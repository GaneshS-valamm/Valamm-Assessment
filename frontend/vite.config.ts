import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// .env lives at the repository root and is shared with the backend.
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  return {
    plugins: [react()],
    envDir: path.resolve(__dirname, '..'),
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: rootEnv.VITE_API_BASE_URL || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
