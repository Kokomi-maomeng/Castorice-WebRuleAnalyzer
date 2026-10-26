import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
 plugins: [react()],
 server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:19110' } },
 build: { outDir: '../backend/internal/webui/dist', emptyOutDir: false, chunkSizeWarningLimit: 700 },
 test: { environment: 'jsdom', setupFiles: './src/test-setup.ts', globals: true },
});
