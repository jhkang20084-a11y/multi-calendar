import {
  collection, doc, query, where, orderBy, onSnapshot, serverTimestamp, writeBatch, arrayUnion,
  arrayRemove, getDoc, getDocs, updateDoc,
} from 'firebase/firestore';
import { computeRange, addDays, daysBetween } from '../lib/time.js';
import { expandEvent, untilBefore, occKeyToDT } from '../lib/recurrence.js';

export const VISIBILITY_LABELS = {
  members: '캘린더 멤버에게 공개',
  busy: '멤버에게 시간만 공개',
  private: '비공개 (나만 보기)',
};

const TEXT_FIELDS = ['title', 'description', 'location', 'notes'];

const evCol = (db, calId) => collection(db, 'calendars', calId, 'events');
const evRef = (db, calId, id) => doc(db, 'calendars', calId, 'events', id);
const secretRef = (db, calId, id) => doc(db, 'calendars', calId, 'events', id, 'secret', 'detail');

function secretOf(input) {
  const s = {};
  for (const k of TEXT_FIELDS) s[k] = String(input[k] || '');
  return s;
}

/** 편집 폼 입력값 → Firestore 저장 형식 (createdBy/createdAt 제외) */
export function buildEventData(user, calId, input, extra = {}) {
  const anniversary = input.kind === 'anniversary';
  const allDay = anniversary ? true : Boolean(input.allDay);
  const ev = {
    calendarId: calId,
    title: String(input.title || '').slice(0, 200),
    description: String(input.description || '').slice(0, 5000),
    location: String(input.location || '').slice(0, 500),
    notes: String(input.notes || '').slice(0, 10000),
    color: String(input.color || '').slice(0, 20),
    category: String(input.category || '').slice(0, 40),
    allDay,
    startMs: allDay ? null : input.startMs,
    endMs: allDay ? null : Math.max(input.endMs, input.startMs),
    startDate: allDay ? input.startDate : null,
    endDate: allDay ? (input.endDate < input.startDate ? input.startDate : input.endDate) : null,
    timeZone: input.timeZone || 'Asia/Seoul',
    recurrence: anniversary ? { freq: 'YEARLY', interval: 1 } : (input.recurrence || null),
    exdates: extra.exdates ?? input.exdates ?? [],
    recurringEventId: extra.recurringEventId ?? input.recurringEventId ?? null,
    originalStart: extra.originalStart ?? input.originalStart ?? null,
    visibility: ['members', 'busy', 'private'].includes(input.visibility) ? input.visibility : 'members',
    kind: anniversary ? 'anniversary' : 'event',
    completed: Boolean(input.completed),
    reminders: (input.reminders || []).slice(0, 5).map(Number),
    showDday: anniversary ? true : Boolean(input.showDday),
    // 기념일: 100일 단위(100일, 200일 …) 자동 표시 여부. 1년 단위(주년)는 항상 표시.
    milestones: anniversary ? input.milestones !== false : false,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  };
  if (ev.visibility === 'busy') for (const k of TEXT_FIELDS) ev[k] = '';
  Object.assign(ev, computeRange(ev));
  return ev;
}

// writeSecret=false: 폼이 아니라 저장된 문서에서 만든 입력(반복 분할 등)이라 비밀 내용을 덮어쓰면 안 될 때
function putEvent(b, db, user, calId, ref, input, extra, prev, writeSecret = true) {
  const data = buildEventData(user, calId, input, extra);
  if (prev) {
    // 작성자/생성일은 서버 값을 그대로 둔다(update 는 최상위 필드만 통째로 교체).
    b.update(ref, data);
  } else {
    b.set(ref, { ...data, createdBy: user.uid, createdAt: serverTimestamp() });
  }
  if (data.visibility === 'busy') { if (writeSecret) b.set(secretRef(db, calId, ref.id), secretOf(input)); }
  else if (prev?.visibility === 'busy') b.delete(secretRef(db, calId, ref.id));
  return data;
}

/** 일정 만들기. todos(할 일 문장 목록)를 주면 같은 배치로 체크리스트도 함께 만든다. */
export async function createEvent(db, user, calId, input, todos = []) {
  const ref = doc(evCol(db, calId));
  const b = writeBatch(db);
  putEvent(b, db, user, calId, ref, input, {}, null);
  addTodosToBatch(b, user, ref, todos);
  await b.commit();
  return ref.id;
}

function addTodosToBatch(b, user, eventRef, todos) {
  todos.map((t) => String(t).trim()).filter(Boolean).slice(0, 50).forEach((text, i) => {
    b.set(doc(collection(eventRef, 'todos')), {
      text: text.slice(0, 500), done: false, assigneeUid: null, order: Date.now() + i,
      doneBy: null, doneAt: null, createdBy: user.uid, createdAt: serverTimestamp(),
      updatedBy: user.uid, updatedAt: serverTimestamp(),
    });
  });
}

/** 이미 있는 일정에 할 일 여러 개를 한 번에 추가 */
export function addTodos(db, user, calId, eventId, todos) {
  const b = writeBatch(db);
  addTodosToBatch(b, user, evRef(db, calId, eventId), todos);
  return b.commit();
}

/** 단일 일정(또는 반복 전체) 수정. prev 는 현재 저장된 원본 문서 데이터. */
export async function updateEvent(db, user, calId, eventId, prev, input) {
  const b = writeBatch(db);
  putEvent(b, db, user, calId, evRef(db, calId, eventId), input,
    { exdates: prev.exdates, recurringEventId: prev.recurringEventId, originalStart: prev.originalStart }, prev);
  await b.commit();
}

async function deleteEventTree(b, db, user, calId, id, ev) {
  const todos = await getDocs(collection(db, 'calendars', calId, 'events', id, 'todos'));
  todos.forEach((t) => b.delete(t.ref));
  if (ev.visibility === 'busy' && ev.createdBy === user.uid) b.delete(secretRef(db, calId, id));
  b.delete(evRef(db, calId, id));
}

export async function deleteEvent(db, user, calId, eventId, ev) {
  const b = writeBatch(db);
  await deleteEventTree(b, db, user, calId, eventId, ev);
  await b.commit();
}

function occurrenceStartOf(master, occKey) {
  const dt = occKeyToDT(master, occKey);
  return master.allDay ? { startDate: dt.toISODate() } : { startMs: dt.toMillis() };
}

/** 반복 일정에서 occKey 이전 회차 수 (count 분할 계산용) */
function countBefore(master, occKey) {
  const occ = occurrenceStartOf(master, occKey);
  const range = master.allDay
    ? { startDate: master.startDate, endDate: addDays(occ.startDate, -1), startMs: 0, endMs: 0 }
    : { startMs: master.startMs - 1, endMs: occ.startMs, startDate: '', endDate: '' };
  return expandEvent({ ...master, exdates: [] }, range).length;
}

function shiftKey(master, key, deltaMs, deltaDays) {
  return master.allDay ? addDays(key, deltaDays) : String(Number(key) + deltaMs);
}

/**
 * 반복 일정의 한 회차를 수정한다.
 * scope: 'this' (이 일정만) | 'following' (이 일정 및 이후) | 'all' (모든 반복)
 * input 은 해당 회차 기준으로 편집된 값(startMs/startDate 가 회차 날짜).
 */
export async function saveRecurringOccurrence(db, user, calId, masterId, master, occKey, input, scope) {
  const occ = occurrenceStartOf(master, occKey);
  const b = writeBatch(db);
  const mRef = evRef(db, calId, masterId);

  if (scope === 'this') {
    b.update(mRef, { exdates: arrayUnion(occKey), updatedAt: serverTimestamp(), updatedBy: user.uid });
    const oRef = doc(evCol(db, calId));
    putEvent(b, db, user, calId, oRef, { ...input, recurrence: null },
      { exdates: [], recurringEventId: masterId, originalStart: occKey }, null);
    await b.commit();
    return;
  }

  const isFirst = master.allDay ? occ.startDate === master.startDate : occ.startMs === master.startMs;
  if (scope === 'all' || isFirst) {
    // 편집한 회차와의 차이만큼 원본 시작을 이동(전체 반복의 시간 변경)
    const deltaMs = master.allDay ? 0 : input.startMs - occ.startMs;
    const deltaDays = master.allDay ? daysBetween(occ.startDate, input.startDate) : 0;
    const shifted = master.allDay
      ? { startDate: addDays(master.startDate, deltaDays),
          endDate: addDays(addDays(master.startDate, deltaDays), daysBetween(input.startDate, input.endDate)) }
      : { startMs: master.startMs + deltaMs, endMs: master.startMs + deltaMs + (input.endMs - input.startMs) };
    const sameShape = Boolean(input.allDay) === Boolean(master.allDay) || input.kind === 'anniversary';
    const merged = { ...input, ...(sameShape ? shifted : {}) };
    const exdates = (master.exdates || []).map((k) => shiftKey(master, k, deltaMs, deltaDays));
    putEvent(b, db, user, calId, mRef, merged,
      { exdates, recurringEventId: null, originalStart: null }, master);
    await b.commit();
    return;
  }

  // 'following': 기존 반복은 전날까지로 끝내고, 이 회차부터 새 반복을 만든다.
  const before = countBefore(master, occKey);
  const oldRec = { ...master.recurrence };
  const newRec = input.recurrence ? { ...input.recurrence } : null;
  if (oldRec.count) {
    delete oldRec.count;
    if (newRec && newRec.count && master.recurrence.count === newRec.count) {
      newRec.count = Math.max(1, newRec.count - before);
    }
  }
  oldRec.until = untilBefore(master, occKey);
  const masterInput = { ...master, recurrence: oldRec };
  putEvent(b, db, user, calId, mRef, masterInput,
    { exdates: master.exdates || [], recurringEventId: null, originalStart: null }, master, false);
  const nRef = doc(evCol(db, calId));
  const keep = (master.exdates || []).filter((k) => k > occKey);
  putEvent(b, db, user, calId, nRef, { ...input, recurrence: newRec }, { exdates: keep }, null);
  await b.commit();
}

/** 반복 일정의 회차 삭제. scope 의미는 saveRecurringOccurrence 와 같다. */
export async function deleteRecurringOccurrence(db, user, calId, masterId, master, occKey, scope) {
  const occ = occurrenceStartOf(master, occKey);
  const isFirst = master.allDay ? occ.startDate === master.startDate : occ.startMs === master.startMs;
  const b = writeBatch(db);
  const mRef = evRef(db, calId, masterId);
  if (scope === 'this') {
    b.update(mRef, { exdates: arrayUnion(occKey), updatedAt: serverTimestamp(), updatedBy: user.uid });
  } else if (scope === 'following' && !isFirst) {
    const rec = { ...master.recurrence, until: untilBefore(master, occKey) };
    delete rec.count;
    putEvent(b, db, user, calId, mRef, { ...master, recurrence: rec },
      { exdates: master.exdates || [], recurringEventId: null, originalStart: null }, master, false);
  } else {
    // 전체 삭제: 원본 + 개별 수정된 회차들
    const overrides = await getDocs(query(evCol(db, calId),
      where('visibility', 'in', ['members', 'busy']), where('recurringEventId', '==', masterId)));
    for (const o of overrides.docs) {
      const od = o.data();
      if (od.visibility === 'members' || od.createdBy === user.uid) {
        await deleteEventTree(b, db, user, calId, o.id, od);
      }
    }
    await deleteEventTree(b, db, user, calId, masterId, master);
  }
  await b.commit();
}

/**
 * 완료 표시. 반복 일정은 그 회차(occKey)만 완료하고, 반복이 아닌 일정은 일정 자체를 완료한다.
 */
export function setOccurrenceCompleted(db, user, calId, eventId, occKey, done) {
  const patch = occKey
    ? { completedOccs: done ? arrayUnion(occKey) : arrayRemove(occKey) }
    : { completed: done };
  return updateDoc(evRef(db, calId, eventId), { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export function setCompleted(db, user, calId, eventId, prev, completed) {
  const b = writeBatch(db);
  b.update(evRef(db, calId, eventId), { completed, updatedAt: serverTimestamp(), updatedBy: user.uid });
  return b.commit();
}

/**
 * 캘린더 하나의 화면 범위 일정 실시간 구독.
 * - 쿼리 1: 공개 + 시간만 공개 일정 (모든 멤버)
 * - 쿼리 2: 내가 만든 비공개 일정
 * 다른 사람의 비공개 일정은 규칙상 읽을 수 없으므로 쿼리에도 포함하지 않는다.
 */
export function listenEvents(db, uid, calId, range, cb, onError) {
  const rangeFilters = [
    where('rangeStartMs', '<=', range.endMs),
    where('rangeEndMs', '>=', range.startMs),
    orderBy('rangeStartMs'),
  ];
  const q1 = query(evCol(db, calId), where('visibility', 'in', ['members', 'busy']), ...rangeFilters);
  const q2 = query(evCol(db, calId), where('createdBy', '==', uid), where('visibility', '==', 'private'), ...rangeFilters);
  const parts = [null, null];
  const meta = [null, null];
  const emit = () => {
    if (!parts[0] || !parts[1]) return;
    const map = new Map();
    for (const p of parts) for (const d of p) map.set(d.id, d);
    cb([...map.values()], {
      fromCache: meta[0].fromCache || meta[1].fromCache,
      hasPendingWrites: meta[0].hasPendingWrites || meta[1].hasPendingWrites,
    });
  };
  const handle = (i) => (snap) => {
    parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    meta[i] = snap.metadata;
    emit();
  };
  const u1 = onSnapshot(q1, { includeMetadataChanges: true }, handle(0), onError);
  const u2 = onSnapshot(q2, { includeMetadataChanges: true }, handle(1), onError);
  return () => { u1(); u2(); };
}

export function listenEvent(db, calId, eventId, cb, onError) {
  return onSnapshot(evRef(db, calId, eventId), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), onError);
}

/** 시간만 공개 일정의 실제 세부 내용 (작성자만 읽을 수 있음) */
export async function getSecret(db, calId, eventId) {
  const s = await getDoc(secretRef(db, calId, eventId));
  return s.exists() ? s.data() : null;
}
