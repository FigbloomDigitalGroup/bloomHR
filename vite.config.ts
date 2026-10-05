import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveAppVersion, versionFile } from './scripts/appVersion.mjs';

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return ''; // not a git checkout (some hosts build from a plain copy)
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : 'http://localhost:3001';

  // The version baked into the code and the one published in /version.json come from this one value, so the
  // "Update Available" check can never disagree with the build it belongs to.
  const builtAt = new Date();
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
  const appVersion = resolveAppVersion({
    explicit: env.VITE_APP_VERSION,
    pkgVersion: pkg.version,
    commit: gitCommit(),
    builtAt,
  });
  process.env.VITE_APP_VERSION = appVersion; // read by import.meta.env.VITE_APP_VERSION in src/sw.ts

  return {
    plugins: [
      react(),
      {
        name: 'emit-version-json',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: `${JSON.stringify(versionFile(appVersion, builtAt), null, 2)}
`,
          });
        },
      },
    ],
    base: '/',
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      host: true,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          // rewrite: (path) => path.replace(/^\/api/, ''),
          secure: false,
        },
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
      include: ['react-router-dom'],
    },
    build: {
      outDir: 'dist',
      assetsInlineLimit: 0,
      rollupOptions: {
        external: ['uuid'],
        input: {
          main: resolve(__dirname, 'index.html'),
        },
        output: {
          assetFileNames: 'assets/[name].[hash][extname]',
          chunkFileNames: 'assets/[name].[hash].js',
          entryFileNames: 'assets/[name].[hash].js',
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
      chunkSizeWarningLimit: 1600,
    },
    preview: {
      port: 3000,
      host: true,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          secure: false,
        },
      },
    },
  };
});