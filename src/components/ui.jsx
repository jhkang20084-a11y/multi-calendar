import { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../services/errors.js';
import { TORN_PATH } from '../lib/colors.js';

// ── 토스트 + 저장 상태 표시 ───────────────────────────────────────────────
const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const seq = useRef(0);

  const toast = useCallback((kind, text, ms = 3000) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  /**
   * 쓰기 작업 결과를 정직하게 표시한다.
   *  - 온라인: 서버 저장이 확정된 뒤에만 성공 표시. 실패하면 오류 표시.
   *  - 오프라인: "연결되면 동기화" 안내 후 'queued' 반환. 나중에 확정/실패 시 다시 알림.
   */
  const write = useCallback(async (promise, okText = '저장했습니다.') => {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const tracked = Promise.resolve(promise).then(
      () => { toast('success', offline ? `동기화 완료: ${okText}` : okText); return true; },
      (e) => { toast('error', friendlyError(e), 6000); return false; },
    );
    if (offline) {
      toast('info', '오프라인 상태입니다. 연결되면 자동으로 저장됩니다(아직 저장되지 않음).', 5000);
      return 'queued';
    }
    return (await tracked) ? 'ok' : 'error';
  }, [toast]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setConfirmState({ ...opts, resolve });
  }), []);

  return (
    <UiContext.Provider value={{ toast, write, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
      {confirmState && (
        <Modal title={confirmState.title || '확인'} onClose={() => { confirmState.resolve(null); setConfirmState(null); }} small>
          <p className="confirm-text">{confirmState.message}</p>
          <div className="btn-col">
            {(confirmState.choices || [{ value: true, label: confirmState.okLabel || '확인', danger: confirmState.danger }]).map((c) => (
              <button key={String(c.value)} className={`btn ${c.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => { confirmState.resolve(c.value); setConfirmState(null); }}>{c.label}</button>
            ))}
            <button className="btn" onClick={() => { confirmState.resolve(null); setConfirmState(null); }}>취소</button>
          </div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);

// ── 모달 ───────────────────────────────────────────────────────────────
export function Modal({ title, label, onClose, children, footer, small, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${small ? 'modal-small' : ''} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : undefined)}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name, photoURL, size = 28 }) {
  const [broken, setBroken] = useState(false);
  if (photoURL && !broken) {
    return <img className="avatar" src={photoURL} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="avatar avatar-text" style={{ width: size, height: size, fontSize: size * 0.45 }}>{(name || '?').slice(0, 1).toUpperCase()}</span>;
}

export function ColorPicker({ value, onChange, palette, allowNone }) {
  return (
    <div className="color-picker">
      {allowNone && (
        <button type="button" className={`swatch swatch-none ${!value ? 'selected' : ''}`} onClick={() => onChange('')} title="캘린더 색상 사용">⦸</button>
      )}
      {palette.map((c) => (
        <button type="button" key={c} className={`swatch ${value === c ? 'selected' : ''}`} style={{ background: c }}
          onClick={() => onChange(c)} aria-label={`색상 ${c}`} />
      ))}
    </div>
  );
}

export function Spinner({ label = '불러오는 중…' }) {
  return <div className="spinner-wrap"><div className="spinner" /><span>{label}</span></div>;
}

/** 화면 일부에서 예기치 못한 오류가 나도 앱 전체가 멈추지 않게 한다. */
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="card">
          <h1>화면을 표시하는 중 오류가 발생했습니다</h1>
          <p className="muted small">{String(this.state.error?.message || this.state.error)}</p>
          <p>저장된 데이터에는 영향이 없습니다.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>새로고침</button>
        </div>
      </div>
    );
  }
}

/** 찢어진 종이 가장자리 (커버 아래쪽에 겹쳐 그림) */
export function Torn({ className = 'torn' }) {
  return (
    <svg className={className} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
      <path d={TORN_PATH} fill="currentColor" />
    </svg>
  );
}

export function Hearts() {
  return <span className="hearts" aria-hidden><span className="h1">♥</span><span className="h2">♥</span><span className="h3">♥</span></span>;
}

/** 손그림 격자선용 SVG 필터 (앱에 한 번만 넣는다) */
export function SketchFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="sketch">
        <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="4" />
        <feDisplacementMap in="SourceGraphic" scale="5" />
      </filter>
    </svg>
  );
}
