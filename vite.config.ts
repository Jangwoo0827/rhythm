import { defineConfig } from 'vitest/config';

// host: true → 같은 와이파이의 폰에서 http://<PC IP>:5173 으로 접속 가능
// base: './' → 어느 경로(GitHub Pages 의 /<저장소>/ 포함)에 올려도 동작하는 상대 경로 빌드
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
