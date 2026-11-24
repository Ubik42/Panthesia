# Panthesia 开发计划

版本：2026-11-22 / 5。本文件是唯一任务队列与长期目标。进度流水写在 [progress.md](progress.md)；界面规范见 [interface-design.md](interface-design.md)；调研依据见 [research-2026-11.md](research-2026-11.md)。已完成阶段的任务分解在 git 历史中（提交 86902bd 及之前的本文件）。

## 1. 长期目标

Panthesia 是开源的 Windows 钢琴练习软件。核心是好的练琴体验，数据有什么用什么。

**定位（2026-11-21 用户决定）**：Panthesia 是“打开一首歌就能练”的专用程序，不做曲库管理。曲库的浏览、整理、标签由通用文件库 Keel（`D:\Manage\_tools\Keel`）承担；Keel 把 MIDI、MusicXML 与 `.panthesia` 的打开方式指向 Panthesia。歌曲数据跟着文件走，写在文件旁的 `.panthesia` 清单中（3.6）。技术栈保持 Rust + Tauri + React。

1. **练琴体验**：打开文件即进入歌曲页，一键开始演奏。瀑布、琴键、光效、虚拟双手、和弦级数、歌词、五线谱在一个流畅的舞台中，每个图层可以分别开关。
2. **一首歌的全部资料一目了然**：演奏 MIDI、五线谱（MusicXML / ABC / PDF）、原曲音频、人声与伴奏分轨、各个图层都在歌曲页上列出；缺少的资料能从已有资料生成。Keel 中看到的歌曲信息与 Panthesia 歌曲页一致。
3. **统一来源**：MIDI、MusicXML、ABC、音频转录结果进入同一个歌曲模型；派生版本对任意来源都可用。
4. **可靠的资料**：歌曲、标注和设置不会因文件移动、版本变化或重新分析而丢失；人工修改永远不被自动结果覆盖。数据与文件放在一起，换机器、换软件、用 Git 都能带走。

## 2. 当前状态（2026-11-22）

R0–R10 与 RO 已完成（第 4 节）：集中曲库已删除，数据跟随文件；引擎按领域拆分；前端状态由引擎推送；瀑布为 WebGL2；ABC、MusicXML、MIDI 导入统一；和弦、调性、段落分析；伴奏分轨同步与变速；虚拟双手；自由演奏录音；运行包与 Keel 插件。

主要问题在界面：启动页与歌曲设置仍是早期按 Synthesia 截图复刻的结果（2026-11-22 用户说明：复刻是开发初期交互能力不足时的权宜做法），一首歌有哪些资料、缺什么、能生成什么，在界面上看不到；演奏舞台的段落与小节标注、五线谱区域和设置弹窗也需要重新设计。第 4 节 RS–RP 处理这些问题。

## 3. 目标架构

### 3.1 分层歌曲模型

```
Song
├─ sources[]        原始文件（MIDI / MusicXML / ABC / 音频 / PDF），内容哈希
├─ performances[]   可播放演奏（tick 事件、NoteId）；至少一份
├─ variants[]       派生：转调、量化、速度——对 performance 与 score 的纯函数，可重算
├─ scores[]         Score IR（小节、声部、记号）；可选
├─ alignments[]     score ↔ performance（ScoreEventId ↔ NoteId）；audio ↔ performance（tick → 秒映射）
└─ layers           全部可选，统一使用 performance 的 tick 时基
   ├─ hands         轨道手别、逐音覆盖
   ├─ fingering     逐音指法、换指
   ├─ sections      段落（前奏 / 主歌 / 副歌）
   ├─ keys          调性分段
   ├─ chords        和弦（Harte 语法）；级数由 chords + keys 派生显示
   ├─ lyrics        歌词行与时间
   ├─ beats         拍与小节线（转录 MIDI 的节拍追踪结果）
   └─ stems         伴奏音频（人声、原曲、伴奏），经 alignment 同步
```

每个图层条目带来源信息：`provenance`（`human` / `imported` / `generated`、工具、版本、参数哈希、时间）、`confidence`（仅 generated）、`status`（`draft` / `accepted`）、`dependsOn`。

规则：

- 人工结果（`human`）不被自动重算覆盖；`generated` 结果在工具版本变化时可重算。
- 图层存在与否决定界面：没有的图层不显示结果，只在歌曲页给出“生成”入口。
- 外部文件按内容哈希关联，改名、移动后仍匹配。

### 3.2 歌曲资料与生成

一首歌的资料分为七类，歌曲页与 Keel 插件使用同一份汇总（引擎 `song_summary`，`probe --json` 输出同一结构）：

| 资料 | 来源 | 可以从什么生成 |
| --- | --- | --- |
| 演奏 MIDI | 主文件或清单中的 performance | 原曲音频 → 转录（外部 Transkun） |
| 五线谱 MusicXML | 清单中的 score，或同名 `.musicxml` / `.mxl` | 演奏 MIDI → Score IR → MusicXML（引擎内）；外部 DuET 谱面 |
| ABC 谱 | 同名 `.abc` | Score IR → ABC（引擎内） |
| 谱页 PDF | 清单中的 paper | — |
| 原曲音频 | 清单中的 source，或同名音频 | — |
| 人声 | stem `vocals`，或 `*_人声.wav` / `vocals.wav` | 原曲音频 → 分离（外部 BS-RoFormer） |
| 伴奏 | stem `accompaniment` 等 | 原曲音频 → 分离 |

生成的文件写在歌曲文件旁边，登记到清单（`provenance.origin = generated`），不覆盖已有文件。外部工具（`D:\Music\_tools\music-transcription`：分离 → 转录 → DuET）只通过后台任务调用，位置在设置中配置；工具不存在时生成入口说明原因。

### 3.3 分析服务（后台，可选）

在 Rust 引擎内实现，结果写入图层（`origin: generated`）：

| 服务 | 方法 | 输出图层 |
| --- | --- | --- |
| 节拍追踪 | 转录 MIDI 无可靠 tempo map 时：onset 间隔 + 动态规划 | beats |
| 调性 | Krumhansl-Schmuckler 窗口估计 + 转调惩罚平滑 | keys |
| 和弦 | 拍段音级分布（低音加权）+ 模板匹配 + Viterbi 平滑 | chords |
| 段落 | 小节自相似矩阵 + novelty 边界 + 聚类命名 | sections |
| 手别分离与指法 | 演奏约束规划器：跨度、按住的键、移动速度、双手交错、音型；与虚拟双手共用约束 | hands、fingering |
| 伴奏对齐 | 起音直方图对齐；后续 chroma DTW | alignments |

外部 Python 工具（Transkun 2.0.1、BS-RoFormer-SW、DuET）只通过后台适配器调用：每个工具独立 venv，路径在设置中配置，不硬编码，不静默下载模型。

### 3.4 引擎

- 主线只保留练琴所需：打开文件、清单读写、播放会话、声音、记谱、分析、资料生成。评分与历史回放在 `feature/assessment-lab`。
- 没有集中曲库：打开文件时直接读原文件，不复制。本地只保存练习历史与时长、每首歌上次的速度与位置、最近打开列表（按演奏文件的 BLAKE3 关联），以及可重算的缓存。
- 状态推送：引擎发出状态帧与任务列表，前端通过 Tauri 事件订阅（浏览器调试为长轮询）。
- 音频：伴奏音轨经 Signalsmith Stretch 保持音高变速；伴奏开启时音频样本位置为主时钟。

### 3.5 前端

规范见 [interface-design.md](interface-design.md)。要点：

- **三个界面**：启动页（最近打开、打开文件、自由演奏）、歌曲页（资料、图层、练习方式与开始）、演奏舞台（全屏）。
- **状态**：领域状态用 `useSyncExternalStore` 外部 store（`playbackStore` 按字段订阅），应用级状态由 `app/useAppModel` 组合后经 `AppContext` 提供。
- **传输**：`api.ts` 中 `call()` 在 Tauri 命令与 HTTP 服务间选择；协议类型由 Rust 生成。
- **设计系统**：`tokens.css` 单一来源，组件样式只用 token；`src/` 根目录不放业务组件。
- **舞台渲染器**：WebGL2 负责瀑布与光效，Canvas 2D 负责琴键、标签与回退。性能目标：19,200 音符负载下 60 Hz 稳定。

### 3.6 数据跟随文件：`.panthesia` 清单

格式、写入时机与 `probe` 命令行见 [panthesia-format.md](panthesia-format.md)（JSON Schema：[panthesia-format.schema.json](panthesia-format.schema.json)）。要点：

- 单个乐曲文件用同名清单（`七里香.mid` → `七里香.panthesia`）；歌曲文件夹用根目录 `song.panthesia`。
- 只在用户第一次修改某首歌时创建；扫描、打开、分析不生成清单。写入一律原子替换，未知字段原样保留。
- 打开文件 X 的查找顺序：同名清单 → 同目录或向上两级中引用了 X 的 `song.panthesia` → 没有清单直接演奏。

**对 `D:\Music\MIDI` 各区的覆盖（2026-11-21 实地查看）**

| 区 | 结构 | 清单形态 |
| --- | --- | --- |
| B 站曲目（如 `Ai-Ai-Ai_BV16b6RBpE6T`） | 根目录 `piano_raw.mid`、`source/` 原音视频、`stems/`、`exports/<运行>/`（`piano_raw.mid`、`score.mid`、`score.musicxml`、`piano.wav`、`vocals.wav`）、`exports/latest.json`、多次 `runs/` | 文件夹清单：引用根 MIDI、选定一次导出的谱面与人声；新的导出不自动替换，在歌曲页切换采用 |
| `Look at the Sky` | 根 MIDI、`versions/`（原调 / C 大调 × 自动对齐 / 乐谱量化）、`source/` mp3 | 文件夹清单：多个 `performances`，标注各自版本 |
| 周杰伦 126 首 | 每首一个文件夹，多数 1 个 MIDI，`七里香` 有 14 个版本 | 单文件时用同名清单；多版本文件夹用文件夹清单列出全部版本 |
| KAIRCI ACG | MIDI 在 `#N MIDI`，伴奏与 `_人声.wav` 在相邻的 `#N AUDIO`；含 `._` 系统文件 | MIDI 旁的同名清单，用 `../` 引用伴奏与人声；文件名中的 BPM 与调写入图层（来源 `filename`）；忽略 `._*` |
| Datasets（POP909、MAESTRO、Hooktheory 等） | 只读数据集，标注在旁边的 txt / json | 默认不写清单；打开时读取旁边的标注作为 `imported` 图层 |
| SNH48 PDF 谱 | PDF、`.omr`、`.mxl`、识谱 MIDI | 文件夹清单：`paper` 引用 PDF，`score` 引用 MXL，`performance` 引用 MIDI |

### 3.7 测试语料

本地 `D:\Music\MIDI`（不入库，只读，许可各异）：

| 用途 | 样本 |
| --- | --- |
| 完整分层歌曲 | `B站纯钢琴演奏视频转MIDI/Ai-Ai-Ai_BV16b6RBpE6T/exports/<run>/` |
| 多版本 | `B站纯钢琴演奏视频转MIDI/Look at the Sky - Porter Robinson - MIDI/` |
| 伴奏同步 | `KAIRCI ACG …/「ACG」CHORUS PIANO #1_/`（`yama - Oz - BPM76 - Gmajor.mid` + 同名 `.wav` + `_人声.wav`） |
| 多版本归并 | `周杰伦midi  126首/七里香/` |
| 和弦识别真值 | `Datasets/POP909-Dataset/POP909/001/` |
| 踏板与长曲 | `Datasets/Classical_Performance_MAESTRO/` |
| 识谱边界 | `SNH48钢琴PDF谱/PDF转MIDI/海砂.mid`、`海砂.mxl` |
| 解析鲁棒性 | `Datasets/Classical_Transcription_GiantMIDI/midis/`、`Open_Pop_Style/` |

## 4. 阶段

### 已完成

| 阶段 | 内容 | 完成 |
| --- | --- | --- |
| R0 基线清理 | 删除死 crate、旧原生应用、重复文档 | 2026-11-21 |
| R1 主线瘦身 | 删除评分时代代码与历史回放、一次性迁移；DuET 独立 venv | 2026-11-21 |
| R2 清单存储与打开文件 | `.panthesia` 格式；命令行、文件关联、单实例、拖入；`probe`；删除集中曲库与五套存储机制；迁移真实资料；拆分 `lib.rs` | 2026-11-21 |
| RF 前端基础 | 删除失去用途的界面；tokens、状态推送、App 拆分 | 2026-11-22 |
| R3 演奏舞台渲染器 | WebGL2 瀑布、琴键、光效；慢机器模拟下绘制 p99 3.9 ms | 2026-11-22 |
| R4 分层歌曲模型与统一导入 | `panthesia-notation`；ABC 导入；MIDI meta 图层；歌曲包识别 | 2026-11-22 |
| R5 谱面显示 | 谱面窗口化、跟随、适合宽度重排；统一 Score IR 写出器 | 2026-11-22 |
| R6 和声与结构分析 | 和弦、调性、段落、歌词图层；POP909 根音 84.7%、主调 84.9% | 2026-11-22 |
| R7 伴奏音轨 | stems 识别与导入；起音对齐；Signalsmith Stretch 变速 | 2026-11-22 |
| R8 虚拟双手 | 骨架 + IK、穿指、换指、交叉；缺手别与指法时自动规划 | 2026-11-22 |
| R9 自由演奏与录音 | 录音速度与节拍器、保存到文档目录、量化 | 2026-11-22 |
| R10 发布准备 | 运行包、使用说明、来源审计 | 2026-11-22（公开发布受内置音色库许可阻塞，待用户决定，见 [sources-and-licences.md](sources-and-licences.md)） |
| RO Keel 插件 | `probe` 缩略图与歌曲信息；`.panthesia` 伴生登记 | 2026-11-22 |

### 进行中与待做

| 阶段 | 内容 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| RD 工程与文档整理 | 合并过时与重复的开发文档；删除旧批次证据与失效脚本、未用资源；更新 README 与文档站 | 每份文档只有一个职责，内容与当前代码一致；仓库中没有失去用途的文件 | 已完成（2026-11-22） |
| RS 歌曲页与资料 | 引擎 `song_summary`（事实、资料、图层，供歌曲页与 `probe`）；资料生成：MusicXML、ABC（引擎内），转录与分离（外部工具后台任务）；新歌曲页取代歌曲设置与“歌曲文件与版本”对话框；启动页重做 | 打开任意歌曲能看到七类资料的有无、文件与来源；能从 MIDI 生成 MusicXML 与 ABC 并在旁边保存、登记；配置外部工具后能从原曲生成 MIDI 与人声；旧歌曲设置界面删除 | 已完成（2026-11-22）：外部工具的转录与分离未用真实模型跑通（需 GPU 长时间运行），只验证了调用与登记路径；声部设置、分手、全局设置等二级页面仍是旧的浅色样式 |
| RK Keel 插件同步与美化 | `probe` 读取清单与同文件夹资料，输出与歌曲页相同的汇总；插件读取伴生清单与同文件夹资产；歌曲信息改为插件自带的 HTML 对话框，视觉与歌曲页一致 | Keel 中歌曲信息与 Panthesia 歌曲页的事实、资料、图层一致 | 已完成（2026-11-22）：歌曲信息用 Keel 原生对话框组件；插件 HTML 对话框在当前 Keel 中宽度为 0（Keel 缺陷，见进度记录） |
| RP 演奏舞台排版与设置 | 段落与小节编号移到右侧；默认不显示拍号；有段落时小节按段内序号编号；五线谱一次显示一行，去掉内嵌滚动区；设置弹窗重新排版 | 规范 [interface-design.md](interface-design.md) 第 4 节逐项达到 | 已完成（2026-11-22） |

| RA 默认量化与自动分析 | 打开 MIDI 默认使用量化版本（原始时值由用户选择）；首次打开自动生成分手、指法、段落、和弦草稿并标记“待检查” | 新 MIDI 打开后清单有四个 `generated`/`draft`/`review: "pending"` 图层与量化设置；歌曲页显示“待检查” | 已完成（2026-11-22） |

| RU 界面统一与架构重整 | 按 [interface-design.md](interface-design.md) 第 6 节：一个路由；设置页改为单页分区并取代显示 / 设备对话框；歌曲二级页（声部与手别、转调与量化、谱面资料）与自由演奏改用新视觉；舞台工具条合并弹出面板；删除应用菜单栏、旧皮肤、三套“未完成工作”视图与旧样式表；对话框与弹出面板各一种实现；拆分 `useAppModel`；谱面逐行渲染 | 没有界面使用旧样式表（`style.css` 旧段、`dailyTheme.css`、`synthesiaLayout.css`、`instrumentSkins.css`、`productScreens.css`）；每个全局设置只有一个修改位置；全屏缩放正确 | 已完成（2026-11-23）：一个路由与对话框、练习界面 store（zustand）；前端分层（`lib/`、`ui/legacy/`，页面不读应用 Context，`useAppModel` 只是应用层组合根）；设置页单页分区；主界面顶栏 + 双列卡片，歌曲详情为滑出面板；二级页与自由演奏新设计；舞台工具条三个面板；全部对话框为 `ui/Dialog`；`main.tsx` 加载的 9 个旧样式表删除，规则归到组件旁（逐元素核对计算样式不变），共用旧工具类留在 `ui/legacy/legacyBase.css`。Keel 插件“开始练习”直达舞台（`--play`、`locate`）。未做：`legacyBase.css` 与组件旁旧规则中的调色板变量改为语义 token；`--play` 未在真实单实例下实测 |

顺序：RD → RS → RK → RP → RU。RK 依赖 RS 的 `song_summary`。

### 待办（不排期，按需插入）

- 伴奏对齐结果写入清单 `alignments`（目前每次打开重新计算）；乐谱时值版本与真实演奏间的 DTW 对齐。
- 伴奏与合成器共用输出设备选择（伴奏目前用系统默认设备）。
- 节拍追踪（转录 MIDI 的拍点估计）。
- 多轨录音（左右手分开录）。
- 虚拟双手：对照参考视频 BV1gasF6UERM 逐段校对；手腕弹跳与前臂旋转。
- 安装程序与文件类型关联（当前为便携运行包）；公开发布（需用户确认音色库方案）。
- 二级页面（声部与乐器、分手、全局设置、各编辑对话框）改用新的视觉语言。
- 用真实模型跑通一次转录与分离。
- AI 检查润色：读取 `review: "pending"` 的图层，给段落命名（主歌、副歌…）、修正不合理的指法与分手、核对和弦，写回后把 `review` 改为 `"ai"`。入口放在歌曲页。
- 量化版本下编辑节拍网格与演奏细节（力度、踏板等）：目前需先切回原始时值。指法与分手已可在量化版本下编辑。
- 指法评测：PIG 数据集只对学术机构 IP 开放下载，需向作者邮件申请；拿到后与教科书评测（`cargo run -p panthesia-core --example fingering_bench --release`）一起使用，再在 PIG 上学习规则权重。

## 5. 固定约束（用户决定）

- 曲库管理由 Keel 承担，Panthesia 只有启动页、歌曲页与演奏舞台。Panthesia 品牌、简体中文。
- 曲目文件夹索引（2026-11-22 用户决定）：启动时扫描设置的曲目文件夹（`D:\Music\MIDI`），在其 `索引库` 子文件夹为每个 `.panthesia` 放一个快捷方式（用 Panthesia 打开），启动页提供搜索。曲目文件夹本身只读；`索引库` 归 Panthesia 管理。
- 界面自行设计，不再以 Synthesia 截图为准（2026-11-22 起，取代 2026-11-21 的“演奏舞台保留 Synthesia 式布局”）。演奏舞台保留顶部工具条、时间线、谱面、瀑布、琴键的上下顺序。
- 数据跟随文件：歌曲数据写在 `.panthesia` 清单中；本地只保存练习历史、最近打开与缓存。技术栈保持 Rust + Tauri + React。
- 速度单位为 BPM。
- 主线只有连续播放与等待按键两种模式。评分、达标、日课、晋级、历史回放与表现记录只在 `feature/assessment-lab`（保存点 ca4aeb5，未推送）。
- 数据不要求完整：缺少的资料与图层不阻塞练习，演奏舞台只显示存在的内容；生成入口放在歌曲页。
- 后台能力（转录、分离、DuET、分析、转调量化）从歌曲页或设置进入；演奏舞台不放任务卡、版本栏、诊断信息。
- 按文件实际状态打开；清单引用的文件缺失时在歌曲页标记，不阻塞演奏。
- 虚拟双手自行实现；不复制或移植 pygame-piano-animator（无许可证）的代码、参数与权重。
- 浏览器调试模式保留，收在单一 `call()` 之后。
- 用户 MIDI、谱面、标注、设置、录音必须保护；迁移可回退。
- 不推送、不发布，除非用户明确要求。
- 验收看软件质量：架构清楚、职责单一、代码好读、行为正确。行数、文件数等数字只用来发现可能的冗余，不作为目标（2026-11-21 用户决定）。

## 6. 待核对

- 本地 Transkun 权重 `D:\Music\_tools\_reference\Transkun\transkun\pretrained\2.0.pt` 是否为带踏板的 V2。
- `D:\Music\MIDI` 中 B 站项目 `result.json` 的 `midi` 字段指向已失效的旧路径，导入时以目录内实际文件为准。

## 7. 工作方式

- 每轮推进一个阶段内的一批完整改造，接入后同步删除旧路径，不让同一职责两套并行。
- 检查以快速推进为准：每批 `cargo check --workspace --all-targets` 与 `npm run build` 通过即可；阶段结束时跑相关 crate 测试并实际打开一次桌面构建。
