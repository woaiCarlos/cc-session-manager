# ccsm 手动冒烟测试清单

> **本清单覆盖 OpenSpec tasks 9.2-9.9**。
> 实施已完成（300+ tests passing，`npm run build` 成功，dist/cli.js 可运行）。
> 下面 9 项需用户在**真实 macOS Terminal**（iTerm2 / Terminal.app）中手动验证。
> 详细键位与终端设置参见 README.md。

## 前置

```bash
cd /Users/carlos/workspace/cc-manager
npm run build                       # 产 dist/cli.js
node dist/cli.js                    # 启动 ccsm（或 npm link 后 ccsm）
```

启动后应看到：
- 两栏布局：左 = 项目列表，右 = session 列表
- StatusBar 在底部，显示当前选择与扫描进度
- 项目/session 数量随扫描实时增长

## 验证清单

- [ ] **9.2 真实目录扫描** — 项目/session 列表与 `ls ~/.claude/projects/` 数量一致
- [ ] **9.3 Enter 恢复 session** — 选中 session 按 Enter，Terminal.app 打开新窗口，命令是 `cd <cwd> && claude --resume <id>`
- [ ] **9.4 `n` 新建 session** — 选中 project 按 `n`，Terminal.app 打开新窗口，命令是 `cd <dir> && claude`
- [ ] **9.5 重命名 + 删除 + 复制** — `r` 改 session 名（按 Enter 保存 / Esc 取消）→ 跨重启保留；`d` 删手动项目（Y 确认 / N 取消）；`c` 复制 sessionId（粘贴确认 = UUID）
- [ ] **9.6 搜索** — `/` 打开搜索框，输入子串实时过滤；Esc 恢复完整列表
- [ ] **9.7 设置** — `,` 打开设置，修改 session 根目录或终端选择后保存；下次重启生效
- [ ] **9.8 帮助** — `?` 显示键位表；再次按 `?` 或 Esc 关闭
- [ ] **9.9 退出** — `q` 干净退出，cursor 恢复；`Ctrl+C` 同样干净退出
- [ ] **9.bonus 终端切换** — 设置中切到 iTerm2 / Warp，重新操作，验证由所选终端接管

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| 按 Enter 没反应 | Ink 焦点未在 session pane | 按 `Tab` 切到 session pane |
| `n` 触发 settings | 旧版 7.14 brief 误标 | 已修正：`n` = new session，`,` = settings |
| osascript 报 "not authorized" | macOS 自动化权限 | 系统设置 → 隐私与安全 → 自动化 → 允许 Terminal / iTerm2 |
| session 不出现 | 根目录探测失败 | `,` 设置中手动指定 session 根目录 |
| 终端切回 `q` 后光标消失 | TTY 异常 | 重开 Terminal |
| Warp 按 Enter 无反应 | Warp 注入不靠谱 | Warp 自动 fallback 到剪贴板，粘贴并按 Enter 即可 |
