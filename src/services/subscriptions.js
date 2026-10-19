import {
  collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { appError } from './errors.js';

/** 구독 문서 ID 를 고정해 같은 (사용자, 대상, 원본) 조합의 중복 구독을 막는다. */
export const subscriptionId = (uid, targetId, sourceId) => `${uid}__${targetId}__${sourceId}`;

export function listenMySubscriptions(db, uid, cb, onError) {
  const q = query(collection(db, 'subscriptions'), where('ownerUid', '==', uid));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

/**
 * target 캘린더 화면에 source 캘린더 일정을 읽기 전용으로 함께 표시한다.
 * 일정은 복사하지 않는다. 표시할 때마다 원본 캘린더 권한으로 다시 조회한다.
 */
export async function subscribe(db, user, targetId, sourceId, myCalendars) {
  if (targetId === sourceId) throw appError('app/self-subscribe');
  const ids = new Set(myCalendars.map((c) => c.id));
  if (!ids.has(targetId) || !ids.has(sourceId)) throw appError('app/no-access');
  const ref = doc(db, 'subscriptions', subscriptionId(user.uid, targetId, sourceId));
  const snap = await getDoc(ref);
  if (snap.exists()) throw appError('app/already-subscribed');
  await setDoc(ref, {
    ownerUid: user.uid,
    targetCalendarId: targetId,
    sourceCalendarId: sourceId,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function setSubscriptionActive(db, subId, active) {
  return updateDoc(doc(db, 'subscriptions', subId), { active, updatedAt: serverTimestamp() });
}

/** 구독 해제: 구독 관계 문서만 지운다. 원본 일정은 그대로다. */
export function unsubscribe(db, subId) {
  return deleteDoc(doc(db, 'subscriptions', subId));
}
