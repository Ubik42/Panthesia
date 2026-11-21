# Panthesia 工程说明

开源 Windows 钢琴练习软件。Tauri 2（Rust）+ React 19 + Vite。GPL-3.0，部分初始代码来自 Neothesia（见 NOTICE.md）。

定位（2026-11-21）：打开一首歌就能练的专用程序，不做曲库管理。曲库由 Keel（`D:\Manage\_tools\Keel`）管理并按文件类型打开 Panthesia。歌曲数据写在文件旁的 `.panthesia` 清单中（`current-plan.md` 3.7）；本地只保存练习历史、最近打开与缓存。

## 先读

0. `GOAL.md`：长期目标、授权与启动方式。
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
| `panthesia-engine` | 有状态运行时：歌曲仓库（SQLite，R2 删除，改为 `.panthesia` 清单）、导入、播放会话、声音（oxisynth/cpal、MIDI、VST3）、记谱准备。`panthesia-service` 是浏览器调试用的 HTTP 服务 |
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

## 长期自主执行

用户要求连续开发时按此执行，不逐步请示。

1. **开始**：读 `current-plan.md` 第 4 节与 `progress.md` 最新一条，看 `git status` 与当前分支。工作分支为 `refactor/cleanup-baseline`，不切回 `main`、不合并、不推送。
2. **每批**：取当前阶段的下一组关联任务，完整做完（实现 → 接入 → 删除旧路径）。一批约 1–3 小时的实际改动量，不把拆一个文件当作一批。
3. **检查**（2026-11-21 用户决定减少门禁，快速推进）：每批只要求 `cargo check --workspace --all-targets` 与 `npm run build` 通过。阶段结束时再跑改到的 crate 的 `cargo test -p <crate>`（engine 在 R2 删除集中曲库前加 `-- --skip package_commands`，已知失败基线见 `progress.md`；不允许新增失败）并实际打开一次桌面构建。不为检查写新脚本，不额外补测试。
4. **提交**：每批一个或几个提交，信息写清做了什么、为什么。随后在 `progress.md` 追加记录（日期、提交、完成内容、未完成、下一入口）；阶段完成时更新 `current-plan.md` 第 4 节状态。
5. **继续**：直接开始下一批。阶段完成后按第 4 节顺序进入下一阶段。
6. **停下来问用户的情况只有**：要删除或改写用户数据而无法回退；要做计划外的产品范围变化；要推送、发布或调用付费服务；同一问题连续三次方案失败。其他技术决定自行判断，并在 `progress.md` 写明理由。

已授权（2026-11-21）：R2 的真实资料迁移（在原文件旁写 `.panthesia` 清单、导出只在副本存储中的歌曲、迁移练习历史、核对通过后移除旧 `library/`）可以直接执行，不再询问。条件：执行前重新完整备份 `%APPDATA%\com.ubik.neothesia`；先在备份副本上跑通；Panthesia 已退出；逐首核对能从新位置打开且图层与设置一致；任何一首不一致就停止、从备份恢复并报告。
用户数据：真实资料在 `%APPDATA%\com.ubik.neothesia`（旧 ID，由 `product::profile_root` 选中），备份在 `work/user-data-backup/com.ubik.neothesia-20261121.zip`。开发测试一律设置 `PANTHESIA_DATA_ROOT` 指向 `work/` 下的临时目录，不在真实资料上做实验。迁移代码必须先在其副本上跑通。

测试语料：`D:\Music\MIDI`（见 `current-plan.md` 第 3.6 节），只读。

## 规则

- 保护用户数据：MIDI、谱面、标注、设置、录音。改存储格式必须带迁移且可回退。
- 新实现接入后删除旧路径；不保留两套并行的同一职责。
- 前端：样式只用 `tokens.css` 中的变量，不写硬编码颜色与 `!important`；业务组件放 `src/screens`、`src/stage` 等目录，不放 `src/` 根目录。
- 评分、达标、日课类功能不进入主线（在 `feature/assessment-lab`）。
- 不推送、不发布，除非用户明确要求。
- 对用户的回复、文档和界面一律使用简体中文（代码标识符与提交信息可用英文），直接陈述事实，不写过程流水与自我证明。
