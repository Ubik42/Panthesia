# Panthesia Web＋Tauri 练习室

当前成品：`outputs/releases/Panthesia-20261118-r2-1735cfc/Panthesia.exe`。来源 `1735cfc`，最终 Release 包与重启恢复通过，见 [R2 完成清单](../docs/development/r2-delivery.md)。

2026-11-18 R2 四批已集中接入。作品关系和谱面能力入口位于曲库“文件与资料”，入门配对谱随内置练习提供，备份升级为 v16。当前统一包和逐项结果见 [R2 清单](../docs/development/r2-delivery.md)。以下保留旧视觉版与 R1 来源记录。

此前视觉交付为 `outputs/releases/Panthesia-20261116-visual-a852c07`，包含 T07 界面美化与钢琴特效，源码与包对应。结果和使用方式见 [视觉版交付](../docs/development/visual-delivery.md)。下文保留 R1 基线记录。

新的中文主界面使用 React、TypeScript、Vite 与 Tauri 2。独立的
`panthesia-engine` Rust 工作线程负责播放时钟、MIDI 输入输出、内置钢琴音源、
跟弹匹配和练习记录；界面只发送命令和读取状态。

当前应用版本：**0.1.0（日常练习候选版）**。2026-11-16 本地交付为 `outputs/releases/Panthesia-20261116-1f5cf57`，源码与包对应；证据及人工确认项见 [交付记录](../docs/development/r1-delivery.md)。统一目标见 [当前计划](../docs/development/current-plan.md)，架构见 [架构决策](../docs/development/architecture-decisions.md)，程序位置见 [工程交接](../docs/development/handoff.md)。本轮自动开发结束，R2/R3 单独安排。

具体完成范围与未完成项见 [产品路线](../docs/development/product-roadmap.md) 和 [逐轮开发进度](../docs/development/progress.md)。下面保留早期迁入能力说明；不能用早期批次列表代替当前完整功能对照。

Cycle 115：小节拖选/缩放分页/跟随、实际拍位定位/逐拍移动、完整演奏与背谱、完成后再演奏和薄弱段重练。

Cycle 114：可移植曲目包导出、导入预览、三种冲突处理，以及完整教学标注/谱面版本/分组评级/练习段落恢复。

Cycle 113：直接 MusicXML/MXL 练习、混合批量/拖放导入及可暂停/重启恢复的后台曲库索引已接入。

Cycle 112：逐音分手审阅/保存/撤销、按手生成指法、每手默认跨度、整曲拍号/弱起校正、多谱面版本管理与历史比较范围隔离已接入。完整剩余功能见 [产品路线](../docs/development/product-roadmap.md)。

## 维护界面协议

`npm run protocol:generate` 从 Rust 命令和已迁移业务定义生成界面类型；`npm run protocol:check` 检查生成器、源码同步及类型反例，生产构建会自动执行。当前已迁移技术练习、分手、手型、指法提示／动作、小节网格和音轨设置。新增业务类型时，在 `scripts/generate-protocol.mjs` 注册源文件及类型名，再让界面引用生成结果；原始字段、枚举名称和默认值以 Rust 为准。生成器遇到未支持的序列化形式会停止，需明确补充转换规则。指法方案、接受审阅及双手保存的请求与响应已通过 `src/engine/fingeringApi.ts` 集中对应；普通／持音返回由实际 Rust 结构生成，输出可空字段保留必填语义。示范与历史声音回放通过 `src/engine/demoApi.ts` 共用观察状态，状态更新需核对当前身份与必要字段。数值范围、存档身份及保存条件继续由引擎检查；尚未迁移的业务对象和响应仍需继续整理。

## 轮次保存恢复检查

每轮成绩与回放通过 `round_storage` 的恢复记录共同提交；启动恢复先核对内容哈希及目标文件条件。`scripts/verify-practice.ps1 -SkipBuild -RoundRecovery` 可在独立数据中构造中断状态，再实际重启音乐服务验证恢复。该可选开发检查需要 Python 和 `scripts/requirements-recovery-check.txt` 中的依赖；运行包不依赖它们。临时恢复内容与旧版存档保持分开，后续的设置、计划进度和其他保存路径继续整合。

## 直接运行

仓库根目录双击 `Open-Desktop.cmd` 启动已构建的 Tauri 桌面开发版。
桌面程序内置前端资源，不需要启动浏览器服务器。首次未构建或源码已更新时，入口会先执行构建；构建失败会显示错误并停止。

双击 `Open-Web.cmd` 启动浏览器开发版：后台启动本地音乐服务和前端开发服务，
然后打开 `http://127.0.0.1:5173`。它与桌面版复用同一 Rust 引擎实现。
浏览器开发服务只监听回环地址，桌面版使用 Tauri 命令通信。

内置“从中央 C 开始”的九音五指热身，因此没有外部曲库也可以练习。
外部曲库默认读取 `D:\Music\MIDI\PracticeLibrary\catalog.csv`，
可用 `PANTHESIA_LIBRARY_ROOT` 环境变量指定其他目录。
列表直接读取目录清单；只有选中的曲目才解析 MIDI。

## 早期已接入的基础能力（Cycle 115）

- 中文演奏工作台：可折叠曲库、键盘提示或乐谱、音轨与练习设置、固定播放控制。
- MIDI 拍号、变拍号与速度图；显示小节和拍，按小节导航、选段及循环。6/8 显示两大拍；缺失拍号明确标识为默认值。
- 等音、连续、聆听三种模式；逐音轨练习、伴奏、静音与隐藏。左右手使用声部归属，未知声部可手动指定。
- 有声预备拍、节拍器、循环遍数、独立逐轮成绩、可选自适应速度；每曲设置独立恢复。
- 结构化小节、声部、和弦、时机、力度、踏板和时值反馈；反馈可直接重练段落，历史按模式和声部区分。
- 完整技术练习生成器：调性、大小调与小调形式、音阶/琶音/和弦、手别、方向、八度、遍数及速度；带已有教学指法。
- MusicXML/MXL 配对、真实 Verovio WASM 排版、对齐诊断、可靠音符定位和翻页跟随；支持手动指法编辑。
- 自由演奏录音、MIDI 保存、回放和导出。录音不会覆盖原曲练习模式。
- 收藏、最近、队列与排序；桌面 MIDI/文件夹导入、元数据编辑、内容身份校验与缺失路径重新定位。
- 原生 MIDI/SoundFont、输入重连、紧急停止、设备独立延迟校准；复用原生 VST3 插件发现、编辑器及状态存储后端。
- 公共曲库 12,908 首，加五组原创入门练习。GiantMIDI 自动转录仍标记待校对。

桌面记录保存在 Tauri 用户应用数据目录；浏览器开发版默认使用仓库 `work/web-data`，可用 `PANTHESIA_DATA_ROOT` 覆盖。旧原生程序和历史保留，没有自动合并。

核心共享了原生音轨配置、匹配器、历史、录音器与 VST3 后端。完整功能对照见 [当前产品路线](../docs/development/product-roadmap.md)：指法审阅、网格编辑、曲库整理、文件变化检查和备份已持续扩展；各能力的具体范围与余项以该路线为准。VST3 编辑器兼容性、真实实弹及持续断连恢复仍保留原先实测边界；打开 MIDI 端口不等于完成实弹验收。

## 工程整合入口（2026-11-13）

当前整合任务与阶段边界见 [工程整合计划](../docs/development/modernization.md)。
桌面、音乐服务和便携包复用根目录 `scripts/build-practice.ps1`：

```powershell
# 在仓库根目录执行；日常桌面构建
.\scripts\build-practice.ps1 -Target Desktop -Offline
# 前端、服务、核心测试和真实后端练习／重启检查
.\scripts\verify-practice.ps1 -Offline -Workspaces -Expression -Background -Playback -Imports
# 全新目录中生成优化运行包；附源码版本和文件校验清单
.\scripts\package-web-practice.ps1 -Destination .\outputs\Panthesia-Release
# 需要较快的开发运行包时，显式选择 Debug
.\scripts\package-web-practice.ps1 -Destination .\outputs\Panthesia-Debug -Configuration Debug -Offline
```

离线选项要求依赖已在本机准备。流程检查会独立创建数据和空曲库，只使用内置练习；
端口 5173 或 32124 已占用时停止，不接管现有服务。结束后关闭本次启动的进程，保留日志与测试结果。
`-Workspaces` 增加工作区、会话同步、评语与日历检查；`-Expression` 增加力度与踏板流程；`-Background` 增加控制通道和指法审阅；`-Playback` 增加状态订阅、画布绘制、快捷键及小节导航；`-Imports` 增加后台导入、索引、批量配对、原谱与曲目包检查。各业务用例使用独立数据目录。

引擎命令的 Rust 定义位于 `panthesia-engine/src/protocol.rs`。修改后在前端目录运行
`npm run protocol:generate`；`npm run build` 自动核对生成结果及类型约束。
当前覆盖全部命令名称、必填字段和基础类型。`api.session()` 成组读取曲目与播放状态；其他嵌套业务对象与返回值仍按领域逐步迁入。

`features/practice/usePracticeSession` 管理会话读取与请求代次；`playbackStore` 保存完整快照并提供控制状态和字段订阅。主界面使用控制状态，位置、按键、计时与成绩由各显示组件订阅。操作需要当前小节时调用 `getSnapshot()`，保留过期响应与曲目身份核对。

公共导入调用通过引擎 `import_pipeline` 在后台准备 MIDI 和谱面，再由播放运行时核对当前曲目与版本后安装。文件保存、已有谱面恢复及其他内部加载路径仍按整合计划继续拆分；导入期间可查看任务并取消未提交的准备。

## 开发与构建

```powershell
npm ci
npm run dev
# 另一个后台进程，在仓库根目录运行
cargo run -p panthesia-engine --bin panthesia-service
# 快速生成包含前端资源的桌面开发版
npm run desktop:build:dev
# 优化构建
npm run desktop:build
```

`npm run desktop` 是 Tauri 开发模式，会启动真实桌面窗口；日常前端开发和验证
优先使用浏览器无界面模式。

## 验证

```powershell
cargo test -p panthesia-engine --lib
# 初始化真实音频设备和 SoundFont，不发出音符
cargo run -p panthesia-engine --bin panthesia-service -- --audio-probe
```

浏览器端运行 `npm test`。需要先启动前端和 Rust 本地服务；自动化服务用 `--silent`
避免测试期间发声，并设置独立的 `PANTHESIA_DATA_ROOT`。测试通过真实后端完成
等待、暂停、页面刷新、九音演奏和持久化，不使用模拟后端。
第二项测试读取实际 GiantMIDI 曲库并检查来源提示与窄屏溢出。

本地开发服务协议：`GET /api/library`、`GET /api/state`、`GET /api/song`、
`GET /api/devices`、`POST /api/command`。写请求需要客户端标识，浏览器来源限定为
本地前端地址；曲目加载只允许目录清单登记的路径。桌面导入通过系统文件选择器授权。

Tauri 隐藏窗口检查可设置 `PANTHESIA_HEADLESS_CHECK=1`；实际桌面启动默认显示窗口。
此变量只用于验证窗口生命周期，不会把硬件验证变成无界面测试。
也可运行 `Panthesia.exe --headless-check`：等待真实前端 DOM 与引擎连接，
通过 Tauri IPC 读取内置 MIDI 并初始化音色和音频设备，成功后返回退出码 0。
检查不打开远程调试端口，也不播放音符。
所有启动检查必须设置 `PANTHESIA_DATA_ROOT` 为独立检查目录；窗口设置、缓存与练习资料一同隔离。
Release 包可用 `scripts/verify-portable.ps1 -Package <运行包目录>` 检查：校验资源，导入乐谱，完成两轮模拟输入，关闭后重新启动并继续一轮。检查使用无声引擎，并分别初始化音色、音频设备、乐谱 WASM 和 PDF 渲染器。结果与资料保存在独立目录；真实键盘和声音质量需另行验收。

运行包可通过仓库的 `scripts/package-web-practice.ps1 -Destination <目录>` 重建，
包含 `Panthesia.exe`、`default.sf2` 和中文使用说明。

设置存储在同一数据目录的 `web-preferences.json`，通过临时文件替换保存。
循环范围是 `[起点, 终点)`；终点上的音符归下一段。设置范围会停止当前播放，
点击开始练习后连续重复。跳转需位于当前范围内，或先关闭循环。
每轮清空本轮统计，历史保留各轮结果。设备缺失时给出提示，输入重连不会自动演奏。

Windows 启动脚本使用 ASCII 内容和 CRLF 换行，避免中文文件夹名的命令行编码问题。
便携包双击 `Panthesia.exe`，或使用同目录的 `Open.cmd`。桌面数据目录有进程锁，
避免重复启动同时覆盖练习历史。启动失败会弹出错误并写入临时目录的
`panthesia-startup-error.txt`。`--window-check` 会验证真实可见窗口、DOM、IPC、
曲库、MIDI 和真实音频初始化后退出；验证应使用独立 `PANTHESIA_DATA_ROOT`。
