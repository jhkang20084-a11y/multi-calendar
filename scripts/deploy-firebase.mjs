// Firebase 자동 배포 스크립트
//   준비(둘 중 하나):
//     ① FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY 를 키 파일의 project_id, client_email, private_key 값으로
//     ② FIREBASE_SERVICE_ACCOUNT 에 서비스 계정 키 JSON 전체(한 줄)
//         (또는 로컬에서 `npx firebase login` 후 FIREBASE_PROJECT_ID 만 지정)
//   실행: npm run deploy:auto
// 하는 일: 웹 앱 등록/설정값 생성 → Firestore DB 확인(없으면 서울 리전에 생성) → Google 로그인 사용 여부 확인
//          → 공휴일 사본 갱신 → 빌드 → hosting + firestore 규칙 + 색인 배포
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const log = (m) => console.log(`\n▶ ${m}`);
const fail = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };

// ── 인증 ────────────────────────────────────────────────────────────────
let projectId = process.env.FIREBASE_PROJECT_ID;
const env = { ...process.env };
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
if (!projectId) fail('프로젝트를 알 수 없습니다. FIREBASE_SERVICE_ACCOUNT 또는 FIREBASE_PROJECT_ID 를 설정하세요.');

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
fb(['deploy', '--only', 'hosting,firestore:rules,firestore:indexes', '--force'], { inherit: true });

console.log(`\n✅ 배포 완료: https://${projectId}.web.app`);
console.log('   (Firestore 색인은 몇 분 뒤에 준비됩니다. 그 전에는 일정 목록이 잠시 비어 보일 수 있습니다.)');
