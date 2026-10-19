// 아이폰(iCloud) 캘린더 링크 가져오기 E2E (iPhone 13 화면)
// 실행 전: 에뮬레이터(auth,firestore,functions) + npm run dev:emu   실행: node tests/e2e/external.mjs
// 이 스크립트가 가짜 iCloud 서버(로컬 HTTP)를 띄운다. 에뮬레이터의 서버 함수는 https://127.0.0.1 을 http 로 불러온다.
import { chromium, devices } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173';
mkdirSync('test-results', { recursive: true });
const ics = readFileSync('tests/fixtures/icloud-sample.ics', 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/published/2/abc') { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `https://127.0.0.1:${server.address().port}/published/2/abc`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const step = (s) => console.log(`▶ ${s}`);

try {
  await p.goto(URL);
  await p.getByRole('button', { name: /Google 계정으로 로그인/ }).waitFor();
  await p.evaluate((e) => window.__emuSignIn(e, '지수'), `ext-${Date.now()}@example.com`);
  await p.locator('.month').waitFor();

  step('캘린더 설정 → 구독 → 아이폰 링크 붙여 넣기');
  await p.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await p.getByRole('tab', { name: '구독' }).click();
  await p.getByRole('button', { name: /아이폰\(iCloud\) 캘린더 링크로 가져오기/ }).click();
  await p.getByText('아이폰에서 링크 복사하는 방법').waitFor();
  await p.getByPlaceholder(/webcal:\/\//).fill(feed);
  await p.locator('.external-form .color-picker .swatch').nth(6).click();
  await p.screenshot({ path: 'test-results/ext-1-form.png' });
  await p.locator('.external-form').getByRole('button', { name: '가져오기' }).click();
  await p.locator('.toast-success', { hasText: '일정을 가져오는 중' }).waitFor();

  step('목록에 가져온 일정 개수 표시');
  await p.locator('.invite-list', { hasText: /일정 8개/ }).waitFor({ timeout: 30000 });
  await p.screenshot({ path: 'test-results/ext-2-status.png' });
  await p.getByRole('button', { name: '닫기' }).click();

  step('달력에 아이폰 일정이 나타남(제주 여행은 여러 날 막대)');
  await p.locator('.month', { hasText: '저녁 약속' }).waitFor({ timeout: 20000 });
  await p.locator('.month', { hasText: '제주 여행' }).waitFor();
  await p.screenshot({ path: 'test-results/ext-3-month.png', fullPage: true });

  step('가져온 일정은 읽기 전용으로 열림');
  await p.locator('.month').getByText('저녁 약속').first().click();
  await p.locator('.modal').waitFor();
  const modal = p.locator('.modal').last();
  if (await modal.getByRole('button', { name: '저장' }).count()) throw new Error('가져온 일정이 수정 창으로 열림');
  await modal.getByText(/아이폰에서/).first().waitFor();
  await p.screenshot({ path: 'test-results/ext-4-detail.png' });

  console.log('\n✅ 아이폰 캘린더 가져오기 E2E 통과');
} catch (e) {
  console.error('\n❌ 실패:', e.message);
  await p.screenshot({ path: 'test-results/ext-fail.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('페이지 오류:', errors);
  await browser.close();
  server.close();
}
