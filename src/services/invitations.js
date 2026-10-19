import {
  collection, collectionGroup, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc,
  updateDoc, where, writeBatch, arrayUnion, deleteDoc,
} from 'firebase/firestore';
import { appError } from './errors.js';
import { memberInfoFromUser } from './calendars.js';

const EMAIL_RE = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;

export const INVITE_STATUS_LABELS = {
  pending: '대기 중', accepted: '수락됨', declined: '거절됨', canceled: '취소됨',
};

/**
 * 소유자: 이메일로 초대. 문서 ID 가 소문자 이메일이므로 같은 사람을 중복 초대할 수 없다.
 * 거절/취소된 초대는 다시 보내면 pending 으로 바뀐다. 대기 중 초대의 역할만 바꿀 수도 있다.
 * 초대 문서만으로는 아무 권한도 생기지 않는다. 초대받은 사람이 같은 이메일의 Google 계정으로
 * 로그인해 수락해야만 규칙이 멤버 추가를 허용한다.
 */
export async function inviteMember(db, user, cal, rawEmail, role) {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw appError('app/invalid-email');
  if (!cal.shared) throw appError('app/not-shared');
  if (email === (user.email || '').toLowerCase()) throw appError('app/self-invite');
  if (Object.values(cal.memberInfo || {}).some((m) => m.email?.toLowerCase() === email)) {
    throw appError('app/already-member');
  }
  const ref = doc(db, 'calendars', cal.id, 'invitations', email);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().status === 'pending' && snap.data().role === role) {
    throw appError('app/already-invited');
  }
  await setDoc(ref, {
    email,
    role,
    status: 'pending',
    calendarId: cal.id,
    calendarName: cal.name,
    calendarColor: cal.color,
    invitedBy: user.uid,
    invitedByName: (user.displayName || user.email || '').slice(0, 100),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { reinvited: snap.exists() };
}

export function cancelInvitation(db, user, calId, email) {
  return updateDoc(doc(db, 'calendars', calId, 'invitations', email), {
    status: 'canceled', invitedBy: user.uid, updatedAt: serverTimestamp(),
  });
}

export function deleteInvitation(db, calId, email) {
  return deleteDoc(doc(db, 'calendars', calId, 'invitations', email));
}

/** 소유자: 캘린더의 초대 목록 */
export function listenCalendarInvitations(db, calId, cb, onError) {
  return onSnapshot(collection(db, 'calendars', calId, 'invitations'), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

/** 나에게 온 대기 중 초대 (모든 캘린더) */
export function listenMyInvitations(db, user, cb, onError) {
  const email = (user.email || '').toLowerCase();
  const q = query(collectionGroup(db, 'invitations'), where('email', '==', email));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => i.status === 'pending'));
  }, onError);
}

/**
 * 초대 수락: 캘린더에 나를 추가하고 초대를 accepted 로 바꾸는 작업을 하나의 배치로 보낸다.
 * 보안 규칙이 두 문서를 교차 검증하므로, 초대 없이 멤버가 되거나 다른 역할로 들어갈 수 없다.
 */
export function acceptInvitation(db, user, invite) {
  const b = writeBatch(db);
  b.update(doc(db, 'calendars', invite.calendarId), {
    memberIds: arrayUnion(user.uid),
    [invite.role === 'editor' ? 'editorIds' : 'viewerIds']: arrayUnion(user.uid),
    [`memberInfo.${user.uid}`]: memberInfoFromUser(user),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  b.update(doc(db, 'calendars', invite.calendarId, 'invitations', invite.email), {
    status: 'accepted', respondedAt: serverTimestamp(), respondedBy: user.uid, updatedAt: serverTimestamp(),
  });
  return b.commit();
}

export function declineInvitation(db, user, invite) {
  return updateDoc(doc(db, 'calendars', invite.calendarId, 'invitations', invite.email), {
    status: 'declined', respondedAt: serverTimestamp(), respondedBy: user.uid, updatedAt: serverTimestamp(),
  });
}
