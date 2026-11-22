# 进度记录

每轮一条，新记录在上。计划与阶段定义见 [current-plan.md](current-plan.md)。

## 2026-11-22 · R5 谱面显示（提交 5920350、14c9305、b7c8013、9200eba、1504f2e）

- 跟随不再重渲染：原来谱面组件随每次播放状态推送整体重渲染，并且每次都重写正在演奏音符的类名（每秒 378 次 DOM 变更）。现在谱面与反复路线条直接订阅播放 store，高亮、跟随滚动、窗口切换、当前反复段都在订阅回调中完成，只在正在演奏的音符变化时改 DOM（每秒 11 次）；只有速度或反复段变化时才渲染。纸谱阅读器只订阅小节号。删除 `PlaybackView` 渲染函数组件，只保留 `usePlaybackFields`。CPU 降速 4 倍、1600×1000 的条件下，谱面加瀑布的帧间隔 P99 从 18.6 ms 降到 7.3 ms。
- 适合宽度改为重排：原来把 A4 页面放大到谱面区宽度，舞台默认 25% 的谱面区只能显示大谱表的一部分。现在按谱面区宽度重新排版，谱表保持 100% 大小；当一行谱放不下时缩小谱表（下限 0.35），页高随内容调整，不显示页眉。跟随滚动让整行谱完整可见；谱行高于视区时保证当前音符所在的单个谱表完整可见；视区尺寸变化时重新定位。
- 对齐：直接打开 MusicXML 时，演奏由乐谱生成，但对齐把每个延音线后续音都当作待击键的谱面音，结果覆盖率只有 84%、状态为“需校对”，而且延音起点因预期时值只算第一个音头，置信度只有 70。现在延音后续音按演奏生成器的同一规则并入起点（同音高、同声部、同谱表，演奏时间相接，位于同一小节或下一小节）。Just The Two Of Us：1593/1593，覆盖率与置信度均为 100。
- 谱面只有一条生成路径：练习谱生成与 ABC 导入原来各自拼接 MusicXML 文本，现在都构建 Score IR，交给唯一的写出器 `musicxml_write`。IR 补上写出所需而导入不需要的信息：音符 id、显示类型/附点/临时记号、隐藏音符与整小节休止、小节线样式、房号文字、节拍器文字。新旧输出在 ABC 样例和 4 个 MIDI 文件的练习谱上做了比较：音符身份映射、音高、声部、类型、附点、临时记号、延音完全一致，只有 divisions 改为最小公倍数。练习谱生成器版本升到 v6，缓存的练习谱会重建。
- 转调核对：A♭ 大调谱面 +2 后调号为 B♭ 大调（-2），E♭5→F5、E5→F♯5，演奏音高同步 +2，覆盖率不变。
- 检查：notation 118、engine 97 通过；浏览器 5 个用例通过；桌面 Debug 构建打开 MusicXML 长谱，谱面“配对 100% · 可跟随”，瀑布层为 webgl2。
- 未做：MusicXML 歌词与和弦按演奏位置展开仍在 R6。

下一入口：R6（和弦、调性、段落、歌词图层；MusicXML 歌词与和弦按演奏 tick 展开；POP909 标注导入）。

## 2026-11-22 · R3 演奏舞台渲染器（提交 8bebaba、94120bb、f057428）

- 测量方法：19,200 音符、4 声部、300 秒的压力曲（`work/web-preview-songs/stress-19200.mid`），Playwright 无头 Chromium（ANGLE D3D11，取消帧率上限），2560×1440、DPR 2、CPU 降速 4 倍模拟慢机器，取 5 秒播放中的帧回调耗时。原 Canvas2D：绘制 p50 5.9 ms、p99 9.9–17.4 ms，超出 16.7 ms 目标；采样剖析显示主要开销是逐音符 `drawImage` 与 2D 合成。
- 新瀑布层 `waterfallLayer.ts`：背景渐变与键盘光晕、琴键列线、拍线与小节线（细分线虚线在着色器中生成）、循环接缝、音符（圆角 SDF、右侧渐淡、顶部高光、发光、深色描边，参照 Synthesia 让相邻音符分开）合成一个 WebGL2 实例化绘制，画在 2D 画布下方；2D 画布只画文字标签、琴键与光效。同条件下绘制 p50 1.2 ms、p99 3.2 ms（加描边后 3.9 ms）。没有 WebGL2 或上下文丢失时，同一接口在 2D 画布上画平面形状。删除音符精灵缓存，标签缓存改名 `WaterfallLabels`；着色器编译与单位四边形与光效渲染器共用 `webglProgram.ts`。
- 琴键保持 Canvas2D：底图按尺寸与标签缓存，每帧只重画按下的键，剖析中占不到 1%，改 GPU 不划算。时钟（`WaterfallClock` 插值）、标签模式（含首调级数）、小节线与循环预览在此前已实现，本阶段只换了绘制层。
- 舞台颜色集中到 `stageTheme.ts`（背景按皮肤、光晕按光效配色、琴键按皮肤与材质、指法与网格墨色），Piano 与琴键绘制中不再有内联色值。
- CSS：清除剩余 24 处 `!important`。能确定对手规则的改为提高选择器特异性（速度输入框、双手卡片、导出警告）；重复的练习对话框宽度与未使用的 `practice-result` 样式删除；其余原样移入各文件顶层的 `@layer overrides`，构建插件保留该层，层序为 tokens → components → overrides → state，因此 `[hidden]` 也能盖过窄屏节拍器规则。
- 检查：`npm run build`、`cargo check` 通过；浏览器 5 个用例通过；桌面 Debug 构建打开压力曲，WebView2 中瀑布层为 `webgl2`，每帧 742 个实例，跟随刷新率约 57 fps。
- 未做：与 MIDIVisualizer 逐项对照光效（光效渲染器已是其方程的移植，本阶段未改）。

下一入口：RO 依赖 Keel PF 阶段，跳过；进入 R5 谱面显示（谱面窗口化、跟随、只读阅读器；从 Score IR 生成）。

## 2026-11-22 · R4 分层歌曲模型与统一导入（提交 cc06368、407a3a5、e6818ed、58a33ac、89a1fb3、eb28436、c08e08b）

- `panthesia-notation`：乐谱模型（MusicXML / Score IR、反复展开、乐谱→演奏、对齐、装饰音、谱面视图与窗口、练习谱生成、转调拼写、手别枚举）从 core 拆出；core 去掉只有乐谱代码用的依赖。测试数不变。
- MIDI meta 图层：元信息文本按文件识别编码（合法 UTF-8 用 UTF-8，否则 chardetng + encoding_rs；GBK 轨道名与歌词实验解码正确）；读取歌词（无 Lyric 时读卡拉 OK 文字事件）、段落（Marker / Cue Point）、调号变化，作为 `importedLayers` 随歌曲提供（不写清单）；`probe` 报告数量。
- MusicXML 歌词与和弦符号读入 Score IR。按演奏 tick 展开到反复位置放到 R6：生成的演奏 MIDI 用借用字节的 `'static` 事件，写入歌词需要改 `Performance` 的所有权，与 R6 的和弦/歌词图层对齐一起做。
- ABC 导入：考察了 `abc-parser` 0.4（MIT、PEG），时值与标注字段私有且时值为 f32，无法用于语义转换，因此自写。`panthesia-notation::abc` 把 ABC 2.1 常用子集转成 MusicXML（头字段与行内字段、八度、小节内按八度的临时记号、时值、休止、和弦、延音、附点节奏、连音、倚音、小节线与反复、反房号、和弦符号、`w:` 歌词、声部），时值用精确分数，不可直接书写的时值拆成连音的多个音符；读取 `.abc` 原件即得到 MusicXML，打开、缓存、谱面版本、原件变化检查与制谱与 MusicXML 共用一条路径。文件选择、文件关联、`probe` 支持 ABC。实验：临时记号、三连音、声部、弱起、反复与反房、渲染出的谱面（和弦、歌词）正确；转调与量化对 ABC 与 MIDI 都生效。
- 歌曲包识别：`song_package` 按固定命名规则找出同一首歌的文件（同名音频、`_人声`、导出目录的人声与钢琴分轨、`score.mid` 与 `piano_raw.mid`、`score.musicxml` 或同名谱、`versions/` 与 `_原调_`/`_C大调_` 版本、`… MIDI` 旁的 `… AUDIO`、`source/` 录音、POP909 标注），不按标题合并不同编配（七里香 14 个文件互不归并）；"歌曲文件与版本"列出建议，加入即写清单，谱面经新命令 `PairScoreFile` 配对（引擎读文件，ABC 亦可）。在 `work/` 中 5 个语料目录的镜像上核对；修正对话框被长文件名撑宽。
- 元数据收敛：删除只服务于已删 Synthesia 导入的"来源默认值"层（core `metadata_layers`、引擎 `metadata_defaults`、两条协议命令、前端面板；子代理完成）。元数据只剩一套 `SongMetadata`。旧数据仍可读：标注文档接受并丢弃 `metadataLayers` 键，RON 附注忽略该字段，清单的 `extensions.panthesia` 重写时原样保留。
- 语料回归（3.6 节样本，每组最多 60 个文件，经 `probe` 只读）：发现 DuET 导出的谱面因装饰音没有计时属性（MuseScore 等也这样写）且主音带延音而被拒绝。改为：无计时属性时，带斜线的倚音占主音 12.5%，不带斜线的占 50%（同组平分）；主音可以开始延音，不能是延音的延续。另外跳过 macOS `._` 隐藏文件。之后所有 MIDI、MusicXML、ABC 样本都能导入，唯一失败是 YouTube 章节 `.xml`（不是乐谱）。
- 阶段检查：notation 118、core 110、engine 97 通过（engine 少的 1 个随来源默认值删除）；桌面 Debug 构建从命令行打开 ABC 文件，最近打开记录正确，日志无错误，正常关闭。

下一入口：R3 演奏舞台渲染器（WebGL2 瀑布 + 琴键 + 光效；时钟；标签、小节线、循环区）。

## 2026-11-22 · RF 收尾：浏览器关键流程、清理匹配器、恢复延迟校准（提交 d0f66ed、405f1f2、755cb20、f6ad1d3）

- 浏览器用例：新增 `open-and-practice`（打开文件 → 跟随双手练习出现所需琴键 → 暂停 → 歌曲文件与版本 → 回到主页从最近打开重开；设置页打开设备设置），2 个用例通过。旧用例全量运行 91 个中 82 个失败、10 个因无脚本提供的环境变量而跳过，原因都是旧曲库界面或已删的 `importScore`/`load` 命令，删除 62 个文件；保留并通过的有 `verovio-index`、`paper-ink-merge`。共 5 个用例全部通过。
- core：删除未使用的自适应速度教练；匹配器由子代理精简（`practice.rs` 2216 → 823 行），持久化的总结类型保持 serde 形状，供练习历史读写。
- 延迟校准：子代理发现自评分分支拆出后没有代码向匹配器输入音符，校准永远是"有效样本 0/24"；而且只接受界面无法进入的 flow 模式。改为在连续播放（listen、flow）中由播放会话推进人声部游标，把到点的谱面起音和演奏者按键交给匹配器。临时实验：每个音晚 30 ms 按下，测得中位偏移正好 30 ms（实验用例已删除）。
- 检查：`cargo test -p panthesia-engine` 98 通过；`cargo check`、`npm run build` 通过；浏览器 5 个用例通过。
- RF 完成情况：失去用途的对话框与 CSS 已删除；颜色全部用 token；`App.tsx` 只提供模型；状态与任务改为推送；关键流程用例通过。未完成：24 处 `!important`（对通用控件皮肤与主题文件的覆盖），随各屏视觉重做处理。

下一入口：R4 分层歌曲模型与统一导入（按第 4 节单会话顺序 RF → R4）。

## 2026-11-21 · RF 第三批：任务推送、App 拆分、模式清理、CSS 层叠层（提交 d5daecf、6789c2f、db49c5e、963ccf9、a989662 及本批 CSS 提交）

- 任务列表推送：任务池加修订号与条件变量，任务入队、开始、阶段、来源、提交、结束、取消时前进；引擎 `next_tasks`，桌面发 `engine-tasks` 事件，调试服务 `/api/tasks/next` 长轮询。前端任务监视器与状态共用同一个订阅函数。主页空闲时界面不再发出请求（原来每秒一次 `tasks`）。
- `App.tsx` 拆分：`App.tsx` 只提供模型（12 行）；`app/useAppModel` 组合会话、导航与操作，经 `AppContext` 提供；窗口视图拆为 `AppShell` → `AppMenu`、`AppNotices`、`ProductScreens`、`PracticeWorkspace`、`AppDialogs`，各自只读取用到的值。按关注点拆出 `useSongOpening`（打开文件、最近打开、外部转交）、`useAppDialogs`（对话框开关与参数、应用菜单的外部点击关闭）、`useKeyboardViewport`（舞台键盘范围）。`useAppModel` 约 550 行，仍可按恢复、命令、工作入口继续拆。拆分用脚本按顶层声明生成返回值与解构，再用 `scripts/organize-imports.mjs`（TypeScript 服务）删除无用导入；每步在浏览器中核对主页、歌曲设置、演奏、设置页与对话框。
- 模式：引擎只接受 wait / listen（flow 为人声部连续伴奏）；评分时代的 recital / memory 在前端与引擎中的锁、隐藏提示、快捷键限制与说明文字删除。
- CSS 层叠层：构建时 PostCSS 插件把 `tokens.css` 放入 `tokens` 层，其余样式表放入 `components` 层（相对优先级不变）；`src/layers.css` 声明层顺序并在 `state` 层隐藏 `[hidden]`，删除 6 条分散的 `[hidden] { display: none !important }`。其余 24 处 `!important` 是对通用控件皮肤（`.workbench button` 等）与主题文件的覆盖；把通用皮肤整体降层会同时改变依赖主题覆盖的地方，在无法逐一截图核对时风险高，留到各屏视觉重做时处理。
- 计划：第 3.5 节状态与传输按实际设计更新（推送、外部 store、AppContext；不引入 zustand）。
- 检查：`cargo test --workspace` 全部通过（core 245、desktop 18、engine 98）；`npm run build` 通过。

## 2026-11-21 · RF 第二批：颜色 token、类型生成、模块归位（提交 140b88b、4b08619、9866df5、53b0277、bfa7939、bf453f4、09e225e、342838e）

- 状态推送修正：采集序号每次发布都增长，原来 16 ms 一次的发布让长轮询每秒返回 60 次；状态源改为对去掉序号的快照计算内容哈希，内容变化才前进。空闲时长轮询等满 20 秒。首次会话读取的可选调用短路了参数，导致界面停在"正在连接"，已修正（浏览器调试中实测：主页、歌曲设置、演奏舞台、播放进度均正常）。
- 颜色：`src/tokens.css` 80 个 OKLCH token，按原界面 1630 处颜色拟合（OKLab 加权 k-means，权重取出现次数的平方根，防止大量灰色挤掉醒目的强调色；白、黑固定），按色相族与亮度命名。`scripts/tokenize-colors.py` 把所有字面颜色替换为最近的 token（平均 ΔE 1.5，p99 4.9），半透明色写成 `color-mix`。先试过系统化色阶（按色相族生成），饱和色损失明显（标题栏与绿色按钮发灰），因此改用拟合。CSS 中已无硬编码颜色；TS 中画布绘制颜色留到 R3 渲染器。
- `!important`（约 40 处）未处理：它们来自多套主题文件互相覆盖，正确做法是 CSS 层叠层，但会改变全部样式表的优先级，在无法逐一截图核对对话框时风险高，放到 RF 重写各屏时一起做。
- 类型生成：`Snapshot` 及嵌套类型改由 `generate-protocol.mjs` 从 Rust 生成，删除手写版本。考虑过换成 ts-rs / specta：现有生成器按方向处理 `serde(default)`（输入可选、输出必填），通用工具不区分，因此保留并扩展。`StorageStatus` 只留 `operation`、`pending`、`error`。
- 删除：core 的 `song_catalog`、`repertoire`、`synthesia_metadata`，`song_project` 只留记谱生成与练习版本；`practice_history` 中无调用者的查询（2220 → 843 行，子代理完成；持久化格式的类型与字段不变，旧文件可原样读写）；已删功能的 20 个浏览器用例与 5 个脚本；`smoke-practice.mjs` 只按名称运行用例。
- 传输：`api.ts` 的 `http` 与 `postLocal` 合并为 `local` / `call`；约 50 个"后台命令"名单只给出所有命令本来就有的超时，删除。
- 模块归位：src 根目录 53 个业务模块按领域移入 `features/fingering`、`features/practice`、`features/scores`、`stage/`、`app/`、`features/settings`，导入路径按解析结果改写；根目录只留入口、`App`、`api`、生成文件、token 与基础样式。
- 检查：`cargo check --workspace --all-targets`、`npm run build` 通过；core 测试 245 通过。

下一入口：RF 第三批——任务列表改为推送（目前每秒轮询 `tasks`）；`App.tsx`（约 1000 行）拆分为组合层；CSS 层叠层与 `!important`；关键流程用例改用 `openFile`。

## 2026-11-21 · RF 第一批：状态推送与删除失去用途的前端（提交 462f8df、c0bb794、8b64bd7、5540b62）

- 引擎快照删除评分时代字段：计数、尝试总结、总结版本、历史 id、本轮已保存标记、导入格式版本；依赖它们的"本轮结果未保存"守卫永远不会触发，一并删除；删除未使用的自适应速度教练。`state-frame` 接口随总结一起删除。
- 状态推送：引擎通过 `StateFeed`（修订号 + 条件变量）发布，提供 `next_state(after, timeout)`；桌面端一个线程只在快照内容变化时发出 `engine-state` 事件；调试服务提供 `/api/state/next?after=N` 长轮询（独立通道）。前端 `api.subscribeState` 统一两种方式，`usePracticeSession` 不再每 80 ms 轮询（638 → 378 行）。
- 前端删除（盘点由只读子代理完成，三组互不重叠的文件由子代理并行修改，共享文件由我修改）：曲库与收藏读取、歌曲列表、队列辅助、曲库元数据模式与右键菜单、浏览状态存储、纸谱上的历史定位、导入 / 曲目包 / 日课类工作目标、恢复日志条目、曲库布局设置；导航只剩主页与练习两个工作区（原来的锁从未被设置）。`LibraryMetadataEditor` 改为 `features/library/SongMetadataEditor.tsx`。
- CSS：新增 `scripts/prune-css.mjs`（postcss 解析，删除源码中不可能出现的类名对应的选择器），删除 1221 个选择器；CSS 总计约 1.08 万行，`style.css` 2763 → 1157 行。
- 用户问是否换成 TypeScript + Electron：结论是不换。前端已是 TypeScript，核心能力（低延迟音频、MIDI、VST3、乐谱处理）在 Rust；效率问题来自代码复杂度，按 RF 计划简化（推送、单一 `send()`、类型生成）。
- 检查：`cargo check --workspace --all-targets`、`npm run build` 通过。

下一入口：RF 第二批——`tokens.css` 与硬编码颜色替换；随后单一 `send()` 与从 Rust 生成 `Snapshot` 等类型。

## 2026-11-21 · R2 第 6 项：迁移真实资料，R2 完成（提交 8e0b047、224e00e、a756bca、c758201）

- 迁移前完整备份：`work/user-data-backup/com.ubik.neothesia-20261121-before-migration.zip`（4221 个文件，与源目录一致）。
- 有用户数据的歌曲 16 首：
  - 5 首内置练习：标题、分手与配对谱面写入资料目录中歌曲旁的清单，谱面引用旁边已有的同内容 `.musicxml`。
  - 10 首在 `D:\Music\MIDI` 下：分手图层写入歌曲旁的清单。同一内容有两份副本的歌曲（Libera me, Domine）两处都写了清单。
  - 1 首（爱转角_清理后主旋律）原文件与曲库副本都已不存在，只剩偏好，无文件可迁，没有导出任何歌曲。
- 练习设置仍按内容 id 存在 `web-preferences.json`，首次打开时由引擎写入已有清单。偏好中指向 `library/` 的 6 处路径改到新位置；`recent-files.json` 用迁移的歌曲初始化（原来的选曲列表随曲库删除）。
- 过程：一次性工具 `migrate_library` 与 `verify_migration`。先在备份副本上运行，外部歌曲先复制到 `work/` 下的镜像目录，删除副本的 `library/` 后用引擎逐首打开核对；再对真实资料执行。核对内容为清单读回与写入一致、清单引用的文件存在、练习设置一致。两处差异属于正常规范化：`adaptive` 属于已删除的评分模式；`parts` 原来为空，由分手图层填入。两次核对 15 首全部通过。工具在之后的提交中删除，可在提交历史中找回。同时删除引擎中已无引用的 `rusqlite` 依赖。
- 资料目录整理：删除旧 `library/`；旧曲库状态文件（`library-workspace.json`、`library-monitor-files.json`、`repertoire.json`、`synthesia-discovery.json`、`library-open-results/`）与历史回放数据 `performance-history/` 移到 `legacy/`，不解析。`web-practice-history.ron` 主线仍在读取，保留原位。
- 代码中删除旧曲库布局：谱面查找不再回退到 `library/assets/notation`；标注文档只用于技术练习（`exercises/`）；文件位置记忆删除已删功能的类别（曲库、曲目包、重新定位、备份导入）。
- 修正测试：MuseScore 转谱测试原来直接打开仓库里的 `five-finger.mid`，保存谱面版本时副本写进了仓库，现改为在临时目录中使用副本。
- 阶段检查：`cargo test --workspace` 全部通过（core 271、desktop 18、engine 98 等）；桌面 Debug 构建以真实资料启动，从命令行打开迁移后的歌曲，最近打开记录更新，日志无错误，正常关闭。
- 计划：R2 标为完成；RF 的"`App.tsx` < 300 行"改为职责描述（只组合各屏与全局状态），理由同上一条。

下一入口：RF 前端基础，先列出并删除随曲库、选曲、导入、评分、历史一起失去用途的对话框与 CSS。

## 2026-11-21 · R2 第 5 项（三）：拆分 `lib.rs`，谱面副本跟随歌曲（提交 df49b02、f297b95、e7d6087）

- `lib.rs` 3.2k → 246 行：`Player` 与播放状态移到 `player.rs`，命令分派移到 `player_commands.rs`，测试移到 `player_tests.rs`；`lib.rs` 只声明模块与 `Engine` 入口。
- 配对谱面：有清单的歌曲，谱面副本放在歌曲旁（原来引用资料目录副本，跨磁盘时清单无法写相对路径）；其余副本放在资料目录 `scores/`。
- 技术练习移出 `library/`：`exercises/<cid>.mid`，标注在 `exercises/annotations/<cid>.json`（练习 cid 由参数决定，与字节哈希不同，所以不用清单）。
- 计划调整：去掉"engine ≤ 3 万行"的验收条件，改为架构判断（每个职责一条路径、模块边界清楚、不留只为旧机制存在的代码）。行数只作为发现冗余的信号（用户决定，见计划第 5 节）。当前 engine 约 3.1 万行（其中测试 3.6k）。

下一入口：R2 第 6 项，迁移真实资料。

## 2026-11-21 · R2 第 5 项（二）：删除存储机制，测试全部通过（提交 fa95f79、73fc0b3、c61af8f）

- 删除：`operation_journal`、`pending_save`（合并延迟写入的设置写入线程）、`round_storage` / `settings_storage`（保存意图与恢复）、`asset_storage`（谱面与标注的延迟发布与恢复日志）、`storage_recovery`，以及后台读取器外的只读捕获。设置、历史、标注、谱面、谱页一律由修改者直接原子写入；分离的编辑仍在播放线程外准备，`prepare*` 直接返回结果。真实资料中没有遗留的保存意图文件（已核对备份）。
- `storage_status` 保留界面读取的快照结构（无恢复、不可重试）；关窗只等待正在运行的写入与独占操作，报告未保存的录音或保存错误；评分时代的"本轮成绩 / 完整演奏"关窗项删除。协议删除 `RetrySave`、`RetrySettingsSave`、`ReadStorageStatus`（175 → 172 条），恢复面板去掉"重试保存""重新核对保存状态"。
- 启动忙碌：原来恢复检查失败会让引擎一直处于"正在保存或恢复"，现在只在启动恢复上次曲目期间忙碌；新增 `Engine::wait_until_ready`。
- 测试修复中发现并修正的问题：
  - 改变状态的运行时请求，回复改为在清单同步之后发出（原来由延迟写入线程保证顺序），调用方收到回复时清单已写好。
  - 没有清单时加载歌曲不再记录基线，偏好中已有的歌曲数据会在下一次修改时创建清单。
  - 引用了演奏中不存在的音符的标注条目，写清单时放入图层 `unmatched` 并在读取时原样带回，不再丢弃。
  - 保存的 SoundFont 被删除后，启动回落到随包音源并提示。
- 测试调整：练习测试显式切到等待模式（歌曲默认以连续播放打开），去掉已删评分计数的断言；删除只测已删机制的测试（练习缓存冲突与 `-restored-` 副本、延迟写入下的字节不变、旧曲库谱面副本、评分模式）；被拒绝的换指测试改为比较标注内容；core 附加信息测试按清单行为更新；谱面投影测试按纳秒精度；Audiveris 页快照测试改用短数据目录（原来超过 Windows 260 字符路径限制，基线即失败）。
- 结果：`cargo test --workspace` 能跑完且全部通过（core 271、desktop 18、engine 98 等；原来 engine 测试会死锁、约 125 个失败）。`cargo check --workspace --all-targets` 无警告，`npm run build` 通过。
- 规模：engine 34.4k → 31.3k 行。

下一入口：R2 第 5 项（三）：拆分 `lib.rs`（3.2k 行：`Player` 与命令分派分离，按领域分模块），同时把 engine 降到 3 万行以内；然后第 6 项迁移真实资料。

## 2026-11-21 · R2 第 5、7 项（一）：删除集中曲库（提交 ad4d606）

- 引擎删除：歌曲仓库与副本存储、导入流水线与收据、目录登记、曲库工作区（分组、评分、首选路径）、文件夹扫描 / 监视 / 索引、曲库修复与 MIDI 替换、元数据模板 / 历史 / 声明、Synthesia 元数据批量导入、作品目录（repertoire）、收藏与队列、非当前歌曲的曲库谱面、八秒试听、`.neopiece` 曲目包。协议命令 252 → 175。
- 保留并迁出：`music_file`（读 MIDI）、`data_locks`（资料目录锁与路径键）、`library_scores`（当前歌曲的谱面配对与谱面版本）、`song_audition`（轨道设置页的乐器试听）。
- MusicXML 打开：生成的演奏、原谱副本与清单放在资料目录 `cache/scores/<哈希>/`，同一份谱面再次打开时复用（`score_open.rs`）。清单写在 MusicXML 旁边要等 R4 统一导入。
- 技术练习直接用 `generate` 命令生成，缓存在 `library/assets/exercises/<cid>.mid`；前端去掉收据、恢复、取消流程。
- 最近打开：`recent-files.json`（资料目录），`OpenFile` 成功时记录；新命令 `RecentFiles` / `ForgetRecentFile`。主页改为"打开乐曲…"、最近打开（右键移除）、自由演奏、设置；应用菜单去掉"曲库"组，"文件"组提供打开乐曲、当前曲目信息、歌曲文件与版本。
- 桌面端删除曲库监视、添加扫描文件夹、修复与重定位 MIDI、曲目包传输、导入桥；`--headless-check` 改为打开内置五指练习（写入资料目录 `startup-check/`）。
- 前端删除选曲页、文件夹管理、导入队列与导入对话框、曲目包对话框、版本栏与演奏管理、作品目录客户端等（按 import 图删除不可达文件）。曲目信息只对当前打开的歌曲编辑。
- 测试：删除只测已删功能的测试 25 个；其余用测试专用的 `load_file` / `import_score` 代替 `Load` / `ImportScore` 作为准备步骤。
- 检查：`cargo check --workspace --all-targets` 通过（有若干死代码警告，存储机制删除时一并清理）；`npm run build` 通过。
- 规模：engine 50.5k → 34.4k 行。
- 用户数据：旧 `library/`、`songs.sqlite3`、`library-workspace.json` 不再被读取，原样留在资料目录，由第 6 项迁移后移除。

下一入口：R2 第 5 项（二）：删除五套存储机制（`asset_edit` 的延迟写入、`pending_save`、`operation_journal`、`round_storage`、`settings_storage`、`storage_control`、`storage_recovery`、`storage_close`、`asset_storage`、桌面 `desktop_close.rs`），写入改为直接原子写；消除启动忙碌；清理警告；拆分 `lib.rs`。

## 2026-11-21 · R2 第 4 项：`probe` 子命令（提交 f4b8205）

- `Panthesia.exe probe <文件> [--json] [--thumbnail <png>] [--size 宽x高]`：在桌面程序 `main` 最前面处理，不启动窗口、不锁资料目录、不经过单实例转交。实现在 `panthesia-engine::probe`，输出字段写在 `panthesia-format.md` 末节。
- MusicXML 走与打开相同的"谱面生成演奏"路径后再分析；`.panthesia` 分析默认演奏。
- 调：清单 `keys` 图层 → MIDI 调号 → 文件名中的 `Gmajor` / `F#minor` → Krumhansl–Kessler 估计。拍速：清单 `tempo` 图层 → 持续最久的拍速；文件没有拍速事件（默认 120）且文件名含 `BPM76` 时取文件名。文件名解析只是 R4 导入器（文件名写入图层）之前的补充。
- 缩略图：钢琴卷帘 PNG（新增 `png 0.18` 依赖，锁文件中已有），清单分配手别时右手绿、左手蓝，否则按轨道着色。
- 程序为 GUI 子系统：只有没有继承输出句柄时才附着父控制台，管道与重定向（Keel 的调用方式）不受影响。
- 实测（debug 构建，语料只读）：KAIRCI《Oz》76 BPM / G 大调（文件名）；《七里香》75 BPM / C 大调（MIDI）；POP909 001 估计 F# 大调，与数据集 `key_audio.txt` 的 Gb:maj 一致；SNH48《海砂》.mxl 120 BPM / Eb 大调、94 次拍速变化；带清单的副本取到清单中的调、图层与缺失的人声文件；不存在的文件输出 `{"error": …}` 并返回 1。每个文件约 0.2 秒（首次 2.7 秒为冷启动）。
- 注意：在 Git Bash 中用 Python 解析输出时需按 UTF-8 读取（默认按 GBK 解码会把中文后的 `\` 吞掉）。

下一入口：R2 第 5 项（删除集中曲库与五套存储机制，拆分 `lib.rs`）。先列出 `song_repository`、`import_storage`、`song_catalog` / `catalog_rows`、`library_workspace`、`library_monitor`、`locations` 与五套存储机制的全部调用方，按"打开文件 → 练习"主线保留所需部分；MusicXML 打开改为不经曲库；同时处理分离读取器直接写清单的问题。

## 2026-11-21 · R2 第 3 项：歌曲设置接入清单（提交 573f758）

- 不在旧集中曲库中的歌曲（没有 `library/assets/midi/<cid>.mid`）从原位置直接加载，`retain_assets` 不再把它复制进曲库。已在曲库中的歌曲行为不变，数据仍在集中存储，等第 6 项迁移。
- 标注：`library::load_song_sidecar` / `save_song_sidecar` 对外部 MIDI 改为读写清单（`panthesia-core::manifest_sidecar`）：手别（轨道与逐音）、指法与持音换指、逐音演奏者、小节（含旧式整体修正）、谱面配对（`files` 中 `score` 引用 + `scores[]`，分析快照写在 `analysis`）、元数据；元数据来源层写在 `extensions.panthesia`。音符引用在兼容序号与 `[track, onset, pitch]` 之间按演奏的音符映射转换；无法对应的旧条目移入图层 `unmatched`，不删除。旧 `.neothesia.ron` 仍可读取（读取时投影到当前音符序号），保存一律进清单。`D:\Music\MIDI` 中没有旧 RON 文件。
- 偏好中按歌曲保存的数据（`manifest_settings.rs`）：练习段、书签 → 图层 `passages` / `bookmarks`；轨道外观与音色、变调量化、手型、练习设置 → `settings`。加载时用清单内容替换该曲的偏好项；每个改变状态的运行时请求结束后比较投影，有变化才写回。练习段等歌曲数据第一次出现时创建同名清单；只改练习设置不创建。
- 选择在运行时请求出口统一同步：偏好的保存点有二十余处，且书签、练习段走 `practice_catalog` 的独立提交通道，挂在 `Player::command` 上会漏掉。分离的读取器（后台准备）不写清单。
- `manifest_store` 移到 `panthesia-core`（标注读写在 core 中，需要它），新增进程内读改写锁 `edit()`，标注保存与设置同步不会互相覆盖。core 的"纯函数、无 IO"边界在 `library.rs` 中本来就不成立，第 5 项拆分时一并整理。
- 文件夹清单中的多个演奏：非默认演奏的图层键为 `名称:演奏id`，设置在 `settings.performances.<id>`。格式文档已补充。
- 清单输出：一行能写下（≤100 字符）的数组与对象写成一行，每条音符引用一行，便于阅读和 Git 对比。
- 新命令 `SongFiles` / `EditSongFile`（添加、移除、命名）；歌曲设置页"更多"菜单新增"歌曲文件与版本…"：列出版本（切换、命名、移除非默认版本、添加 MIDI 版本）、伴奏与人声及原音频（登记、移除）、文件缺失与未匹配标注数量。桌面端新增 `pick_song_file`。打开文件后若清单有缺失文件或未匹配标注，提示一次。
- 检查：`cargo check --workspace --all-targets`、`npm run build` 通过；`file_open` 测试扩展为：第一次加书签创建同名清单、改元数据写入同一清单且保留书签、重新打开恢复标题与书签、文件未复制进曲库、登记与移除伴奏。标注往返（手别、指法、换指、逐音演奏者、小节、元数据）用临时测试核对一致后删除。
- 未完成：MusicXML 仍经 `ImportScoreOriginal` 生成曲库内 MIDI，数据不进清单（第 5 项处理）；登记的伴奏不播放（R7）；分离读取器中的标注保存直接写清单，不经过可恢复提交（第 5 项删除存储机制时统一）；未实际打开桌面构建（阶段结束时做）。

下一入口：R2 第 4 项（`probe` 子命令）。

## 2026-11-21 · R2 第 2 项：打开文件

- 引擎新增 `OpenFile { path }`（`file_open.rs`）：接受 MIDI / MusicXML / `.panthesia`；按 3.7 查找清单，校验引用并在目录树内找回（有改动且非只读时写回）；打开清单中列出的那个演奏，否则打开默认演奏；演奏文件内容变化时用 `reconcile_notes` 核对音符引用、更新记录的哈希并写回；结果附 `opened`（清单路径、演奏列表、变化 / 缺失 / 找回 / 未匹配数量）。没有清单时直接演奏，打开不创建清单。MusicXML 暂走 `ImportScoreOriginal`。
- 桌面端（`open_requests.rs`）：命令行参数、第二次启动（`tauri-plugin-single-instance`，转交文件并把原窗口提到前台）、原生拖放都进入同一队列，发出 `panthesia://open-requested`；前端启动就绪后与收到事件时取出最后一个文件，切到练习并 `openFile`。安装包登记 mid / midi / kar、musicxml / mxl、panthesia 文件关联。启动检查模式不启用单实例，以免与正常窗口互相转交。
- 原生拖放启用后，桌面版窗口内不再收到 HTML5 拖放，拖入导入对话框改为用文件选择（导入流程在第 7 项删除）；浏览器调试模式不变。
- 实测（debug 桌面构建，临时资料目录）：带《七里香》参数启动即打开该曲；再次启动带 POP909 001 → 第二个进程立即退出，原窗口打开 001，系统中只有一个进程；歌曲文件旁未生成清单。拖放未做自动化验证（与转交走同一队列）。
- 测试：`file_open` 1 个（无清单直接打开、过期引用找回并写回、演奏变化后音符移入 unmatched）、`open_requests` 1 个。发现：引擎测试需等待启动恢复结束（`startup.ready` 且无 pending）才能发命令；R1 基线中 engine 的许多失败可能只是没有等待，第 5 项处理忙碌状态时一并核对。
- 未完成：加载仍经集中曲库解析并复制到 `library/assets`（第 5 项删除）；"第一次修改时在文件旁创建同名清单"随第 3 项的保存路径实现；打开结果中的清单问题尚未在界面提示（第 3 项歌曲设置中显示）。

下一入口：R2 第 3 项（歌曲设置接入清单）。

## 2026-11-21 · R2 第 1 项：`.panthesia` 格式

- 格式说明 `docs/development/panthesia-format.md` 与 `panthesia-format.schema.json`：顶层字段、文件角色、演奏 / 谱面、图层（hands、fingering、playback、meter、keys、chords、sections、beats、lyrics、tempo、passages、bookmarks）、派生版本、设置。音符引用写作 `[track, onset, pitch]`，音高用于在演奏文件变化后核对。
- `panthesia-core::manifest`：类型（各层对象均保留未知字段）、解析（接受 BOM，更新版本只读）、校验（编号唯一、引用存在、相对路径只用 `/`、stem 必填、confidence / status 取值、音符引用格式）、序列化、`reconcile_notes`（不存在或音高不符的音符引用移入图层 `unmatched`，不删除）。
- `panthesia-engine::manifest_store`：查找顺序（同名清单 → 同级及向上两级中引用该文件的 `song.panthesia`；清单损坏时报错而非替换）、原子写入、BLAKE3 校验、在清单目录树内按大小与哈希找回移动的文件（忽略 `._*`，最多检查 5 万个文件）、相对路径计算（大小写不敏感，去除 `\\?\` 前缀）。
- 测试：core 5 个、engine 4 个单元测试；`corpus_manifests`（`--ignored`）在 `work/` 下复制 `D:\Music\MIDI` 各区样本，按 3.7 表生成 B 站、Look at the Sky、七里香、KAIRCI、POP909、SNH48 六种清单，验证写入、查找、校验与移动后找回；语料目录未写入任何文件。
- 决定：图层载荷在 Rust 中保持 JSON，只对共用字段与 `notes` 做类型校验；具体图层在接入功能时再加类型化读取，避免为尚未使用的图层先写结构。

下一入口：R2 第 2 项（打开：命令行参数、文件关联、单实例转交、拖入；打开时接入 `check` 与 `reconcile_notes`）。

## 2026-11-21 · R1 完成（提交 30cca4b、2374c75 及本条）

- 第 3 项：删除 `legacy_exercise_history`、`legacy_exercise_tracks`、`library_migration` 与 examples 中两个迁移程序、对应协议命令和核对对话框，以及随之失效的 `practice_conditions` 条件比较、`hands::Selection`。`library_repairs` 是集中曲库工作区文件的一部分，移到 R2 与集中曲库一起删除。
- 第 8 项：DuET 独立 venv `D:\Music\_tools\_reference\DuET\.venv`（uv 离线从缓存建立，torch 2.11+cu128，CUDA 可用）；模型目录按设置项 → `PANTHESIA_DUET_MODEL` → `PANTHESIA_MODELS_ROOT/music-transcription/DuET` 查找，程序中不再有本机路径；`Open-Desktop.cmd` 设置本机共享模型库。已用新 venv 实际加载共享库中的模型。调试服务不再回退到旧 Neothesia 工作目录。
- 第 9 项：engine 49.5k 行；`cargo check` 零警告；`assessment-separation.md` 更新。
- 阶段检查：
  - `panthesia-core` 262 通过 / 1 失败（与基线同一个 `score_alignment` 测试；少 2 个为已删 speed_ladder 测试）。
  - `panthesia-engine`（`--skip package_commands`）124 通过 / 40 失败；40 个失败全部在基线失败名单中，无新增失败（基线 121 失败，其余随模块删除）。
  - `panthesia-desktop` 13 通过 / 4 失败，与基线数量相同；其中音源设置测试所测函数本轮未改。
  - 真实资料：备份副本解压到 `work/` 后启动引擎，恢复上次曲目（2468 音符）、无错误；修改速度触发保存后，ladderPresets、routines、songExpressionGoals 等旧键原样保留，每首歌设置只去掉已废弃的 adaptive。
  - 桌面构建 `--headless-check`：全新目录与真实资料副本均 PASS。注意该检查取曲库第一首当作内置练习，曲库根目录指向 `D:\Music\MIDI\Datasets` 时会失败，需设 `PANTHESIA_LIBRARY_ROOT` 为空目录；R2 删除集中曲库时改为直接加载内置练习。
- 临时副本已删除，备份 zip 保留。

下一入口：R2 第 1 项（`.panthesia` 格式与读写）。

## 2026-11-21 · R1 第 1、2、4、7 项：删除评分时代功能（提交 59f9686）

- 引擎：删除评分轮次保存、日课、速度阶梯、表现目标、学习资料、弱项练习、历史回放 / 批阅 / 问题重练、练习备份及其协议命令（`practice_policy.rs` 一并删除）。`Mode` 只接受 wait / listen（flow 视为 listen）；状态快照去掉 routine、ladder、adaptive、表现目标与循环重启字段。
- 用户数据：`web-preferences.json` 中这些功能的键（ladderPresets、routines、songExpressionGoals、loopRestartErrors 等）经已有的 `extensions` 映射原样读回、写回；`library-workspace.json` 的 `learning` 改为不解析的 JSON 原样保留；前端 localStorage 草稿中的 annotations / learning / expressions 同样原样保留。曲目包中的 ladders 读取时忽略、导出时不再写。
- 保留并迁出：指法示范的取消队列与 `replay_index`（示范仍在用）；测试夹具 `seeded` 移到 `test_fixtures.rs`。
- 桌面端：删除备份、历史片段、评语、日课的 Tauri 命令与 `backup_operations.rs`；`practice_backup_bridge.rs` 去掉备份部分后改名 `file_transfer.rs`；便携检查的 save / restore / resume-plan 阶段依赖评分轮次与日课，连同 `scripts/verify-portable.ps1` 删除，`--headless-check` 保留。
- 前端：删除 review / routines / backups 目录、历史与日课对话框、表现目标控件、学习资料对话框、反馈对话框等，以及因此不可达的 29 个文件和 18 个对应 spec；App、Notation、草稿中心、工作进度、浏览位置等去掉相关状态与入口。
- 检查：`cargo check --workspace --all-targets` 通过（剩 `legacy_exercise_history.rs` 3 个死代码警告，第 3 项删除）；`npm run build` 通过。
- 规模：engine 约 51.5k 行（R1 目标 < 50k）。

未完成：`PaperScore` 的 historyFocus 可选属性仍在（已无调用方传入）；部分主线 spec 仍模拟已删命令，RF 跑 Playwright 时一并修。

下一入口：R1 第 3 项（一次性迁移代码）。

## 2026-11-21 · 瘦身目标与先删后改

- R2 完成条件增加 `panthesia-engine` ≤ 3 万行：职责缩小为"打开文件、练习"后，评分、日课、历史回放、备份、集中曲库、导入流水线、目录缓存与五套存储机制都应删除。
- RF 改为先删后改：先删除随曲库、选曲、导入、评分、历史失去用途的对话框与全局 CSS，再建立 token、store 与新结构。

下一入口：R1（继续前先核对 `git status` 中暂停时留下的改动）。
## 2026-11-21 · 减少门禁

- 用户决定减少门禁与测试，快速推进：每批只要求 `cargo check` 与 `npm run build`；crate 测试与实际运行检查移到阶段结束（AGENTS.md 第 3 条）。

下一入口：R1（继续前先核对 `git status` 中暂停时留下的改动）。

## 2026-11-21 · 计划审查修正

- 第 2 节删去"SQLite 歌曲仓库与内容寻址资产"的保留项，与 R2 删除集中曲库一致。
- `lib.rs` 拆分从 R1 移到 R2：在删除集中曲库之后进行，避免先拆出 library、annotations 模块再删除。
- R1 删除历史回放读取代码前，数据原样留在备份中；R2 迁移时只原样归档到练习数据目录 `legacy/`，不解析。
- R2 只做存储、打开与迁移；新增 RF"前端基础"阶段承接 tokens、store、单一 `send()`、状态推送与界面重写。
- Ouro 插件改为薄插件，调用 R2 新增的 `panthesia probe` 子命令，MIDI 与清单解析只在 Rust 中实现一次。
- 新增 `GOAL.md` 作为长期任务入口。

下一入口：R1（会话暂停时有未提交的 R1 删除改动，继续前先核对 `git status`）。

## 2026-11-21 · 迁移授权

- 用户授权 R2 的真实资料迁移，执行时不再询问；条件写在 AGENTS.md。已确认本机账户对 `%APPDATA%\com.ubik.neothesia` 与 `D:\Music\MIDI` 有修改权限，Claude 全局权限模式为 `bypassPermissions`。

下一入口：R1 第 1 项（评分时代命令与模块删除）。

## 2026-11-21 · 定位调整：外部演奏程序与数据跟随文件

- 用户决定：Panthesia 不做曲库管理，曲库由 Ouro（原 Serpent，`D:\Manage\_tools\Serpent`）承担；Panthesia 作为外部演奏程序，由 Ouro 按文件类型打开。技术栈保持 Rust + Tauri + React。
- 用户决定：歌曲数据跟着文件走。新增 `.panthesia` 清单格式（current-plan.md 3.7）：JSON，相对路径引用素材，保存图层与设置；单文件用同名清单，歌曲文件夹用 `song.panthesia`；只在首次修改时创建。
- 调研现有存储：集中库在 `%APPDATA%\com.ubik.neothesia`，1,385 份 MIDI 副本；有用户数据的歌曲约 20 首（轨道分配 15、谱面配对 5、元数据 5，另有约 12 首的段落、书签、变调与会话设置）。
- 实地查看 `D:\Music\MIDI` 各区结构，3.7 节逐区给出清单形态（KAIRCI 伴奏与 MIDI 分处相邻文件夹、周杰伦多版本、B 站多次导出、数据集只读）。
- 计划改动：R2 由"曲库工作台"改为"清单存储与打开文件"（含删除集中曲库与真实资料迁移）；新增 RO（Ouro 插件，依赖 Ouro PF 阶段）；R1 的存储事务合并移到 R2。
- 更新 interaction-model.md 开头说明、research-2026-11.md 第 8 节、AGENTS.md。

下一入口：R1 第 1 项（评分时代命令与模块删除）。

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
