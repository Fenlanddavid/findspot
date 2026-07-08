import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure logic only — no DOM, no IndexedDB.
    // Any test needing browser APIs must override environment per-file.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
