// 아이폰 위젯 피드(widgetFeed 서버 함수) 통합 테스트
// 실행: npm run test:functions (auth, firestore, functions 에뮬레이터)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache, doc, getDoc } from 'firebase/firestore';
import { DateTime } from 'luxon';
import { ensureUserProfile } from '../../src/services/users.js';
import { createCalendar } from '../../src/services/calendars.js';
import { inviteMember, acceptInvitation } from '../../src/services/invitations.js';
import { createEvent } from '../../src/services/events.js';
import { createWidgetToken, revokeWidgetTokens, widgetFeedUrl } from '../../src/services/widget.js';
import { addDays } from '../../src/lib/time.js';

const PROJECT = 'demo-multi-calendar';
const TZ = 'Asia/Seoul';
const today = DateTime.now().setZone(TZ).toISODate();
const tomorrow = addDays(today, 1);
const at = (date, hm) => DateTime.fromISO(`${date}T${hm}`, { zone: TZ }).toMillis();
const apps = [];

async function signIn(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'x' }, `w-${name}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const email = `${name}-${Date.now()}@example.com`;
  const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name })));
  const profile = await ensureUserProfile(db, user);
  return { db, user, email, personalId: profile.personalCalendarId };
}

const feed = async (token) => {
  const r = await fetch(widgetFeedUrl({ projectId: PROJECT, token, emulator: true }));
  return { status: r.status, body: await r.json() };
};
const day = (body, date) => body.days.find((d) => d.date === date);
const titles = (body, date) => day(body, date).items.map((i) => i.title);

let A; let B; let calId;
beforeAll(async () => {
  A = await signIn('alice');
  B = await signIn('bob');
  calId = await createCalendar(A.db, A.user, { name: '우리', shared: true, color: '#e88aa6' });
  const cal = { id: calId, ...(await getDoc(doc(A.db, 'calendars', calId))).data() };
  await inviteMember(A.db, A.user, cal, B.email, 'editor');
  await acceptInvitation(B.db, B.user, { calendarId: calId, email: B.email.toLowerCase(), role: 'editor' });

  const base = { description: '', location: '', notes: '', timeZone: TZ, visibility: 'members' };
  await createEvent(A.db, A.user, calId, { ...base, title: '저녁 약속', allDay: false, startMs: at(tomorrow, '19:00'), endMs: at(tomorrow, '20:30') });
  await createEvent(A.db, A.user, calId, { ...base, title: '여행', allDay: true, startDate: addDays(today, 2), endDate: addDays(today, 4) });
  await createEvent(A.db, A.user, calId, { ...base, title: '내 비밀', allDay: true, startDate: tomorrow, endDate: tomorrow, visibility: 'private' });
  await createEvent(B.db, B.user, calId, { ...base, title: '밥의 비밀', allDay: true, startDate: tomorrow, endDate: tomorrow, visibility: 'private' });
  await createEvent(B.db, B.user, calId, { ...base, title: '밥의 병원', allDay: false, startMs: at(tomorrow, '10:00'), endMs: at(tomorrow, '11:00'), visibility: 'busy' });
  await createEvent(A.db, A.user, calId, { ...base, title: '사귄 날', kind: 'anniversary', allDay: true, startDate: addDays(today, -99), endDate: addDays(today, -99) });
  await createEvent(A.db, A.user, calId, { ...base, title: '먼 일정', allDay: true, startDate: addDays(today, 20), endDate: addDays(today, 20) });
}, 60000);

afterAll(async () => { await Promise.all(apps.map((a) => deleteApp(a))); });

describe('아이폰 위젯 피드', () => {
  it('보고 있는 캘린더의 앞으로 14일 일정 (앱과 같은 공개 범위)', async () => {
    const token = await createWidgetToken(A.db, A.user.uid, calId);
    const { status, body } = await feed(token);
    expect(status).toBe(200);
    expect(body.today).toBe(today);
    expect(body.calendar).toEqual({ name: '우리', color: '#e88aa6' });
    expect(body.days).toHaveLength(14);
    expect(titles(body, tomorrow)).toEqual(expect.arrayContaining(['저녁 약속', '내 비밀', '바쁨']));
    expect(titles(body, tomorrow)).not.toContain('밥의 비밀'); // 다른 사람의 비공개 일정은 서버에서부터 빠짐
    expect(JSON.stringify(body)).not.toContain('밥의 병원'); // 시간만 공개 일정은 "바쁨"으로만
    expect(day(body, tomorrow).items.find((i) => i.title === '저녁 약속')).toMatchObject({ allDay: false, time: '19:00', endTime: '20:30' });
    expect(day(body, addDays(today, 3)).items.find((i) => i.title === '여행')).toMatchObject({ allDay: true, span: '2/3' });
    expect(titles(body, today)).toContain('사귄 날 100일'); // 기념일 100일 자동 표시
    expect(JSON.stringify(body)).not.toContain('먼 일정');
    expect(body.ddays[0]).toMatchObject({ title: '사귄 날', count: '100일째' });
  }, 30000);

  it('캘린더를 고르지 않았으면 내 캘린더를 보여 줌', async () => {
    const token = await createWidgetToken(A.db, A.user.uid, '');
    const { body } = await feed(token);
    expect(body.calendar.name).toBe('내 캘린더');
  }, 30000);

  it('잘못된 토큰·끊은 토큰은 거절', async () => {
    expect((await feed('짧음')).status).toBe(400);
    expect((await feed('x'.repeat(43))).status).toBe(401);
    const token = await createWidgetToken(B.db, B.user.uid, calId);
    expect((await feed(token)).status).toBe(200);
    await revokeWidgetTokens(B.db, B.user.uid);
    expect((await feed(token)).status).toBe(401);
  }, 30000);
});
