// 아이폰 앱과 주고받는 메시지 (firebase 를 불러오지 않는 가벼운 부분 — firebase.js 에서도 쓴다). 자세한 설명은 native.js
export const isNativeApp = () => typeof window !== 'undefined'
  && Boolean(window.__kittyNative && window.webkit?.messageHandlers?.kittyNative);

export function postNative(msg) {
  if (!isNativeApp()) return;
  try { window.webkit.messageHandlers.kittyNative.postMessage(msg); } catch { /* 앱이 아님 */ }
}

/** 앱의 Safari 로그인 창(구글은 앱 안 웹뷰 로그인을 막음)으로 로그인하고 Google 토큰을 받는다. */
export function nativeGoogleLogin() {
  return new Promise((resolve, reject) => {
    window.__kittyAuthResult = (r) => {
      window.__kittyAuthResult = null;
      if (r?.idToken) resolve(r);
      else reject(Object.assign(new Error(r?.error || 'cancelled'), { code: r?.error === 'cancelled' ? 'app/login-cancelled' : 'app/native-login' }));
    };
    postNative({ type: 'login' });
  });
}

