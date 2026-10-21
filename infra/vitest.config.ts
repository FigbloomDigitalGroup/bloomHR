import { defineConfig } from 'vitest/config';

// Own config so vitest doesn't pick up the app's (jsdom, src/**) from the folder above
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
