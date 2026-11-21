# 进度记录

每轮一条，新记录在上。计划与阶段定义见 [current-plan.md](current-plan.md)。

## 2026-11-21 · 交接准备与界面方向调整

- `bilibili_toolkit` 提交 9c6e7b6（分块 Range 下载 + 镜像切换，以及之前未提交的 ASR 工作）。
- `cargo clean` 后用 `scripts/build-practice.ps1 -Target Desktop -Configuration Debug` 完整构建通过（约 2 分钟），构建缓存已预热。
- 真实资料备份：`work/user-data-backup/com.ubik.neothesia-20261121.zip`（31 MB）。
- Rust 测试基线（R0 后，`main` 上同样存在）：
  - `panthesia-music` 4/4、`panthesia-keyboard` 1/1、`panthesia-vst3` 7/7 全部通过。
  - `panthesia-core` 264 通过、1 失败（`score_alignment::tests::projects_notes_and_directions_with_duration_and_identity`）。
  - `panthesia-desktop` 13 通过、4 失败（2 个 Audiveris 页快照、2 个需要本机安装 MuseScore）。
  - `panthesia-engine` 329 个测试：约 203 通过、121 失败，`package_commands` 的 5 个测试死锁（CPU 几乎为 0，永不结束），所以 `cargo test --workspace` 跑不完。失败的主要原因是引擎启动后立即处于"正在保存或恢复"忙碌状态（`storage_control.rs:46`），测试发出的命令被全部拒绝；约一半失败位于 R1 将删除的模块（routine、history、expression_goal、practice_backup 等）。
  - 在 R1 第 5 项修好之前，engine 测试用 `cargo test -p panthesia-engine -- --skip package_commands` 运行，并以本条为基线比较。日志在 `work/test-runs/engine.log`。
- `AGENTS.md` 增加"长期自主执行"协议；`current-plan.md` 增加 R1 任务分解。
- 用户决定：曲库与管理界面改为 Serpent 式三栏工作台（只借布局与交互，不借美术），演奏舞台保留 Synthesia 式。调研见 research-2026-11.md 第 8 节，规格见 current-plan.md 第 3.5 节，R2 改为"曲库工作台与设计系统"。

下一入口：R1 第 1 项（评分时代命令与模块删除）。

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
