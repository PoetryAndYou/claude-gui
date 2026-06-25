import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// Vite 同时构建：渲染进程(React) + 主进程(electron/main.ts)
export default defineConfig({
  // 相对路径，确保打包后 file:// 能加载资源
  base: './',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: { outDir: 'dist-electron', rollupOptions: { external: ['electron'] } },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) { reload(); },
        vite: {
          build: { outDir: 'dist-electron', rollupOptions: { external: ['electron'] } },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
