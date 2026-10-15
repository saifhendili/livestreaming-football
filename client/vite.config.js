import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:5050' },
  },
  build: {
    chunkSizeWarningLimit: 700, // hls.js is large by nature
  },
});
