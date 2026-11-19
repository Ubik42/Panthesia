# 工程交接

2026-11-19：长期现代化改造已开始，当前进度与下一批入口见 [长期开发交接](modernization-handoff.md)。下列程序是此前可运行版本，尚未包含本轮架构改造。

最新包为 `outputs/releases/Panthesia-20261118-waterfall/Panthesia.exe`，增加皮肤、琴键材质、网格透明度及转调量化，见 [本批交付清单](visual-variants-delivery.md) 与 [练习版本规范](practice-variants.md)。

此前日常练琴版入口及三批清单见 [日常练琴版交付](daily-delivery.md)。此前版本按各自日期读取。

## R2 四批：2026-11-18

本轮状态更正：用户实际使用发现演奏无声、退出双框，以及速度、时间线、目录树和页面流程的缺口。现有 basic-ux 包用于复现，当前可用性结论与后续实施顺序以 [日常可用标准与界面重整](usability-reset.md) 为准。本轮只调查与更新计划，未交付新的修复包。

最新基础体验包：`outputs/releases/Panthesia-20261118-basic-ux/Panthesia.exe`。修复扫描目录显示、顶部菜单与练习布局、等待/连续即时切换，以及普通 MIDI 的直接双谱表。使用实际 Look at the Sky MIDI 检查，结果见 [基础体验交付](basic-ux-delivery.md)。下文保留 R2 来源记录。

此前 R2 入口：`outputs/releases/Panthesia-20261118-r2-1735cfc/Panthesia.exe`。干净源码 `1735cfc`，构建 `925d59c51e9a4a5486a9862e01bd6dfe`；该批最终包核对通过，完整清单见下文链接。

本批实现与统一运行包位置见 [R2 四批清单](r2-delivery.md)。旧视觉版和 R1 记录继续保留，以下段落按原日期读取。

## 此前视觉版：2026-11-16

直接运行 `outputs/releases/Panthesia-20261116-visual-a852c07/Panthesia.exe`。已含统一视觉、练习/演出光效、三组配色、强度及减少动画设置；最终包全新资料启动与 11 项文件核对通过，Keystation 已连接。操作和证据见 [视觉版交付](visual-delivery.md)。

## R1 基线交接记录：2026-11-16

**R1 基线入口：`outputs/releases/Panthesia-20261116-1f5cf57/Panthesia.exe`。** 同目录 `Open.cmd` 也可启动。源码为干净提交 `1f5cf57`，之后仅补交付文档。最终包通过资源、MusicXML 导入、练习与保存、重启恢复、再次重启的计划进度及左右手个人指法恢复。内置音源和实际音频输出流初始化通过。

日常界面的两轮练习、历史恢复、弹窗输入及窄窗操作通过；Keystation 61 MK3 实际端口连接和软件重连通过，暂停/止音/跳转清除按键状态。人工手弹、物理拔插和长期使用仍待确认。完整证据、来源版本和限制见 [R1 交付记录](r1-delivery.md)。本轮自动开发结束，R2/R3 不自动展开。GitHub、既有安装版与用户资料保留。

以下为本日恢复开发前的审查快照；其中暂停状态和版本差保留历史含义，当前入口以上文为准。

开发已暂停，原 Goal 已清除。当前目标和逐项结论见 [统一计划](current-plan.md)，技术讨论见 [研讨复核](discussion-review.md)，架构约定见 [架构决策](architecture-decisions.md)。原五阶段仍有缺口。

| 对象 | 位置或状态 |
| --- | --- |
| 已提交代码基线 | `feature/pianoteq-vst3` / `629ed19` |
| 未提交批次 | 29 个已跟踪前端文件＋新增 `src/app/inputOwnership.ts`；输入归属、焦点和快捷键；尚未类型检查、构建或运行 |
| 最近统一 Release 包 | 仓库内 `outputs/releases/Panthesia-20261115-426d359/Panthesia.exe`；源码 `426d359`，落后基线 25 个提交 |
| 便携包入口 | 包内 `Open.cmd`；与源码入口区分，启动前查看随包 `build-info.json` 和使用说明 |
| GitHub 开发分支 | 本轮只读查询为 `7ce0533`，基线领先 102 个提交；本轮未上传 |

恢复工作时先处理保留的未提交批次，再按 R1 清单收口实际流程与最终包。源代码、外部曲库、练习数据、配置及历史输出均保留。最终交付需要让代码提交、程序来源和使用记录对应。

下文为 **2026-11-12 历史收尾记录**，其测试数量、版本与后续清单保留当时含义；当前验收顺序以统一计划为准。

更新时间：2026-11-12。源码基线为 Cycle 362；本次完成工程整理、构建修复和本地验证。

## 日常入口

- 根目录 `Open-Desktop.cmd`：启动中文桌面练习室。首次运行或源码更新后自动构建，需要 Rust、Node.js/npm 和 Windows WebView2。
- 根目录 `Open-Web.cmd`：启动本地音乐服务、前端服务和浏览器。适合开发调试。
- 旧原生界面：根目录 `cargo run --release`，使用独立的旧界面与配置。

## 目录与资料

| 位置 | 内容 |
| --- | --- |
| `panthesia-web/src` | React 中文练习界面 |
| `panthesia-web/src-tauri` | Windows 桌面壳 |
| `panthesia-engine` | 播放、设备、评分与练习流程 |
| `panthesia-core` | MusicXML、指法、曲库与历史等共享逻辑 |
| `scripts` | 启动准备、便携包、曲库和诊断入口 |
| `target`、`panthesia-web/dist` | 本机构建输出，Git 已忽略 |
| `work`、`test-results` | 本机运行数据与测试结果，Git 已忽略 |
| `outputs` | 既有截图与导出文件，保留原件，Git 已忽略 |

桌面练习数据默认保存在 Tauri 用户应用数据目录；浏览器开发版默认使用 `work/web-data`。`PANTHESIA_DATA_ROOT` 可指定独立数据目录。既有 `settings.ron`、`vst3-state`、练习数据、曲库及截图均保留。

[产品路线](product-roadmap.md) 记录当前功能范围；[逐轮进度](progress.md) 和 [Backlog](backlog.md) 保留历史记录。旧进度中的测试和构建限制描述对应当轮状态。

## 本次修复

- 双手指法方案类型改为明确替换通用方案中的音符列表；音符键函数只要求音轨和索引，恢复前端类型检查。
- MusicXML 空白文本判断去除有歧义的类型转换；拍位相加先约去分母公因子，修复高精度回音落点计算溢出。
- 修正测试中的练习统计类型、普通整曲条件和引用生命周期；持音换指断言按实际手指评分，并检查确有源音换指动作。
- 统一两份 README 的源码批次，补齐 Cycle 354–362 的状态入口，并说明上游下载与本地分支的关系。

## 验证

- 前端：`npm run build` 通过。
- 文档：`npm run build`（在 `docs` 中）通过。
- 共享核心：`cargo test -p panthesia-core --lib --offline`，260 项通过。
- 练习引擎：`cargo test -p panthesia-engine --lib --offline`，192 项通过。
- 桌面：`cargo build -p panthesia-desktop --features custom-protocol --offline` 通过。
- 桌面启动：使用独立 `work/closeout-2026-11-12/headless` 数据目录执行 `--headless-check`，退出码 0。

构建仍提示部分前端资源包超过 500 kB，以及少量 Rust 未使用函数；可作为后续维护项。

## 后续工作

1. 用真实 MIDI 键盘验证实弹、音频中断、重连和长时间练习。
2. 验证真实 Audiveris 识谱、MuseScore 编辑往返及 VST3 编辑器与重启恢复。
3. 执行完整浏览器交互回归；既有 `test-results` 中的失败记录保留，本次未运行浏览器套件。
4. 按产品路线另行推进安装器、自动更新和跨平台验收。

本次完成本地开发版收尾；正式发行与硬件验收继续按上述清单推进。
