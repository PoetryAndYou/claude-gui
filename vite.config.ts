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
          // 主进程跑在 Electron 内置 Node 上，node14 目标保守兼容旧 Node API
          build: { outDir: 'dist-electron', rollupOptions: { external: ['electron'] }, target: 'node14', emptyOutDir: false },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart({ reload }) { reload(); },
        vite: {
          build: { outDir: 'dist-electron', rollupOptions: { external: ['electron'] }, target: 'node14', emptyOutDir: false },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 渲染进程目标：兼容 Electron 22 的 Chromium 108
    target: 'chrome108',
  },
  server: {
    port: 5173,
  },
});
