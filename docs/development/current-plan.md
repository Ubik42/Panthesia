# Panthesia 开发计划

版本：2026-11-21 / 2。本文件是唯一任务队列与长期目标。进度流水写在 [progress.md](progress.md)，调研依据见 [research-2026-11.md](research-2026-11.md)。旧 B00–B07 计划已结束，内容在 git 历史（`main` 分支 9561452 之前）。

## 1. 长期目标

Panthesia 是开源的 Windows 钢琴练习软件。核心是好的练琴体验，数据有什么用什么。

1. **练琴体验**：交互逐屏参照 Synthesia（主页 → 选曲 → 歌曲设置 → 演奏），视觉质量高于参照。瀑布、琴键、光效、虚拟双手、和弦级数、歌词在一个流畅的舞台中，每个图层可以分别开关。
2. **分层歌曲模型**：一首歌只要有一份可播放的演奏就能练。谱面、量化版本、转调、段落、和弦级数、指法、歌词、伴奏音频都是可选图层；有就显示，没有就隐藏，需要时由算法或 AI 在后台生成。
3. **统一来源**：MIDI、MusicXML、ABC、音频转录结果进入同一个歌曲模型；派生版本对任意来源都可用。
4. **可靠的资料**：歌曲、标注和设置不会因文件移动、版本变化或重新分析而丢失；人工修改永远不被自动结果覆盖。

## 2. 现状诊断（2026-11-21 扫描）

| 区域 | 规模 | 主要问题 |
| --- | --- | --- |
| 前端 `panthesia-web/src` | 约 11.4 万行 | `App.tsx` 1578 行、55 个 useState，状态靠 props 逐层传递；两套导航叠加；`src/` 根目录约 120 个散落大对话框；86 个全局 CSS 文件互相覆盖，硬编码颜色约 2400 处；80 ms 轮询后端；`api.ts` 每个功能写 Tauri 与 HTTP 两遍 |
| 引擎 `panthesia-engine` | 约 7.6 万行 | `lib.rs` 4438 行；评分时代代码约 1 万行仍编译、运行时由 `practice_policy.rs` 拒绝；五套"意图文件 + 恢复"存储机制；一次性迁移代码在主路径 |
| 核心 `panthesia-core` | 约 2.6 万行 | 乐谱 IR、练习判定、历史、练习曲生成、曲库格式混在一个 crate；四套类型描述"作品 / 版本 / 谱面" |
| 音乐模型 | — | 演奏模型与乐谱模型并行，由对齐表连接；MIDI 生成谱面时直接输出 MusicXML 文本；**ABC 导入不存在** |
| 后台工具 | — | 转录链路在仓库外（`D:\Music\_tools\music-transcription`）；DuET 借用 Transkun 的 venv，模型路径硬编码 `D:\cs\...` |
| 测试 | 110 个 Playwright spec | 需要手动启动 Vite 与 HTTP 引擎；依赖中文文案与 CSS 类名；没有基于真实语料的回归 |

保留价值高的部分：`panthesia-music`（tick 时间、稳定 NoteId）、PlaybackSession、SQLite 歌曲仓库与内容寻址资产、MusicXML 解析与反复展开、Verovio 渲染链、MIDIVisualizer 光效着色器、Synthesia 参考截图与交互规范。

## 3. 目标架构

### 3.1 分层歌曲模型

```
Song
├─ sources[]        原始文件（MIDI / MusicXML / ABC / 音频 / PDF），内容哈希，许可状态
├─ performances[]   可播放演奏（tick 事件、NoteId）；至少一份
├─ variants[]       派生：转调、量化、速度——对 performance 与 score 的纯函数，可重算
├─ scores[]         Score IR（小节、声部、记号）；可选
├─ alignments[]     score ↔ performance（ScoreEventId ↔ NoteId）；audio ↔ performance（tick → 秒映射）
└─ layers           全部可选，统一使用 performance 的 tick 时基
   ├─ hands         轨道手别、逐音覆盖
   ├─ fingering     逐音指法、换指
   ├─ sections      段落（前奏 / 主歌 / 副歌）
   ├─ keys          调性分段
   ├─ chords        和弦（Harte 语法：root:quality/bass）；级数由 chords + keys 派生显示
   ├─ lyrics        歌词行与时间
   ├─ beats         拍与小节线（转录 MIDI 的节拍追踪结果）
   └─ stems         伴奏音频（人声、原曲、伴奏），经 alignment 同步
```

每个图层条目带来源信息：

```
provenance: { origin: human | imported | generated, tool, tool_version, params_hash, created_at }
confidence: 0..1（generated 才有）
status:     draft | accepted
depends_on: [layer ids]   例：chords 依赖 beats；级数显示依赖 chords + keys
```

规则：

- 人工结果（`human`）不被自动重算覆盖；`generated` 结果在工具版本变化时可重算。
- 图层存在与否决定界面：没有和弦层就不显示级数开关的结果，提示可以"分析和弦"。
- 外部文件按内容哈希关联，改名、移动后仍匹配。
- 现有 `library/annotations/<contentId>.json`（手别、指法、小节设置）迁入 `layers`，保留 v2 读取。

### 3.2 统一音乐模型与导入

- 新 crate `panthesia-notation`：从 `core::musicxml` 拆出 Score IR、MusicXML 读写、反复展开（`score_playback`）、Score → Performance（`score_performance`）、对齐（`score_alignment`）。
- 导入器全部输出 `Song`：
  - MIDI → Performance；导入时读取 tempo、拍号、调号、歌词（Lyric meta）、标记（Marker meta）进入图层。
  - MusicXML → Score IR → Performance；和弦符号（`<harmony>`）、歌词进入图层。
  - ABC → Score IR → Performance（新写解析器，覆盖 ABC 2.1 常用子集：头字段、音符/时值、和弦符号、多声部 `V:`、反复）。
  - 音频转录结果（Transkun 输出 + DuET 谱面）作为 performance + score + stems 一起导入。
- **歌曲包识别**：导入一个目录或文件时识别同目录的伴生文件，归入同一首歌：`vocals.wav` / `*_人声.wav`、`source/*.mp3`、`score.musicxml`、`versions/*_原调_*`、`*_C大调_*`、POP909 的 `chord_midi.txt` / `key_audio.txt` / `beat_midi.txt`、文件名中的 `BPM97 Bmajor`。识别结果按规则给出，不按标题猜测合并不同演奏。
- 谱面渲染只有一条路：Score IR → MusicXML → Verovio。`practice_engraving` 改为输出 Score IR。
- 转调同时修改调号与拼写；量化保留原始演奏可返回。
- 元数据收敛为一套类型，替换 `song_project` / `repertoire` / `SongSidecar` / `song_catalog`。

### 3.3 分析服务（后台，可选）

在 Rust 引擎内实现，结果写入图层（`origin: generated`）：

| 服务 | 方法 | 输出图层 |
| --- | --- | --- |
| 节拍追踪 | 转录 MIDI 无可靠 tempo map 时：onset 间隔 + 动态规划；后续可接 Beat This!（外部） | beats |
| 调性 | Krumhansl-Schmuckler 窗口估计 + 转调惩罚平滑 | keys |
| 和弦 | 拍段音级分布（低音加权）+ 模板匹配 + Viterbi 平滑 | chords |
| 段落 | 小节自相似矩阵 + novelty 边界 + 聚类命名 | sections |
| 手别分离 | 分组 + beam search 代价函数（跨度、音域、移动、指数） | hands |
| 演奏清理 | 幽灵音、半音粘连、重叠裁切（以实际发声结束时间为判据） | 新 variant，不改原演奏 |
| 伴奏对齐 | MIDI chroma ↔ 音频 chroma 的多分辨率 DTW | alignments |

外部 Python 工具（Transkun 2.0.1、BS-RoFormer-SW、DuET）只通过后台适配器调用：每个工具独立 venv，路径在设置中配置，不硬编码，不静默下载模型。

### 3.4 引擎

- 主线只保留练琴所需：导入、歌曲仓库、播放会话、声音、记谱、标注、分析服务。评分时代模块与历史回放移出主线（保存在 `feature/assessment-lab`）。
- 一套存储事务：SQLite 事务 + 内容寻址文件，替换五套机制。
- `lib.rs` 按领域拆分。
- 状态推送：引擎发出状态帧，前端通过 Tauri 事件订阅。
- 音频：伴奏音轨经 signalsmith-stretch（MIT）保持音高变速；伴奏开启时音频样本位置为主时钟。

### 3.5 前端与演奏舞台

- **外壳**：`AppShell` + 屏幕状态机（Home / SongSelect / SongSetup / Tracks / HandSplit / Play / FreePlay / Settings）。删除 workspace 层。
- **状态**：按领域划分的少量 store（song、playback、settings、library），组件直接订阅。
- **传输**：`api.ts` 只有 `send(command)` 一个出口，启动时选定 Tauri 或 HTTP（浏览器调试与 Playwright 用）。
- **设计系统**：`tokens.css` 单一来源；基础组件 Button、IconButton、Toggle、Slider、Select、Popover、Menu、Dialog、List、Card；组件样式与组件同目录，只用 token。
- **目录**：`src/app`、`src/ui`、`src/screens/<屏幕>`、`src/stage`、`src/notation`、`src/engine`。`src/` 根目录不放业务组件。
- **舞台渲染器**：一个 WebGL2 渲染器负责瀑布、琴键、光效（实例化），Canvas 2D 只作回退。图层顺序：背景 → 小节线与段落标记 → 音符块与标签 → 光效 → 琴键 → 虚拟双手 → 文字叠层（和弦、歌词、调、速度）。
- **标签模式**：音名、唱名、首调级数（`1`–`7`，`♯`/`♭` 前缀）、指法；琴键与音符分别设置。
- **和弦显示**：可选开启；在和弦起始小节线处显示"级数 + 和弦名"（如 `6m7 Bm7`），右下显示当前和弦大字；写法可选级数 / 和弦名 / 两者。
- **歌词**：有歌词层时左下显示当前行。
- **伴奏**：有 stems 时，演奏工具栏出现"人声 / 伴奏"开关与音量。
- **性能**：19,200 音符负载下 60 Hz 稳定，P99 帧时间 < 16.7 ms；高刷新率屏幕跟随显示器频率。
- **视觉方向**：深色舞台、高对比的瀑布和琴键，动效有物理感（按键下沉、光晕衰减、粒子）。

### 3.6 测试语料

本地 `D:\Music\MIDI`（不入库，许可各异）。`tests/corpus.toml` 只登记路径与期望：

| 用途 | 样本 |
| --- | --- |
| 完整分层歌曲 | `B站纯钢琴演奏视频转MIDI/Ai-Ai-Ai_BV16b6RBpE6T/exports/<run>/`（`piano_raw.mid`、`score.mid`、`score.musicxml`、`vocals.wav`） |
| 多版本 | `B站纯钢琴演奏视频转MIDI/Look at the Sky - Porter Robinson - MIDI/`（`versions/` 原调 / C 大调 × 自动对齐 / 乐谱量化） |
| 伴奏同步 | `KAIRCI ACG …/「ACG」CHORUS PIANO #1_/`（`yama - Oz - BPM76 - Gmajor.mid` + 同名 `.wav` + `_人声.wav`）；`CRYCHIC - 春日影` 人声近乎静音，作边界 |
| 多轨 / 多版本归并 | `周杰伦midi  126首/七里香/`（14 个版本，含 `[12和弦]`、`ROCK版`） |
| 和弦识别真值 | `Datasets/POP909-Dataset/POP909/001/`（`chord_midi.txt`、`key_audio.txt`）；`Datasets/Hooktheory/` |
| 踏板与长曲 | `Datasets/Classical_Performance_MAESTRO/`（`.midi`） |
| 识谱边界 | `SNH48钢琴PDF谱/PDF转MIDI/海砂.mid`、`海砂.mxl` |
| 解析鲁棒性 | `Datasets/Classical_Transcription_GiantMIDI/midis/`（文件名含逗号与变音字母）、`Open_Pop_Style/`（极短片段） |

回归测试分三类：解析（全部样本可导入、无 panic）、往返（MusicXML / ABC → Score IR → MusicXML 不丢音）、分析精度（POP909 和弦识别准确率作为基线数字，逐版本比较）。

## 4. 阶段

| 阶段 | 内容 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R0 基线清理 | 删除死 crate、旧原生应用、前端不可达代码、重复文档；重写计划；磁盘清理 | 构建通过；文档只有一套计划 | 已完成 |
| R1 主线瘦身 | 删除评分时代代码与历史回放（engine、core、前端 review/routines/history）、对应协议变体与 spec；合并存储事务；拆分 `lib.rs`；删除一次性迁移代码；DuET 独立 venv 与可配置路径 | `practice_policy.rs` 删除；engine < 5 万行；构建通过；真实资料可读 | 下一步 |
| R2 前端骨架与设计系统 | tokens、基础组件、AppShell、屏幕状态机、领域 store、单一 `send()`、状态推送；四个主屏重写 | `App.tsx` < 300 行；CSS 全部基于 token；主流程四屏按参照图重做并通过视觉验收 | 待开始 |
| R3 演奏舞台渲染器 | WebGL2 瀑布 + 琴键 + 光效；时钟；标签模式（含首调级数）、小节线、循环区 | 性能目标达标；视觉对照 Synthesia 与 MIDIVisualizer | 待开始 |
| R4 分层歌曲模型与统一导入 | `panthesia-notation`；Song 图层与来源信息；ABC 导入；MIDI meta（歌词、标记、调号）读入；歌曲包识别；元数据收敛；语料回归 | 第 3.6 节样本全部可导入；同一首歌从 MIDI / MusicXML / ABC 进入后都能播放、显示谱面、转调、量化 | 待开始（可与 R2 并行） |
| R5 谱面显示 | 谱面窗口化、跟随、只读阅读器；从 Score IR 生成 | 长谱流畅翻页与跟随；转调后谱面与演奏一致 | 待开始 |
| R6 和声与结构分析 | 节拍、调性、和弦、段落、手别分离服务；舞台和弦 / 段落 / 歌词图层；编辑与采用 | POP909 和弦识别有基线准确率；《情话》式显示可开关；人工修改不被覆盖 | 待开始 |
| R7 伴奏音轨 | stems 识别与导入；chroma DTW 对齐；signalsmith-stretch 变速；人声 / 伴奏开关 | KAIRCI 与 B 站样本可同步播放；改 BPM 时音高不变、不漂移 | 待开始 |
| R8 虚拟双手 | 自行实现（参考公开思路，不移植无许可证代码）：骨架 + IK、穿指、换指、交叉；舞台图层 | 实际运动对照参考视频 BV1gasF6UERM | 待开始 |
| R9 自由演奏与录音 | UI08：录音、量化保存、重开 | 录音保存为歌曲后可正常练习 | 待开始 |
| R10 发布 | 打包、使用文档、来源审计、Release | 独立安装包完成一次完整练琴流程 | 待开始 |

顺序：R1 → R2 → R3 为前端主干；R4 → R6 → R7 为数据主干，与前端主干并行。R5 依赖 R4；R8 依赖 R3。

## 5. 固定约束（用户决定）

- 前端布局、层级、导航参照 Synthesia 官方截图（`work/original-product-reset/references`，不随包分发）。Panthesia 品牌、简体中文。
- 速度单位为 BPM。
- 删除"全部歌曲""入门练习"分类、八秒试听、常驻预览侧栏。
- 文件操作放在右键菜单（资源管理器定位、查看版本）。
- 主线只有连续播放与等待按键两种模式。评分、达标、日课、晋级、历史回放与表现记录只在 `feature/assessment-lab`。
- 数据不要求完整：缺少的图层不阻塞练习，界面只显示存在的内容。
- 后台能力（转录、分离、DuET、分析、转调量化、扫描）只从歌曲设置或全局设置的二级入口进入；演奏舞台不放任务卡、版本栏、诊断信息。
- 选曲直接按文件实际状态打开；缺失只在曲目行标记。
- 皮肤、特效、标签、和弦、歌词图层在"显示"设置中开关。
- 虚拟双手自行实现；不复制或移植 pygame-piano-animator（无许可证）的代码、参数与权重。
- 浏览器调试模式保留，收在单一 `send()` 之后。
- 用户 MIDI、谱面、标注、设置、录音必须保护；迁移可回退。15 个未匹配的旧身份保留，不按标题合并。
- 不推送、不发布，除非用户明确要求。

## 6. 待核对

- 本地 Transkun 权重 `D:\Music\_tools\_reference\Transkun\transkun\pretrained\2.0.pt` 是否为带踏板的 V2（pip 默认的 No Pedal Ext 不输出踏板）。
- `D:\Music\MIDI` 中 B 站项目 `result.json` 的 `midi` 字段指向已失效的旧路径，导入时以目录内实际文件为准。

## 7. 工作方式

- 每轮推进一个阶段内的一批完整改造，接入后同步删除旧路径，不让同一职责长期两套并行。
- 检查以构建通过、语料回归与直接覆盖风险的测试为准；视觉改动用实际截图对照参照图。
- 每轮结束在 [progress.md](progress.md) 记一条：日期、提交、完成内容、下一入口。
