import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node18',
  outExtension: () => ({ js: '.js' }),
  clean: true,
  shims: false,
  bundle: true,
  splitting: false,
  // 关键：react 必须保持 external，与 ink（也 external）共用 node_modules 里的同一份
  // React 实例。否则 react 会被打进 bundle，ink 的 reconciler 又从 node_modules
  // 加载另一份 React，导致 "Invalid hook call / more than one copy of React"。
  external: ['react'],
  minify: false,
  sourcemap: true,
  dts: false,
  // 关键：让 tsup 在 bundle 后的 cli.js 顶部保留 shebang
  banner: { js: '#!/usr/bin/env node' },
});