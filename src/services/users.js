import { doc, runTransaction, serverTimestamp, updateDoc, onSnapshot, collection } from 'firebase/firestore';
import { DEFAULT_TZ } from '../lib/time.js';
import { newCalendarDoc } from './calendars.js';

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  timeZone: DEFAULT_TZ,
  weekStartsOn: 0, // 0=일요일, 1=월요일
  defaultView: 'month',
  hiddenCalendarIds: [],
  notifications: { enabled: false, defaultMinutes: 10 },
};

export function profileFromAuth(user) {
  return {
    uid: user.uid,
    displayName: (user.displayName || user.email || '사용자').slice(0, 100),
    photoURL: (user.photoURL || '').slice(0, 2000),
    email: user.email || '',
    emailLower: (user.email || '').toLowerCase(),
  };
}

/**
 * 로그인 직후 호출. 프로필이 없으면(최초 로그인) 프로필과 기본 개인 캘린더를 함께 만든다.
 * 이미 있으면 이름/사진만 최신 Google 계정 정보로 갱신한다.
 */
export async function ensureUserProfile(db, user) {
  const ref = doc(db, 'users', user.uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const p = profileFromAuth(user);
    if (!snap.exists()) {
      const calRef = doc(collection(db, 'calendars'));
      tx.set(ref, {
        ...p, settings: DEFAULT_SETTINGS, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      tx.set(calRef, newCalendarDoc(user, {
        name: '내 캘린더', description: '나만 보는 개인 캘린더', color: '#4f6bed', shared: false,
      }));
      return { created: true, personalCalendarId: calRef.id };
    }
    const cur = snap.data();
    if (cur.displayName !== p.displayName || cur.photoURL !== p.photoURL || cur.email !== p.email) {
      tx.update(ref, { ...p, updatedAt: serverTimestamp() });
    }
    return { created: false };
  });
}

export function listenProfile(db, uid, cb, onError) {
  return onSnapshot(doc(db, 'users', uid), (s) => cb(s.exists() ? s.data() : null), onError);
}

export function updateSettings(db, uid, settings) {
  return updateDoc(doc(db, 'users', uid), { settings, updatedAt: serverTimestamp() });
}
