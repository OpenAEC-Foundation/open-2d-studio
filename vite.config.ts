import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Only alias @aec-ext if the extension project exists locally (dev mode)
const aecExtPath = path.resolve(__dirname, '../open-2D-studio-AEC-extension/src');
const aecExtAlias = fs.existsSync(aecExtPath)
  ? { '@aec-ext': aecExtPath }
  : {};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'open-2d-studio': path.resolve(__dirname, './src/extensionSdk'),
      ...aecExtAlias,
    },
  },
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 3000,
    strictPort: false,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
    fs: {
      // Allow serving files from the AEC extension project
      allow: ['..'],
    },
  },
  // To make use of `TAURI_DEBUG` and other env variables
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      // @aec-ext is an optional dev-only extension loaded dynamically
      external: (id) => id.startsWith('@aec-ext'),
    },
  },
});
