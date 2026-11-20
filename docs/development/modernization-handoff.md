# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 最新批次：MIDIVisualizer 实时特效已接入

2026-11-20 用户授权恢复并追加实时特效。实现提交 6b2a207。PianoEffects 以 WebGL2 实例图层绘制瞬态光晕/光束/涟漪/星屑，外观预览共用；播放、输入和声音仍由 Rust 负责。Snapshot 新增 pressedKeys 力度/击键序号，前端实时通道接入。上游 MIT 公式来源、固定提交、原许可及随包拷贝已登记，详情 visual-renderer.md。

Web 与嵌入 Debug 编译、实际自由演奏/连续播放、重弹、减少动画、关闭/暂停/定位清理、显卡丢失回退/恢复、窄屏通过；正常退出码 0。证据 evidence/midivisualizer-2026-11-20.json，原记录 work/midivisualizer/runtime。Debug SHA256 257C3173B1FD74A2D65E3EA55E3648CB3DAB6E9F46EF2E46DE025E24D198B72D。正式 Release 未更新；离线视频、3D 未实现。

工具长期 Goal 已清除，本批按用户直接指令执行，未自动重建。执行文件 v7，方向检查已记录。上批暂停源码及原九项路径改动已并入 c7ecdee 并上传；只读谱面实际流程仍未补完。下方 B05 是其已提交基线；下一入口继续 P15 收束，随后 P16/P17、B06/B07。不要重跑已通过的本批实时光效或此前音源负载检查。

## 当前批次 B05

B00–B04 已收束，B05/P15 部分完成。当前实现 5453e81，本批 3a91b42、6d58014、614e10e、5453e81。MIDI 练习谱与外部原谱的演奏范围链均已接入；原谱按书面小节范围、原始记号和稳定源音符身份显示，完整演奏路线决定重复/跳转时的全局位置。窗口携带此前调号/谱号/拍号/速度及活动方向跨度，映射核对源与显示指纹。资产和曲目包原谱边界 64 MiB，单次显示 4 MB；原谱规划与选段共用 100,000 次经过边界。首次导入仍准备整曲语义与演奏，原始 source/标注不改写。

实际 12,728,710 字节/25,001 小节/100,004 音符原谱导入约 12.2 秒，首段 XML 16,261 字节，末段 5,006 字节；远处原音符 100002 可定位。连续播放从书面第 64 小节反复回第 1 小节时，高亮第二遍演奏。范围纸谱显示范围，36 音符保留 36、跳过 0；大曲目包导出/检查及内层 XML 原字节核对通过。完整范围/反复/归档对应 614e10e，最终 5453e81 补核对纸谱与退出；原 XML、反复谱、旧指法保持，正常退出码 0。证据 evidence/authored-score-windows-2026-11-20.json；原记录 work/original-product-reset/p17-window。

下一入口仍为 P15：ScoreFilePreview/ScoreDocumentPreview 的独立查看保留整曲排版及部分 4 MB 入口，需统一到范围服务；然后处理曲中调号投影。整曲纸谱制作及 80 页每次上限仍待收束。之后 P16 的 DuET 实际生成/持久初稿/取消超时/采用，P17 变换一致性/ABC。本轮未运行模型。完整录音 B06，旧实现退役、来源审计和正式包 B07。不重跑 B01–B04 已通过流程。

Debug：target/debug/panthesia-desktop.exe，源码 5453e81 加原有九项目录调整，SHA256 F78A96EA06F8E26D15EB80431221F4C7C8A49BC35CC5F6B42AD69EB3C743F5F6。Web/协议、嵌入 Debug 和三项定向后端检查通过；35 条旧引擎警告及 Vite 分块警告仍在。正式 Release 仍为 a67ea54。Goal v6、两小时审核与 15 个旧未匹配身份的处理保持；本批未改 Goal 正文。B05 历史检查点已从活动计划移入 archive/2026-11-20/p15-window-checkpoints.md。

## B01 已闭环的状态

- SQLite 管理歌曲/演奏/来源；文件、内置/生成练习、历史和旧练习共用持有资产与 JSON 标注。轨道编辑和资料操作走后台事务，旧格式通过导入兼容。
- 整歌归档覆盖全部演奏包、歌曲归属、分组锁和谱面身份，文件事务与 SQLite 回执支持中断继续。普通导出、媒体制作、预览、暂存导入均已接入。
- 资料编辑、默认值恢复、Synthesia 导入、扫描重联和原生重定位统一写入内容标注。Workspace 是读取投影；列表在去重前应用当前标注，源位置变化与旧缓存不覆盖已保存值。

## 真实迁移与运行证据

本批实际资料的 38 个登记身份中，23 份演奏已迁入，失败 0；15 个身份未在登记位置、资料缓存和相关 MIDI 目录命中原字节。旧记录和设置保留，后续来源恢复可按内容重联。源 MIDI、旧附件、旧工作区、旧 repertoire 和历史未改写；新迁入的有效左右手分配已核对。回执 work/original-product-reset/saved-library-migration-final-20261120.json，冷快照同名 .snapshot，核对 saved-library-verification.json；摘要 evidence/b01-closure-2026-11-20.json。真实资料操作用于迁移，检查夹具全部使用内置素材和独立资料。

两项兼容保存/重联检查、一项文件+生成练习+谱面迁移检查通过；最终 Debug 桌面构建通过。独立桌面按已移动的旧路径读取/保存资料后，JSON、列表名称与指法均正确，旧附件和 MIDI 字节未变；最终窗口已关闭。记录 work/original-product-reset/compatibility-window。开发构建包含原有九项目录调整；正式包仍为下文 a67ea54。

前批证据 annotation-migration-2026-11-20.json、owned-assets-2026-11-20.json、song-archive-2026-11-20.json 均在 evidence 目录。Look at the Sky 的五来源/四演奏归同一歌曲关系保持，原工程回执及快照仍在 work/original-product-reset。

## 最近可运行包

`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，Release，源码 a67ea54，指纹 73D7A4E9CB84481A33E1EB8BB03B6E45373E0A82250478F9F9BE36A78ACD3CA0。29 个文件哈希核对、独立窗口启动通过；前端、IPC、音频、制谱 WASM 与 PDF 就绪。它是此前版本，不包含本轮后续架构改造。

三张主界面证据：work/ui-simplification/runtime/synthesia-evidence.json；目录导航：folder-evidence.json；运行包：work/ui-simplification/package-evidence.json。UI01/UI02/UI05 主布局已有，其余下级面板、主页和自由演奏等仍需完成。

## 工作区保护

本轮前已有九项未提交的曲库路径/文档修改：docs/pages/practice-library.md、engine 的 library/main/package_commands、web README、Tauri main、三份曲库脚本。不能覆盖或回退；需要在这些文件继续开发时保留其意图并整合。允许替换旧实现和删除退役代码，用户文件与设置的迁移按 song-core.md 执行。

旧完整记录见 [历史交接](archive/2026-11-20/modernization-handoff.md)。评分分支说明见 [assessment-separation.md](assessment-separation.md)。

## B00 有限检查

活动文档 20 份、48 个本地链接核对通过；Cargo metadata 确认默认目标为 panthesia-desktop；活动工作流 YAML 可解析；两份新增脚本可解析，方向检查点已记录。此批未重编桌面、未重跑旧评分测试、未重打包；最近运行包仍为 a67ea54。
