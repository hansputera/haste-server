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
  },
  // Shiki ships one grammar module per language and the worker imports all
  // thirty, so the default single worker chunk is ~2.8 MB of grammars no
  // visitor needs. `output.format: 'es'` keeps the worker as a module — the
  // only form Vite code-splits — so each grammar becomes its own file and is
  // fetched only when a paste names that language.
  worker: {
    format: 'es'
  }
});
