import { defineConfig } from 'vitest/config';

// Own config so vitest doesn't pick up the app's (jsdom, src/**) from the folder above
export default defineConfig({
  // and an inline PostCSS config, or vite searches upwards, finds the app's postcss.config.js and fails on tailwindcss
  // (not installed here)
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
