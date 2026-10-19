// 링크 초대 E2E: A(PC)가 링크를 만들고, 처음 오는 C(iPhone 화면)가 링크 → 로그인 → 참여
// 실행 전: npm run emulators + npm run dev:emu   실행: node tests/e2e/invite-link.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173';
mkdirSync('test-results', { recursive: true });
const run = Date.now().toString(36);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await ctxA.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL });
const ctxC = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const A = await ctxA.newPage();
const C = await ctxC.newPage();
const errors = [];
for (const [n, p] of [['A', A], ['C', C]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
const step = (s) => console.log(`▶ ${s}`);

try {
  step('A 로그인, 공유 캘린더 생성');
  await A.goto(URL);
  await A.getByRole('button', { name: /Google 계정으로 로그인/ }).waitFor();
  await A.evaluate((e) => window.__emuSignIn(e, 'Alice'), `alice-${run}@example.com`);
  await A.locator('.month').waitFor();
  await A.getByRole('button', { name: '새 캘린더' }).click();
  await A.getByPlaceholder(/커플 캘린더/).fill('독서 모임');
  await A.getByRole('button', { name: '만들기' }).click();
  await A.locator('.toast-success', { hasText: '캘린더를 만들었습니다' }).waitFor();

  step('A가 열람자 링크 만들기 → 링크 복사');
  await A.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await A.getByRole('tab', { name: '초대' }).click();
  await A.getByRole('combobox', { name: '링크 역할' }).selectOption('viewer');
  await A.getByRole('button', { name: '링크 만들고 보내기' }).click();
  await A.locator('.toast-success', { hasText: '링크를 복사했습니다' }).waitFor();
  const link = await A.evaluate(() => navigator.clipboard.readText());
  if (!/\?join=/.test(link)) throw new Error(`링크 형식 이상: ${link}`);
  await A.locator('.invite-list li', { hasText: '열람자 링크' }).waitFor();
  await A.screenshot({ path: 'test-results/link-1-owner.png' });
  await A.getByRole('button', { name: '닫기' }).click();

  step('C가 링크를 열면 로그인 화면에 초대 안내 → 로그인 → 참여 화면');
  await C.goto(link);
  await C.getByText('캘린더 초대를 받았어요').waitFor();
  if (C.url().includes('join=')) throw new Error('주소창에 초대 코드가 남아 있음');
  await C.screenshot({ path: 'test-results/link-2-login.png' });
  await C.evaluate((e) => window.__emuSignIn(e, 'Carol'), `carol-${run}@example.com`);
  await C.locator('.join-name', { hasText: '독서 모임' }).waitFor({ timeout: 15000 });
  await C.getByText('열람자로 참여합니다').waitFor();
  await C.screenshot({ path: 'test-results/link-3-join.png' });
  await C.getByRole('button', { name: '참여하기' }).click();
  await C.locator('.toast-success', { hasText: '독서 모임에 참여했습니다' }).waitFor();
  await C.locator('.cal-item.active', { hasText: '독서 모임' }).waitFor({ state: 'attached', timeout: 10000 });

  step('A 화면 멤버 목록에 C가 열람자로 표시');
  await A.locator('.cal-item', { hasText: '독서 모임' }).getByRole('button', { name: /설정/ }).click();
  await A.getByRole('tab', { name: /멤버/ }).click();
  await A.locator('.member-list li', { hasText: 'Carol' }).getByRole('combobox', { name: '역할' }).waitFor();
  const role = await A.locator('.member-list li', { hasText: 'Carol' }).getByRole('combobox', { name: '역할' }).inputValue();
  if (role !== 'viewer') throw new Error(`역할 이상: ${role}`);

  step('A가 링크 취소 → 같은 링크로 새 사용자 D는 참여 불가');
  await A.getByRole('tab', { name: '초대' }).click();
  await A.locator('.invite-list li', { hasText: '열람자 링크' }).getByRole('button', { name: '취소' }).click();
  await A.getByRole('button', { name: '취소하기' }).click();
  await A.locator('.toast-success', { hasText: '링크를 취소했습니다' }).waitFor();
  const ctxD = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const D = await ctxD.newPage();
  await D.goto(link);
  await D.getByRole('button', { name: /Google 계정으로 로그인/ }).waitFor();
  await D.evaluate((e) => window.__emuSignIn(e, 'Dave'), `dave-${run}@example.com`);
  await D.locator('.toast-error', { hasText: '초대 링크가 올바르지 않거나 취소되었습니다' }).waitFor({ timeout: 15000 });
  if (await D.locator('.join-name').count()) throw new Error('취소된 링크로 참여 화면이 나옴');

  console.log('\n✅ 링크 초대 E2E 통과');
} catch (e) {
  console.error('\n❌ 실패:', e.message);
  await A.screenshot({ path: 'test-results/link-fail-A.png' }).catch(() => {});
  await C.screenshot({ path: 'test-results/link-fail-C.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('페이지 오류:', errors);
  await browser.close();
}
