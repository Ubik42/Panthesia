# 技术调研 2026-11

为分层歌曲模型、和弦级数、伴奏音轨、导入整理和音频转 MIDI 做的调研。结论已写入 [current-plan.md](current-plan.md)。

## 1. 参考：《情话》钢琴瀑布 V2（BV1x2xM6PEkq）

制作工具为 "Piano Falls by HOTHOT v1.0.2"（UP 主自制，未公开）。完整视频（1080P）在 `D:\obsidian\_reference\B站\丁世光《情话》钢琴瀑布V2【新增和弦级数】\`，1080P 截图在 `work/research/chord-degree-reference/`（t005 前奏、t045 主歌、t150 副歌）。

画面上的信息层：

| 位置 | 内容 |
| --- | --- |
| 左上 | 拍号 `4/4`、速度 `♩=65.4`；小节线左端标小节号（如 `14`） |
| 音符块 | 首调级数数字（`1`–`7`，变音加 `♯`/`♭` 前缀，如 `♭7`、`♯5`），颜色区分左右手；按住的键在其琴键列上留半透明长条 |
| 琴键 | 白键和黑键都标级数（黑键同时标 `♯x` 与 `♭y`）；按下的键染成所属手的颜色 |
| 横线 | 小节线贯穿瀑布；段落标记写在小节线上（如 `Chorus`） |
| 右侧边栏 | 每个和弦在起始小节线处显示级数 + 和弦名：`5m7 Am7`、`6m11 Bm11`、`3⁷/♯5 F♯7/A♯`、`7°/4 C♯°/G`、`1/3 D/F♯` |
| 左下 | 当前调 `D`，当前歌词一行（如"而他却不知道"） |
| 右下 | 当前和弦大字：`1/3 D/F♯`、`1sus2 Dsus2`、`1add9 Dadd9` |
| 右上 | **Vocal / Piano** 两个音轨开关（人声与钢琴分别开关） |
| 顶部 | 快捷键条：Play（暂停、拖动、速度、重开）；View（全屏、标题栏、`[D] Degree` 级数、缩放、`[K/W] Range` 键盘范围、`[C] Theme`，当前主题 "Ink and Gold / Dark"）；Edit（`[H] Notes`、`[J] Markers` 段落标记、移动、删除、`[N/B] Labels`、`[A] Analyze` 自动分析）；Sound（静音、MIDI 输出、Sustain、FX）；File（导出、预设、保存、撤销） |

要点：

- 级数用首调简谱写法（`4 5 3m 6m`），转位写成 `1/3`，七和弦上标 `3⁷`，减和弦 `7°`，扩展和弦（`m11`、`add9`、`sus2`）完整保留。
- 歌词、段落、和弦、调性、人声都是叠加在瀑布上的可选图层，可以分别开关。
- 和弦有自动分析（`[A] Analyze`）与手动编辑（Markers、Labels）两条路，对应本项目图层的 `generated` 与 `human` 来源。

## 2. 和弦与级数识别

Rust 生态没有可直接用的符号域和声分析库（`kord` 只解析和弦名，MIT）。自己实现：

1. 拍网格：从 tempo map 生成；转录 MIDI 没有可靠 tempo map 时先做节拍追踪。
2. 分段：按拍切，相邻同和弦合并。
3. 特征：每段 12 维音级分布，按时值和力度加权，最低音额外加权（决定转位）。
4. 匹配：三和弦、七和弦、sus、add、dim、aug、N（无和弦）模板。
5. 平滑：HMM / Viterbi，偏向保持当前和弦。
6. 调性：Krumhansl-Schmuckler 在 4–8 小节窗口上估计，Temperley 式转调惩罚平滑。
7. 级数：调内和弦直接给级数；次属和弦标 `V/x`；调外音和弦标借用；无法解释时显示原和弦名。

内部表示用 Harte 语法（root:quality/bass）。显示层提供两种写法：首调级数（`6m7`）与和弦名（`Bm7`）。

验证数据：本地 Hooktheory（16,383 段，带 harmony 与 keys 标注）和 POP909（909 首，`chord_midi.txt`、`key_audio.txt`、`beat_midi.txt`）。离线可用 music21 做对照，不进运行时。

## 3. 段落结构

可做粗粒度建议：按小节特征（音级分布、和弦序列、音符密度）建自相似矩阵，用 checkerboard novelty 找边界，聚类后按启发式命名（开头低密度为前奏，重复最多、密度最高为副歌）。结果标记为 AI 来源，供用户修改。参考：Eldeeb & Malandro 2025（arXiv 2509.16566，含 Lakh MIDI 人工边界）。

## 4. 伴奏音轨（人声 / 原曲）

- **找文件**：同目录或同名（`_人声.wav`、`vocals.wav`、`source/*.mp3`），再按时长（误差 < 2%）与 chroma 相关性确认。音频指纹（Chromaprint）对钢琴翻弹无效。
- **对齐**：MIDI 直接算 chroma，与音频 chroma 做 DTW（长曲用多分辨率 MrMsDTW，参考 synctoolbox）。输出 tick → 秒的分段线性映射，锚点 2–5 秒一个，检查单调性。
- **人声分离**：离线预处理。当前链路已用 BS-RoFormer-SW 六轨分离。
- **变速**：练习时改 BPM，音频需要保持音高变速。用 signalsmith-stretch（MIT，C++ 头文件库，Rust 绑定 `ssstretch`）。Rubber Band 为 GPL/商业双许可，可用但不必要。
- **时钟**：伴奏开启时以音频样本位置为主时钟，MIDI 调度经映射换算。

## 5. 导入整理：hibikiwtnb/piano-midi-cleanup

许可证 **AGPL-3.0**。整体水平不高，**不作为本项目的参考实现**。Python 管线：分离 → ByteDance 转录 → BPM / 第一拍 → 规则清理 → 分手 → 重叠裁切，全部是手调阈值的启发式，只在 8 首曲目上调过，绑定特定转录模型，固定速度假设，踏板平滑与量化未实现。

唯一采纳的一点：裁切或合并音符时，以"实际发声结束时间（含踏板）是否改变"作为判据。这条判据用于第 3.3 节的演奏清理。

手别分离不参考该仓库。pygame-piano-animator 的 `hand_split.py` 在同一 beam search 骨架上考虑了更完整的演奏约束（演奏者手型决定的跨度、按住的键、物理移动速度上限、双手交错检测、颤音整段归一只手、重复和弦沿用分法、轨道先验仅在手跟不上时让步），并与指法规划、动画自检共用约束，在 MAESTRO 1276 首上做过统计验证。该仓库无许可证，只学习约束设计，不移植代码。我们的手别分离与指法规划按下列顺序选型：

1. 规划器：beam search / 动态规划，代价由演奏约束组成（跨度、速度、按住的键、交错、指数、音型），演奏者手型参数化。
2. 学习方法作对照：Nakamura merged-output HMM（手别与指法）、"Cluster and Separate"（ISMIR 2024，GNN 声部与手别）、PIG 指法数据集上的模型。
3. 验证：MAESTRO 与 Hanon / Czerny 等带指法的教学曲，统计"手够不到 / 速度超限 / 交错"事件，逐版本比较。

其他环节选型：节拍追踪用 Beat This!（ISMIR 2024）或 madmom；演奏 MIDI 到谱面参考 partitura、Nakamura 的节奏量化 HMM 与 PM2S；当前链路的 DuET 已承担演奏 MIDI → MusicXML。

## 6. 音频转 MIDI：Transkun

本地版本 **Transkun 2.0.1**，即 PyPI 最新版（2024-09-28，MIT）。2025–2026 年没有找到明确优于它的可用开源钢琴转录系统。

| 系统 | Note onset F1（MAESTRO） | 许可 |
| --- | --- | --- |
| Transkun V2 | 98.3 | MIT |
| Aria-AMT | 97.6 | 代码 Apache-2.0，权重未确认 |
| hFT-Transformer | 97.4 | 代码 MIT，权重单独许可 |
| ByteDance high-res | 96.7 | 未确认 |

- 转录链路在 `D:\Music\_tools\music-transcription`：BS-RoFormer-SW 六轨分离 → Transkun 2.0.1 → DuET → MusicXML。Panthesia 内没有转录代码。
- **待核对**：pip 包的默认模型是 V2 No Pedal Ext（不输出踏板）。本地 `transkun/pretrained/2.0.pt` 是哪一版需要做哈希比对；需要踏板时应使用带踏板的 V2 权重。
- **DuET** 不是音频转录，是 performance MIDI → MusicXML（`duet-score` 0.1.0，代码 MIT，权重 CC BY-NC 4.0）。`duet_runtime.rs` 让 DuET 借用 Transkun 的 venv，并硬编码 `D:\cs\...` 模型路径，应拆分并改为设置项。

## 7. 本地语料 `D:\Music\MIDI`

约 41,000 个文件、7.3 GB。没有统一的"每首一个文件夹"结构，按来源分为五区：

| 区 | 数据形态 | 用途 |
| --- | --- | --- |
| `B站纯钢琴演奏视频转MIDI` | 每首：`source.json`、原视频/音频、六轨分离（含 `vocals.wav`）、`piano_raw.mid`（演奏）、`score.mid` + `score.musicxml`（DuET）、逐帧拍点 `frames.csv`；部分有 `versions/` 原调/C 大调 × 自动对齐/乐谱量化 | 完整分层歌曲样本：演奏 + 谱面 + 伴奏 + 版本 |
| `KAIRCI ACG …` | 100 首：文件名含 BPM 与调（`yama - Oz - BPM76 - Gmajor.mid`），同名伴奏 `.wav` 与 `_人声.wav`，有 `人声匹配清单.csv` | 伴奏同步；文件名元数据解析；含 macOS `._*` 垃圾文件 |
| `周杰伦midi 126首` | 每首一个文件夹，多个来源各异的版本（如 `七里香 [12和弦].mid`、`ROCK版七里香.mid`） | 多版本归并；多轨 MIDI |
| `SNH48钢琴PDF谱` | PDF + Audiveris/MuseScore 识谱的 MIDI/MXL 初稿 | 纸谱与识谱质量边界 |
| `Datasets` | POP909（和弦/调/拍标注）、Hooktheory（和声 JSON）、MAESTRO（`.midi`，踏板）、GiantMIDI、Mutopia、Open_Pop_Style、`catalog.csv` | 和弦识别验证；性能与解析回归 |

没有 ABC 文件，没有歌词。代表性测试子集见 current-plan.md 第 3.6 节。

## 8. Serpent 工作台布局（`D:\manage\_tools\Serpent`）

技术栈：Electron + Node + React + TypeScript，MIT，约 32 万行（上游 dolag233/Serpent，本地为 Ubik42 个人版）。后端是 Node（better-sqlite3、sharp），不是 Rust，与 Panthesia 无法共用后端。

布局：顶栏（后退 / 前进、库切换、工作区标签页、搜索、左右栏开关）+ 左栏（入口、文件夹树、标签树、自动任务）+ 中栏（等高行网格 / 瀑布流、尺寸滑块、筛选条、排序）+ 右栏 Inspector（预览、标签、评分、描述、属性）。没有列表视图，画布没有方向键导航。

代码结构：

- 好的部分是一批纯 TS 模块，带单测：栏宽拖拽与自动隐藏（`panel-drag-session`、`panel-auto-hide`、`shell-preferences`）、工作区标签页与共享历史（`workspace-tabs`、`workspace-nav-history`、`use-workspace-tabs`）、自研虚拟化（`virtual-browse-canvas`、`asset-grid-layout`、`card-size-stops`）、选择与框选（`useAssetSelection`、`marquee-*`）、搜索表达式解析器（`shared/search-expression.ts`，递归下降，带位置诊断）、标签树模型、自动任务分组模型。
- 差的部分：`App.tsx` 17,673 行，233 个 useState，状态全部集中再经 props 下传；`styles.css` 20,113 行全局 CSS，结构与美术混写；Inspector、侧栏、筛选栏都是 60–150 个 props 的受控大组件。
- 后端边界干净：渲染层只通过 `SerpentLibraryApi` 接口（zod 校验的 `type` 判别联合请求 + `Result` 返回）访问主进程，不直接依赖 Electron。

能否做成共用框架：

- 后端不能共用（Node 与 Rust）。可共用的是前端工作台层：外壳、面板、标签页、虚拟化、选择、搜索解析、树、Popover、设计 token 的结构约定，加上"一个 API 接口 + 判别联合请求 + Result"的传输模式。
- 现在不在 Serpent 内部抽包：App.tsx 单体需要大面积重构，且 fork 的高频冲突文件（App.tsx、NavigationSidebar、styles.css）会让以后每次合并上游都冲突。
- 做法：把上述纯模块复制进 Panthesia `src/workbench/`，类型泛化为 `Item` / `Location`，用 zustand store 承接状态，组件按 Panthesia 领域重写。NOTICE 记录来源提交。等 Panthesia 的 `src/workbench/` 稳定、有第三个应用要用时，再抽成独立包（`@ubik/workbench`），并让 Serpent 反向接入。
- 估计工作量 3–4 周（纯模块移植 3–5 天；外壳与结构 CSS 1 周；侧栏、筛选、Inspector 按曲库领域重写 1–2 周）。
