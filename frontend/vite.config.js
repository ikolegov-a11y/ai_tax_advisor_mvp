import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          // Extend socket timeouts so 60-90s agent calls don't get dropped
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setTimeout(300000, () => proxyReq.destroy());
          });
          proxy.on('error', (err, _req, res) => {
            console.error('[vite proxy error]', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
            }
          });
        }
      }
    }
  }
});
