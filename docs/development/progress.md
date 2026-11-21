# 进度记录

每轮一条，新记录在上。计划与阶段定义见 [current-plan.md](current-plan.md)。

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
