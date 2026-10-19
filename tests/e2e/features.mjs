// 새 기능 E2E (iPhone 13 화면): 날짜 탭→입력, 분류 색, 할 일 함께 등록, 네이버 지도, 기념일 100일,
// 분류 색 변경(저장 시 창 닫힘), 구독 일정 색 고정, 확대 방지 설정
// 실행 전: npm run emulators + npm run dev:emu   실행: node tests/e2e/features.mjs
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173';
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const step = (s) => console.log(`▶ ${s}`);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

try {
  await p.goto(URL);
  await p.getByRole('button', { name: /Google 계정으로 로그인/ }).waitFor();
  await p.evaluate((e) => window.__emuSignIn(e, '지수'), `feat-${Date.now()}@example.com`);
  await p.locator('.month').waitFor();

  step('확대 방지: viewport, 입력칸 16px 이상, 가로 넘침 없음');
  const vp = await p.locator('meta[name=viewport]').getAttribute('content');
  if (!vp.includes('maximum-scale=1') || !vp.includes('user-scalable=no')) throw new Error(`viewport: ${vp}`);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`가로로 ${overflow}px 넘침`);

  step('월 이동 버튼 없음, 손가락으로 끌어서 넘기기');
  if (await p.getByRole('button', { name: '다음' }).count()) throw new Error('월 이동 버튼이 남아 있음');
  const cdp = await ctx.newCDPSession(p);
  async function swipe(fromX, toX, y = 420, steps = 8, ms = 16) {
    const pt = (x) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(fromX) });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(fromX + ((toX - fromX) * i) / steps) });
      await p.waitForTimeout(ms);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const monthText = () => p.locator('.month-name').textContent();
  const startMonth = await monthText();
  await swipe(340, 300); // 조금만 밀면 제자리
  await p.waitForTimeout(500);
  if (await monthText() !== startMonth) throw new Error('조금 밀었는데 월이 넘어감');
  if (await p.locator('.modal').count()) throw new Error('끌기 동작 뒤에 입력 창이 열림');
  await swipe(350, 60, 420, 10, 16); // 왼쪽으로 크게 밀기 → 다음 달
  await p.waitForTimeout(120);
  await p.screenshot({ path: 'test-results/swipe-mid.png' });
  await p.waitForTimeout(600);
  const next = await monthText();
  if (next === startMonth) throw new Error('밀었는데 월이 안 넘어감');
  if (await p.locator('.modal').count()) throw new Error('넘기기 뒤에 입력 창이 열림');
  await swipe(40, 330, 420, 10, 16); // 오른쪽으로 → 다시 이번 달
  await p.waitForTimeout(800);
  if (await monthText() !== startMonth) throw new Error(`되돌아오지 않음: ${await monthText()}`);

  step('오늘 날짜에만 동그라미, 형광펜 없음');
  const todayMarks = await p.locator(`.cell[aria-label^="${today}"] .daynum`).evaluate((el) => ({
    circle: getComputedStyle(el, '::after').borderTopStyle, marker: getComputedStyle(el, '::before').content,
  }));
  if (todayMarks.circle !== 'solid' || todayMarks.marker !== 'none') throw new Error(`오늘 표시 이상: ${JSON.stringify(todayMarks)}`);
  const other = addDays(today, today.slice(8) === '15' ? 1 : (Number(today.slice(8)) > 15 ? -3 : 3));

  step('날짜를 누르면 그날 일정 목록 창 → 바깥을 누르면 닫힘');
  await p.locator(`.cell[aria-label^="${other}"] .daynum`).click();
  await p.getByRole('dialog', { name: `${other} 일정` }).waitFor();
  const otherCircle = await p.locator(`.cell[aria-label^="${other}"] .daynum`).evaluate((el) => getComputedStyle(el, '::after').content);
  if (otherCircle !== 'none') throw new Error('누른 날짜에 동그라미가 생김');
  await p.mouse.click(195, 40); // 창 바깥(위쪽 어두운 부분)
  await p.getByRole('dialog').waitFor({ state: 'detached' });

  step('날짜 → 그날 목록 → 일정 추가 → 입력 창');
  await p.locator(`.cell[aria-label^="${today}"] .daynum`).click();
  await p.getByRole('dialog', { name: `${today} 일정` }).getByRole('button', { name: /일정 추가/ }).click();
  await p.locator('.modal', { hasText: '새 일정' }).waitFor();
  const fontSize = await p.locator('.modal input.title-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  if (fontSize < 16) throw new Error(`입력칸 글자 ${fontSize}px (iPhone 자동 확대)`);
  if (await p.getByText('시간대', { exact: true }).count()) throw new Error('일정 입력에 시간대 칸이 남아 있음');
  if (!(await p.locator('input[type=datetime-local]').first().inputValue()).startsWith(today)) throw new Error('누른 날짜가 들어가지 않음');

  step('분류(병원) 고르기 + 장소 + 할 일 2개 함께 등록');
  await p.locator('.title-input').fill('치과 검진');
  await p.getByRole('radio', { name: '병원' }).click();
  await p.locator('label.field', { hasText: '장소' }).locator('input').fill('강남역 치과');
  const map = await p.locator('a.map-link').getAttribute('href');
  if (!map.startsWith('https://map.naver.com/p/search/')) throw new Error(`지도 링크: ${map}`);
  const todo = p.getByRole('textbox', { name: '할 일 입력' });
  await todo.fill('보험증 챙기기'); await todo.press('Enter');
  await todo.fill('치실 사기');
  await p.getByRole('button', { name: '저장' }).click();
  await p.locator('.toast-success', { hasText: '일정을 추가했습니다' }).waitFor();

  step('저장 후 그날 목록으로 돌아오고, 목록에서 바로 완료 체크');
  const dayDlg = p.getByRole('dialog', { name: `${today} 일정` });
  await dayDlg.locator('.day-item', { hasText: '치과 검진' }).waitFor();
  await dayDlg.getByRole('checkbox', { name: '치과 검진 완료' }).click();
  await dayDlg.locator('.day-item .chip-done', { hasText: '치과 검진' }).waitFor();
  await p.screenshot({ path: 'test-results/feat-day-list.png' });
  await dayDlg.getByRole('checkbox', { name: '치과 검진 완료' }).click(); // 완료 취소
  await dayDlg.locator('.day-item .ruled-item:not(.chip-done)', { hasText: '치과 검진' }).waitFor();
  await p.getByRole('button', { name: '닫기' }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
  const chip = p.locator('.chip', { hasText: '치과 검진' }).first();
  const color = await chip.evaluate((el) => el.style.getPropertyValue('--c'));
  if (color !== '#e4513a') throw new Error(`병원 분류 색이 아님: ${color}`);
  const marker = await chip.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
  if (!marker || marker === 'rgba(0, 0, 0, 0)') throw new Error('형광펜 배경이 없음');

  step('일정을 누르면 바로 수정 화면: 할 일 2개, 네이버 지도 링크, 삭제 버튼');
  await chip.click();
  await p.locator('.modal', { hasText: '일정 수정' }).waitFor();
  await p.locator('.todos li', { hasText: '보험증 챙기기' }).waitFor();
  await p.locator('.todos li', { hasText: '치실 사기' }).waitFor();
  await p.locator('.modal a.map-link', { hasText: '강남역 치과' }).waitFor();
  await p.getByRole('button', { name: '삭제', exact: true }).waitFor();
  // 수정 화면의 할 일 추가가 일정 저장으로 이어지지 않는지
  await p.getByPlaceholder('할 일 추가').fill('예약 확인 전화');
  await p.locator('.todo-add').getByRole('button', { name: '추가' }).click();
  await p.locator('.todos li', { hasText: '예약 확인 전화' }).waitFor();
  if (!(await p.locator('.modal', { hasText: '일정 수정' }).count())) throw new Error('할 일 추가 후 수정 화면이 닫힘');
  await p.screenshot({ path: 'test-results/feat-1-detail.png' });
  await p.getByRole('button', { name: '닫기' }).click();

  step('기념일: 오늘이 100일이 되도록 등록 → 오늘 칸에 "100일" 자동 표시');
  await p.getByRole('button', { name: '새 일정' }).click();
  await p.getByRole('button', { name: '기념일' }).click();
  await p.locator('.title-input').fill('사귄 날');
  await p.locator('label.field', { hasText: '기념일(시작일)' }).locator('input').fill(addDays(today, -99));
  await p.getByRole('button', { name: '저장' }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
  await p.locator(".week .chip", { hasText: "사귄 날 100일" }).waitFor();

  step('여러 날 일정은 이어진 막대 하나(제목 한 번)로 표시');
  await p.getByRole('button', { name: '새 일정' }).click();
  await p.locator('.title-input').fill('제주 여행');
  await p.locator('label.check', { hasText: '종일' }).locator('input').check();
  await p.locator('label.field', { hasText: '시작일' }).locator('input').fill(today);
  await p.locator('label.field', { hasText: '종료일' }).locator('input').fill(addDays(today, 2));
  await p.getByRole('button', { name: '저장' }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
  const bars = p.locator('.chip.bar', { hasText: '제주 여행' });
  await bars.first().waitFor();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 일요일 시작 달력
  const expected = dow + 2 >= 7 ? 2 : 1; // 주가 바뀌면 다음 줄에 이어서 한 번 더
  if (await bars.count() !== expected) throw new Error(`막대 수 ${await bars.count()} (예상 ${expected})`);
  const cellW = await p.locator('.week .cell').first().evaluate((el) => el.getBoundingClientRect().width);
  const barW = await bars.first().evaluate((el) => el.getBoundingClientRect().width);
  if (expected === 1 && barW < cellW * 2.5) throw new Error(`막대가 3칸에 걸치지 않음 (${barW} / 칸 ${cellW})`);
  await p.screenshot({ path: 'test-results/feat-0-bars.png' });

  step('캘린더 설정(⋯) → 분류 색 변경 → 저장하면 창이 저절로 닫히고 일정 색이 바뀜');
  await p.locator('.menu-btn').click();
  await p.locator('.cal-name-btn', { hasText: '내 캘린더' }).click();
  await p.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await p.getByRole('tab', { name: '분류' }).click();
  await p.getByRole('button', { name: '병원 색 바꾸기' }).click();
  await p.locator('.category-colors .swatch').nth(7).click(); // 라벤더 #9b87c4
  await p.getByRole('button', { name: '저장' }).click();
  await p.locator('.modal').waitFor({ state: 'detached' });
  // 달력 칸이 꽉 차면 접히므로, 아래 Schedule(오늘 일정) 목록의 색 막대로 확인
  await p.waitForFunction(() => {
    const el = [...document.querySelectorAll('.ruled-item')].find((c) => c.textContent.includes('치과 검진'));
    return el && el.style.getPropertyValue('--c') === '#9b87c4';
  }, null, { timeout: 10000 });
  await p.screenshot({ path: 'test-results/feat-2-month.png', fullPage: true });

  step('구독할 때 고른 색으로 구독 일정 표시(분류와 상관없이), 이모티콘 없음');
  await p.locator('.menu-btn').click();
  await p.getByRole('button', { name: '새 캘린더' }).click();
  await p.getByPlaceholder(/커플 캘린더/).fill('우리 둘');
  await p.getByRole('button', { name: '만들기' }).click();
  await p.locator('.toast-success', { hasText: '캘린더를 만들었습니다' }).waitFor();
  await p.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await p.getByRole('tab', { name: '구독' }).click();
  await p.getByRole('combobox', { name: '구독할 캘린더' }).selectOption({ label: '내 캘린더' });
  await p.locator('.invite-form .color-picker .swatch').nth(4).click(); // 구독 색: 머스터드 #d9b44a
  await p.locator('.invite-form').getByRole('button', { name: '구독' }).click();
  await p.locator('.toast-success', { hasText: '구독을 시작했습니다' }).waitFor();
  await p.getByRole('button', { name: '닫기' }).click();
  const sub = p.locator('.ruled-item', { hasText: '치과 검진' }).first();
  await sub.waitFor({ timeout: 10000 });
  const subColor = await sub.evaluate((el) => el.style.getPropertyValue('--c'));
  if (subColor !== '#d9b44a') throw new Error(`구독 일정이 구독할 때 고른 색(#d9b44a)이 아님: ${subColor}`);
  if ((await sub.textContent()).includes('🔗')) throw new Error('구독 이모티콘이 남아 있음');
  if (await p.getByRole('button', { name: '구독 관리' }).count()) throw new Error('달력 화면에 구독 관리 버튼이 남아 있음');
  await p.screenshot({ path: 'test-results/feat-3-subscribed.png' });

  console.log('\n✅ 새 기능 E2E 통과');
} catch (e) {
  console.error('\n❌ 실패:', e.message);
  await p.screenshot({ path: 'test-results/feat-fail.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('페이지 오류:', errors);
  await browser.close();
}
