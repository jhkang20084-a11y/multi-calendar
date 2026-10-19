import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
