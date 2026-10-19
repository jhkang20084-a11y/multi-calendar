import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db, completeRedirectSignIn } from '../firebase.js';
import { ensureUserProfile } from '../services/users.js';
import { friendlyError } from '../services/errors.js';

/** 로그인 상태 + 최초 로그인 시 프로필 생성. 로그인 유지는 Firebase Auth 의 로컬 지속성으로 처리된다. */
export function useAuthState() {
  const [state, setState] = useState({ user: null, loading: true, error: null, profileReady: false });

  useEffect(() => {
    completeRedirectSignIn().catch((e) => setState((s) => ({ ...s, error: friendlyError(e) })));
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState((s) => ({ user: null, loading: false, error: s.error, profileReady: false }));
        return;
      }
      setState({ user, loading: true, error: null, profileReady: false });
      try {
        await ensureUserProfile(db, user);
        setState({ user, loading: false, error: null, profileReady: true });
      } catch (e) {
        setState({ user, loading: false, error: friendlyError(e), profileReady: false });
      }
    });
  }, []);

  return state;
}
