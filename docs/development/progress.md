# 进度记录

每轮一条，新记录在上。计划与阶段定义见 [current-plan.md](current-plan.md)。

## 2026-11-21 · 技术调研与分层歌曲模型

- 用户决定：虚拟双手自行实现；历史回放与表现记录移出主线；浏览器调试模式保留在单一 `send()` 后。
- 调研写入 [research-2026-11.md](research-2026-11.md)：《情话》瀑布 V2 的和弦级数显示方式（截图在 `work/research/chord-degree-reference/`）、和弦 / 调性 / 段落识别方法、伴奏音频匹配与 DTW 对齐、signalsmith-stretch 变速、piano-midi-cleanup（AGPL，只借鉴思路）、Transkun 2.0.1（已是最新版）、本地语料 `D:\Music\MIDI` 结构。
- 计划改为分层歌曲模型：演奏必需，谱面、版本、段落、和弦、指法、歌词、伴奏为可选图层，带来源与置信度；新增分析服务、伴奏音轨、测试语料；阶段扩为 R0–R10。
- 磁盘清理：`cargo clean` 释放 55.2 GB；`work/` 从 2.7 GB 减为 6.4 MB（保留迁移回执与快照、Synthesia 参考图、手部动画调研、和弦参考截图）；`outputs/` 只保留当前运行包 `Panthesia-20261120-synthesia-layout`。

下一入口：R1 主线瘦身。

## 2026-11-21 · R0 基线清理（分支 `refactor/cleanup-baseline`）

接手工程，完成全面扫描与清理。

- Rust：删除死 crate `piano-layout`、`midi-file`、`panthesia-ai`；删除旧原生 wgpu 应用 `panthesia` 与其专属 crate `panthesia-cli`、`nuon`、`wgpu-jumpstart`、`midi-io`、`panthesia-image`、`ffmpeg-encoder`；删除 core 的 `native-render` 代码（render、config、font_system 等）。工作区从 16 个成员减为 6 个。
- 依赖别名改回真名：`midi_file` → `panthesia_music`，`piano_layout` → `panthesia_keyboard`（61 个文件）。
- 修复 `audiveris_paper.rs` 中两个调用已删函数 `convert` 的测试（`main` 上已无法编译）。
- 前端：按 import 图从 `main.tsx` 遍历，删除 62 个不可达文件（约 1.75 万行，包括 RoutineDialog、LibraryDialog、LadderDialog、WeakPracticePanel 等）；删除 7 个一行转发文件并改写引用；删除 25 个针对评分时代功能或已删 UI 的 spec。
- 其他：删除 `flatpak/`、`makefile`、`tools/`、`.github/legacy`、`.github/actions`（旧平台）、`test.mid`、`sin_wave.sf2`、7 个无引用脚本。
- 文档：开发文档从约 90 份减为 17 份；删除 9 个跳转文件、历史快照、三份大日志（共约 0.9 MB）、旧交付记录、Goal 机制文件；用户文档只保留安装页。重写计划、本文件、`AGENTS.md`。
- 检查：`cargo check --workspace --all-targets` 通过；`npm run build`（含协议校验、tsc、vite）通过。Playwright 未运行。

下一入口：用户确认计划第 6 节的决定项后进入 R1 主线瘦身。
