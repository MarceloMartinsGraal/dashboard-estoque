import { defineConfig } from 'vite';
export default defineConfig({
  root: 'frontend',
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3000' } },
});
