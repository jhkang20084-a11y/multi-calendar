// 아이폰 앱 연결 E2E: 앱(WKWebView)이 넣어 주는 window.__kittyNative / messageHandlers 를 흉내 내어
// 로그인 요청 → 토큰으로 로그인 → 위젯 연결(피드 주소) → 일정 변경 시 새로 고침 → 로그아웃 알림, 그리고
// Safari 로그인 창 페이지(/?nativeLogin=1)가 구글 토큰을 만들어 앱으로 돌려주는지 확인한다.
// 실행 전: 에뮬레이터(auth,firestore,functions) + npm run dev:emu   실행: node tests/e2e/native-bridge.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173';
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await ctx.addInitScript(() => {
  if (new URLSearchParams(location.search).has('nativeLogin')) return; // Safari 로그인 창은 앱 밖(일반 Safari)
  window.__kittyNative = { platform: 'ios' };
  window.__sent = [];
  window.webkit = { messageHandlers: { kittyNative: { postMessage: (m) => window.__sent.push(JSON.parse(JSON.stringify(m))) } } };
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const step = (s) => console.log(`▶ ${s}`);
const sent = () => p.evaluate(() => window.__sent);
const waitSent = (type, after = 0, timeout = 15000) => p.waitForFunction(([t, n]) => window.__sent.slice(n).find((m) => m.type === t), [type, after], { timeout }).then((h) => h.jsonValue());

try {
  await p.goto(URL);
  step('로그인 버튼 → 앱에 로그인 요청');
  await p.getByRole('button', { name: /Google 계정으로 로그인/ }).click();
  await waitSent('login');
  step('앱이 Safari 로그인 창에서 받은 토큰을 돌려주면 로그인');
  const email = `native-${Date.now()}@example.com`;
  await p.evaluate((e) => window.__kittyAuthResult({ idToken: JSON.stringify({ sub: e, email: e, email_verified: true, name: '지수' }), accessToken: '' }), email);
  await p.locator('.month').waitFor();

  step('위젯 연결: 피드 주소를 앱에 전달하고, 그 주소로 일정 피드를 받을 수 있음');
  const w = await waitSent('widget');
  if (!/widgetFeed\?t=[A-Za-z0-9_-]{43}$/.test(w.feedUrl)) throw new Error(`피드 주소 이상: ${w.feedUrl}`);
  const res = await fetch(w.feedUrl);
  const body = await res.json();
  if (res.status !== 200 || body.calendar?.name !== '내 캘린더' || body.days.length !== 14) throw new Error(`피드 응답 이상: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);

  step('일정을 추가하면 위젯 새로 고침 알림');
  const before = (await sent()).length;
  await p.getByRole('button', { name: '새 일정' }).click();
  await p.getByPlaceholder('일정 제목').fill('위젯에 보일 일정');
  await p.getByRole('button', { name: '저장' }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
  await waitSent('widgetRefresh', before);
  const after = await (await fetch(w.feedUrl)).json();
  if (!JSON.stringify(after).includes('위젯에 보일 일정')) throw new Error('새 일정이 피드에 없음');

  step('설정: 위젯 영역이 보이고, 앱에서는 알림 안내가 바뀜');
  await p.locator('.menu-btn').click();
  await p.getByRole('button', { name: '설정', exact: true }).click();
  await p.getByText('홈 화면 위젯').waitFor();
  await p.screenshot({ path: 'test-results/native-1-settings.png' });
  step('위젯 다시 연결 → 예전 주소는 끊기고 새 주소 전달');
  const n2 = (await sent()).length;
  await p.getByRole('button', { name: '위젯 다시 연결' }).click();
  const w2 = await waitSent('widget', n2);
  if (w2.feedUrl === w.feedUrl) throw new Error('주소가 바뀌지 않음');
  if ((await fetch(w.feedUrl)).status !== 401) throw new Error('예전 주소가 아직 동작함');
  if ((await fetch(w2.feedUrl)).status !== 200) throw new Error('새 주소가 동작하지 않음');

  step('로그아웃 → 앱에 알림(위젯 비우기)');
  const n3 = (await sent()).length;
  await p.getByRole('button', { name: '로그아웃' }).click();
  await waitSent('signedOut', n3);

  step('Safari 로그인 창 페이지: 바로 구글 로그인(리디렉션)으로 넘어감');
  // 구글에서 돌아온 뒤 토큰을 꺼내는 마지막 단계는 apis.google.com 스크립트가 필요해 이 테스트 환경(외부 접속 차단)에서는 확인할 수 없다.
  // 그 단계는 기존 아이폰 웹 로그인과 같은 getRedirectResult 를 쓴다.
  const q = await ctx.newPage();
  await q.goto(`${URL}/?nativeLogin=1`);
  await q.waitForURL(/\/emulator\/auth\/handler\?.*authType=signInViaRedirect/, { timeout: 20000 });
  await q.getByText(/Add new account/i).waitFor();

  console.log('\n✅ 아이폰 앱 연결 E2E 통과');
} catch (e) {
  console.error('\n❌ 실패:', e.message);
  await p.screenshot({ path: 'test-results/native-fail.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('페이지 오류:', errors);
  await browser.close();
}
