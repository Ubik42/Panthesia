# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B03

B00–B02 已完成；本轮源码 026001a，B03 继续。P09/P10 的声部持续预听、源音色、拖动复制/全部声部、模式配色、自动配色/恢复默认、双指分手、完整独立标签与当前练习调性拼写均已接入。音乐设备使用输入/输出对象列表；设备、外观/键盘/快捷键从主页设置进入整页叶页。旧侧栏布局选项、重复标签字段和重复转调面板已移除。

下一轮直接推进 P11：演奏工具栏组合、编辑窗口协调、键盘快捷键与后台接续仍集中在 App.tsx；移到现有页面控制器并退出旧抽屉/旧工作区适配。useProductNavigation/usePartSettings 已拥有相应导航和声部操作，四个旧检查栏/音轨表单组件及 74 条失去消费者的 CSS 选择器已删除。随后对 UI01 长列表定位与 UI09 对象右键做随改动核对，再进入 B04。不要重做本轮已通过的全部交互或 B01/B02 迁移。

连续声部编辑从 getBoundSong 取得最新修订，并核对原 contentId/engineId；分手与恢复默认另有 proof。Track/TrackAppearance/TrackSound/ResetPartSettings 进入受保护的 practice_edit 保存。按手别的配色/显示随既有 TrackAppearance 与曲目包保存。自定义逐音分手不向另一条源轨猜测复制。

预听复用独立试听调度器，乐句在内存中限量循环，由前端续租；停止、失焦、租期结束或实际输入会退出，用户按键/录音/历史/判定不接收预听事件。原始调性与 effectiveTonic/effectiveFifths 分开，原始 MIDI 和源 NoteId 不因标签/转调显示而变化。当前标签按首个源调号/手动或估计调性及转调呈现；曲中多次调号变化尚未投影到标签。

Debug：target/debug/panthesia-desktop.exe，SHA256 E3139B9A032F3B032EF8426D16C0C1C408FBC978EF3CD2C9A1E5A707ECA4DA71，源码 026001a 加原有九项目录调整，custom-protocol 嵌入当前前端。三项定向后端检查与 11 个标签格式情况通过。独立桌面核对声部/设置/标签，双指通过触控模拟；最终源码另核对转调主音/调号、连续 Track 保存与设置清理。原始 MIDI、2 条指法和 1 条 unmapped 标注完整，窗口正常关闭。摘要 evidence/product-interactions-2026-11-20.json，原记录 work/original-product-reset/b03-details-window。

已修复实际发现的内部拖动触发文件导入：目标停止事件传递，全局入口仅接受文件拖动。预听观察脚本曾尝试替换只读的 Tauri invoke，后改为实际输出电平/界面状态，原失败观察记录保留；不应将它解释为预听无声。最终检查不需要重新替换 host API。

正式 Release 仍为 a67ea54；本批未完成 Windows MIDI/Pianoteq 的听感、长时间性能、全录音与整体原创交付。真实用户资料未用于检查，15 个旧未匹配身份继续保留。B02 音乐域与 v2/v20 协议详见 music-domain.md。

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
