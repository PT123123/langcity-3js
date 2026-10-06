// 仓库根目录这套是「纯程序化城市」版（src/world/layout.js 手写路网，不依赖任何 GLB）。
// variant-z/ 是另一套（原版 planets_present_* 碎块壳资产）。
// 两套各跑各的端口：just run → variant-z :5173，just run-city → 本文件 :5174。
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  optimizeDeps: {
    // Vite 默认把 root 下 **/*.html 全当入口去预打包，会连带扫到 variant-z/ 那两套页面
    // （实测报 "Unexpected else" 之类的错算到本项目头上）。本项目的入口只有根 index.html。
    entries: ['index.html'],
  },
  build: { outDir: 'dist' },
});
