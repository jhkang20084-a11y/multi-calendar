// Firebase 자동 배포 스크립트
//   준비(둘 중 하나):
//     ① FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY 를 키 파일의 project_id, client_email, private_key 값으로
//     ② FIREBASE_SERVICE_ACCOUNT 에 서비스 계정 키 JSON 전체(한 줄)
//         (또는 로컬에서 `npx firebase login` 후 FIREBASE_PROJECT_ID 만 지정)
//   실행: npm run deploy:auto
// 하는 일: 웹 앱 등록/설정값 생성 → Firestore DB 확인(없으면 서울 리전에 생성) → Google 로그인 사용 여부 확인
//          → 공휴일 사본 갱신 → 빌드 → hosting + firestore 규칙 + 색인 배포 → 서버 함수 배포(Blaze 요금제일 때)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const log = (m) => console.log(`\n▶ ${m}`);
const fail = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };

// ── 인증 ────────────────────────────────────────────────────────────────
let projectId = process.env.FIREBASE_PROJECT_ID;
// 기본값(동시 업로드 200개)은 느린 회선(Cloud Shell 등)에서 시간 초과로 실패하므로 줄인다.
const env = { FIREBASE_HOSTING_UPLOAD_CONCURRENCY: '8', ...process.env };
let key = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch { fail('FIREBASE_SERVICE_ACCOUNT 가 올바른 JSON 이 아닙니다(키 파일 내용 전체를 한 줄로 넣어야 합니다).'); }
} else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  // 키 파일에서 값 3개만 한 줄씩 넣은 경우: private_key 안의 \n 글자를 실제 줄바꿈으로 바꾼다.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY.trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  if (!privateKey.includes('BEGIN PRIVATE KEY')) fail('FIREBASE_PRIVATE_KEY 에는 키 파일의 private_key 값(-----BEGIN PRIVATE KEY----- 로 시작)을 넣어야 합니다.');
  if (!projectId) fail('FIREBASE_PROJECT_ID 도 함께 넣어 주세요(키 파일의 project_id 값).');
  key = {
    type: 'service_account', project_id: projectId,
    client_email: process.env.FIREBASE_CLIENT_EMAIL.trim().replace(/^"|"$/g, ''), private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}
if (key) {
  if (key.type !== 'service_account') fail('서비스 계정 키(JSON)가 아닙니다.');
  const dir = mkdtempSync(join(tmpdir(), 'fb-'));
  const keyPath = join(dir, 'key.json');
  writeFileSync(keyPath, JSON.stringify(key), { mode: 0o600 });
  env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
  projectId = projectId || key.project_id;
}
if (!projectId) {
  // 로그인한 계정(firebase login / Cloud Shell)의 프로젝트가 하나뿐이면 그것을 쓴다.
  let projects = [];
  try {
    const out = execFileSync('npx', ['firebase', 'projects:list', '--json', '--non-interactive'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    projects = (JSON.parse(out).result || []).filter((p) => p.projectId && !p.projectId.startsWith('demo-'));
  } catch {
    fail('Firebase 에 로그인되어 있지 않습니다. 먼저 `npx firebase login --no-localhost` 를 실행하세요.');
  }
  if (projects.length === 1) projectId = projects[0].projectId;
  else if (!projects.length) fail('이 계정에 Firebase 프로젝트가 없습니다. console.firebase.google.com 에서 먼저 만드세요.');
  else {
    console.log('\n프로젝트가 여러 개입니다. 배포할 프로젝트 ID 를 골라 아래처럼 다시 실행하세요:');
    projects.forEach((p) => console.log(`  FIREBASE_PROJECT_ID=${p.projectId} npm run deploy:auto   (${p.displayName || ''})`));
    process.exit(1);
  }
}

const fb = (args, opts = {}) => execFileSync('npx', ['firebase', ...args, '--project', projectId, '--non-interactive'],
  { cwd: root, env, encoding: 'utf8', stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
const fbJson = (args) => JSON.parse(fb([...args, '--json'])).result;

log(`대상 프로젝트: ${projectId}`);

// ── 웹 앱 + 설정값 ────────────────────────────────────────────────────────
log('웹 앱 확인');
let apps = fbJson(['apps:list', 'WEB']) || [];
if (!apps.length) {
  log('웹 앱이 없어 새로 등록합니다');
  fb(['apps:create', 'WEB', '함께 캘린더']);
  apps = fbJson(['apps:list', 'WEB']);
}
const appId = apps[0].appId;
const sdk = fbJson(['apps:sdkconfig', 'WEB', appId]);
const cfg = sdk.sdkConfig || sdk;
writeFileSync(join(root, '.env.production.local'), [
  `VITE_FIREBASE_API_KEY=${cfg.apiKey}`,
  `VITE_FIREBASE_AUTH_DOMAIN=${cfg.authDomain || `${projectId}.firebaseapp.com`}`,
  `VITE_FIREBASE_PROJECT_ID=${cfg.projectId}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${cfg.storageBucket || ''}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId || ''}`,
  `VITE_FIREBASE_APP_ID=${cfg.appId}`,
  '',
].join('\n'));
console.log(`  웹 앱 ${appId} 설정값을 .env.production.local 에 저장`);

// ── Firestore ────────────────────────────────────────────────────────────
log('Firestore 데이터베이스 확인');
let hasDb = false;
try { hasDb = (fbJson(['firestore:databases:list']) || []).some((d) => d.name?.endsWith('/databases/(default)')); } catch { /* 권한/미사용 */ }
if (!hasDb) {
  try {
    fb(['firestore:databases:create', '(default)', '--location', 'asia-northeast3'], { inherit: true });
  } catch {
    fail('Firestore 데이터베이스를 만들지 못했습니다. Firebase 콘솔 > Firestore Database > 데이터베이스 만들기(서울, 프로덕션 모드)를 눌러 주세요.');
  }
}

// ── Google 로그인 사용 여부(확인만) ───────────────────────────────────────
log('Google 로그인 사용 설정 확인');
try {
  const { GoogleAuth } = await import('google-auth-library');
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const res = await client.request({
    url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs/google.com`,
    validateStatus: () => true,
    headers: { 'x-goog-user-project': projectId },
  });
  if (res.status === 200 && res.data.enabled) console.log('  Google 로그인: 사용 중');
  else console.warn('  ⚠ Google 로그인이 꺼져 있습니다. 콘솔 > Authentication > 로그인 방법 > Google 을 사용 설정해야 로그인할 수 있습니다.');
} catch (e) {
  console.warn(`  ⚠ Google 로그인 상태를 확인하지 못했습니다(${e.message}). 콘솔에서 직접 확인하세요.`);
}

// ── 빌드 + 배포 ──────────────────────────────────────────────────────────
log('공휴일 사본 갱신 + 빌드');
execFileSync('npm', ['run', 'holidays:update'], { cwd: root, env, stdio: 'inherit' });
execFileSync('npx', ['vite', 'build'], { cwd: root, env, stdio: 'inherit' });

log('배포 (hosting, firestore 규칙, 색인)');
// 네트워크가 불안정하면 일부 파일 업로드가 실패할 수 있다. 이미 올라간 파일은 다시 올리지 않으므로 재시도하면 이어서 진행된다.
for (let attempt = 1; ; attempt++) {
  try {
    fb(['deploy', '--only', 'hosting,firestore:rules,firestore:indexes', '--force'], { inherit: true });
    break;
  } catch {
    if (attempt >= 5) fail('배포에 5번 실패했습니다. 잠시 뒤 다시 실행하거나, 위에 나온 오류를 확인하세요.');
    console.warn(`\n⚠ 배포 ${attempt}번째 시도 실패 — 이어서 다시 시도합니다 (${attempt + 1}/5)`);
  }
}

// ── 외부 캘린더(아이폰 링크)용 서버 함수 ──────────────────────────────────
// Cloud Functions 는 Blaze(사용량 기반) 요금제에서만 배포된다. 실패해도 앱 자체는 위에서 이미 배포됐다.
log('서버 함수 배포 (외부 캘린더 가져오기)');
let functionsOk = false;
try {
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: join(root, 'functions'), env, stdio: 'inherit' });
  fb(['deploy', '--only', 'functions', '--force'], { inherit: true });
  functionsOk = true;
} catch {
  console.warn([
    '',
    '⚠ 서버 함수는 배포하지 못했습니다. 앱은 정상 동작하지만 "아이폰 캘린더 가져오기"만 동작하지 않습니다.',
    '  대부분 요금제 때문입니다. Firebase 콘솔 왼쪽 아래 "업그레이드" → Blaze 로 바꾼 뒤(예산 알림 1,000원 정도 권장)',
    '  `npm run deploy:auto` 를 다시 실행하세요. 개인 사용량은 무료 한도 안이라 보통 요금이 나오지 않습니다.',
  ].join('\n'));
}

console.log(`\n✅ 배포 완료: https://${projectId}.firebaseapp.com`);
console.log('   (휴대폰 홈 화면에는 위 주소로 들어가서 추가하세요. .web.app 주소는 자동으로 이 주소로 이동합니다.)');
if (!functionsOk) console.log('   (아이폰 캘린더 가져오기는 Blaze 요금제로 바꾼 뒤 다시 배포하면 켜집니다.)');
console.log('   (Firestore 색인은 몇 분 뒤에 준비됩니다. 그 전에는 일정 목록이 잠시 비어 보일 수 있습니다.)');
