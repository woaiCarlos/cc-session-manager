// 注意：shebang 由 tsup banner (tsup.config.ts) 在 bundle 后注入；源文件不重复声明
import React from 'react';
import { render } from 'ink';
import { App } from './tui/App.js';
import { DEFAULT_STATE, type AppState, type Project } from './state/types.js';

// cli.tsx 阶段（Task 9.1）会替换为真实 bootstrap 序列：
//   state/lock.tryAcquire → state/store.load → discovery/detectRoot →
//   discovery/scan(callback) → render(<App bootstrapState={…} projects={…}>)
// 当前 placeholder 已使用真实 DEFAULT_STATE 占位，满足编译与启动验证。
const placeholderState: AppState = {
  ...DEFAULT_STATE,
};

const placeholderProjects: Project[] = [];

render(
  React.createElement(App, {
    bootstrapState: placeholderState,
    projects: placeholderProjects,
    onSession: () => {},
    onScanComplete: () => {},
  })
);
