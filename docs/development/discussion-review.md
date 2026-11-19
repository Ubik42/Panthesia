# 技术研讨复核与决策来源

复核日期：2026-11-16。来源对话：[整理并收尾 Panthesia 工程 (2)](codex://threads/01a1d7f8-8e91-77d2-b182-01f9da20bc49)。通过历史分页读取全部六轮，覆盖最早工程收尾到最后内部乐谱模型讨论。下表按时间排列，用户问题和回答结论以摘要保存。

| 轮次 | 用户问题 | 原回答的主要结果 | 本次规划处理 |
| --- | --- | --- | --- |
| 1 | `D:\Music\_tools\Panthesia 整理工程，快速收尾` | 本地 `f249e55` 修复构建和拍位溢出，补交接；当时核心 260、引擎 192 项及前端/文档/桌面构建通过，硬件、插件与识谱仍开放 | 保留为 2026-11-12 历史证据，当前源码与交付另记 E01、E02、E14 |
| 2 | GitHub 是否有 fork，最新进度是否上传 | fork 为 Ubik42/Panthesia；当时远端 `7ce0533`，本地领先一个收尾提交 | 本次重新只读查询：远端仍为 `7ce0533`，源码基线 `629ed19`，领先 102 个提交；未提交批次另列 |
| 3 | 按成熟、好用、美观的软件标准回顾架构 | 三工作区；界面状态归属；保护播放调度；统一后台任务、存储恢复和类型协议；作品/演奏/文件关系；领域依赖边界；五阶段交付顺序 | 拆为 E01–E14，逐项在 [当前计划](current-plan.md) 记录现状和缺口；原五阶段仍有未完成内容 |
| 4 | Rust/C++/React 的实际分工；公开古典 MIDI 能否上传 | React/TS＋Tauri＋Rust；第三方音源与 WASM 单独接入。来源许可各异，古典作品、文件分发与演奏来源分别核对；建议源码、精选曲库包、完整本地库分开 | 架构现状写入 [决策记录](architecture-decisions.md)；T01 保留逐曲来源、精选入门包及外部数据集路线 |
| 5 | 哪些软件可参考钢琴特效；MIDI 与各类谱面如何统一 | MIDIVisualizer、Notefall、Piano VFX 为参考；练习/演出两类效果；特效只读音乐状态。MusicXML 交换、原谱优先、MIDI/识谱初稿待校对，演奏和记谱分别保存并对齐 | T02、T07、T08：视觉单独排期，资料与乐谱进入整合；统一显示保留有音乐意义的声部、谱表和编辑差异 |
| 6 | 内部模型如何选型，是否通用、全面、获社区认可 | 当前 Score 为自建练习模型；有分数时间、声部/谱表、书面/演奏顺序分离，但不完整表达排版、歌词、移调与渐强渐弱等。Verovio 实际读取原 XML；没有社区采用的证据 | T03–T06：明确文档/语义/演奏/显示四层，能力分别声明，受控往返、真实样例和跨版本身份规则纳入计划 |

## 需要纠正的理解

- “统一内部模型”指应用内部协调所需的练习语义模型。完整乐谱资料依靠原文档保存，通用交换采用成熟标准。
- 讨论中的“内部模型→统一排版”是目标示意；当前 Web 排版读取保存的原 XML/MXL，Rust 模型承担分析与对齐。两条路径的能力应分别记录。
- 音符 ID 在固定来源版本内确定；结构编辑后的同名 ID 需要重新核对。反复演奏的 occurrence 与书面音符分别保存。
- 原回答中的 12,908 条素材为当时本机清单，其中 10,855 GiantMIDI、1,276 MAESTRO、521 Mutopia、256 Pop-K。本轮未重扫这些实际文件，数量保留为历史快照。
- 原回答的来源许可说明用于制定逐曲登记规则。素材包发布时需复核实际条目、来源页面及适用条款；工程主仓当前仍保留脚本和清单，完整下载库位于仓外。
- Notefall 等项目的效果展示用于视觉研究；具体源码复用取决于拟采用版本的许可证。项目名和截图本身不足以确定可复用范围。
- 研讨回答中的建议已纳入工作计划；实现、编译、实际使用、打包与公开上传分别记录状态。

## 当时研讨引用的原始资料

这些链接用于保留技术决策来源，本轮未重新核验其网页内容：

- [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/)、[MEI](https://music-encoding.org/about/)、[Verovio 输入格式](https://book.verovio.org/toolkit-reference/input-formats.html)。
- [MIDIVisualizer](https://github.com/kosua20/MIDIVisualizer)、[Notefall](https://github.com/ekkx/notefall)、[Piano VFX](https://piano-vfx.com/)。
- [MuseScore MIDI 导入](https://handbook.musescore.org/import-export/midi-import)、[Audiveris](https://github.com/Audiveris/audiveris)。
- [MAESTRO](https://magenta.withgoogle.com/datasets/maestro)、[Mutopia 许可页](https://www.mutopiaproject.org/legal.html)、[GiantMIDI](https://github.com/bytedance/GiantMIDI-Piano)、[Pop-K](https://zenodo.org/records/14791511)。
