// 브라우저 UI 스모크 테스트 (두 사용자: PC 화면 A, iPhone 크기 화면 B)
// 실행 전: npm run emulators  (다른 터미널) + npm run dev:emu  (다른 터미널)
// 실행: node tests/e2e/ui-smoke.mjs   → 스크린샷은 test-results/ 에 저장
import { chromium, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173';
const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const A_EMAIL = `alice-${run}@example.com`;
const B_EMAIL = `bob-${run}@example.com`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const ctxB = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errors = [];
for (const [name, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
}
const step = (s) => console.log(`▶ ${s}`);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

async function login(p, email, name) {
  await p.goto(URL);
  await p.getByRole('button', { name: /Google 계정으로 로그인/ }).waitFor();
  await p.evaluate(([e, n]) => window.__emuSignIn(e, n), [email, name]);
}
async function openMenu(p) {
  if (await p.locator('.menu-btn').isVisible() && !(await p.locator('.sidebar.open').count())) await p.locator('.menu-btn').click();
}

try {
  step('1. A, B 로그인 → 개인 캘린더 자동 생성');
  await login(A, A_EMAIL, 'Alice');
  await login(B, B_EMAIL, 'Bob');
  await A.getByText('내 캘린더').first().waitFor();
  await shot(A, '01-a-first-login');

  step('2. A가 공유 캘린더 생성');
  await A.getByRole('button', { name: '새 캘린더' }).click();
  await A.getByPlaceholder(/커플 캘린더/).fill('커플 캘린더');
  await A.getByRole('button', { name: /공유/ }).click();
  await A.getByRole('button', { name: '만들기' }).click();
  await A.locator('.toast-success', { hasText: '캘린더를 만들었습니다' }).waitFor();

  step('2. A가 B를 편집자로 초대');
  await A.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await A.getByRole('tab', { name: '초대' }).click();
  await A.getByPlaceholder('상대방 Google 계정 이메일').fill(B_EMAIL);
  await A.locator('.invite-form').getByRole('button', { name: '초대' }).click();
  await A.locator('.status-pending').waitFor();
  await shot(A, '02-a-invited');
  await A.getByRole('button', { name: '닫기' }).click();

  step('3. B가 초대 수락 (모바일)');
  await openMenu(B);
  await B.getByRole('button', { name: /받은 초대 1건/ }).click();
  await shot(B, '03-b-invitation');
  await B.getByRole('button', { name: '수락' }).click();
  await B.locator('.toast-success', { hasText: '참여했습니다' }).waitFor();
  await B.getByRole('button', { name: '닫기' }).click();
  await openMenu(B);
  await B.locator('.cal-name-btn', { hasText: '커플 캘린더' }).click();

  step('4. A가 일정 추가 → B 화면에 실시간 표시');
  await A.getByRole('button', { name: '새 일정' }).click();
  await A.getByPlaceholder('일정 제목').fill('저녁 데이트');
  await A.locator('label.field', { hasText: '장소' }).locator('input').fill('성수동');
  await A.getByRole('button', { name: '저장' }).click();
  await A.locator('.toast-success', { hasText: '일정을 추가했습니다' }).waitFor();
  await B.locator('.chip', { hasText: '저녁 데이트' }).first().waitFor({ timeout: 10000 });
  await shot(B, '04-b-sees-event');

  step('5~6. B가 체크리스트 추가/완료 → A에게 반영');
  await B.locator('.chip', { hasText: '저녁 데이트' }).first().click();
  await B.getByPlaceholder('할 일 추가').fill('꽃 예약');
  await B.locator('.todo-add').getByRole('button', { name: '추가' }).click();
  await B.locator('.todos li', { hasText: '꽃 예약' }).locator('input[type=checkbox]').click();
  await B.locator('.todos li.done', { hasText: '꽃 예약' }).waitFor();
  await shot(B, '05-b-todo-done');
  await A.locator('.chip', { hasText: '저녁 데이트' }).first().click();
  await A.locator('.todos li.done', { hasText: '꽃 예약' }).waitFor({ timeout: 10000 });

  step('5. B가 일정 제목 수정 → A의 열린 상세 화면에 반영');
  await B.getByRole('button', { name: '수정', exact: true }).click();
  await B.getByPlaceholder('일정 제목').fill('저녁 데이트 (7시 반)');
  await B.getByRole('button', { name: '저장' }).click();
  await B.locator('.toast-success', { hasText: '일정을 수정했습니다' }).waitFor();
  await A.locator('.detail-title h3', { hasText: '저녁 데이트 (7시 반)' }).waitFor({ timeout: 10000 });
  await shot(A, '06-a-detail-synced');
  await A.getByRole('button', { name: '닫기' }).click();

  step('7. A가 가족 캘린더를 만들고 기념일 추가, 커플 캘린더에서 구독');
  await A.getByRole('button', { name: '새 캘린더' }).click();
  await A.getByPlaceholder(/커플 캘린더/).fill('가족');
  await A.getByRole('button', { name: '만들기' }).click();
  await A.locator('.toast-success', { hasText: '캘린더를 만들었습니다' }).waitFor();
  await A.getByRole('button', { name: '새 일정' }).click();
  await A.getByRole('button', { name: '기념일' }).click();
  await A.getByPlaceholder(/사귄 날/).fill('엄마 생신');
  const today = await A.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3); d.setUTCFullYear(d.getUTCFullYear() - 30);
  await A.locator('label.field', { hasText: '기념일(시작일)' }).locator('input').fill(d.toISOString().slice(0, 10));
  await A.getByRole('button', { name: '저장' }).click();
  await A.locator('.toast-success', { hasText: '일정을 추가했습니다' }).waitFor();
  await A.locator('.dday-item', { hasText: '엄마 생신' }).waitFor();

  await A.locator('.cal-name-btn', { hasText: '커플 캘린더' }).click();
  await A.getByRole('button', { name: '캘린더 설정', exact: true }).click();
  await A.getByRole('tab', { name: '구독' }).click();
  await A.getByRole('combobox', { name: '구독할 캘린더' }).selectOption({ label: '가족' });
  await A.locator('.invite-form').getByRole('button', { name: '구독' }).click();
  await A.locator('.toast-success', { hasText: '구독을 시작했습니다' }).waitFor();
  await A.getByRole('button', { name: '닫기' }).click();
  await A.locator('.chip', { hasText: /엄마 생신 \d+주년/ }).first().waitFor({ timeout: 10000 });
  await shot(A, '07-a-subscribed-view');

  step('8. 원본(가족)에서 제목 변경 → 구독 화면 반영');
  await A.locator('.chip', { hasText: /엄마 생신 \d+주년/ }).first().click();
  await A.locator('.source-box', { hasText: '가족' }).waitFor();
  await A.getByRole('button', { name: '수정', exact: true }).click();
  await A.getByPlaceholder(/사귄 날/).fill('엄마 생신 🎂');
  await A.getByRole('button', { name: '저장' }).click();
  // 반복(매년) 일정이므로 범위 선택
  await A.getByRole('button', { name: '모든 반복 일정' }).click();
  await A.locator('.toast-success', { hasText: '일정을 수정했습니다' }).waitFor();
  await A.locator('.chip', { hasText: '엄마 생신 🎂' }).first().waitFor();

  step('주간 / 목록 보기, 다크 모드');
  await A.getByRole('tab', { name: '주' }).click();
  await A.locator('.tgrid').waitFor();
  await shot(A, '08-a-week');
  await A.getByRole('tab', { name: '목록' }).click();
  await A.locator('.list').waitFor();
  await shot(A, '09-a-list');
  await B.emulateMedia({ colorScheme: 'dark' });
  await shot(B, '10-b-dark-month');

  step('검색');
  await A.getByRole('button', { name: '검색 열기' }).click();
  await A.getByRole('searchbox', { name: '일정 검색' }).fill('데이트');
  await A.locator('.list-item', { hasText: '저녁 데이트' }).waitFor();
  if (await A.locator('.list-item', { hasText: '엄마' }).count()) throw new Error('검색 필터 실패');

  step('12. 시간만 공개 / 비공개 일정: B에게 세부 내용 미노출');
  await A.getByRole('button', { name: '검색 열기' }).click(); // 검색 닫기(검색어 초기화)
  await A.getByRole('tab', { name: '월' }).click();
  async function quickEvent(p, title, visibility, extra = async () => {}) {
    await p.getByRole('button', { name: '새 일정' }).click();
    await p.getByPlaceholder('일정 제목').fill(title);
    await p.locator('label.field', { hasText: '장소' }).locator('input').fill(`${title} 장소`);
    await p.locator('label.field', { hasText: '공개 범위' }).locator('select').selectOption(visibility);
    await extra();
    await p.getByRole('button', { name: '저장' }).click();
    await p.locator('.toast-success', { hasText: '일정을 추가했습니다' }).last().waitFor();
  }
  await quickEvent(A, '병원 진료', 'busy');
  await quickEvent(A, '깜짝 선물 준비', 'private');
  await A.locator('.chip', { hasText: '병원 진료' }).first().waitFor();
  await A.locator('.chip', { hasText: '깜짝 선물 준비' }).first().waitFor();
  await B.locator('.chip', { hasText: '바쁨' }).first().waitFor({ timeout: 10000 });
  const bText = await B.locator('.month').innerText();
  if (bText.includes('병원') || bText.includes('깜짝')) throw new Error('B 화면에 비공개 세부 내용 노출');
  await B.locator('.chip', { hasText: '바쁨' }).first().click();
  await B.getByText('세부 내용을 볼 수 없습니다').waitFor();
  if (await B.getByRole('button', { name: '수정', exact: true }).count()) throw new Error('B에게 시간만 공개 일정 수정 버튼 노출');
  await shot(B, '11-b-busy-detail');
  await B.getByRole('button', { name: '닫기' }).click();

  step('10. A가 B를 열람자로 변경 → B 화면에서 수정/삭제 버튼 사라짐');
  await A.locator('.cal-item', { hasText: '커플 캘린더' }).getByRole('button', { name: /설정/ }).click();
  await A.getByRole('tab', { name: /멤버/ }).click();
  await A.getByRole('combobox', { name: '역할' }).selectOption('viewer');
  await A.locator('.toast-success', { hasText: '역할을 변경했습니다' }).waitFor();
  await A.getByRole('button', { name: '닫기' }).click();
  await B.locator('.chip', { hasText: '저녁 데이트' }).first().click();
  await B.getByText('내 역할: 열람자').waitFor({ timeout: 10000 });
  if (await B.getByRole('button', { name: '수정', exact: true }).count()) throw new Error('열람자에게 수정 버튼 노출');
  if (await B.locator('.todo-add').count()) throw new Error('열람자에게 할 일 추가 노출');
  await B.getByRole('button', { name: '닫기' }).click();

  step('반복 일정: 매일 5회 → 한 회차만 제목 변경');
  await quickEvent(A, '아침 운동', 'members', async () => {
    await A.getByRole('combobox', { name: '반복 주기' }).selectOption('DAILY');
    await A.getByRole('combobox', { name: '반복 종료' }).selectOption('count');
    await A.locator('.fieldset input[type=number]').last().fill('5');
  });
  await A.getByRole('tab', { name: '목록' }).click();
  await A.locator('.list-item', { hasText: '아침 운동' }).nth(4).waitFor();
  if (await A.locator('.list-item', { hasText: '아침 운동' }).count() !== 5) throw new Error('반복 회차 수 불일치');
  await A.locator('.list-item', { hasText: '아침 운동' }).nth(2).click();
  await A.getByRole('button', { name: '수정', exact: true }).click();
  await A.getByPlaceholder('일정 제목').fill('아침 운동 (쉬는 날)');
  await A.getByRole('button', { name: '저장' }).click();
  await A.getByRole('button', { name: '이 일정만' }).click();
  await A.locator('.toast-success', { hasText: '일정을 수정했습니다' }).last().waitFor();
  await A.locator('.list-item', { hasText: '아침 운동 (쉬는 날)' }).waitFor();
  const total = await A.locator('.list-item', { hasText: '아침 운동' }).count();
  const changed = await A.locator('.list-item', { hasText: '쉬는 날' }).count();
  if (total !== 5 || changed !== 1) throw new Error(`회차 수정 결과 이상: 전체 ${total}, 변경 ${changed}`);
  await B.getByRole('tab', { name: '목록' }).click();
  await B.locator('.list-item', { hasText: '아침 운동 (쉬는 날)' }).waitFor({ timeout: 10000 });
  await shot(A, '12-a-recurring-list');

  step('16. A 오프라인에서 일정 추가 → 복구 후 B에게 전달');
  await ctxA.setOffline(true);
  await A.locator('.sync-offline').waitFor();
  await A.getByRole('button', { name: '새 일정' }).click();
  await A.getByPlaceholder('일정 제목').fill('오프라인 메모');
  await A.getByRole('button', { name: '저장' }).click();
  await A.locator('.toast-info', { hasText: '오프라인 상태' }).waitFor();
  if (await A.locator('.toast-success', { hasText: '동기화 완료' }).count()) throw new Error('오프라인인데 성공 표시');
  await A.locator('.list-item', { hasText: '오프라인 메모' }).first().waitFor();
  await shot(A, '13-a-offline');
  await B.waitForTimeout(1500);
  if (await B.locator('.list-item', { hasText: '오프라인 메모' }).count()) throw new Error('오프라인 데이터가 B에 도달');
  await ctxA.setOffline(false);
  await A.locator('.toast-success', { hasText: '동기화 완료' }).waitFor({ timeout: 20000 });
  await B.locator('.list-item', { hasText: '오프라인 메모' }).waitFor({ timeout: 20000 });

  step('메모·날짜 선택: A가 이달의 메모 작성 → B(열람자)에게 실시간 표시, 날짜를 누르면 그날 일정');
  await A.getByRole('tab', { name: '월' }).click();
  await B.getByRole('tab', { name: '월' }).click();
  await A.getByRole('textbox', { name: '이달의 메모' }).fill('10월엔 단풍 보러 가기 🍁');
  await A.locator('.month-name').click(); // 포커스를 빼면 저장
  await A.locator('.toast-success', { hasText: '메모를 저장했습니다' }).waitFor();
  await B.locator('textarea.memo-area').evaluate((el) => el.scrollIntoView());
  await B.waitForFunction(() => document.querySelector('textarea.memo-area')?.value.includes('단풍'), null, { timeout: 10000 });
  if (!(await B.locator('textarea.memo-area').evaluate((el) => el.readOnly))) throw new Error('열람자 메모가 편집 가능');
  const today2 = await A.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
  // 열람자는 날짜를 눌러도 일정을 만들 수 있는 캘린더만 고를 수 있다(개인 캘린더). 닫으면 그날 일정이 보인다.
  await B.locator(`.cell[aria-label^="${today2}"] .daynum`).click();
  if (await B.locator('.modal').count()) await B.getByRole('button', { name: '닫기' }).click();
  await B.locator('.ruled-item', { hasText: '저녁 데이트' }).waitFor();
  await shot(B, '14-b-memo-schedule');

  console.log('\n✅ UI 스모크 테스트 통과');
} catch (e) {
  console.error('\n❌ 실패:', e.message);
  await shot(A, 'fail-A').catch(() => {});
  await shot(B, 'fail-B').catch(() => {});
  process.exitCode = 1;
} finally {
  const relevant = errors.filter((e) => !/PERMISSION_DENIED|permission-denied|favicon/.test(e));
  if (errors.length) console.log(`\n콘솔 오류 ${errors.length}건 (권한 거부 제외 ${relevant.length}건):\n${relevant.slice(0, 10).join('\n')}`);
  await browser.close();
}
