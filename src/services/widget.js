import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';

/**
 * 아이폰 위젯 연결용 비밀 토큰. 위젯은 로그인할 수 없으므로 이 토큰이 든 주소로 서버(widgetFeed)에서 일정을 받는다.
 * 토큰을 아는 사람은 내 일정을 볼 수 있으니 기기 밖으로 보내지 않는다(앱 → 위젯 공유 저장소에만 저장).
 */
export function newWidgetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createWidgetToken(db, uid, calendarId = '') {
  const token = newWidgetToken();
  await setDoc(doc(db, 'widgetTokens', token), { uid, calendarId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return token;
}

/** 토큰이 아직 살아 있는지(다른 기기에서 끊지 않았는지) */
export async function widgetTokenAlive(db, token) {
  try { return (await getDoc(doc(db, 'widgetTokens', token))).exists(); } catch { return false; }
}

/** 위젯에 보여 줄 캘린더를 바꾼다(앱에서 보고 있는 캘린더) */
export function setWidgetCalendar(db, token, calendarId) {
  return updateDoc(doc(db, 'widgetTokens', token), { calendarId, updatedAt: serverTimestamp() });
}

/** 내 위젯 토큰을 모두 끈다(예전 링크로는 더 이상 일정을 볼 수 없음) */
export async function revokeWidgetTokens(db, uid) {
  const snap = await getDocs(query(collection(db, 'widgetTokens'), where('uid', '==', uid)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  return snap.size;
}

export function widgetFeedUrl({ projectId, token, emulator = false }) {
  const t = encodeURIComponent(token);
  return emulator
    ? `http://127.0.0.1:5001/${projectId}/asia-northeast3/widgetFeed?t=${t}`
    : `https://asia-northeast3-${projectId}.cloudfunctions.net/widgetFeed?t=${t}`;
}
