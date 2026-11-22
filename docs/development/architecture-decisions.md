# 当前架构决策

更新：2026-11-22（R0–R10、RO 之后）。阶段与任务见 [current-plan.md](current-plan.md)。

## A01 产品壳与后台能力

Panthesia 是打开一首歌就能练的专用程序。曲库由 Keel 管理；Panthesia 只有启动页、歌曲页与演奏舞台，界面规范见 [interface-design.md](interface-design.md)。转录、分离、DuET、转调量化、谱面生成等作为后台能力，从歌曲页或设置进入；演奏舞台不放任务与诊断。

## A02 模块边界

```text
前端 screens / AppShell 区域组件
  → app/useAppModel（AppContext）、领域 store
    → api.ts：命令、推送订阅（Tauri 事件 / 浏览器长轮询）
      → panthesia-engine：Engine 入口 → 播放线程 Player、后台任务池、状态源
        → panthesia-core（纯函数：乐谱、清单、对齐、指法、练习）+ panthesia-music（MIDI、NoteId）
          ← 设备适配（MIDI、SF2、VST3、音频）、文件系统
```

| 边界 | 拥有的内容 | 不承担的内容 |
| --- | --- | --- |
| panthesia-music | MIDI 解析、tick 时间图、稳定 NoteId | 文件位置、界面状态 |
| panthesia-core | 乐谱 IR、清单格式与读写（`manifest`、`manifest_store`、`manifest_sidecar`）、对齐、指法、练习判定 | IO 之外的运行时状态、设备 |
| Player（播放线程） | 当前歌曲、播放时钟、等待目标、音源与输入、命令分派（`player.rs`、`player_commands.rs`） | 长时间计算、磁盘扫描 |
| 后台任务池 | 准备歌曲、谱面、音源与设备切换；进度、取消、过期结果拒绝 | 播放时钟 |
| 状态源 | 快照发布：内容变化才前进的修订号，供推送 | 业务逻辑 |
| 桌面外壳（src-tauri） | 文件对话框、打开请求、单实例、外部程序、状态与任务推送线程 | 音乐领域 |
| 前端模型层 | 会话、导航、对话框、打开文件等应用状态；经 `AppContext` 提供 | 逐帧计算、身份判断以外的业务规则 |

只在依赖需要时抽 crate，不为目录数量建立服务层或重复 DTO。

## A03 存储

歌曲数据写在文件旁的 `.panthesia` 清单中（格式见 [panthesia-format.md](panthesia-format.md)）：图层、设置、谱面配对与伴奏文件，按内容哈希引用。首次修改时创建同名清单；写入为原子写，`manifest_store::edit` 串行化同一进程内的修改，内容未变不写。本地资料目录只保存练习数据（偏好、练习历史与时长、最近打开）与缓存（`cache/scores/` 的 MusicXML 演奏、`scores/` 的谱面副本、`exercises/` 的技术练习）。没有集中数据库、副本存储或意图日志。

改存储格式必须带迁移且可回退。2026-11-21 的真实资料迁移（旧曲库 → 清单）用一次性工具完成，工具保留在提交历史中（见 progress.md）。

## A04 音乐与实时路径

原始 MIDI 字节的 BLAKE3 身份与文件路径分离。tick 是音乐顺序的基础；tempo map 决定秒，小节由 meter map 决定；播放 BPM 是时间尺度，不改写源文件。手别和播放职责独立，等待模式只跟踪所需琴键，不计算准确率或达标。主线模式：wait（等待所需琴键）、flow（人声部，伴奏连续）、listen（观看）。

播放载荷预先编译为不可变事件序列，切换载荷使用版本标记和有界消息。音频回调避免 I/O、分配和阻塞锁。解析、模型和存储工作在后台执行；停止与止音命令有独立的控制通道。

## A05 状态推送

播放线程约每 16 ms 发布一次快照；状态源对去掉采集序号的快照计算内容哈希，只有内容变化时修订号前进并唤醒订阅者。桌面端一个线程发出 `engine-state` 事件，任务池的修订号同样驱动 `engine-tasks` 事件；浏览器调试模式用 `/api/state/next`、`/api/tasks/next` 长轮询。界面不轮询状态。`Snapshot` 等类型由 `generate-protocol.mjs` 从 Rust 生成。

## A06 渲染与谱面

屏幕读取时间锚点推算显示时刻，引擎拥有事实时钟；React 只处理低频状态，实时字段由显示组件按字段订阅 `playbackStore`。瀑布通过索引查询可见区间；不逐帧遍历全曲、序列化全谱或重建 React 树。谱面页和节拍索引由后台生成，页/范围缓存有上限。瀑布与光效为 WebGL2，见 [stage-rendering.md](stage-rendering.md)。

## A07 前端结构与样式

`App.tsx` 只提供模型；`app/useAppModel` 组合会话（`usePracticeSession`）、导航、对话框（`useAppDialogs`）、打开文件（`useSongOpening`）与操作；`AppShell` 由 `AppMenu`、`AppNotices`、`ProductScreens`、`PracticeWorkspace`、`AppDialogs` 组成，各自从 `AppContext` 读取用到的值。业务组件按领域放在 `features/*`、`stage/`、`app/`，`src/` 根目录不放业务组件。

样式只用 `tokens.css` 的变量（按原界面颜色拟合的 OKLCH token）。构建时所有样式表进入 CSS 层叠层：`tokens` → `components` → `overrides` → `state`（`[hidden]` 等状态规则）。不使用 `!important`。

## A08 原创替换与来源

Neothesia 应用逻辑逐模块退出：先稳定领域协议，再以功能规格和独立实现替换消费者。已有 GPL 代码在退出前准确保留来源。midly、cpal、midir、rtrb、oxisynth、Verovio、PDF.js 等通用依赖单独记录来源和许可。审计已见代码不能称为严格 clean-room；后续实现记录真实开发来源。来源与许可见 [sources-and-licences.md](sources-and-licences.md)。

## A09 迁移方式

每批完成"新实现 → 消费者接入 → 必要检查 → 旧路径退出"，不长期保留同一职责的两套实现。一次性迁移工具用完即删，留在提交历史中。

## A10 源音符与标注

panthesia-music 的 tick-native 源演奏保持原字节身份，NoteId 按原物理轨与正力度 NoteOn 序号建立。视图索引、转调后音高和秒数均为投影。清单中的音符引用为 `[轨, 起点 tick, 音高]`；无法对应到当前演奏的条目放入图层的 `unmatched`，读取时原样带回，不丢弃。不以曲名或近似音高推断同一内容。详见 [music-model.md](music-model.md)。

## A11 歌曲设置、声部与分手

`useProductScreens` 拥有主页、设置与歌曲设置、声部、分手、演奏、自由演奏的呈现状态；`useWorkspaceNavigation` 只有主页与练习两个工作区，负责切换前的准备（暂停、核对引擎）。`SetPartHands` 绑定 contentId、轨号和手别 proof，在后台事务中构造整首分手；整轨手别选择替换该轨的旧逐音覆盖，其他轨与指法保留。声部外观与音色按轨保存到清单设置中。

乐器预听使用独立试听调度器的短乐句；关闭、失焦或实际输入会停止预听，演奏位置、录音与判定不接收预听音符。琴键与音符标签分别保存；调性使用 effectiveTonic，避免转调后仍显示原调唱名。

## A12 实时会话、音乐游标与绘制缓存

PlaybackSession 拥有时钟、事件/等待目标游标、所需琴键与节拍边界，只接收内存时间线和只读角色投影。暂停、定位、换曲、退出共用 panic 的停止代次，陈旧输出包由 sound_runtime 的代次检查丢弃。模式、等待与手别切换保持当前位置；seek 与循环才重建游标。预备拍、节拍器与状态投影共用 musical_position；节拍按拍边界触发一次，迟到时不补发。

瀑布延续可见区间索引，音符由 WebGL2 实例化绘制，不再缓存音符精灵。

## A13 谱面页面与排版

页源按内容/布局身份共享，准备前取得租期，当前页通过带请求身份的 worker RPC 加载。SVG 使用 32 MiB / 16 页 LRU；最后一个读者退出时中止并释放排版线程。纸谱仅按需取得页面；切源或取消时拒绝过期结果。跟随播放只移动高亮，不重新排版。

## A14 实际音高与书写符号

源 MusicXML 的 alter 表示实际升降，accidental 表示书写符号，依据 [W3C alter](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/alter/) 与 [W3C accidental](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/accidental/)。Verovio 导入丢失的音高在渲染副本中通过 accid.ges 修正，按稳定渲染 ID 关联，原谱不改。生成谱按调号、小节和声部维护书写状态。

## A15 练习谱范围与原谱索引

ScoreView 读取请求携带演奏身份与谱面修订；MIDI 简化谱及量化谱一次准备 32 个全局小节，片段 ID 由源轨、音符索引和全局书面位置组成，窗口重叠时可复用。范围开头恢复谱表、调号、拍号与速度，边界连音保留。映射在后台重建同一窗口并核对显示字节指纹，陈旧版本或范围不安装。

SourceDocument 从原文件建立一次书面索引，MusicXML timewise 只在显示副本中转为 partwise；重复或匿名 ID 生成稳定显示 ID。完整源 ScoreEventId 及 occurrence 对齐决定演奏时间；SourceView 缓存全曲音符关联和演奏路线，范围的多个不连续时间段负责反复与跳转跟随。资产预算与显示预算分开：原谱 64 MiB，窗口 4 MB 且最多 32 小节；路线规划默认 100,000 次小节经过上限，拒绝未可靠展开的演奏顺序。

## A16 MIDIVisualizer 实时视觉层

采用 WebView 内的独立 WebGL2 实例图层；后端只投影输入力度与击键身份，播放时钟与音频所有权保持在 Rust。与 Canvas2D 瀑布共享帧调度和几何，暂态效果使用有界批次；显卡异常时切回同一状态的 Canvas2D。详见 [stage-rendering.md](stage-rendering.md)。
