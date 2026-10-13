import { defineConfig } from 'vitest/config';

// Firestore 에뮬레이터가 떠 있어야 한다: npm run test:rules
export default defineConfig({
  test: { environment: 'node', include: ['rules-tests/**/*.test.ts'], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false },
});
