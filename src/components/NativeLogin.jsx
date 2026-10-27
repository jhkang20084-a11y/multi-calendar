import { useEffect, useRef, useState } from 'react';
import { runNativeLoginStep } from '../firebase.js';
import { friendlyError } from '../services/errors.js';

/**
 * 아이폰 앱이 띄우는 Safari 로그인 창 안의 페이지(/?nativeLogin=1).
 * 구글 로그인을 마치면 앱으로 돌아간다(kittycal://auth). 앱 밖에서 이 주소를 열면 아무 일도 생기지 않는다.
 */
export default function NativeLogin() {
  const [state, setState] = useState('working');
  const [error, setError] = useState('');
  const step = (retry) => {
    setState('working'); setError('');
    runNativeLoginStep(retry)
      .then((r) => {
        if (r?.callbackUrl) { setState('done'); window.location.replace(r.callbackUrl); }
        else if (r === 'retry') setState('retry');
      })
      .catch((e) => { setError(friendlyError(e)); setState('retry'); });
  };
  const started = useRef(false);
  useEffect(() => { if (!started.current) { started.current = true; step(false); } }, []);
  return (
    <div className="center-screen login">
      <div className="card">
        <h1 className="login-title">Calendar</h1>
        {state === 'working' && <p className="login-sub">Google 로그인 화면으로 이동하는 중…</p>}
        {state === 'done' && <p className="login-sub">로그인했어요! 앱으로 돌아가는 중… ♡</p>}
        {state === 'retry' && (
          <>
            <p className="login-sub">로그인을 마치지 못했어요.</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary" onClick={() => step(true)}>다시 로그인</button>
            <p className="hint">그만두려면 위쪽의 "취소"를 누르세요.</p>
          </>
        )}
      </div>
    </div>
  );
}
