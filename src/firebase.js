import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, setPersistence, browserLocalPersistence, signInWithCredential,
} from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache,
  persistentMultipleTabManager, memoryLocalCache,
} from 'firebase/firestore';

const env = import.meta.env;

// iPhone Safari(추적 방지)는 앱 주소와 로그인 처리 주소가 다르면 로그인 정보를 막는다.
// Firebase Hosting 은 모든 호스팅 주소에서 /__/auth/ 로그인 처리 페이지를 제공하므로,
// 앱이 호스팅 주소(.web.app / .firebaseapp.com)에서 열리면 로그인도 같은 주소에서 처리한다.
function pickAuthDomain() {
  if (typeof window === 'undefined' || env.VITE_USE_EMULATORS === 'true') return env.VITE_FIREBASE_AUTH_DOMAIN;
  const host = window.location.host;
  return /\.(web\.app|firebaseapp\.com)$/.test(window.location.hostname) ? host : env.VITE_FIREBASE_AUTH_DOMAIN;
}

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: pickAuthDomain(),
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

// 오프라인 지속성: 네트워크가 끊겨도 마지막으로 받은 데이터를 보여 주고, 작성한 내용은 연결 후 전송한다.
export const db = app
  ? initializeFirestore(app, {
    localCache: typeof indexedDB !== 'undefined'
      ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      : memoryLocalCache(),
  })
  : null;

if (app && usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // 에뮬레이터 전용: 자동화 테스트에서 팝업 없이 테스트 Google 계정으로 로그인 (배포 빌드에는 영향 없음)
  window.__emuSignIn = (email, name) => signInWithCredential(auth, GoogleAuthProvider.credential(
    JSON.stringify({ sub: email, email, email_verified: true, name }),
  ));
}

if (auth) setPersistence(auth, browserLocalPersistence).catch(() => {});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

/** 홈 화면에 추가한 앱(standalone)과 iPhone/iPad 에서는 팝업 대신 리디렉션 방식을 쓴다. */
function shouldUseRedirect() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  return standalone || (ios && !usingEmulators);
}

export async function signInWithGoogle() {
  if (shouldUseRedirect()) return signInWithRedirect(auth, provider);
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업 차단 시 리디렉션으로 재시도
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export function completeRedirectSignIn() {
  return auth ? getRedirectResult(auth) : Promise.resolve(null);
}

export function logout() {
  return signOut(auth);
}
