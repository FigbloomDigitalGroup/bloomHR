import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
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
        target: 'http://localhost:3001',  // Your backend server
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,  // For local development with self-signed certificates
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
    proxy: {  // Add the same proxy config for preview mode
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
      },
    },
  },
});