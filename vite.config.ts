import { defineConfig } from 'vite';

// host: true → 같은 와이파이의 폰에서 http://<PC IP>:5173 으로 접속 가능
export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
