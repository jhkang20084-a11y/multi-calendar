import {
  collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, Timestamp, writeBatch, arrayUnion,
} from 'firebase/firestore';
import { appError } from './errors.js';
import { memberInfoFromUser } from './calendars.js';

/**
 * 링크 초대
 *   calendars/{calId}/inviteLinks/{linkId}  : role, 만료일 (linkId = 추측할 수 없는 무작위 코드)
 *   calendars/{calId}/joins/{uid}           : 누가 어떤 링크로 들어왔는지
 * 링크 주소: https://<앱 주소>/?join=<calId>~<linkId>
 * 참여는 "joins 기록 + 캘린더에 나를 추가"를 한 배치로 보내고, 보안 규칙이 링크의 유효기간과 역할을 검사한다.
 */

export const LINK_DAYS = [1, 7, 30];

function randomId(len = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function inviteUrl(calId, linkId, origin = window.location.origin) {
  return `${origin}/?join=${encodeURIComponent(`${calId}~${linkId}`)}`;
}

/** URL 의 ?join= 값 → { calId, linkId } 또는 null */
export function parseJoinParam(value) {
  const m = /^([A-Za-z0-9_-]{1,128})~([A-Za-z0-9_-]{24,64})$/.exec(value || '');
  return m ? { calId: m[1], linkId: m[2] } : null;
}

export async function createInviteLink(db, user, cal, role, days = 7) {
  if (!cal.shared) throw appError('app/not-shared');
  const linkId = randomId();
  await setDoc(doc(db, 'calendars', cal.id, 'inviteLinks', linkId), {
    role,
    calendarId: cal.id,
    calendarName: cal.name,
    calendarColor: cal.color,
    createdBy: user.uid,
    createdByName: (user.displayName || user.email || '').slice(0, 100),
    createdAt: serverTimestamp(),
    // 서버 시각보다 조금 앞서도 규칙(최대 31일)을 넘지 않도록 하루 단위로만 계산
    expiresAt: Timestamp.fromMillis(Date.now() + days * 86400e3 - 60e3),
  });
  return { linkId, url: typeof window === 'undefined' ? null : inviteUrl(cal.id, linkId) };
}

/** 소유자: 이 캘린더의 초대 링크 목록 */
export function listenInviteLinks(db, calId, cb, onError) {
  return onSnapshot(collection(db, 'calendars', calId, 'inviteLinks'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function deleteInviteLink(db, calId, linkId) {
  return deleteDoc(doc(db, 'calendars', calId, 'inviteLinks', linkId));
}

/** 링크 정보 읽기 (캘린더 멤버가 아니어도 링크 코드를 알면 읽을 수 있다) */
export async function getInviteLink(db, calId, linkId) {
  const snap = await getDoc(doc(db, 'calendars', calId, 'inviteLinks', linkId));
  if (!snap.exists()) throw appError('app/link-invalid');
  const link = snap.data();
  if (link.expiresAt.toMillis() <= Date.now()) throw appError('app/link-expired');
  return { id: linkId, ...link };
}

export function joinWithLink(db, user, calId, linkId, role) {
  const b = writeBatch(db);
  b.set(doc(db, 'calendars', calId, 'joins', user.uid), { linkId, joinedAt: serverTimestamp() });
  b.update(doc(db, 'calendars', calId), {
    memberIds: arrayUnion(user.uid),
    [role === 'editor' ? 'editorIds' : 'viewerIds']: arrayUnion(user.uid),
    [`memberInfo.${user.uid}`]: memberInfoFromUser(user),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  return b.commit();
}
