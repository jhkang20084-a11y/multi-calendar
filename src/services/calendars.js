import {
  collection, doc, query, where, onSnapshot, serverTimestamp, updateDoc, runTransaction,
  setDoc, deleteField, getDocs, writeBatch, deleteDoc,
} from 'firebase/firestore';
import { appError } from './errors.js';
import { DEFAULT_CATEGORIES, cleanCategories } from '../lib/categories.js';

export const ROLE_LABELS = { owner: '소유자', editor: '편집자', viewer: '열람자' };

export function roleOf(cal, uid) {
  if (!cal || !uid) return null;
  if (cal.ownerId === uid) return 'owner';
  if (cal.editorIds?.includes(uid)) return 'editor';
  if (cal.viewerIds?.includes(uid)) return 'viewer';
  return null;
}

export const canEdit = (cal, uid) => ['owner', 'editor'].includes(roleOf(cal, uid));
export const isOwner = (cal, uid) => roleOf(cal, uid) === 'owner';

export function memberInfoFromUser(user) {
  return {
    name: (user.displayName || user.email || '').slice(0, 100),
    email: (user.email || '').toLowerCase(),
    photoURL: (user.photoURL || '').slice(0, 2000),
  };
}

export function newCalendarDoc(user, { name, description = '', color = '#4f6bed', coverImage = '', shared = false }) {
  return {
    name: name.trim().slice(0, 60),
    description: description.slice(0, 500),
    color,
    coverImage,
    shared: Boolean(shared),
    categories: DEFAULT_CATEGORIES,
    ownerId: user.uid,
    createdBy: user.uid,
    editorIds: [],
    viewerIds: [],
    memberIds: [user.uid],
    memberInfo: { [user.uid]: memberInfoFromUser(user) },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
}

export async function createCalendar(db, user, data) {
  if (!data.name?.trim()) throw appError('app/invalid-name', '캘린더 이름을 입력하세요.');
  const ref = doc(collection(db, 'calendars'));
  await setDoc(ref, newCalendarDoc(user, data));
  return ref.id;
}

/** 로그인한 사용자가 멤버인 캘린더만 실시간으로 받는다. */
export function listenMyCalendars(db, uid, cb, onError) {
  const q = query(collection(db, 'calendars'), where('memberIds', 'array-contains', uid));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.createdAt?.toMillis?.() ?? Infinity) - (b.createdAt?.toMillis?.() ?? Infinity));
    cb(list, snap.metadata);
  }, onError);
}

export async function updateCalendarSettings(db, user, calId, patch, currentCal) {
  const allowed = {};
  for (const k of ['name', 'description', 'color', 'coverImage', 'shared', 'categories']) {
    if (k in patch) allowed[k] = patch[k];
  }
  if ('categories' in allowed) allowed.categories = cleanCategories(allowed.categories);
  if ('name' in allowed) {
    allowed.name = allowed.name.trim().slice(0, 60);
    if (!allowed.name) throw appError('app/invalid-name', '캘린더 이름을 입력하세요.');
  }
  if (allowed.shared === false && currentCal && currentCal.memberIds.length > 1) {
    throw appError('app/has-members');
  }
  return updateDoc(doc(db, 'calendars', calId), {
    ...allowed, updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
}

/** 소유자: 멤버 역할 변경 (editor ↔ viewer). 최신 상태를 읽고 쓰기 위해 트랜잭션 사용. */
export function changeMemberRole(db, user, calId, targetUid, newRole) {
  if (!['editor', 'viewer'].includes(newRole)) throw appError('app/invalid-role', '잘못된 역할입니다.');
  const ref = doc(db, 'calendars', calId);
  return runTransaction(db, async (tx) => {
    const cal = (await tx.get(ref)).data();
    if (cal.ownerId !== user.uid) throw appError('permission-denied');
    if (targetUid === cal.ownerId || !cal.memberIds.includes(targetUid)) throw appError('not-found');
    const editors = cal.editorIds.filter((u) => u !== targetUid);
    const viewers = cal.viewerIds.filter((u) => u !== targetUid);
    (newRole === 'editor' ? editors : viewers).push(targetUid);
    tx.update(ref, { editorIds: editors, viewerIds: viewers, updatedAt: serverTimestamp(), updatedBy: user.uid });
  });
}

function removeFromCalendar(tx, ref, cal, targetUid, user) {
  tx.update(ref, {
    memberIds: cal.memberIds.filter((u) => u !== targetUid),
    editorIds: cal.editorIds.filter((u) => u !== targetUid),
    viewerIds: cal.viewerIds.filter((u) => u !== targetUid),
    [`memberInfo.${targetUid}`]: deleteField(),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

/** 소유자: 멤버 제거 */
export function removeMember(db, user, calId, targetUid) {
  const ref = doc(db, 'calendars', calId);
  return runTransaction(db, async (tx) => {
    const cal = (await tx.get(ref)).data();
    if (cal.ownerId !== user.uid) throw appError('permission-denied');
    if (targetUid === cal.ownerId) throw appError('permission-denied', '소유자는 제거할 수 없습니다.');
    removeFromCalendar(tx, ref, cal, targetUid, user);
  });
}

/** 멤버(소유자 제외): 캘린더 나가기 */
export function leaveCalendar(db, user, calId) {
  const ref = doc(db, 'calendars', calId);
  return runTransaction(db, async (tx) => {
    const cal = (await tx.get(ref)).data();
    if (cal.ownerId === user.uid) {
      throw appError('failed-precondition', '소유자는 나갈 수 없습니다. 먼저 소유권을 이전하세요.');
    }
    removeFromCalendar(tx, ref, cal, user.uid, user);
  });
}

/** 소유권 이전: 대상(기존 멤버)이 소유자가 되고, 나는 편집자로 남는다. */
export function transferOwnership(db, user, calId, newOwnerUid) {
  const ref = doc(db, 'calendars', calId);
  return runTransaction(db, async (tx) => {
    const cal = (await tx.get(ref)).data();
    if (cal.ownerId !== user.uid) throw appError('permission-denied');
    if (!cal.memberIds.includes(newOwnerUid) || newOwnerUid === user.uid) throw appError('not-found');
    tx.update(ref, {
      ownerId: newOwnerUid,
      editorIds: [...cal.editorIds.filter((u) => u !== newOwnerUid), user.uid],
      viewerIds: cal.viewerIds.filter((u) => u !== newOwnerUid),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
  });
}

/**
 * 소유자: 캘린더 삭제. 읽을 수 있는 하위 데이터(일정, 체크리스트, 초대)를 먼저 지운 뒤 캘린더 문서를 지운다.
 * 다른 멤버가 만든 "비공개/시간만 공개" 일정은 소유자도 읽을 수 없어 남을 수 있지만,
 * 캘린더 문서가 사라지면 규칙상 누구도 접근할 수 없다(알려진 제한 사항 참고).
 */
export async function deleteCalendar(db, user, calId) {
  const calRef = doc(db, 'calendars', calId);
  const evSnap = await getDocs(query(collection(calRef, 'events'), where('visibility', 'in', ['members', 'busy'])));
  const mine = await getDocs(query(collection(calRef, 'events'), where('createdBy', '==', user.uid), where('visibility', '==', 'private')));
  const refs = [];
  for (const e of [...evSnap.docs, ...mine.docs]) {
    const ev = e.data();
    if (ev.visibility !== 'members' && ev.createdBy !== user.uid) continue;
    const todos = await getDocs(collection(e.ref, 'todos'));
    todos.forEach((t) => refs.push(t.ref));
    if (ev.visibility === 'busy') refs.push(doc(e.ref, 'secret', 'detail'));
    refs.push(e.ref);
  }
  for (const sub of ['invitations', 'inviteLinks', 'joins']) {
    const snap = await getDocs(collection(calRef, sub));
    snap.forEach((d) => refs.push(d.ref));
  }
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
  await deleteDoc(calRef);
}
