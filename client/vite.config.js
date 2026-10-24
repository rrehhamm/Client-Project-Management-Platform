import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The root .env holds server values (NODE_ENV, secrets). Only API_PORT is read,
// for the dev proxy. Vite's loadEnv is deliberately not used: it applies NODE_ENV
// from the file, which turned production builds into development builds.
function readApiPort() {
  const file = resolve(import.meta.dirname, '../.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')).API_PORT : undefined;
  return process.env.API_PORT || fromFile || '4000';
}

export default defineConfig(() => {
  const apiTarget = `http://localhost:${readApiPort()}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin /api in development, so cookies work without CORS.
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      include: ['src/**/*.test.{js,jsx}'],
      css: false,
    },
  };
});
