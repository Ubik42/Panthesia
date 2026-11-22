# Panthesia 界面（React + Tauri 2）

界面用 React 19、TypeScript 与 Vite，桌面外壳为 Tauri 2（`src-tauri`，程序名 `panthesia-desktop`）。播放时钟、MIDI 输入输出、音源、清单读写与乐谱处理都在 Rust 引擎 `panthesia-engine` 中；界面只发送命令、接收状态。计划与阶段见 [current-plan.md](../docs/development/current-plan.md)。

## 运行

- 桌面：仓库根目录运行 `Open-Desktop.cmd`。源码有变化时先构建，再启动。
- 浏览器调试：`Open-Web.cmd`，或在 Claude Code 中按 `.claude/launch.json` 启动 `service`（音乐服务，资料目录在 `work/web-preview-data`）和 `web`（Vite，`http://127.0.0.1:5173`）。浏览器模式与桌面版用同一个引擎实现，服务只监听本机回环地址。
- 资料目录：桌面版使用用户应用数据目录；开发和测试一律用 `PANTHESIA_DATA_ROOT` 指向 `work/` 下的目录。

## 与引擎通信

- 命令：`panthesia-engine/src/protocol.rs` 的 `Command` 枚举。界面经 `src/api.ts` 发送；桌面走 Tauri 命令，浏览器走本地 HTTP。
- 状态：引擎只在快照内容变化时发布。桌面端收到 `engine-state` 事件；浏览器用 `/api/state/next?after=N` 长轮询。两者都由 `api.subscribeState` 统一提供，`features/practice/usePracticeSession` 据此更新 `playbackStore`。位置、按键等实时字段由显示组件按字段订阅。
- 类型：`npm run protocol:generate` 从 Rust 定义生成 `src/engine/commands.generated.ts`（命令、`Snapshot` 及已登记的领域类型；`serde(default)` 字段在输入方向为可选）。新增类型时在 `scripts/generate-protocol.mjs` 登记源文件与类型名。`npm run build` 会核对生成结果。

## 样式

- 颜色只用 `src/tokens.css` 的变量。这些变量由 `scripts/tokenize-colors.py` 按原界面颜色拟合（OKLCH），重新设计时直接修改变量值。
- `scripts/prune-css.mjs [--list] [--write]` 删除源码中不会出现的类名对应的选择器。
- 尚待处理：约 40 处 `!important` 与多套主题文件互相覆盖，在 RF 重写各屏时改用 CSS 层叠层（`@layer`）解决。

## 检查

```powershell
npm run build                                       # 协议核对 + tsc + vite
..\scripts\verify-practice.ps1 -SkipBuild -Spec open-and-practice,verovio-index,paper-ink-merge   # 真实服务上运行浏览器用例
```

每个用例使用独立资料目录；5173 或 32124 端口已被占用时停止，不接管现有服务。浏览器用例只覆盖关键流程：`open-and-practice`（打开文件、跟随练习、歌曲文件、最近打开、设置页设备）、`verovio-index`（整谱索引）、`paper-ink-merge`（纸谱墨迹合并）。针对旧界面与已删命令的用例在 RF 中删除，可在提交历史中找回；功能逻辑由 Rust 测试覆盖。
