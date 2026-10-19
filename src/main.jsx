import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
// 글꼴을 앱에 포함 (오프라인/PWA 에서도 같은 모양). 한글 글꼴은 필요한 글자 조각만 내려받는다.
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/playfair-display/latin-700-italic.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/gowun-dodum/400.css';
import '@fontsource/gaegu/400.css';
import './styles.css';

// 앱처럼: 손가락 두 개로 확대(핀치)와 두 번 탭 확대를 막는다. (iOS Safari 는 viewport 설정을 무시하므로 직접 막음)
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea, select')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

// PWA: 배포 빌드에서만 서비스 워커 등록 (개발 중 캐시 문제 방지)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
