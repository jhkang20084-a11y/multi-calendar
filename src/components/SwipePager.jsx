import { useCallback, useEffect, useRef, useState } from 'react';

const DURATION = 260; // ms
const EASE = 'cubic-bezier(.22,.8,.3,1)';

/**
 * 좌우로 끌어서 이전/다음으로 넘기는 영역.
 * - 손가락(또는 마우스)을 따라 내용이 움직이고, 충분히 밀거나 빠르게 튕기면 다음 화면이 밀려 들어온다.
 * - 덜 밀면 제자리로 돌아온다. 위아래 스크롤은 그대로 동작한다(touch-action: pan-y).
 * - 키보드 ←/→, 트랙패드 가로 스와이프로도 넘길 수 있다.
 * onMove(dir): dir = 1(다음) | -1(이전)
 */
export function SwipePager({ onMove, children }) {
  const box = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const busy = useRef(false);
  const wheel = useRef({ sum: 0, t: 0, lockUntil: 0 });
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);

  const slide = useCallback((dir) => {
    if (busy.current) return;
    busy.current = true;
    const w = box.current?.offsetWidth || window.innerWidth;
    // 1) 지금 화면을 밀어 내보내고
    setAnimating(true);
    setDx(-dir * w);
    setTimeout(() => {
      // 2) 내용을 바꾼 뒤 반대편에서 시작해
      onMove(dir);
      setAnimating(false);
      setDx(dir * w * 0.35);
      // 3) 제자리로 밀려 들어오게 한다
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setAnimating(true);
        setDx(0);
        setTimeout(() => { setAnimating(false); busy.current = false; }, DURATION);
      }));
    }, DURATION * 0.75);
  }, [onMove]);

  const snapBack = () => {
    setAnimating(true);
    setDx(0);
    setTimeout(() => setAnimating(false), DURATION);
  };

  // 키보드 ←/→ (입력 중일 때·창이 열려 있을 때는 무시)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.modal')) return;
      if (e.key === 'ArrowRight') slide(1);
      if (e.key === 'ArrowLeft') slide(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slide]);

  // ── 공통: 시작 / 이동 / 끝 (손가락은 터치 이벤트, 마우스는 포인터 이벤트로 들어온다) ──
  const start = (x, y) => {
    if (busy.current) return;
    drag.current = { x, y, t: performance.now(), mode: null, lastX: x };
  };
  // 반환값 true = 가로로 끄는 중(브라우저 기본 동작을 막아야 함)
  const moveTo = (x, y) => {
    const d = drag.current;
    if (!d) return false;
    const mx = x - d.x;
    const my = y - d.y;
    d.lastX = x;
    if (!d.mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return false;
      // 처음 움직인 방향으로 가로 넘기기/세로 스크롤을 정한다
      d.mode = Math.abs(mx) > Math.abs(my) * 1.2 ? 'x' : 'y';
    }
    if (d.mode !== 'x') return false;
    // 손을 따라 움직이되 많이 끌수록 조금씩 덜 따라오게(고무줄 느낌)
    const w = box.current.offsetWidth;
    const m = Math.min(Math.abs(mx), w);
    setDx(Math.sign(mx) * m * (1 - m / (w * 3)));
    return true;
  };
  const end = (x) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== 'x') return;
    suppressClick.current = true; // 끄는 동작 뒤에 일정이 눌리지 않게
    setTimeout(() => { suppressClick.current = false; }, 80);
    const mx = (x ?? d.lastX) - d.x;
    const v = Math.abs(mx) / Math.max(1, performance.now() - d.t);
    const w = box.current.offsetWidth;
    if (Math.abs(mx) > w * 0.22 || (v > 0.45 && Math.abs(mx) > 30)) slide(mx < 0 ? 1 : -1);
    else snapBack();
  };

  // 손가락: 가로로 끄는 중에는 preventDefault 로 브라우저가 가로채지 못하게 (passive: false 필요)
  const handlers = useRef({});
  handlers.current = { start, moveTo, end };
  useEffect(() => {
    const el = box.current;
    const ts = (e) => { if (e.touches.length === 1) handlers.current.start(e.touches[0].clientX, e.touches[0].clientY); else drag.current = null; };
    const tm = (e) => { if (e.touches.length === 1 && handlers.current.moveTo(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault(); };
    const te = (e) => handlers.current.end(e.changedTouches[0]?.clientX);
    const tc = () => { if (drag.current?.mode === 'x') { drag.current = null; snapBack(); } else drag.current = null; };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', tc);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', tc);
    };
  }, []);

  // 마우스(PC): 끌어서 넘기기
  const onPointerDown = (e) => { if (e.pointerType === 'mouse' && e.button === 0) start(e.clientX, e.clientY); };
  const onPointerMove = (e) => {
    if (e.pointerType !== 'mouse' || !drag.current) return;
    if (moveTo(e.clientX, e.clientY)) { try { box.current.setPointerCapture(e.pointerId); } catch { /* 무시 */ } }
  };
  const onPointerUp = (e) => { if (e.pointerType === 'mouse') end(e.clientX); };

  // 트랙패드 가로 스와이프
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = performance.now();
    // 한 번 넘긴 뒤에는 같은 손동작(관성 스크롤)으로 여러 번 넘어가지 않게 잠시 무시
    if (now < (wheel.current.lockUntil || 0)) return;
    if (now - wheel.current.t > 300) wheel.current.sum = 0;
    wheel.current.t = now;
    wheel.current.sum += e.deltaX;
    if (Math.abs(wheel.current.sum) > 80) {
      slide(wheel.current.sum > 0 ? 1 : -1);
      wheel.current.sum = 0;
      wheel.current.lockUntil = now + 700;
    }
  };

  return (
    <div className="swipe-pager" ref={box}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={(e) => { if (e.pointerType === 'mouse') { if (drag.current?.mode === 'x') snapBack(); drag.current = null; } }}
      onWheel={onWheel}
      onClickCapture={(e) => {
        if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; }
      }}>
      <div className="swipe-track" style={{
        transform: `translate3d(${dx}px,0,0)`,
        transition: animating ? `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms` : 'none',
        opacity: 1 - Math.min(Math.abs(dx) / ((box.current?.offsetWidth || 400) * 2.2), 0.45),
      }}>
        {children}
      </div>
    </div>
  );
}
