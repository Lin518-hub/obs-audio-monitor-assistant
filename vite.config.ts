import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 从 package.json 读取 version,在 renderer 端用 import.meta.env.VITE_APP_VERSION 访问
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: {
    // 暴露给 renderer(开发 + 生产都可用)
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
