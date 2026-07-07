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
  minify: false,
  sourcemap: true,
  dts: false,
  // 关键：让 tsup 在 bundle 后的 cli.js 顶部保留 shebang
  banner: { js: '#!/usr/bin/env node' },
});