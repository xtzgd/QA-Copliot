import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

async function runBuild() {
  console.log('>>> 开始构建 QA Copilot Chrome Extension MV3...');

  // 确保清理 dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 复制 public 到 dist
  const publicDir = resolve(rootDir, 'public');
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, distDir, { recursive: true });
    console.log('✓ 静态资源与 manifest.json 已同步到 dist');
  }

  // 1. 构建 Side Panel
  console.log('1. 构建 Side Panel (React + Tailwind CSS)...');
  await build({
    root: resolve(rootDir, 'src/sidepanel'),
    plugins: [react()],
    publicDir: false,
    base: './',
    build: {
      outDir: resolve(distDir, 'sidepanel'),
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(rootDir, 'src/sidepanel/index.html'),
      },
    },
  });
  console.log('✓ Side Panel 构建完成');

  // 2. 构建 Background Service Worker
  console.log('2. 构建 Background Service Worker (ESM)...');
  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(rootDir, 'src/background/index.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
  console.log('✓ Background Service Worker 构建完成');

  // 3. 构建 Content Script
  console.log('3. 构建 Content Script (IIFE 独立打包)...');
  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(rootDir, 'src/content/index.ts'),
        name: 'QACopilotContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
  console.log('✓ Content Script 构建完成');

  // 4. 构建 Injected Script (网络拦截器)
  console.log('4. 构建 Injected Script (页面内 Fetch/XHR 拦截器)...');
  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(rootDir, 'src/injected/networkInterceptor.ts'),
        name: 'QACopilotInjected',
        formats: ['iife'],
        fileName: () => 'injected.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
  console.log('✓ Injected Script 构建完成');

  // 5. 构建 DevTools 注册页
  console.log('5. 构建 DevTools Panel 注册入口...');
  await build({
    root: rootDir,
    publicDir: false,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(rootDir, 'src/devtools/index.ts'),
        formats: ['es'],
        fileName: () => 'devtools.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });
  console.log('✓ DevTools Panel 构建完成');

  console.log('🎉 所有产物构建成功！dist/ 目录可直接在 Chrome 开发者模式加载测试。');
}

runBuild().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
