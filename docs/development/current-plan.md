# Panthesia 开发计划

版本：2026-11-21 / 3。本文件是唯一任务队列与长期目标。进度流水写在 [progress.md](progress.md)，调研依据见 [research-2026-11.md](research-2026-11.md)。旧 B00–B07 计划已结束，内容在 git 历史（`main` 分支 9561452 之前）。

## 1. 长期目标

Panthesia 是开源的 Windows 钢琴练习软件。核心是好的练琴体验，数据有什么用什么。

**定位（2026-11-21 用户决定）**：Panthesia 是"打开一首歌就能练"的专用程序，不做曲库管理。曲库的浏览、整理、标签、规则由通用文件库 Keel（`D:\Manage\_tools\Keel`，原 Serpent）承担；Keel 把 MIDI、MusicXML 与 `.panthesia` 的打开方式指向 Panthesia。歌曲数据跟着文件走，写在文件旁边的 `.panthesia` 清单中（3.7）。技术栈保持 Rust + Tauri + React。

1. **练琴体验**：打开文件即进入演奏；演奏舞台参照 Synthesia，视觉质量高于参照。瀑布、琴键、光效、虚拟双手、和弦级数、歌词在一个流畅的舞台中，每个图层可以分别开关。
2. **分层歌曲模型**：一首歌只要有一份可播放的演奏就能练。谱面、量化版本、转调、段落、和弦级数、指法、歌词、伴奏音频都是可选图层；有就显示，没有就隐藏，需要时由算法或 AI 在后台生成。
3. **统一来源**：MIDI、MusicXML、ABC、音频转录结果进入同一个歌曲模型；派生版本对任意来源都可用。
4. **可靠的资料**：歌曲、标注和设置不会因文件移动、版本变化或重新分析而丢失；人工修改永远不被自动结果覆盖。数据与文件放在一起，换机器、换软件、用 Git 都能带走。

## 2. 现状诊断（2026-11-21 扫描）

| 区域 | 规模 | 主要问题 |
| --- | --- | --- |
| 前端 `panthesia-web/src` | 约 11.4 万行 | `App.tsx` 1578 行、55 个 useState，状态靠 props 逐层传递；两套导航叠加；`src/` 根目录约 120 个散落大对话框；86 个全局 CSS 文件互相覆盖，硬编码颜色约 2400 处；80 ms 轮询后端；`api.ts` 每个功能写 Tauri 与 HTTP 两遍 |
| 引擎 `panthesia-engine` | 约 7.6 万行 | `lib.rs` 4438 行；评分时代代码约 1 万行仍编译、运行时由 `practice_policy.rs` 拒绝；五套"意图文件 + 恢复"存储机制；一次性迁移代码在主路径 |
| 核心 `panthesia-core` | 约 2.6 万行 | 乐谱 IR、练习判定、历史、练习曲生成、曲库格式混在一个 crate；四套类型描述"作品 / 版本 / 谱面" |
| 音乐模型 | — | 演奏模型与乐谱模型并行，由对齐表连接；MIDI 生成谱面时直接输出 MusicXML 文本；**ABC 导入不存在** |
| 后台工具 | — | 转录链路在仓库外（`D:\Music\_tools\music-transcription`）；DuET 使用独立 venv（`_reference/DuET/.venv`），模型按设置项 → `PANTHESIA_MODELS_ROOT` 共享模型库查找（R1 完成） |
| 测试 | 110 个 Playwright spec | 需要手动启动 Vite 与 HTTP 引擎；依赖中文文案与 CSS 类名；没有基于真实语料的回归 |

保留价值高的部分：`panthesia-music`（tick 时间、稳定 NoteId）、PlaybackSession、MusicXML 解析与反复展开、Verovio 渲染链、MIDIVisualizer 光效着色器、Synthesia 参考截图与交互规范。

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
- 现有集中存储中的标注（`library/annotations/<contentId>.json`、`web-preferences.json` 中的段落、书签、变调与量化）迁移到文件旁的 `.panthesia` 清单（3.7、R2）。

### 3.2 统一音乐模型与导入

- 新 crate `panthesia-notation`：从 `core::musicxml` 拆出 Score IR、MusicXML 读写、反复展开（`score_playback`）、Score → Performance（`score_performance`）、对齐（`score_alignment`）。
- 导入器全部输出 `Song`：
  - MIDI → Performance；导入时读取 tempo、拍号、调号、歌词（Lyric meta）、标记（Marker meta）进入图层。
  - MusicXML → Score IR → Performance；和弦符号（`<harmony>`）、歌词进入图层。
  - ABC → Score IR → Performance（新写解析器，覆盖 ABC 2.1 常用子集：头字段、音符/时值、和弦符号、多声部 `V:`、反复）。
  - 音频转录结果（Transkun 输出 + DuET 谱面）作为 performance + score + stems 一起导入。
- **歌曲包识别**：打开一个目录或文件时识别相关文件，结果在用户确认或修改后写入 `.panthesia` 清单：`vocals.wav` / `*_人声.wav`、`source/*.mp3`、`score.musicxml`、`versions/*_原调_*`、`*_C大调_*`、POP909 的 `chord_midi.txt` / `key_audio.txt` / `beat_midi.txt`、文件名中的 `BPM97 Bmajor`。识别结果按规则给出，不按标题猜测合并不同演奏。
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
| 手别分离与指法 | 演奏约束规划器：跨度（按演奏者手型）、按住的键、物理移动速度上限、双手交错、指数、音型（颤音、重复和弦）；与虚拟双手共用约束；学习方法（Nakamura HMM、GNN）作对照 | hands、fingering |
| 演奏清理 | 针对转录模型的误检音、重叠裁切；修改是否可接受以实际发声结束时间（含踏板）为判据，用 A/B 试听验收 | 新 variant，不改原演奏 |
| 伴奏对齐 | MIDI chroma ↔ 音频 chroma 的多分辨率 DTW | alignments |

外部 Python 工具（Transkun 2.0.1、BS-RoFormer-SW、DuET）只通过后台适配器调用：每个工具独立 venv，路径在设置中配置，不硬编码，不静默下载模型。

### 3.4 引擎

- 主线只保留练琴所需：打开文件、清单读写、播放会话、声音、记谱、分析服务。评分时代模块与历史回放移出主线（保存在 `feature/assessment-lab`）。
- **不再有集中曲库**：删除歌曲仓库 `songs.sqlite3`、内容寻址副本存储 `library/assets`、目录缓存、`library-workspace.json`、`library-monitor-files.json`、导入复制流程。打开文件时直接读原文件，不复制。
- 本地只保留属于用户本人、不属于歌曲的数据：练习历史与时长、每首歌上次的速度与位置、最近打开列表（按演奏文件的 BLAKE3 关联）；以及可重算的缓存（谱面渲染、分析中间结果）。
- `lib.rs` 按领域拆分。
- 状态推送：引擎发出状态帧，前端通过 Tauri 事件订阅。
- 音频：伴奏音轨经 signalsmith-stretch（MIT）保持音高变速；伴奏开启时音频样本位置为主时钟。

### 3.5 前端与演奏舞台

- **三个界面**（RF 阶段按新结构重写）：
  - **启动页**：最近打开、打开文件 / 文件夹、拖入。不做曲库浏览、筛选、标签。
  - **歌曲设置**：查看与编辑本首歌的清单内容：演奏版本选择、轨道与手别、谱面配对、伴奏文件、图层状态（有 / 缺失 / 生成）、段落与书签。
  - **演奏舞台**：全屏，保留 Synthesia 式的演奏布局（顶部工具条、时间线、谱面、瀑布、琴键）。
- **打开方式**：命令行参数、Windows 文件关联（`.mid`、`.midi`、`.musicxml`、`.mxl`、`.panthesia`）、单实例（已运行时把文件交给现有窗口）、拖入文件或文件夹，都直接进入演奏或歌曲设置。
- **状态**：引擎推送状态与任务列表（桌面为 Tauri 事件，浏览器调试为长轮询），界面不轮询。领域状态用 `useSyncExternalStore` 外部 store（`playbackStore` 按字段订阅，设置、任务同样），应用级状态由 `app/useAppModel` 组合后经 `AppContext` 提供，组件直接读取，不逐层传 props。不另引入 zustand：现有外部 store 已覆盖其用途（2026-11-21 决定）。
- **传输**：`api.ts` 中 `local()` 是浏览器调试的唯一 HTTP 出口，`call()` 在 Tauri 命令与服务路径间选择；类型由 Rust 生成。
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

### 3.7 数据跟随文件：`.panthesia` 清单

用户 2026-11-21 决定：歌曲数据尽量跟着文件走。打开文件时，数据直接从文件旁边取。

**格式**：`.panthesia` 是 UTF-8 JSON 文本，用相对路径引用素材文件，自身保存歌曲数据。

```json
{
  "format": "panthesia-song",
  "version": 1,
  "title": "Oz",
  "artist": "yama",
  "files": [
    { "id": "perf", "role": "performance", "path": "yama - Oz - BPM76 - Gmajor.mid", "blake3": "…", "bytes": 18234 },
    { "id": "acc", "role": "stem", "stem": "accompaniment", "path": "../「ACG」CHORUS PIANO #1 AUDIO/yama - Oz - BPM76 - Gmajor.wav", "blake3": "…" },
    { "id": "vox", "role": "stem", "stem": "vocals", "path": "../「ACG」CHORUS PIANO #1 AUDIO/yama - Oz - BPM76 - Gmajor_人声.wav", "blake3": "…" }
  ],
  "performances": [ { "id": "main", "file": "perf", "label": "原版", "noteIdentity": "smf-track-noteon-v1" } ],
  "default": { "performance": "main" },
  "layers": {
    "keys":  { "items": [ { "tick": 0, "key": "G:maj" } ], "provenance": { "origin": "imported", "tool": "filename" } },
    "hands": { "tracks": { "0": "right", "1": "left" }, "provenance": { "origin": "human" } }
  },
  "variants": [],
  "alignments": [],
  "extensions": {}
}
```

**规则**

| 项 | 规定 |
| --- | --- |
| 文件引用 | `role`：`performance`、`score`、`paper`（PDF / 图片谱）、`stem`（`vocals` / `accompaniment` / `piano` …）、`source`（原音频 / 视频）、`annotation-source`（如 POP909 的 `chord_midi.txt`）。路径相对清单，用 `/` 分隔；可带 `range`（起止秒），用于引用长音视频中的一段。每个引用记录 BLAKE3 与字节数 |
| 图层 | 沿用 3.1 的图层与来源信息（`provenance`、`confidence`、`status`）；引用音符时使用 NoteId，并与所属演奏文件的哈希绑定 |
| 兼容 | `version` 只在不兼容时递增；读写时保留未知字段与 `extensions` 原样；新增文件角色与图层不需要改版本 |
| 写入 | 原子替换（临时文件 + 重命名）；只在用户第一次修改某首歌时创建，扫描、打开、分析都不自动生成清单 |
| 一致性 | 打开时校验引用的哈希：演奏文件被外部修改 → 按 NoteId 协议重映射图层，无法映射的部分标为未匹配并提示；引用丢失 → 先在清单所在目录树内按哈希查找，找到后更新路径 |
| 生成者 | 其他工具（如 `D:\Music\_tools\music-transcription`）可以在导出时直接写清单；格式说明与 JSON Schema 放在 `docs/development/panthesia-format.md` |

**放置**

| 情况 | 位置 | Keel 中的行为 |
| --- | --- | --- |
| 单个 MIDI / MusicXML | 主文件旁边，同名：`七里香.mid` → `七里香.panthesia` | 伴生文件，随主文件移动、改名、删除 |
| 歌曲文件夹 | 文件夹根目录 `song.panthesia` | 随文件夹移动 |

**打开时的查找顺序**：打开文件 X → ① 同目录同名 `.panthesia` → ② 同目录或向上两级中引用了 X 的 `song.panthesia` → ③ 没有清单，直接演奏；第一次修改时在 X 旁边创建同名清单。打开 `.panthesia` 本身 → 按清单的 `default` 打开。

**对 `D:\Music\MIDI` 各区的覆盖（2026-11-21 实地查看）**

| 区 | 结构 | 清单形态 |
| --- | --- | --- |
| B 站曲目（如 `Ai-Ai-Ai_BV16b6RBpE6T`） | 根目录 `piano_raw.mid`、`source/` 原音视频、`stems/`、`exports/<运行>/`（`piano_raw.mid`、`score.mid`、`score.musicxml`、`piano.wav`、`vocals.wav`）、`exports/latest.json`、多次 `runs/` | 文件夹清单：引用根 MIDI、选定一次导出的谱面与人声；新的导出不自动替换，在歌曲设置中切换采用 |
| `Look at the Sky` | 根 MIDI、`versions/`（原调 / C 大调 × 自动对齐 / 乐谱量化）、`source/` mp3 | 文件夹清单：多个 `performances`，标注各自版本 |
| 周杰伦 126 首 | 每首一个文件夹，多数 1 个 MIDI，`七里香` 有 14 个版本 | 单文件时用同名清单；多版本文件夹用文件夹清单列出全部版本 |
| KAIRCI ACG | MIDI 在 `#N MIDI`，伴奏与 `_人声.wav` 在相邻的 `#N AUDIO`；含 `._` 系统文件 | MIDI 旁的同名清单，用 `../` 引用伴奏与人声；文件名中的 BPM 与调写入 `keys` / tempo 图层（来源 `filename`）；忽略 `._*` |
| Datasets（POP909、MAESTRO、Hooktheory 等） | 只读数据集，标注在旁边的 txt / json | 默认不写清单；打开时由导入器读取旁边的标注（POP909 `chord_midi.txt` 等）作为 `imported` 图层；用户修改时才创建清单 |
| SNH48 PDF 谱 | PDF、`.omr`、`.mxl`、识谱 MIDI | 文件夹清单：`paper` 引用 PDF，`score` 引用 MXL，`performance` 引用 MIDI |
| Output | 交付物与压缩包 | 不处理 |

**`.neopiece` 的新定位**：只用于导出与分享：把清单和它引用的文件打成一个包，路径改写为包内路径。导入 `.neopiece` 时解包到用户选择的文件夹，生成文件夹清单。

**与 Keel 的配合**：Keel 的 PF 阶段提供伴生文件与按类型打开方式（见 Keel `docs/进度.md` 3.6）。Panthesia 提供一个 Keel 插件，放在本仓库 `integrations/keel-plugin/`。插件只做转接：调用 `panthesia probe` 取得时长、BPM、调、轨道数、清单中的标题与已有图层，以及钢琴卷帘缩略图；登记 `.panthesia` 为伴生扩展名；注册"用 Panthesia 练习"打开方式。MIDI 与清单的解析只在 Rust 中实现一次。

## 4. 阶段

| 阶段 | 内容 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R0 基线清理 | 删除死 crate、旧原生应用、前端不可达代码、重复文档；重写计划；磁盘清理 | 构建通过；文档只有一套计划 | 已完成 |
| R1 主线瘦身 | 删除评分时代代码与历史回放（engine、core、前端 review/routines/history）、对应协议变体与 spec；删除一次性迁移代码；DuET 独立 venv 与可配置路径（存储改造与 `lib.rs` 拆分移到 R2） | `practice_policy.rs` 删除；engine < 5 万行；构建通过；真实资料可读 | 已完成（2026-11-21；`library_repairs` 移到 R2） |
| R2 清单存储与打开文件 | `.panthesia` 格式（3.7）的读写、校验、哈希修复与格式文档；打开方式（命令行、文件关联、单实例、拖入）；`probe` 命令行子命令（供 Keel 插件）；删除集中曲库（歌曲仓库、副本存储、目录缓存、导入复制）与五套存储机制，本地只留练习数据、最近打开与缓存；删除曲库、选曲、导入收件箱界面与对应协议命令；迁移真实资料；拆分 `lib.rs`（见下方 R2 任务分解） | 双击任意 MIDI / MusicXML / `.panthesia` 直接进入演奏；修改后在文件旁生成清单，移动文件夹后仍能打开；`songs.sqlite3` 与 `library/assets` 不再存在；真实资料迁移完成并核对；每个职责只有一条实现路径，模块边界清楚（`lib.rs` 只声明模块与引擎入口，播放状态、命令分派、存储、谱面各自成模块），没有只为旧机制保留的代码；`cargo test --workspace` 能跑完且全部通过 | 已完成（2026-11-21） |
| RF 前端基础 | **先删后改**：列出 `src/` 根目录约 120 个对话框与 86 个全局 CSS 文件，删除随曲库、选曲、导入、评分、历史一起失去用途的部分，再动剩下的；然后建立 tokens、基础组件、zustand store（song、playback、settings）、单一 `send()`、状态推送替代 80 ms 轮询；启动页与歌曲设置按新结构重写；留下的对话框归入 `src/screens` | 不再使用的对话框与 CSS 已删除（删除清单记入 progress.md）；`App.tsx` 只组合各屏与全局状态，不承载业务逻辑；CSS 全部基于 token，无硬编码颜色与 `!important`；不再轮询；Playwright 关键流程通过 | 基本完成（2026-11-22）：余 24 处 `!important`，随各屏视觉重做（R3）处理 |
| RO Keel 插件 | `integrations/keel-plugin/`：薄插件，调用 Panthesia 的 `probe` 子命令取得字段与钢琴卷帘缩略图（解析只在 Rust 中实现一次）；`.panthesia` 伴生登记；"用 Panthesia 练习"打开方式 | 在 Keel 中浏览 `D:\Music\MIDI` 副本能看到时长、BPM、调与缩略图；双击进入 Panthesia；在 Keel 中移动 MIDI 时清单一起移动 | 待开始（依赖 Keel PF 阶段） |
| R3 演奏舞台渲染器 | WebGL2 瀑布 + 琴键 + 光效；时钟；标签模式（含首调级数）、小节线、循环区 | 性能目标达标；视觉对照 Synthesia 与 MIDIVisualizer | 待开始 |
| R4 分层歌曲模型与统一导入 | `panthesia-notation`；Song 图层与来源信息；ABC 导入；MIDI meta（歌词、标记、调号）读入；歌曲包识别；元数据收敛；语料回归 | 第 3.6 节样本全部可导入；同一首歌从 MIDI / MusicXML / ABC 进入后都能播放、显示谱面、转调、量化 | 下一步 |
| R5 谱面显示 | 谱面窗口化、跟随、只读阅读器；从 Score IR 生成 | 长谱流畅翻页与跟随；转调后谱面与演奏一致 | 待开始 |
| R6 和声与结构分析 | 节拍、调性、和弦、段落、手别分离服务；舞台和弦 / 段落 / 歌词图层；编辑与采用 | POP909 和弦识别有基线准确率；《情话》式显示可开关；人工修改不被覆盖 | 待开始 |
| R7 伴奏音轨 | stems 识别与导入；chroma DTW 对齐；signalsmith-stretch 变速；人声 / 伴奏开关 | KAIRCI 与 B 站样本可同步播放；改 BPM 时音高不变、不漂移 | 待开始 |
| R8 虚拟双手 | 自行实现（参考公开思路，不移植无许可证代码）：骨架 + IK、穿指、换指、交叉；舞台图层 | 实际运动对照参考视频 BV1gasF6UERM | 待开始 |
| R9 自由演奏与录音 | UI08：录音、量化保存、重开 | 录音保存为歌曲后可正常练习 | 待开始 |
| R10 发布 | 打包、使用文档、来源审计、Release | 独立安装包完成一次完整练琴流程 | 待开始 |

顺序：R1 → R2 → RF → R3 为前端主干；R4 → R6 → R7 为数据主干，与前端主干并行。R5 依赖 R4；R8 依赖 R3；RO 依赖 R2 的 `probe` 子命令与 Keel 的 PF 阶段。单会话连续执行时按 R1 → R2 → RF → R4 → R3 → RO → R5 → R6 → R7 → R8 → R9 → R10 推进；RO 在 Keel PF 完成前跳过，完成后插入。

### R1 任务分解

按顺序做，每项完成即提交：

1. **评分时代命令**：`panthesia-engine/src/practice_policy.rs` 拒绝的命令（Save、Feedback、SongExpressionGoal、Ladder、Routine、ComposePassages、AcceptWeakPractice、HistoryProblemPlan、MultiProblemPlan、SongLearning）从 `protocol.rs` 删除，连同实现模块：`routine_*`（commands 1715、edit 687、loading 684、reader 231、protocol 171 行）、`ladder_commands`、`weak_practice`、`expression_goal`、`expression_review`、`song_learning`、`song_learning_evidence`、`history_problem_plan`、`history_problem_cuts`、`history_multi_plan`、`round_analysis`；core 的 `speed_ladder`。`Mode`/`Adaptive`/`LoopRestartErrors` 的归一化改为协议层只接受 wait/listen。最后删除 `practice_policy.rs`。
2. **历史回放与表现记录**（删除前把 `%APPDATA%\com.ubik.neothesia` 中对应的数据文件原样保留在备份里；R2 迁移时只原样归档、不解析，所以删除读取代码不影响迁移）：engine 的 `history_*`（loading 1028、commands 539、reader 448、replay_loading 611 等）、`performance_archive*`、`replay_*`；core 的 `practice_history`（2220 行）中仅供回放的部分；前端 `features/review/`、`HistoryDialog` 相关、`Notation.tsx` 中的 ScoreHistoryReview 与 HistoryReplayTransport、对应 spec。录音（R9 需要）与普通播放捕获不删。
3. **一次性迁移**：`legacy_exercise_history`、`legacy_exercise_tracks`、`library_migration`、`library_repairs` 及 examples 中的迁移脚本。保留 `.neothesia.ron` 与 Synthesia 资料的**导入器**（它们是导入来源，不是迁移）。先确认真实资料在当前格式下读取不依赖这些模块。
4. **`practice_backup*`**（约 4000 行）：判断是否只服务于评分历史；是则删除，否则收缩为"歌曲与资产备份"，与整歌归档（`song_archive`）合并为一条路径。
5. **存储事务合并（已移到 R2，改为删除集中曲库）**：R1 只在测试被阻塞时修复两个已知缺陷（引擎启动后长时间忙碌、`package_commands` 死锁）。原内容：`asset_edit`、`round_storage`、`pending_save`、`operation_journal`、`storage_control`、`storage_recovery`、`storage_close`、`state_order`、`state_projection` 及桌面端 `desktop_close.rs`。目标：SQLite 事务 + 内容寻址文件 + 一个写入服务；关窗只等待这一个服务。同时修复两个已知缺陷：引擎启动后长时间处于忙碌状态、拒绝普通命令（`storage_control::check_command`，导致约 120 个 engine 测试失败）；`package_commands` 测试死锁。完成标准：`cargo test --workspace` 能跑完且全部通过。
6. **拆分 `lib.rs`**：移到 R2 第 5 项，在删除集中曲库之后进行，避免先拆出 library、annotations 模块再删除。
7. **前端残留**：删除对已删命令的调用、`api.ts` 中对应函数、生成协议后不再存在的类型；`npm run protocol:generate` 重新生成。
8. **后台工具**：DuET 使用独立 venv；`duet_runtime.rs` 中 Python 与模型路径改为设置项，删除 `D:\cs\...` 硬编码默认值。
9. **收尾**：清除全部 dead-code 警告；更新 `architecture-decisions.md` 中与已删模块相关的条目。

### R2 任务分解

1. **格式**：`docs/development/panthesia-format.md` 与 JSON Schema；Rust 类型（serde，保留未知字段）；读、校验、原子写；哈希校验与目录树内修复；NoteId 重映射接入。单元测试覆盖 3.7 表中每一区的样例清单（在 `work/` 下的语料副本上生成）。
2. **打开**：命令行参数、文件关联、单实例转交、拖入；查找顺序按 3.7；没有清单时直接演奏；首次修改时创建同名清单。
3. **歌曲设置**：在现有界面上接入清单：编辑版本选择、轨道与手别、谱面配对、伴奏文件、段落与书签，保存即写清单（界面结构的重写在 RF）。
4. **`probe` 子命令**：`panthesia probe <路径> --json [--thumbnail <png 路径>]`，输出时长、BPM、调、轨道数、已有清单中的标题与图层，可选生成钢琴卷帘缩略图；不启动窗口。
5. **删除集中曲库并拆分 `lib.rs`**：`song_repository`、`import_storage` 副本存储、`song_catalog` / `catalog_rows`、`library-workspace.json`、`library-monitor-files.json`、`locations`、五套存储机制（`asset_edit`、`round_storage`、`pending_save`、`operation_journal`、`storage_control`、`storage_recovery`、`storage_close`、`state_order`、`state_projection`、`desktop_close.rs`）；本地新增练习数据目录（历史、时长、上次速度与位置、最近打开，按 BLAKE3 关联）与缓存目录。同时消除启动忙碌与 `package_commands` 死锁。删除完成后拆分 `lib.rs`：`Player` 与命令分派分离，按领域分模块（manifest、playback、sound、notation、open、practice）。
6. **迁移真实资料**（用户 2026-11-21 已授权，执行时不再询问；先在备份副本上跑通，再对真实资料执行）：
   - 有用户数据的歌曲（2026-11-21：轨道分配 15 首、谱面配对 5 首、元数据 5 首；`web-preferences.json` 中段落、书签、变调与量化、会话设置约 12 首）：在其原始位置（`locations` 中仍存在的路径，优先 `D:\Music\MIDI`）旁写清单。
   - 只存在于副本存储、找不到原文件的歌曲：连同清单导出到 `D:\Music\MIDI\Panthesia导出\`。
   - 练习历史与时长：主线仍能读取的数据（时长、会话设置）转入新的本地练习数据目录；R1 已删除读取代码的历史回放数据原样归档到练习数据目录的 `legacy/`，不解析。
   - 15 个未匹配的旧身份原样保留在备份中，不合并。
   - 核对：每首迁移歌曲能从新位置打开，图层与设置一致；核对通过后移除旧 `library/`（备份保留）。
7. **前端清理**：删除曲库、选曲、导入收件箱等界面与对应协议命令；启动页提供最近打开与打开文件。前端结构重写在 RF。

## 5. 固定约束（用户决定）

- 曲库管理由 Keel 承担，Panthesia 不做曲库界面（2026-11-21 起，取代同日"Serpent 式三栏工作台"的决定）。Panthesia 只有启动页、歌曲设置与演奏舞台；演奏舞台保留 Synthesia 式布局（参考图 `work/original-product-reset/references`，不随包分发），美术自行设计。Panthesia 品牌、简体中文。
- 数据跟随文件：歌曲数据写在文件旁的 `.panthesia` 清单中（3.7）；本地只保存练习历史、最近打开与缓存。技术栈保持 Rust + Tauri + React。
- 速度单位为 BPM。
- 删除"入门练习"分类与八秒试听。
- 文件操作放在右键菜单（资源管理器定位、查看版本）。
- 主线只有连续播放与等待按键两种模式。评分、达标、日课、晋级、历史回放与表现记录只在 `feature/assessment-lab`。
- 数据不要求完整：缺少的图层不阻塞练习，界面只显示存在的内容。
- 后台能力（转录、分离、DuET、分析、转调量化、扫描）只从歌曲设置或全局设置的二级入口进入；演奏舞台不放任务卡、版本栏、诊断信息。
- 按文件实际状态打开；清单引用的文件缺失时在歌曲设置中标记，不阻塞演奏。
- 皮肤、特效、标签、和弦、歌词图层在"显示"设置中开关。
- 虚拟双手自行实现；不复制或移植 pygame-piano-animator（无许可证）的代码、参数与权重。
- 浏览器调试模式保留，收在单一 `send()` 之后。
- 用户 MIDI、谱面、标注、设置、录音必须保护；迁移可回退。15 个未匹配的旧身份保留，不按标题合并。
- 不推送、不发布，除非用户明确要求。
- 验收看软件质量：架构清楚、职责单一、代码好读、行为正确。行数、文件数等数字只用来发现可能的冗余，不作为目标，不为凑数字删除有用的功能或压缩可读性（2026-11-21 用户决定）。

## 6. 待核对

- 本地 Transkun 权重 `D:\Music\_tools\_reference\Transkun\transkun\pretrained\2.0.pt` 是否为带踏板的 V2（pip 默认的 No Pedal Ext 不输出踏板）。
- `D:\Music\MIDI` 中 B 站项目 `result.json` 的 `midi` 字段指向已失效的旧路径，导入时以目录内实际文件为准。

## 7. 工作方式

- 每轮推进一个阶段内的一批完整改造，接入后同步删除旧路径，不让同一职责长期两套并行。
- 检查以快速推进为准：每批构建通过即可；阶段结束时跑相关 crate 测试、实际打开一次；语料回归与视觉对照只在对应阶段（R4、R3）结束时做一次。
- 每轮结束在 [progress.md](progress.md) 记一条：日期、提交、完成内容、下一入口。