import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Integration test files share one database, so files run one after another.
  test: { include: ['src/**/*.test.ts'], fileParallelism: false },
});
