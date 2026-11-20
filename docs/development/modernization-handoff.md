# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B03

B00–B02 已完成，最新实现 c706a2d。下一轮直接开始 B03/P08–P11：UI00 主页、UI01 选曲、UI02 歌曲设置及完整返回路径；随后 UI03 音轨卡片、UI04 自定义分手、UI06 演奏弹出菜单和 UI07 全局设置。按 interaction-model.md 的官方图片逐屏实现，先阅读现有 App.tsx 与 Synthesia 参考索引；按屏幕控制器拆分导航和选择状态，再替换大表单入口。扩展继续留在二级设置，不添加常驻工作台。

B02 已接入 panthesia-music/panthesia-keyboard，桌面普通依赖退出旧 MIDI/布局/原生渲染库。标注 v2、包 v20、稳定源 NoteId 和未应用原行已连通；生成练习使用标准双手缓存进行身份绑定。8 项定向检查通过，独立桌面完成导入/标注/变换/播放/即时等待切换/定位/导出，在新资料目录恢复指法、手别和未映射行；两个窗口正常退出。详细规格 music-domain.md；摘要 evidence/music-domain-2026-11-20.json；原证据 work/original-product-reset/b02-window。

Debug 可执行文件 target/debug/panthesia-desktop.exe，SHA256 254CC13A0CD3066A5D3E334A5F0FD6D433168872B2EA6F42641010C9BC78F14C，源码 c706a2d 加原有目录调整，使用 custom-protocol 嵌入前端。短片段观察到音频输出信号；外部音源、长期性能与渲染优化留在 B04。真实用户资料继续按后台惰性 v2 采用，本批未使用真实歌曲作检查。正式 Release 保持 a67ea54。

不要重跑 B01 迁移或 B02 已通过的兼容检查。旧源码物理删除、NOTICE 与剩余 core 原创替换在 P20/P21 处理；目标整体尚未完成。

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
