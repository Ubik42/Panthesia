# Panthesia 工程说明

开源 Windows 钢琴练习软件。Tauri 2（Rust）+ React 19 + Vite。GPL-3.0，部分初始代码来自 Neothesia（见 NOTICE.md）。

## 先读

1. `docs/development/current-plan.md`：长期目标、目标架构、当前阶段。唯一任务队列。
2. `docs/development/progress.md`：最近一轮做了什么、下一入口。
3. `docs/development/interaction-model.md`：界面参照与用户授权的差异。

每轮结束在 `progress.md` 追加一条记录；阶段状态变化时更新 `current-plan.md` 第 4 节。

## 目录

| 路径 | 职责 |
| --- | --- |
| `panthesia-music` | MIDI 解析、tick 时间图、稳定 NoteId、Performance |
| `panthesia-keyboard` | 琴键范围与几何 |
| `panthesia-core` | MusicXML / Score IR、反复展开、对齐、转调量化、制谱、指法、曲库格式（纯函数，无 IO） |
| `panthesia-engine` | 有状态运行时：歌曲仓库（SQLite）、导入、播放会话、声音（oxisynth/cpal、MIDI、VST3）、记谱准备。`panthesia-service` 是浏览器调试用的 HTTP 服务 |
| `panthesia-vst3` | VST3 宿主 |
| `panthesia-web/src-tauri` | 桌面程序 `panthesia-desktop`，Tauri 命令桥 |
| `panthesia-web/src` | 前端 |
| `panthesia-web/public/verovio`、`public/pdfjs` | Verovio WASM 与 pdf.js 资源 |
| `scripts/` | 构建、打包、验证（PowerShell） |
| `work/`、`outputs/`、`target/` | 未纳入版本管理；`work/original-product-reset/` 含迁移回执和 Synthesia 参考图，不可删除 |

## 命令

```powershell
cargo check --workspace --all-targets
cd panthesia-web; npm run build          # 协议校验 + tsc + vite
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd                         # 启动当前桌面源码
```

协议：`panthesia-engine/src/protocol.rs` 的 `Command` 枚举由 `panthesia-web/scripts/generate-protocol.mjs` 生成 `src/engine/commands.generated.ts`。改 Rust 协议后运行 `npm run protocol:generate`。

## 规则

- 保护用户数据：MIDI、谱面、标注、设置、录音。改存储格式必须带迁移且可回退。
- 新实现接入后删除旧路径；不保留两套并行的同一职责。
- 前端：样式只用 `tokens.css` 中的变量，不写硬编码颜色与 `!important`；业务组件放 `src/screens`、`src/stage` 等目录，不放 `src/` 根目录。
- 评分、达标、日课类功能不进入主线（在 `feature/assessment-lab`）。
- 不推送、不发布，除非用户明确要求。
- 文档用简体中文，直接陈述事实，不写过程流水与自我证明。
