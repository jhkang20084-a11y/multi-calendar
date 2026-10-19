// 실시간 동기화 통합 테스트 (지시서 17장 필수 시나리오)
// 실행: npm run test:integration  (Auth + Firestore 에뮬레이터, 실제 보안 규칙 적용)
// 두 사용자(A, B)가 각자 Google 로그인한 별도 앱 인스턴스로 동시에 접속한 상황을 재현한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, memoryLocalCache, disableNetwork, enableNetwork,
  doc, getDoc,
} from 'firebase/firestore';
import { ensureUserProfile } from '../../src/services/users.js';
import { createCalendar, listenMyCalendars, removeMember } from '../../src/services/calendars.js';
import { inviteMember, listenMyInvitations, acceptInvitation } from '../../src/services/invitations.js';
import { createEvent, updateEvent, deleteEvent, listenEvents } from '../../src/services/events.js';
import { addTodo, toggleTodo, listenTodos } from '../../src/services/todos.js';
import { subscribe, unsubscribe, listenMySubscriptions } from '../../src/services/subscriptions.js';
import { resolveFeedSources } from '../../src/lib/feed.js';
import { viewRange, localInputToMs } from '../../src/lib/time.js';

const PROJECT = 'demo-multi-calendar';
const run = Date.now().toString(36);
const apps = [];

async function login(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'demo' }, `${name}-${run}-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const email = `${name}-${run}@example.com`;
  // Auth 에뮬레이터는 서명되지 않은 Google ID 토큰(JSON)을 허용한다.
  const cred = GoogleAuthProvider.credential(JSON.stringify({
    sub: `${name}-${run}`, email, email_verified: true, name: name.toUpperCase(),
  }));
  const { user } = await signInWithCredential(auth, cred);
  return { app, db, user, uid: user.uid };
}

/** 리스너의 최신 값을 보관하고 조건이 만족될 때까지 기다린다. */
function live(start) {
  const box = { value: undefined, error: null, unsub: null };
  box.unsub = start((v) => { box.value = v; }, (e) => { box.error = e; });
  box.until = async (pred, label = '조건', ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (box.value !== undefined && pred(box.value)) return box.value;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`시간 초과: ${label} (현재 값: ${JSON.stringify(box.value)?.slice(0, 300)})`);
  };
  return box;
}

const range = viewRange('month', '2026-10-01', 'Asia/Seoul', 0);
const ts = (s) => localInputToMs(s, 'Asia/Seoul');
const evInput = (over = {}) => ({
  title: '저녁 데이트', description: '', location: '성수동', notes: '', allDay: false,
  startMs: ts('2026-10-20T19:00'), endMs: ts('2026-10-20T21:00'), timeZone: 'Asia/Seoul',
  visibility: 'members', ...over,
});

let A; let B; let A2;
const ctx = {};

beforeAll(async () => {
  A = await login('alice');
  B = await login('bob');
});

afterAll(async () => {
  for (const app of apps) await deleteApp(app).catch(() => {});
});

describe('필수 테스트 시나리오', () => {
  it('1. A가 Google 로그인 후 개인 캘린더를 가진다', async () => {
    const r = await ensureUserProfile(A.db, A.user);
    expect(r.created).toBe(true);
    await ensureUserProfile(B.db, B.user);
    const cals = live((cb, err) => listenMyCalendars(A.db, A.uid, cb, err));
    const list = await cals.until((l) => l.length === 1, 'A 개인 캘린더');
    expect(list[0].shared).toBe(false);
    expect(list[0].memberIds).toEqual([A.uid]);
    cals.unsub();
    // 두 번째 로그인에서는 중복 생성되지 않음
    expect((await ensureUserProfile(A.db, A.user)).created).toBe(false);
  });

  it('2~3. A가 공유 캘린더를 만들고 B를 초대, B가 실시간으로 초대를 받아 수락', async () => {
    ctx.couple = await createCalendar(A.db, A.user, { name: '커플', color: '#e85d75', shared: true });
    const bInv = live((cb, err) => listenMyInvitations(B.db, B.user, cb, err));
    await bInv.until((l) => l.length === 0, 'B 초대 없음');
    const aCals = live((cb, err) => listenMyCalendars(A.db, A.uid, cb, err));
    const coupleCal = (await aCals.until((l) => l.some((c) => c.id === ctx.couple))).find((c) => c.id === ctx.couple);
    await inviteMember(A.db, A.user, coupleCal, B.user.email.toUpperCase(), 'editor');
    const invs = await bInv.until((l) => l.length === 1, 'B 초대 도착');
    expect(invs[0]).toMatchObject({ calendarName: '커플', role: 'editor', status: 'pending' });
    await acceptInvitation(B.db, B.user, invs[0]);
    await bInv.until((l) => l.length === 0, '수락 후 대기 초대 없음');
    const bCals = live((cb, err) => listenMyCalendars(B.db, B.uid, cb, err));
    await bCals.until((l) => l.some((c) => c.id === ctx.couple), 'B 캘린더 목록에 커플 표시');
    await aCals.until((l) => l.find((c) => c.id === ctx.couple)?.editorIds.includes(B.uid), 'A 화면에 B가 편집자로');
    bInv.unsub(); aCals.unsub(); bCals.unsub();
  });

  it('4~5. A가 추가한 일정이 B에게 실시간 표시, B의 수정이 A에게 반영', async () => {
    const aFeed = live((cb, err) => listenEvents(A.db, A.uid, ctx.couple, range, cb, err));
    const bFeed = live((cb, err) => listenEvents(B.db, B.uid, ctx.couple, range, cb, err));
    await aFeed.until((l) => l.length === 0);
    await bFeed.until((l) => l.length === 0);
    ctx.dateId = await createEvent(A.db, A.user, ctx.couple, evInput());
    const seen = await bFeed.until((l) => l.some((e) => e.id === ctx.dateId), 'B가 새 일정 수신');
    const ev = seen.find((e) => e.id === ctx.dateId);
    expect(ev).toMatchObject({ title: '저녁 데이트', createdBy: A.uid, calendarId: ctx.couple });
    await updateEvent(B.db, B.user, ctx.couple, ctx.dateId, ev, evInput({ startMs: ts('2026-10-20T20:00'), endMs: ts('2026-10-20T22:00') }));
    const aSeen = await aFeed.until((l) => l.find((e) => e.id === ctx.dateId)?.startMs === ts('2026-10-20T20:00'), 'A가 수정 수신');
    expect(aSeen.find((e) => e.id === ctx.dateId).updatedBy).toBe(B.uid);
    aFeed.unsub(); bFeed.unsub();
  });

  it('6. B가 체크리스트를 완료하면 A에게 반영', async () => {
    const aTodos = live((cb, err) => listenTodos(A.db, ctx.couple, ctx.dateId, cb, err));
    await aTodos.until((l) => l.length === 0);
    const todoId = await addTodo(B.db, B.user, ctx.couple, ctx.dateId, '꽃 예약', A.uid);
    await aTodos.until((l) => l.some((t) => t.id === todoId && !t.done), 'A가 할 일 수신');
    await toggleTodo(B.db, B.user, ctx.couple, ctx.dateId, todoId, true);
    const l = await aTodos.until((x) => x.find((t) => t.id === todoId)?.done === true, 'A가 완료 상태 수신');
    expect(l[0]).toMatchObject({ doneBy: B.uid, assigneeUid: A.uid });
    aTodos.unsub();
  });

  it('7~9. 구독: 원본 수정/삭제가 구독 화면에 반영되고, 구독 해제는 원본을 지우지 않음', async () => {
    ctx.family = await createCalendar(A.db, A.user, { name: '가족', color: '#2a9d8f', shared: true });
    const aCals = live((cb, err) => listenMyCalendars(A.db, A.uid, cb, err));
    const aSubs = live((cb, err) => listenMySubscriptions(A.db, A.uid, cb, err));
    const cals = await aCals.until((l) => l.some((c) => c.id === ctx.family));
    await subscribe(A.db, A.user, ctx.couple, ctx.family, cals);
    const subs = await aSubs.until((l) => l.length === 1, '구독 생성');
    await expect(subscribe(A.db, A.user, ctx.couple, ctx.family, cals)).rejects.toMatchObject({ code: 'app/already-subscribed' });

    // 커플 캘린더 보기에 가족 캘린더가 구독 원본으로 포함된다
    const { sources } = resolveFeedSources({ calendars: cals, subscriptions: subs, focus: ctx.couple });
    expect(sources).toContainEqual({ calendarId: ctx.family, subscribed: true, via: ctx.couple });

    const famFeed = live((cb, err) => listenEvents(A.db, A.uid, ctx.family, range, cb, err));
    await famFeed.until((l) => l.length === 0);
    const famId = await createEvent(A.db, A.user, ctx.family, evInput({ title: '할머니 생신', allDay: true, startDate: '2026-10-25', endDate: '2026-10-25' }));
    const l1 = await famFeed.until((l) => l.some((e) => e.id === famId), '구독 화면에 원본 추가 반영');
    await updateEvent(A.db, A.user, ctx.family, famId, l1[0], evInput({ title: '할머니 생신 (장소 변경)', allDay: true, startDate: '2026-10-25', endDate: '2026-10-25' }));
    await famFeed.until((l) => l.find((e) => e.id === famId)?.title === '할머니 생신 (장소 변경)', '구독 화면에 원본 수정 반영');

    // 구독 해제 → 원본 일정은 그대로
    await unsubscribe(A.db, subs[0].id);
    await aSubs.until((l) => l.length === 0, '구독 해제');
    expect((await getDoc(doc(A.db, 'calendars', ctx.family, 'events', famId))).exists()).toBe(true);

    // 원본 삭제 → 사라짐
    const cur = famFeed.value.find((e) => e.id === famId);
    await deleteEvent(A.db, A.user, ctx.family, famId, cur);
    await famFeed.until((l) => !l.some((e) => e.id === famId), '원본 삭제 반영');
    famFeed.unsub(); aCals.unsub(); aSubs.unsub();
  });

  it('10, 13. 열람자 구독자는 수정 불가, 권한이 취소되면 리스너가 차단되고 구독 표시가 중단', async () => {
    // B를 가족 캘린더의 열람자로 초대
    const famCal = { id: ctx.family, name: '가족', color: '#2a9d8f', shared: true, memberInfo: {} };
    await inviteMember(A.db, A.user, famCal, B.user.email, 'viewer');
    const bInv = live((cb, err) => listenMyInvitations(B.db, B.user, cb, err));
    const [inv] = await bInv.until((l) => l.length === 1);
    await acceptInvitation(B.db, B.user, inv);
    bInv.unsub();

    const bCals = live((cb, err) => listenMyCalendars(B.db, B.uid, cb, err));
    const cals = await bCals.until((l) => l.some((c) => c.id === ctx.family));
    const bPersonal = cals.find((c) => !c.shared);
    await subscribe(B.db, B.user, bPersonal.id, ctx.family, cals);
    const bSubs = live((cb, err) => listenMySubscriptions(B.db, B.uid, cb, err));
    await bSubs.until((l) => l.length === 1);

    const evId = await createEvent(A.db, A.user, ctx.family, evInput({ title: '가족 여행' }));
    const bFam = live((cb, err) => listenEvents(B.db, B.uid, ctx.family, range, cb, err));
    const l = await bFam.until((x) => x.some((e) => e.id === evId), 'B가 구독 원본 일정 수신');
    await expect(updateEvent(B.db, B.user, ctx.family, evId, l.find((e) => e.id === evId), evInput({ title: '변경' })))
      .rejects.toMatchObject({ code: 'permission-denied' });

    // A가 B를 가족 캘린더에서 제거
    await removeMember(A.db, A.user, ctx.family, B.uid);
    await bCals.until((x) => !x.some((c) => c.id === ctx.family), 'B 목록에서 가족 캘린더 제거');
    // 권한 취소 이후 원본에 추가된 일정은 B에게 전달되지 않아야 한다.
    const afterId = await createEvent(A.db, A.user, ctx.family, evInput({ title: '취소 후 추가' }));
    const t0 = Date.now();
    while (!bFam.error && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 50));
    console.log('[관찰] 취소 후 기존 리스너 오류:', bFam.error?.code ?? '없음',
      '/ 새 일정 수신 여부:', bFam.value.some((e) => e.id === afterId));
    expect(bFam.value.some((e) => e.id === afterId)).toBe(false);
    bFam.unsub();
    // 새로 여는 리스너와 단건 조회는 즉시 거부된다.
    const again = live((cb, err) => listenEvents(B.db, B.uid, ctx.family, range, cb, err));
    const t1 = Date.now();
    while (!again.error && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 50));
    expect(again.error?.code).toBe('permission-denied');
    await expect(getDoc(doc(B.db, 'calendars', ctx.family, 'events', evId))).rejects.toMatchObject({ code: 'permission-denied' });
    // 구독 문서는 남아 있지만 화면 계산에서 '접근 불가'로 빠진다
    const r = resolveFeedSources({ calendars: bCals.value, subscriptions: bSubs.value, focus: bPersonal.id });
    expect(r.sources.map((s) => s.calendarId)).toEqual([bPersonal.id]);
    expect(r.inaccessible).toHaveLength(1);
    bCals.unsub(); bSubs.unsub();
  });

  it('15. 같은 사용자의 두 기기(모바일/PC)가 같은 데이터를 본다', async () => {
    A2 = await login('alice'); // 같은 Google 계정으로 다른 기기에서 로그인
    expect(A2.uid).toBe(A.uid);
    const pc = live((cb, err) => listenEvents(A.db, A.uid, ctx.couple, range, cb, err));
    const phone = live((cb, err) => listenEvents(A2.db, A2.uid, ctx.couple, range, cb, err));
    const id = await createEvent(A2.db, A2.user, ctx.couple, evInput({ title: '휴대폰에서 추가' }));
    await pc.until((l) => l.some((e) => e.id === id), 'PC 화면 반영');
    const a = (await pc.until(() => true)).map((e) => e.id).sort();
    const b = (await phone.until((l) => l.some((e) => e.id === id))).map((e) => e.id).sort();
    expect(a).toEqual(b);
    pc.unsub(); phone.unsub();
  });

  it('16. 네트워크가 끊겼다 복구되어도 데이터가 일관되게 유지', async () => {
    const aFeed = live((cb, err) => listenEvents(A.db, A.uid, ctx.couple, range, cb, err));
    const bFeed = live((cb, err) => listenEvents(B.db, B.uid, ctx.couple, range, cb, err));
    const current = (await bFeed.until((l) => l.some((e) => e.id === ctx.dateId))).find((e) => e.id === ctx.dateId);

    await disableNetwork(B.db);
    // 오프라인에서 수정: B 화면에는 즉시(대기 중) 반영되지만 A에게는 아직 전달되지 않음
    const pending = updateEvent(B.db, B.user, ctx.couple, ctx.dateId, current, evInput({ title: '오프라인 수정' }));
    await bFeed.until((l) => l.find((e) => e.id === ctx.dateId)?.title === '오프라인 수정', 'B 로컬 반영');
    await new Promise((r) => setTimeout(r, 500));
    expect(aFeed.value.find((e) => e.id === ctx.dateId).title).not.toBe('오프라인 수정');
    // 그동안 A가 다른 일정을 추가
    const newId = await createEvent(A.db, A.user, ctx.couple, evInput({ title: 'A 온라인 추가' }));

    await enableNetwork(B.db);
    await pending; // 서버 저장이 확정되어야 성공으로 처리
    await aFeed.until((l) => l.find((e) => e.id === ctx.dateId)?.title === '오프라인 수정', 'A가 복구 후 수정 수신');
    await bFeed.until((l) => l.some((e) => e.id === newId), 'B가 복구 후 A의 추가 수신');
    const ids = (f) => f.value.map((e) => `${e.id}:${e.title}`).sort();
    expect(ids(aFeed)).toEqual(ids(bFeed));
    aFeed.unsub(); bFeed.unsub();
  });
});
