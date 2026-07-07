import React from 'react';
import { render, Text } from 'ink';

// 占位 App；Task 7.1 会替换为完整实现
// 注意：shebang 由 tsup banner (tsup.config.ts) 注入；不在源文件中重复
const App: React.FC = () =>
  React.createElement(Text, null, 'ccsm bootstrapping…');

render(React.createElement(App));
