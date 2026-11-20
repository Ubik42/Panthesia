# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B05

B00–B04 已收束，当前源码 f5a4e4c（本批 db70b6a、f5a4e4c）。PlaybackSession、playback_adapter 与统一 musical_position 已接入；普通节拍器、模式/手别保留位置、栈 MIDI 包和有界音符/标签缓存已完成。Driver 不再逐 tick 捕获保存，资料变更仍由后台事务确认。来源分类与兼容边界见 A16 及 source-independence.md。

最终桌面完整播放 19,200 音符的五分钟素材，16894 帧，P95 18.50 ms，P99 18.70 ms，无显示倒退，结束无音源错误。Windows GS 与 Pianoteq 系统回录有实际信号，panic 后近零；内置音源、音量零及模式切换亦已核对。USB 输入已连接，所需和弦用软件键事件验证。播放并按住音符时正常退出，退出码 0；原始 MIDI 与标注完整。此证据限当前主机与该负载，不是实体琴键手感或全部硬件的证明。

下一轮直接做 B05/P15–P17：notation.rs 的整曲容量拒绝和 Notation/scoreRenderCache 的全页持有需要改为范围/分页准备、映射和缓存；随后沿 duet_score/score_jobs/duet_worker 收束源/版本、取消超时、持久结果及采用。曲中多调号投影同属 P15。扩展仍走歌曲设置和谱面入口，完整录音继续 B06，旧 core/Player 应用实现与正式包继续 B07。不要重跑 B01–B04 已通过的流程。

Debug：target/debug/panthesia-desktop.exe，SHA256 55824DBB774AC6E31F16F535C93438CF71614651278DF1CF6B707C1696A6A375，源码 f5a4e4c 加原有九项目录调整。Web、最终 Debug 构建和四项会话/控制检查通过。旧 Synthesia 导入检查曾读取退役附件，已改读内容标注并单项通过。观察脚本已改用显式 await 主机状态；原异步浏览器谓词会把 Promise 当作成功。绘制计数探针约两秒间隔没有在普通 UI 起播和完整播放重现，原记录保留。摘要 evidence/playback-session-2026-11-20.json；原记录 work/original-product-reset/p12-window。

正式 Release 仍为 a67ea54；B05–B07 整体目标继续。15 个旧未匹配身份保持回执，不按标题绑定。已有原始资料与九项未提交目录修改保持。

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
