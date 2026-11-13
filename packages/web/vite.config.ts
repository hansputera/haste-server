import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` must match the mount point: the build emits hashed asset URLs, and the
// API serves them from `/v2/assets/…`. Leaving the default `/` makes every one
// of them 404 behind the `/v2` prefix.
export default defineConfig({
  base: '/v2/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  }
});
