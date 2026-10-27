// 아이폰 앱(ios/ 폴더의 KittyCal) 안에서 열렸을 때만 쓰는 연결 코드. 브라우저에서는 아무 일도 하지 않는다.
//  앱 → 웹: window.__kittyNative = { platform: 'ios' } (앱이 페이지 시작 전에 넣어 줌)
//          window.__kittyAuthResult({ idToken, accessToken } | { error })  (Safari 로그인 창 결과)
//  웹 → 앱: window.webkit.messageHandlers.kittyNative.postMessage({ type, ... })
//          login | widget { feedUrl } | widgetRefresh | signedOut
import { useEffect, useRef } from 'react';
import { db, usingEmulators, firebaseConfig } from './firebase.js';
import { isNativeApp, postNative } from './nativeBridge.js';
import { createWidgetToken, setWidgetCalendar, widgetTokenAlive, widgetFeedUrl, revokeWidgetTokens } from './services/widget.js';

const tokenKey = (uid) => `widgetToken:${uid}`;
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 저장 불가 */ } };

async function connectWidget(uid, calendarId, fresh = false) {
  let token = fresh ? null : readLocal(tokenKey(uid));
  if (!token || !(await widgetTokenAlive(db, token))) {
    token = await createWidgetToken(db, uid, calendarId || '');
    writeLocal(tokenKey(uid), token);
    writeLocal(`${tokenKey(uid)}:cal`, calendarId || '');
  }
  postNative({ type: 'widget', feedUrl: widgetFeedUrl({ projectId: firebaseConfig.projectId, token, emulator: usingEmulators }) });
  return token;
}

/** 설정 > 위젯: 예전 연결을 모두 끊고 새로 연결 */
export async function reconnectWidget(uid, calendarId = readLocal('focus') || '') {
  await revokeWidgetTokens(db, uid);
  writeLocal(tokenKey(uid), null);
  const token = await connectWidget(uid, calendarId, true);
  postNative({ type: 'widgetRefresh' });
  return token;
}

/**
 * 로그인한 동안: 위젯 연결, 보고 있는 캘린더가 바뀌면 위젯 캘린더도 바꾸고, 일정이 바뀌면 위젯에 새로 고침을 알린다.
 */
export function useNativeBridge({ uid, focus, instances: changes }) {
  const token = useRef(null);
  useEffect(() => {
    if (!isNativeApp() || !uid) return undefined;
    let alive = true;
    connectWidget(uid, focus).then((t) => { if (alive) token.current = t; }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    if (!isNativeApp() || !uid || !focus) return;
    const key = `${tokenKey(uid)}:cal`;
    const t = token.current || readLocal(tokenKey(uid));
    if (!t || readLocal(key) === focus) return;
    setWidgetCalendar(db, t, focus)
      .then(() => { writeLocal(key, focus); postNative({ type: 'widgetRefresh' }); })
      .catch(() => {});
  }, [uid, focus, token.current]);

  // 일정이 바뀌면(내가 고치거나 다른 멤버가 고치거나) 잠시 뒤 위젯을 새로 고친다
  useEffect(() => {
    if (!isNativeApp() || !uid) return undefined;
    const timer = setTimeout(() => postNative({ type: 'widgetRefresh' }), 4000);
    return () => clearTimeout(timer);
  }, [uid, changes]);
}

export { isNativeApp, postNative };
