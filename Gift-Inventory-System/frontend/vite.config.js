import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API address comes from VITE_API_URL (see .env.example). Nothing else is configured here.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
