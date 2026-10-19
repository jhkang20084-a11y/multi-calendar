import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache,
  persistentMultipleTabManager, memoryLocalCache,
} from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
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
}

if (auth) setPersistence(auth, browserLocalPersistence).catch(() => {});

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

/** 홈 화면에 추가한 PWA(standalone)에서는 팝업이 막히므로 리디렉션 방식을 사용한다. */
function shouldUseRedirect() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  return standalone;
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
