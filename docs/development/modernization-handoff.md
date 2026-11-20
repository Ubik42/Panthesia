# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B04

B00–B03 已收束。当前源码 6082c0f，本批提交完成 P11：usePlaybackActions、PerformanceTools、usePerformanceKeyboard、useSongEditors/SongEditorHost、useScorePairing 和 workNavigation 接管相应职责；App 为 1662 行。旧练习侧栏、抽屉 Hook 与工作区导航等五个组件、三份样式和另外 96 条无消费者样式已删除。选曲、演奏和任务恢复共享现有产品页面；编辑栈核对源身份，同时只挂载顶部编辑器。原始数据未用于本轮核查。

下一轮直接做 B04/P12–P14：沿 playback_driver/session_state/note_playback/audio 与 playbackStore/PracticeStage 收束实时会话、音源端口和关闭顺序，定位代表负载后优化瀑布帧时间。不要继续拆无关页面，不重跑 B01–B03 全流程；两小时方向审核以 goal-state.json 到期时间为准。

独立桌面核对通过：180 首三页列表返回保持搜索/选择/滚动；右键对象查看；源文件移走后资源管理器选中持有副本；按住虚拟键返回选曲会释放并暂停；歌曲选项→谱面管理→返回同时只有一个编辑窗口；配谱超限进入统一状态详情；760×620 无横向溢出。原始 MIDI 与内容标注完全保持，2 条指法及 1 条未匹配行未丢失；PID 7324 正常关闭。一次观察脚本误等主页面错误全文，后通过已有详情入口确认，未改产品逻辑。

Debug：target/debug/panthesia-desktop.exe，SHA256 8D40992EE01FC1A8F309FF46BEC38F3AA4475984CB22F9565694300077BDD2B1，源码 6082c0f 加原有九项目录调整，嵌入当前前端。Web 和 Debug 构建、四项后台导航定向核对通过。摘要 evidence/product-controllers-2026-11-20.json；原记录 work/original-product-reset/p11-window。正式 Release 仍为 a67ea54。

B03 关闭页面/控制器范围，整体目标继续 B04–B07。外部音源听感、长时间性能、长谱、完整录音及旧应用来源替换尚未闭环。标签目前按首个源调号/手动或估计调性及练习转调呈现；曲中多次调号投影与 B05/P15 同批处理。15 个旧未匹配身份保持原回执，不按标题绑定。前批细节见 evidence/product-interactions-2026-11-20.json。

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
