import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 글꼴의 옛 형식(woff) 예비 파일을 빼서 배포 파일 수를 절반으로 줄인다.
// 현재 쓰이는 모든 브라우저(iOS Safari 10+, Chrome, Edge, Firefox)는 woff2 를 사용한다.
const woff2Only = {
  name: 'woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
    return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''), map: null };
  },
};

export default defineConfig({
  plugins: [woff2Only, react()],
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], vendor: ['react', 'react-dom', 'luxon'] },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  test: {
    // 규칙/통합 테스트는 에뮬레이터 하나를 공유하므로 파일을 순서대로 실행한다.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
