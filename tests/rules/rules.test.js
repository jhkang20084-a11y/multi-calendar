// Firestore 보안 규칙 테스트. 실행: npm run test:rules (Firestore 에뮬레이터 필요)
import { readFileSync } from 'node:fs';
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp,
  writeBatch, arrayUnion, collectionGroup,
} from 'firebase/firestore';
import { createCalendar, changeMemberRole, removeMember, transferOwnership, leaveCalendar, newCalendarDoc } from '../../src/services/calendars.js';
import { inviteMember, acceptInvitation, declineInvitation, cancelInvitation } from '../../src/services/invitations.js';
import { createEvent, updateEvent, deleteEvent, listenEvents, getSecret } from '../../src/services/events.js';
import { subscribe, unsubscribe, subscriptionId } from '../../src/services/subscriptions.js';
import { addTodo, toggleTodo } from '../../src/services/todos.js';
import { ensureUserProfile } from '../../src/services/users.js';

const PROJECT = 'demo-multi-calendar';
let env;

const users = {
  alice: { uid: 'alice', email: 'alice@example.com', displayName: 'Alice', photoURL: '' },
  bob: { uid: 'bob', email: 'bob@example.com', displayName: 'Bob', photoURL: '' },
  carol: { uid: 'carol', email: 'carol@example.com', displayName: 'Carol', photoURL: '' },
};
const dbOf = (name) => env.authenticatedContext(users[name].uid, {
  email: users[name].email, email_verified: true,
}).firestore();

const DAY = '2026-10-20';
const eventInput = (over = {}) => ({
  title: '데이트', description: '저녁', location: '성수', notes: '', allDay: true,
  startDate: DAY, endDate: DAY, timeZone: 'Asia/Seoul', visibility: 'members', ...over,
});
const range = { startMs: Date.parse('2026-10-01T00:00:00+09:00'), endMs: Date.parse('2026-11-01T00:00:00+09:00') };

async function getCal(db, id) {
  const s = await getDoc(doc(db, 'calendars', id));
  return { id, ...s.data() };
}

/** alice 가 공유 캘린더를 만들고 bob 을 role 로 초대/수락시킨다. */
async function sharedWithBob(role = 'editor') {
  const a = dbOf('alice');
  const calId = await createCalendar(a, users.alice, { name: '커플', shared: true });
  await inviteMember(a, users.alice, await getCal(a, calId), 'Bob@Example.com', role);
  const invite = { calendarId: calId, email: 'bob@example.com', role };
  await acceptInvitation(dbOf('bob'), users.bob, invite);
  return calId;
}

function listenOnce(db, uid, calId) {
  return new Promise((resolve, reject) => {
    const unsub = listenEvents(db, uid, calId, range, (evs, meta) => {
      if (!meta.fromCache) { unsub(); resolve(evs); }
    }, (e) => { unsub(); reject(e); });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

describe('사용자 프로필', () => {
  it('최초 로그인 시 프로필과 개인 캘린더 생성, 다른 사람 프로필은 읽을 수 없음', async () => {
    const r = await ensureUserProfile(dbOf('alice'), users.alice);
    expect(r.created).toBe(true);
    await assertSucceeds(getDoc(doc(dbOf('alice'), 'users', 'alice')));
    await assertFails(getDoc(doc(dbOf('bob'), 'users', 'alice')));
    const cal = await getCal(dbOf('alice'), r.personalCalendarId);
    expect(cal.shared).toBe(false);
    expect(cal.memberIds).toEqual(['alice']);
  });

  it('허용되지 않은 필드(관리자 권한 등) 추가 차단', async () => {
    await ensureUserProfile(dbOf('alice'), users.alice);
    await assertFails(updateDoc(doc(dbOf('alice'), 'users', 'alice'), { isAdmin: true, updatedAt: serverTimestamp() }));
  });

  it('비로그인 사용자는 아무것도 읽을 수 없음', async () => {
    const calId = await createCalendar(dbOf('alice'), users.alice, { name: '개인' });
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'calendars', calId)));
    await assertFails(getDocs(collection(anon, 'calendars', calId, 'events')));
  });
});

describe('캘린더 생성과 소유자 위조 방지', () => {
  it('다른 사람을 소유자로 위조하거나 멤버를 임의로 넣어 만들 수 없음', async () => {
    const a = dbOf('alice');
    await assertFails(setDoc(doc(a, 'calendars', 'x1'), { ...newCalendarDoc(users.alice, { name: 'x' }), ownerId: 'bob' }));
    await assertFails(setDoc(doc(a, 'calendars', 'x2'), {
      ...newCalendarDoc(users.alice, { name: 'x', shared: true }),
      memberIds: ['alice', 'bob'], editorIds: ['bob'],
      memberInfo: { alice: { name: 'A', email: 'alice@example.com', photoURL: '' }, bob: { name: 'B', email: 'bob@example.com', photoURL: '' } },
    }));
    await assertSucceeds(setDoc(doc(a, 'calendars', 'x3'), newCalendarDoc(users.alice, { name: 'ok' })));
  });

  it('개인 캘린더는 소유자만 접근, 초대도 불가', async () => {
    const a = dbOf('alice');
    const calId = await createCalendar(a, users.alice, { name: '개인', shared: false });
    await assertFails(getDoc(doc(dbOf('bob'), 'calendars', calId)));
    await expect(inviteMember(a, users.alice, await getCal(a, calId), 'bob@example.com', 'viewer'))
      .rejects.toMatchObject({ code: 'app/not-shared' });
    // 클라이언트 검사를 우회해도 규칙이 차단
    await assertFails(setDoc(doc(a, 'calendars', calId, 'invitations', 'bob@example.com'), {
      email: 'bob@example.com', role: 'viewer', status: 'pending', calendarId: calId, calendarName: '개인',
      calendarColor: '#000', invitedBy: 'alice', invitedByName: 'A', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('내 캘린더 목록 쿼리는 내가 멤버인 것만', async () => {
    await createCalendar(dbOf('alice'), users.alice, { name: 'A1' });
    await createCalendar(dbOf('bob'), users.bob, { name: 'B1' });
    const mine = await getDocs(query(collection(dbOf('alice'), 'calendars'), where('memberIds', 'array-contains', 'alice')));
    expect(mine.docs.map((d) => d.data().name)).toEqual(['A1']);
    await assertFails(getDocs(collection(dbOf('alice'), 'calendars')));
  });
});

describe('초대와 권한', () => {
  it('초대 → 수락 후에만 접근 가능', async () => {
    const a = dbOf('alice');
    const calId = await createCalendar(a, users.alice, { name: '커플', shared: true });
    await inviteMember(a, users.alice, await getCal(a, calId), 'bob@example.com', 'editor');
    // 초대만으로는 접근 불가
    await assertFails(getDoc(doc(dbOf('bob'), 'calendars', calId)));
    // bob 은 자신의 초대를 collection group 으로 조회 가능
    const inv = await getDocs(query(collectionGroup(dbOf('bob'), 'invitations'), where('email', '==', 'bob@example.com')));
    expect(inv.size).toBe(1);
    // carol 은 bob 의 초대를 볼 수도, 수락할 수도 없음
    await assertFails(getDocs(query(collectionGroup(dbOf('carol'), 'invitations'), where('email', '==', 'bob@example.com'))));
    await assertFails(acceptInvitation(dbOf('carol'), users.carol, { calendarId: calId, email: 'bob@example.com', role: 'editor' }));
    await assertSucceeds(acceptInvitation(dbOf('bob'), users.bob, { calendarId: calId, email: 'bob@example.com', role: 'editor' }));
    const cal = await getCal(dbOf('bob'), calId);
    expect(cal.editorIds).toEqual(['bob']);
  });

  it('초대 없이 스스로 멤버가 되거나, 초대보다 높은 역할로 들어갈 수 없음', async () => {
    const a = dbOf('alice');
    const calId = await createCalendar(a, users.alice, { name: '커플', shared: true });
    const selfAdd = (db, user, field) => {
      const b = writeBatch(db);
      b.update(doc(db, 'calendars', calId), {
        memberIds: arrayUnion(user.uid), [field]: arrayUnion(user.uid),
        [`memberInfo.${user.uid}`]: { name: user.displayName, email: user.email, photoURL: '' },
        updatedAt: serverTimestamp(), updatedBy: user.uid,
      });
      return b.commit();
    };
    await assertFails(selfAdd(dbOf('carol'), users.carol, 'editorIds'));
    await inviteMember(a, users.alice, await getCal(a, calId), 'carol@example.com', 'viewer');
    // 열람자로 초대됐는데 편집자로 수락 시도
    await assertFails(acceptInvitation(dbOf('carol'), users.carol, { calendarId: calId, email: 'carol@example.com', role: 'editor' }));
    // 초대 상태를 바꾸지 않고 멤버만 추가 시도
    await assertFails(selfAdd(dbOf('carol'), users.carol, 'viewerIds'));
    await assertSucceeds(acceptInvitation(dbOf('carol'), users.carol, { calendarId: calId, email: 'carol@example.com', role: 'viewer' }));
    // 이미 수락한 초대로 다시 들어오기(나갔다가) 불가
    await leaveCalendar(dbOf('carol'), users.carol, calId);
    await assertFails(acceptInvitation(dbOf('carol'), users.carol, { calendarId: calId, email: 'carol@example.com', role: 'viewer' }));
  });

  it('이메일 인증되지 않은 계정은 초대를 수락할 수 없음', async () => {
    const a = dbOf('alice');
    const calId = await createCalendar(a, users.alice, { name: '커플', shared: true });
    await inviteMember(a, users.alice, await getCal(a, calId), 'bob@example.com', 'viewer');
    const unverified = env.authenticatedContext('bob', { email: 'bob@example.com', email_verified: false }).firestore();
    await assertFails(acceptInvitation(unverified, users.bob, { calendarId: calId, email: 'bob@example.com', role: 'viewer' }));
  });

  it('중복 초대 처리, 거절, 취소, 재초대', async () => {
    const a = dbOf('alice');
    const calId = await createCalendar(a, users.alice, { name: '커플', shared: true });
    const cal = await getCal(a, calId);
    await inviteMember(a, users.alice, cal, 'bob@example.com', 'viewer');
    await expect(inviteMember(a, users.alice, cal, 'bob@example.com', 'viewer')).rejects.toMatchObject({ code: 'app/already-invited' });
    await declineInvitation(dbOf('bob'), users.bob, { calendarId: calId, email: 'bob@example.com' });
    // 거절 후에는 수락 불가
    await assertFails(acceptInvitation(dbOf('bob'), users.bob, { calendarId: calId, email: 'bob@example.com', role: 'viewer' }));
    const r = await inviteMember(a, users.alice, cal, 'bob@example.com', 'editor');
    expect(r.reinvited).toBe(true);
    await cancelInvitation(a, users.alice, calId, 'bob@example.com');
    await assertFails(acceptInvitation(dbOf('bob'), users.bob, { calendarId: calId, email: 'bob@example.com', role: 'editor' }));
    // 소유자가 아닌 사람은 초대 불가
    const calId2 = await sharedWithBob('editor');
    await expect(inviteMember(dbOf('bob'), users.bob, await getCal(dbOf('bob'), calId2), 'carol@example.com', 'viewer'))
      .rejects.toMatchObject({ code: 'permission-denied' });
    // 이미 멤버인 사람
    await expect(inviteMember(a, users.alice, await getCal(a, calId2), 'bob@example.com', 'viewer'))
      .rejects.toMatchObject({ code: 'app/already-member' });
  });

  it('역할 변경·멤버 제거·소유권 이전은 소유자만, 소유자 위조 불가', async () => {
    const calId = await sharedWithBob('editor');
    const a = dbOf('alice');
    const b = dbOf('bob');
    // 편집자가 스스로 소유자가 되려는 시도
    await assertFails(updateDoc(doc(b, 'calendars', calId), { ownerId: 'bob', editorIds: ['alice'], updatedAt: serverTimestamp(), updatedBy: 'bob' }));
    // 편집자가 설정 변경 시도
    await assertFails(updateDoc(doc(b, 'calendars', calId), { name: '해킹', updatedAt: serverTimestamp(), updatedBy: 'bob' }));
    // 소유자도 초대 없이 멤버를 직접 추가할 수 없음
    await assertFails(updateDoc(doc(a, 'calendars', calId), {
      memberIds: arrayUnion('carol'), viewerIds: arrayUnion('carol'),
      'memberInfo.carol': { name: 'C', email: 'carol@example.com', photoURL: '' },
      updatedAt: serverTimestamp(), updatedBy: 'alice',
    }));
    await assertSucceeds(changeMemberRole(a, users.alice, calId, 'bob', 'viewer'));
    expect((await getCal(a, calId)).viewerIds).toEqual(['bob']);
    await assertSucceeds(transferOwnership(a, users.alice, calId, 'bob'));
    const after = await getCal(a, calId);
    expect(after.ownerId).toBe('bob');
    expect(after.editorIds).toEqual(['alice']);
    expect(after.viewerIds).toEqual([]);
    // 이전 소유자는 더 이상 멤버를 제거할 수 없음
    await expect(removeMember(a, users.alice, calId, 'bob')).rejects.toBeTruthy();
    await assertSucceeds(removeMember(b, users.bob, calId, 'alice'));
    await assertFails(getDoc(doc(a, 'calendars', calId)));
  });
});

describe('일정 권한', () => {
  it('열람자는 일정 생성·수정·삭제 불가, 편집자는 가능 (시나리오 10)', async () => {
    const calId = await sharedWithBob('viewer');
    const a = dbOf('alice');
    const b = dbOf('bob');
    const evId = await createEvent(a, users.alice, calId, eventInput());
    const ev = (await getDoc(doc(a, 'calendars', calId, 'events', evId))).data();
    await assertSucceeds(getDoc(doc(b, 'calendars', calId, 'events', evId)));
    await assertFails(createEvent(b, users.bob, calId, eventInput()));
    await assertFails(updateEvent(b, users.bob, calId, evId, ev, eventInput({ title: '변경' })));
    await assertFails(deleteEvent(b, users.bob, calId, evId, ev));
    await assertFails(addTodo(b, users.bob, calId, evId, '할 일'));
    await changeMemberRole(a, users.alice, calId, 'bob', 'editor');
    await assertSucceeds(updateEvent(b, users.bob, calId, evId, ev, eventInput({ title: '변경' })));
    const tId = await addTodo(b, users.bob, calId, evId, '꽃 사기');
    await assertSucceeds(toggleTodo(b, users.bob, calId, evId, tId, true));
    await assertSucceeds(deleteEvent(b, users.bob, calId, evId, ev));
  });

  it('작성자/캘린더 ID 위조, 허용되지 않은 필드 차단', async () => {
    const calId = await sharedWithBob('editor');
    const b = dbOf('bob');
    const evId = await createEvent(b, users.bob, calId, eventInput());
    const ref = doc(b, 'calendars', calId, 'events', evId);
    await assertFails(updateDoc(ref, { createdBy: 'alice', updatedAt: serverTimestamp(), updatedBy: 'bob' }));
    await assertFails(updateDoc(ref, { calendarId: 'other', updatedAt: serverTimestamp(), updatedBy: 'bob' }));
    await assertFails(updateDoc(ref, { secretFlag: true, updatedAt: serverTimestamp(), updatedBy: 'bob' }));
    await assertFails(updateDoc(ref, { title: '수정자 위조', updatedAt: serverTimestamp(), updatedBy: 'alice' }));
    await assertSucceeds(updateDoc(ref, { title: '정상', updatedAt: serverTimestamp(), updatedBy: 'bob' }));
  });

  it('외부 사용자는 일정 조회 불가 (시나리오 11)', async () => {
    const calId = await sharedWithBob('editor');
    const evId = await createEvent(dbOf('alice'), users.alice, calId, eventInput());
    const c = dbOf('carol');
    await assertFails(getDoc(doc(c, 'calendars', calId, 'events', evId)));
    await assertFails(listenOnce(c, 'carol', calId));
    await assertFails(getDocs(collection(c, 'calendars', calId, 'events', evId, 'todos')));
  });

  it('비공개 일정은 다른 멤버에게 전혀 보이지 않음 (시나리오 12)', async () => {
    const calId = await sharedWithBob('editor');
    const a = dbOf('alice');
    const b = dbOf('bob');
    const privId = await createEvent(a, users.alice, calId, eventInput({ title: '비밀', visibility: 'private' }));
    await assertFails(getDoc(doc(b, 'calendars', calId, 'events', privId)));
    // 모든 일정을 가져오는 쿼리는 거부되고, 앱의 쿼리로는 비공개가 빠진다.
    await assertFails(getDocs(collection(b, 'calendars', calId, 'events')));
    const bobSees = await listenOnce(b, 'bob', calId);
    expect(bobSees.find((e) => e.id === privId)).toBeUndefined();
    const aliceSees = await listenOnce(a, 'alice', calId);
    expect(aliceSees.find((e) => e.id === privId)?.title).toBe('비밀');
    // 편집자라도 다른 사람의 비공개 일정을 수정/삭제 불가
    await assertFails(deleteDoc(doc(b, 'calendars', calId, 'events', privId)));
  });

  it('시간만 공개 일정: 다른 멤버는 시간만, 세부 내용은 작성자만', async () => {
    const calId = await sharedWithBob('editor');
    const a = dbOf('alice');
    const b = dbOf('bob');
    const busyId = await createEvent(a, users.alice, calId, eventInput({ title: '병원', location: '강남', visibility: 'busy' }));
    const seen = (await getDoc(doc(b, 'calendars', calId, 'events', busyId))).data();
    expect(seen.title).toBe('');
    expect(seen.location).toBe('');
    expect(seen.startDate).toBe(DAY);
    await assertFails(getDoc(doc(b, 'calendars', calId, 'events', busyId, 'secret', 'detail')));
    expect((await getSecret(a, calId, busyId)).title).toBe('병원');
    // 시간만 공개 일정 본문에 제목을 넣는 것은 규칙이 거부
    await assertFails(updateDoc(doc(a, 'calendars', calId, 'events', busyId), { title: '노출', updatedAt: serverTimestamp(), updatedBy: 'alice' }));
    // 체크리스트도 작성자만
    await addTodo(a, users.alice, calId, busyId, '서류');
    await assertFails(getDocs(collection(b, 'calendars', calId, 'events', busyId, 'todos')));
  });
});

describe('구독', () => {
  async function setupFamilyAndCouple() {
    const a = dbOf('alice');
    const family = await createCalendar(a, users.alice, { name: '가족', shared: true });
    await inviteMember(a, users.alice, await getCal(a, family), 'bob@example.com', 'viewer');
    await acceptInvitation(dbOf('bob'), users.bob, { calendarId: family, email: 'bob@example.com', role: 'viewer' });
    const couple = await createCalendar(dbOf('bob'), users.bob, { name: 'bob 개인' });
    return { family, couple };
  }

  it('구독은 양쪽 캘린더 멤버만 만들 수 있고, 중복 구독 불가 (시나리오 14)', async () => {
    const { family, couple } = await setupFamilyAndCouple();
    const b = dbOf('bob');
    const cals = [await getCal(b, family), await getCal(b, couple)];
    await assertSucceeds(subscribe(b, users.bob, couple, family, cals));
    await expect(subscribe(b, users.bob, couple, family, cals)).rejects.toMatchObject({ code: 'app/already-subscribed' });
    // 클라이언트 검사를 우회해 같은 문서를 다시 써도 규칙이 거부
    await assertFails(setDoc(doc(b, 'subscriptions', subscriptionId('bob', couple, family)), {
      ownerUid: 'bob', targetCalendarId: couple, sourceCalendarId: family, active: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    // carol 은 가족 캘린더 멤버가 아니므로 구독 불가
    const carolCal = await createCalendar(dbOf('carol'), users.carol, { name: 'carol' });
    await assertFails(setDoc(doc(dbOf('carol'), 'subscriptions', subscriptionId('carol', carolCal, family)), {
      ownerUid: 'carol', targetCalendarId: carolCal, sourceCalendarId: family, active: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    // 다른 사용자 명의의 구독 생성/조회 불가
    await assertFails(getDoc(doc(dbOf('alice'), 'subscriptions', subscriptionId('bob', couple, family))));
    await assertFails(setDoc(doc(b, 'subscriptions', subscriptionId('alice', couple, family)), {
      ownerUid: 'alice', targetCalendarId: couple, sourceCalendarId: family, active: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('구독으로 원본 권한을 얻지 못함: 구독자(열람자)는 원본 일정 수정 불가, 권한 취소 시 접근 차단 (시나리오 10, 13)', async () => {
    const { family, couple } = await setupFamilyAndCouple();
    const a = dbOf('alice');
    const b = dbOf('bob');
    await subscribe(b, users.bob, couple, family, [await getCal(b, family), await getCal(b, couple)]);
    const evId = await createEvent(a, users.alice, family, eventInput({ title: '제사' }));
    const ev = (await getDoc(doc(a, 'calendars', family, 'events', evId))).data();
    expect((await listenOnce(b, 'bob', family)).map((e) => e.title)).toEqual(['제사']);
    await assertFails(updateEvent(b, users.bob, family, evId, ev, eventInput({ title: '변경' })));
    await assertFails(deleteEvent(b, users.bob, family, evId, ev));
    // 구독 해제는 원본 일정에 영향 없음 (시나리오 9)
    await unsubscribe(b, subscriptionId('bob', couple, family));
    expect((await getDoc(doc(a, 'calendars', family, 'events', evId))).exists()).toBe(true);
    // 다시 구독한 상태에서 alice 가 bob 을 가족 캘린더에서 제거
    await subscribe(b, users.bob, couple, family, [await getCal(b, family), await getCal(b, couple)]);
    await removeMember(a, users.alice, family, 'bob');
    // 구독 문서는 남아 있지만 원본 일정 접근은 차단
    await assertSucceeds(getDoc(doc(b, 'subscriptions', subscriptionId('bob', couple, family))));
    await assertFails(listenOnce(b, 'bob', family));
    await assertFails(getDoc(doc(b, 'calendars', family, 'events', evId)));
    // 권한이 없으므로 구독을 다시 활성화할 수도 없음
    await assertFails(updateDoc(doc(b, 'subscriptions', subscriptionId('bob', couple, family)), { active: false, updatedAt: serverTimestamp() }).then(() =>
      updateDoc(doc(b, 'subscriptions', subscriptionId('bob', couple, family)), { active: true, updatedAt: serverTimestamp() })));
  });
});
