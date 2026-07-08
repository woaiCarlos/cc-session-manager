#!/bin/bash
# scripts/smoke.sh — 冒烟测试（Task 10.4）
#
# 覆盖 happy path：
#   1. `npm run build` 产出 dist/cli.js + dist/cli-smoke.js（带 shebang）
#   2. dist/cli-smoke.js 能跑通并 dump 出 projectCount JSON
#   3. 副作用：config dir 创建、lock 临时存在、dump 完成即释放
#
# 退出码：0 = SMOKE OK；非 0 = 任一步失败

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cc-manager"
STATE_PATH="$CONFIG_DIR/state.json"
LOCK_PATH="$CONFIG_DIR/lock"

# 跑前清理旧 lock（避免上次残留的 stale lock 干扰）
if [ -f "$LOCK_PATH" ]; then
  echo "→ removing pre-existing lock: $LOCK_PATH"
  rm -f "$LOCK_PATH"
fi

# ── Step 1: build ───────────────────────────────────────────────
echo "→ npm run build"
npm run build --silent

# ── Step 2: 验证 dist 产物 ──────────────────────────────────────
test -f dist/cli.js        || { echo "FAIL: dist/cli.js missing";        exit 1; }
test -f dist/cli-smoke.js  || { echo "FAIL: dist/cli-smoke.js missing";  exit 1; }

# 首行 shebang
SHEBANG_CLI=$(head -1 dist/cli.js)
SHEBANG_SMOKE=$(head -1 dist/cli-smoke.js)
if [ "$SHEBANG_CLI" != "#!/usr/bin/env node" ]; then
  echo "FAIL: dist/cli.js shebang = $SHEBANG_CLI"; exit 1
fi
if [ "$SHEBANG_SMOKE" != "#!/usr/bin/env node" ]; then
  echo "FAIL: dist/cli-smoke.js shebang = $SHEBANG_SMOKE"; exit 1
fi
echo "✓ dist/cli.js + dist/cli-smoke.js present (shebang OK)"

# ── Step 3: 跑 cli-smoke.js，dump JSON ──────────────────────────
echo "→ ./dist/cli-smoke.js"
OUT=$(./dist/cli-smoke.js)
echo "$OUT"

# ── Step 4: 校验 JSON 形状（必须含 number 类型的 projectCount）──
echo "$OUT" | node -e "
let s = '';
process.stdin.on('data', (d) => s += d);
process.stdin.on('end', () => {
  const j = JSON.parse(s);
  if (typeof j.projectCount !== 'number') {
    throw new Error('missing or non-numeric projectCount: ' + JSON.stringify(j));
  }
  if (typeof j.sessionCount !== 'number') {
    throw new Error('missing or non-numeric sessionCount: ' + JSON.stringify(j));
  }
  if (j.root !== null && typeof j.root !== 'string') {
    throw new Error('root must be string|null: ' + JSON.stringify(j));
  }
  console.log('✓ JSON shape OK: projectCount=' + j.projectCount + ' sessionCount=' + j.sessionCount + ' root=' + j.root);
});
"

# ── Step 5: 副作用观察（informational，不 fail 脚本） ─────────
# cli-smoke.js 内部 tryAcquire → release()，故进程退出时 lock 已被清。
# state.json 由 loadState() 读取但仅在 saveState() 时落盘（cli-smoke.js
# 不写），故同样可能不存在。两者用 if 包裹，缺失不视为失败。
if [ -f "$STATE_PATH" ]; then
  echo "✓ state.json present: $STATE_PATH"
else
  echo "· state.json absent (cli-smoke.js 不写 state，loadState 仅读不创建)"
fi

if [ -f "$LOCK_PATH" ]; then
  echo "✓ lock present: $LOCK_PATH"
  LOCK_PID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$LOCK_PATH','utf8')).pid)")
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "  lock PID alive: $LOCK_PID"
  else
    echo "  lock PID stale: $LOCK_PID (process gone — 24h stale window 未到，但 PIDs 早死)"
  fi
else
  echo "· lock absent (cli-smoke.js 退出前已 release，符合 happy path 预期)"
fi

# config dir 应已创建（mkdir recursive 在 loadState/lock 中触发）
if [ -d "$CONFIG_DIR" ]; then
  echo "✓ config dir present: $CONFIG_DIR"
else
  echo "FAIL: config dir missing after run: $CONFIG_DIR"
  exit 1
fi

echo ""
echo "SMOKE OK"
