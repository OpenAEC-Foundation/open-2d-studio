import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Slice 1 merged-app Vite config. Runs on port 5173 (1.0 uses 3000 via
// tauri.conf.json), sets VITE_MERGED=1 so main.tsx dispatches to
// MergedApp, disables strict-mode HMR flicker by using default HMR.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MERGED': JSON.stringify('1'),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist-merged',
    emptyOutDir: true,
  },
});
