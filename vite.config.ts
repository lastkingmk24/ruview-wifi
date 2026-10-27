import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = (env.RUVIEW_BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const proxy = {
    '/health': { target: backendTarget, changeOrigin: true },
    '/api': { target: backendTarget, changeOrigin: true },
    '/ws': { target: backendTarget, changeOrigin: true, ws: true },
  };

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
      allowedHosts: true,
      proxy,
    },
  };
});
