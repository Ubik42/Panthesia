最新修正：[钢琴瀑布流连续滚动](waterfall-performance.md)。已复现并修复连续练习中错误冻结显示时间的问题，补充逐帧位移对照。

当前性能改动、合成库对照与测量边界见 [播放性能报告](performance-audio.md)。

# Panthesia 工程文档入口

连续播放声音修正版：不弹也自动播放曲目，同时保留练习评分。详细行为和输出回录见 [当前计划](current-plan.md)。

**当前成品：`outputs/releases/Panthesia-20261118-waterfall/Panthesia.exe`。** 换肤、琴键材质、网格透明度、同曲转调与量化见 [本批交付清单](visual-variants-delivery.md)；单一原始 MIDI 的维护方式见 [练习版本规范](practice-variants.md)。日常练琴版及 R2 的证据按各自批次文档读取。

2026-11-18：[R2 四批实现与交付清单](r2-delivery.md) 集中记录资料关系、乐谱保存与兼容、入门曲库、协议/存储/依赖的实现与当前交付结果。

历史 R1 文档入口（2026-11-16）：当前目标和后续顺序统一见 [当前工程目标与交付计划](current-plan.md)。本地日常练习候选版已交付，证据和人工确认项见 [R1 交付记录](r1-delivery.md)。本轮自动开发结束，历史日志保留。

This directory is the source of truth for the long-term development of this
fork. The product is a piano practice application first and a MIDI visualizer
second.

## Documents

- [美化与钢琴特效版交付](visual-delivery.md) — 当前直接程序入口、视觉能力与本批实际证据

- [当前工程目标与交付计划](current-plan.md) — 原方案 14 项、研讨 8 项、版本差与交付条件
- [技术研讨复核](discussion-review.md) — 链接对话全部六轮的结果及来源
- [架构现状与决策](architecture-decisions.md) — 四层乐谱、音乐对象、运行时和存储边界
- [历史开放项处置](open-items.md) — 36 个未勾选产品条目及旧编号的后续去向

- [工程整合记录](modernization.md) — 按批次保留的实现与检查证据

- [工程交接](handoff.md) — 当前入口、目录、验证结果与剩余验收

- Product context (`PRODUCT.md` at the repository root) — audience, purpose,
  product register, design principles and anti-references
- [产品功能路线](product-roadmap.md) — 原功能条目与逐轮范围，当前处置汇总到统一计划
- [Original roadmap](roadmap.md) — earlier fork direction, architecture and milestones
- [历史任务表](backlog.md) — 稳定编号与历史勾选证据
- [逐轮进度](progress.md) — 各批次实现、检查及当时限制
- [Development log](development-log.md) — append-only record of completed cycles
- [Piano plug-in hosting](../pages/plugin-hosting-roadmap.md) — VST3/Pianoteq plan
- [External Pianoteq routing](../pages/pianoteq-external-routing.md) — current
  standalone workflow and acceptance checklist
- [Song metadata sidecars](../pages/song-metadata-sidecars.md) — portable,
  content-bound repertoire metadata
- [Explainable fingering suggestions](../pages/fingering-suggestions.md) —
  preview/accept cost model and honest scope
- [Public practice library](../pages/practice-library.md) — reproducible,
  license-aware local MIDI corpus
- [Verovio renderer benchmark](verovio-benchmark.md) — pinned fidelity,
  performance, size and interaction evidence

- [Piece packages](../pages/piece-packages.md) — portable MIDI, scores, annotations and practice passages

## Working agreement

按当前计划的一组具体目标集中推进，每批交付完整使用流程。修改前明确问题、预期行为与结束条件；修改后记录实现提交和实际检查范围。

默认只做改动所需的编译、类型或定向检查。测试按具体风险选择；通过的检查有新改动或失败原因时再重跑。完整运行与打包集中在交付批次进行。文档整理按链接、范围和事实核对即可。

汇报分别写明源码实现、必要编译、实际使用与交付包状态。用户要求长期开发时再建立有限 Goal，列清任务编号、停止条件和检查上限；每轮集中推进实际内容。本轮在本地软件交付后结束，后续按独立目标推进。

## Product principles

1. **Practice must produce feedback.** Show what was wrong, how it was wrong,
   and what to do next.
2. **Make the next repetition effortless.** Difficult bars, hands, speed and
   instrument settings should survive a restart.
3. **Preserve musical expression.** Velocity, note duration, pedal and timing
   remain intact unless the learner explicitly chooses quantization.
4. **The audio path must be trustworthy.** Stop, seek, loop and device changes
   must never leave stuck notes.
5. **Calm visual hierarchy.** The notes, keyboard and current practice target
   dominate; secondary controls stay discoverable without covering the music.
6. **Native core, narrow boundaries.** Keep the Rust/wgpu renderer. Isolate
   learning, library, persistence and instrument engines behind testable APIs.
7. **Local-first.** Practice history and song metadata work without an account
   and remain exportable.

## Status vocabulary

- `NOW` — committed to the current milestone
- `NEXT` — prepared and likely to follow
- `LATER` — valuable but not yet scheduled
- `RESEARCH` — requires a prototype or product decision
- `DONE` — acceptance criteria passed and the result was logged
- `BLOCKED` — has a named external or technical blocker

- [Practice history](../pages/practice-history.md) — filters, saved conditions, fair comparisons and reopening attempts (Cycle 116).

- [Speed ladders](../pages/speed-ladders.md) — saved progression rules, real round grading, checkpoints and continuation (Cycle 117).

- [Practice routines](../pages/practice-routines.md) — reusable plans, dated snapshots, real completion evidence and resuming work (Cycle 118).

- [Practice routines](../pages/practice-routines.md) — daily snapshots, grading and weekly recurrence
- [Practice backups](../pages/practice-backups.md) — plans, dates, records and conflict-aware restoration
