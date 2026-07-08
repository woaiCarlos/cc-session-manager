import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// useTerminalSize — 终端尺寸追踪 hook 的行为单测。
//
// 实现把 effect 内部逻辑抽成可测试的纯函数：
//   - readTerminalSize(): 从 process.stdout 读 cols/rows，缺省回退 80x24
//   - trackTerminalSize(handler): 订阅 stdout 'resize'，返回 unsubscribe
//
// 测试以这两个纯函数为切入点，验证：
//  1. 默认 80x24 回退（非 TTY / columns 未定义）
//  2. 真实 stdout 的 cols/rows 被正确读取
//  3. 监听器正确注册与注销（重复 emit 不会泄漏旧 handler）
//  4. resize 事件触发时回调拿到最新尺寸
// ---------------------------------------------------------------------------

import {
  readTerminalSize,
  trackTerminalSize,
} from '../../../src/tui/hooks/useTerminalSize.js';

describe('readTerminalSize', () => {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  afterEach(() => {
    // 恢复原始 stdout 属性，避免污染后续测试 / vitest reporter
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: originalRows,
      configurable: true,
      writable: true,
    });
  });

  it('falls back to 80x24 when process.stdout.columns/rows are undefined', () => {
    Object.defineProperty(process.stdout, 'columns', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(readTerminalSize()).toEqual({ cols: 80, rows: 24 });
  });

  it('uses the actual stdout columns/rows when defined', () => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 132,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: 50,
      configurable: true,
      writable: true,
    });

    expect(readTerminalSize()).toEqual({ cols: 132, rows: 50 });
  });

  it('uses 0 as-is (does not substitute a fallback)', () => {
    // 0 是合法值；只在 undefined 时回退。这条契约保证 "用户压到 0
    // 也能诚实上报"，避免误把 0 当作缺省。
    Object.defineProperty(process.stdout, 'columns', {
      value: 0,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: 0,
      configurable: true,
      writable: true,
    });

    expect(readTerminalSize()).toEqual({ cols: 0, rows: 0 });
  });
});

// ---------------------------------------------------------------------------
// trackTerminalSize — 监听器 attach / detach 行为
//
// 注：process.stdout 是进程全局单例，真实 EventEmitter。我们直接利用
// listenerCount(eventName) 校验 attach / detach，不打桩 .on / .off ——
// 打桩 Node 原型方法在不同版本下行为不稳，且会失去"真的挂上了"的
// 端到端意义。
// ---------------------------------------------------------------------------

function resizeListenerCount(): number {
  return process.stdout.listenerCount('resize');
}

describe('trackTerminalSize', () => {
  // 记录每个测试开始时的基线，diff 校验本测试有没有新增 / 清理 listener
  let baseline = 0;

  beforeEach(() => {
    baseline = resizeListenerCount();
  });

  it('attaches a single resize listener when subscribed', () => {
    const handler = vi.fn();
    trackTerminalSize(handler);
    expect(resizeListenerCount()).toBe(baseline + 1);
  });

  it('returns an unsubscribe that detaches the listener', () => {
    const handler = vi.fn();
    const unsubscribe = trackTerminalSize(handler);
    const peak = resizeListenerCount();
    expect(peak).toBe(baseline + 1);

    unsubscribe();
    expect(resizeListenerCount()).toBe(baseline);
  });

  it('calls the handler with current size on a resize event', () => {
    const captured: Array<{ cols: number; rows: number }> = [];
    const unsubscribe = trackTerminalSize((s) => {
      captured.push(s);
    });

    // 直接 emit resize 事件；handler 应被调用并捕获到当前 size
    process.stdout.emit('resize');
    expect(captured).toHaveLength(1);

    unsubscribe();
  });

  it('does not invoke the handler after unsubscribe (no leak)', () => {
    const handler = vi.fn();
    const unsubscribe = trackTerminalSize(handler);

    process.stdout.emit('resize');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    process.stdout.emit('resize');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isolates two subscriptions so each can unsubscribe independently', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = trackTerminalSize(a);
    trackTerminalSize(b);

    process.stdout.emit('resize');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    process.stdout.emit('resize');
    expect(a).toHaveBeenCalledTimes(1); // 已 unsubscribe，不应再被调用
    expect(b).toHaveBeenCalledTimes(2); // 仍然在线
  });
});
