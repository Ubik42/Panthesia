# 进度记录

每轮一条，新记录在上。计划与阶段定义见 [current-plan.md](current-plan.md)。

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
