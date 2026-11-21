# Panthesia 开发计划

版本：2026-11-21 / R0。本文件是唯一任务队列与长期目标。进度流水写在 [progress.md](progress.md)。旧 B00–B07 计划已结束，内容在 git 历史（`main` 分支 9561452 之前）。

## 1. 长期目标

Panthesia 是开源的 Windows 钢琴练习软件。三项核心：

1. **练琴体验**：交互逐屏参照 Synthesia（主页 → 选曲 → 歌曲设置 → 演奏），视觉质量高于参照：瀑布、琴键、光效和虚拟双手统一在一个流畅的舞台中。
2. **统一音乐模型**：MIDI、MusicXML、ABC 进入同一个歌曲模型。演奏、五线谱、量化版本和转调全部从这个模型派生，在任意来源上都可用。
3. **可靠的歌曲资料**：歌曲、标注（手别、指法）和设置不会因文件移动或版本变化而丢失。

## 2. 现状诊断（2026-11-21 扫描）

| 区域 | 规模 | 主要问题 |
| --- | --- | --- |
| 前端 `panthesia-web/src` | 约 11.4 万行，470 个可达文件 | `App.tsx` 1578 行，55 个 useState，状态靠 props 逐层下传；两套导航（workspace 与 productScreens）叠加；`src/` 根目录约 120 个散落的大对话框；86 个全局 CSS 文件互相覆盖，硬编码颜色约 2400 处，`--accent` 被定义两次；80 ms 轮询后端状态；`api.ts` 每个功能写 Tauri 与 HTTP 两遍 |
| 引擎 `panthesia-engine` | 约 7.6 万行 | `lib.rs` 4438 行；评分时代代码约 1 万行仍编译，运行时由 `practice_policy.rs` 拒绝；五套"意图文件 + 恢复"存储机制并存；一次性迁移代码仍在主路径 |
| 核心 `panthesia-core` | 约 2.6 万行 | 乐谱 IR、练习判定、历史、练习曲生成、曲库格式混在一个 crate；`song_project`、`repertoire`、`library::SongSidecar`、`song_catalog` 四套类型描述同一件事 |
| 音乐模型 | — | 演奏模型（`panthesia-music::MidiFile`）与乐谱模型（`core::musicxml::Score`）并行，由对齐表连接；MIDI 生成谱面时直接输出 MusicXML 文本，不经过 Score IR；**ABC 导入不存在**（全仓库没有 ABC 解析器） |
| 测试 | 110 个 Playwright spec | 需要手动启动 Vite 与 HTTP 引擎服务；依赖中文文案与 CSS 类名；部分 spec 针对已删 UI |
| 文档 | 原 90 份开发文档 | 计划、Goal、交接、证据和日志互相重复；已在 R0 收敛 |

保留价值高的部分：`panthesia-music`（tick 时间、稳定 NoteId）、PlaybackSession 实时会话、SQLite 歌曲仓库与内容寻址资产、MusicXML 解析与反复展开、Verovio 渲染链、MIDIVisualizer 光效着色器、Synthesia 参考截图与交互规范。

## 3. 目标架构

### 3.1 统一音乐模型

```
导入器                     歌曲模型 Song                         派生与输出
MIDI ──────┐         ┌─ Performance（tick 事件、NoteId）─┐
MusicXML ──┼─► Song ─┤                                    ├─► Variant(转调/量化) ─► 播放、瀑布
ABC ───────┘         ├─ Score IR（小节、声部、记号）      │
                     ├─ Alignment（ScoreEventId ↔ NoteId）├─► Score IR ─► MusicXML ─► Verovio
                     └─ Annotations（手别、指法、段落）   ┘
```

- 新 crate `panthesia-notation`：从 `core::musicxml` 拆出 Score IR、MusicXML 读写、反复展开（`score_playback`）、Score→Performance（`score_performance`）、对齐（`score_alignment`）。
- 所有导入器输出 `Song`。MIDI 来源用量化 + 声部分离生成 Score IR；MusicXML 与 ABC 解析为 Score IR 后生成 Performance。
- 谱面渲染只有一条路：Score IR → MusicXML → Verovio。`practice_engraving` 改为输出 Score IR。
- 转调与量化是 `Variant` 对 Performance 和 Score IR 的纯函数，原始版本始终可返回。转调同时修改调号与拼写。
- 歌曲元数据收敛为一套类型，替换 `song_project` / `repertoire` / `SongSidecar` / `song_catalog`。

### 3.2 引擎

- 主线只保留练琴所需：导入、歌曲仓库、播放会话、声音、记谱、标注。评分时代模块从主线删除（保存在 `feature/assessment-lab`）。
- 一套存储事务：SQLite 事务 + 内容寻址文件，替换 `asset_edit` / `round_storage` / `pending_save` / `operation_journal` / `storage_*` 五套机制。
- `lib.rs` 按领域拆分为命令分派与各服务模块。
- 状态从轮询改为推送：引擎发出状态帧，前端通过 Tauri 事件订阅。

### 3.3 前端

- **外壳**：`AppShell` + 一个屏幕状态机（Home / SongSelect / SongSetup / Tracks / HandSplit / Play / FreePlay / Settings）。删除 workspace 层。
- **状态**：按领域划分的少量 store（song、playback、settings、library），组件直接订阅，不逐层传 props。
- **传输**：`api.ts` 只有 `send(command)` 一个出口，传输方式在启动时选定一次。
- **设计系统**：`tokens.css` 单一来源（颜色、间距、圆角、字体、动效时长）；基础组件 Button、IconButton、Toggle、Slider、Select、Popover、Menu、Dialog、List、Card；组件样式与组件同目录，只用 token，不写硬编码颜色和 `!important`。
- **目录**：`src/app`（外壳、路由、store）、`src/ui`（基础组件）、`src/screens/<屏幕>`、`src/stage`（演奏舞台渲染）、`src/notation`、`src/engine`（协议与传输）。`src/` 根目录不放业务组件。
- **视觉方向**：深色舞台、高对比的瀑布和琴键，动效有物理感（按键下沉、光晕衰减、粒子）。参照 Synthesia 的布局与层级，不照搬其低分辨率质感。

### 3.4 演奏舞台

- 一个 WebGL2 渲染器负责瀑布、琴键、光效（实例化绘制），Canvas 2D 只作回退。替换当前 `Piano.tsx` 中 500 行的 Canvas 2D 绘制闭包。
- 渲染时钟由引擎状态帧外推，与 React 渲染分离。
- 性能目标：19,200 音符负载下 60 Hz 稳定，P99 帧时间 < 16.7 ms；高刷新率屏幕跟随显示器频率。
- 虚拟双手作为舞台的一个图层，从歌曲手别、指法与播放时间采样姿态。

## 4. 阶段

| 阶段 | 内容 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| R0 基线清理 | 删除死 crate、旧原生应用、前端不可达代码、重复文档；重写计划 | 工作区与前端构建通过；文档只有一套计划 | 已完成 |
| R1 主线瘦身 | 删除评分时代代码（engine 约 1 万行、前端 review/routines/history 相关）、对应协议变体与 spec；合并存储事务；拆分 `lib.rs`；删除一次性迁移代码 | `practice_policy.rs` 不再需要；engine < 5 万行；构建通过；真实资料可读 | 待开始 |
| R2 前端骨架与设计系统 | tokens、基础组件、AppShell、屏幕状态机、领域 store、单一传输、状态推送；四个主屏重写 | `App.tsx` < 300 行；CSS 全部基于 token；主流程四屏按参照图重做并通过人工视觉验收 | 待开始 |
| R3 演奏舞台渲染器 | WebGL2 瀑布 + 琴键 + 光效统一渲染；时钟；标签、小节线、循环区 | 性能目标达标；视觉对照 Synthesia 与 MIDIVisualizer 参照 | 待开始 |
| R4 统一音乐模型 | `panthesia-notation`；ABC 导入；MIDI→Score IR；Variant 作用于所有来源；元数据收敛 | 同一首歌从 MIDI / MusicXML / ABC 导入后都能播放、显示谱面、转调、量化；语料回归测试通过 | 待开始 |
| R5 谱面显示 | 谱面窗口化、跟随、只读阅读器；从 Score IR 生成 | 长谱流畅翻页与跟随；转调后谱面与演奏一致 | 待开始 |
| R6 虚拟双手 | 舞台手部图层：IK、穿指、换指、交叉 | 见第 6 节授权问题；实际运动对照参考视频 | 受阻 |
| R7 自由演奏与录音 | UI08：录音、量化保存、重开 | 录音保存为歌曲后可正常练习 | 待开始 |
| R8 发布 | 打包、使用文档、来源审计、Release | 独立安装包完成一次完整练琴流程 | 待开始 |

顺序：R1 → R2 → R3 为主干。R4 可在 R2 期间并行（后端独立）。R5 依赖 R4。

## 5. 固定约束（用户决定）

- 前端布局、层级、导航参照 Synthesia 官方截图（`work/original-product-reset/references`，不随包分发）。Panthesia 品牌、简体中文。
- 速度单位为 BPM。
- 删除"全部歌曲""入门练习"分类、八秒试听、常驻预览侧栏。
- 文件操作放在右键菜单（资源管理器定位、查看版本）。
- 主线只有连续播放与等待按键两种模式。评分、达标、日课、晋级只在 `feature/assessment-lab`。
- DuET、音频转谱、转调量化、谱面准备、扫描在后台运行，只从歌曲设置或全局设置的二级入口进入；演奏舞台不放任务卡、版本栏、诊断信息。
- 选曲直接按文件实际状态打开；缺失只在曲目行标记。
- 皮肤与特效在"显示"设置中调整。
- 用户 MIDI、谱面、标注、设置、录音必须保护；迁移可回退。15 个未匹配的旧身份保留，不按标题合并。
- 不推送、不发布，除非用户明确要求。

## 6. 待用户决定

1. **虚拟双手授权**：参考仓库 V9011N/pygame-piano-animator（提交 ae8ae03）没有许可证文件。没有许可证时，复制或移植其代码（`hands.py` 等）进入 GPL 开源仓库不合法。可选：(a) 联系作者取得许可（推荐 MIT 或 GPL 兼容）；(b) 只参考公开思路，自行实现同等质量的 IK 手部；(c) 暂停 R6。
2. **浏览器开发模式**：`panthesia-service`（tiny_http）只为浏览器调试与 Playwright 存在。保留则需维护第二传输层；删除则测试改为 Tauri 驱动。建议保留为单一 `send()` 后的开发传输，不再逐功能分支。
3. **历史回放 / 表现记录**：当前主线 UI 已不可达（`HistoryDialog` 未渲染）。建议在 R1 一并移出主线，归入 `feature/assessment-lab`。
4. **磁盘清理**：`target/` 44 GB、`work/` 2.7 GB、`outputs/` 1.6 GB 未纳入版本管理。`work/original-product-reset/` 中的迁移回执、快照和 `references/` 必须保留；其余运行副本和 23 个旧运行包可删。需要用户确认后执行。

## 7. 工作方式

- 每轮推进一个阶段内的一批完整改造，接入后同步删除旧路径，不让同一职责长期两套并行。
- 检查以构建通过与直接覆盖风险的测试为准；视觉改动用实际截图对照参照图。
- 每轮结束在 [progress.md](progress.md) 记一条：日期、提交、完成内容、下一入口。
