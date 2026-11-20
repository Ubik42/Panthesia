# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B05

B00–B04 已收束，B05/P15 部分完成。当前实现 30661bc，本批提交 1fecbbb、ecab0b1、8547393、688df52、30661bc。MIDI 练习谱现按 32 小节生成、排版和映射，翻页与全曲时间跟随跨段工作，空白段仍可跟随；源轨/音符身份、跨段连音、拍号/速度和已有左右手保持。映射核对显示指纹且回执绑定范围，调性估计在后台。

100,016 音符/6,379 小节真实桌面：首段 111,187 字节、末段 39,570 字节；远处定位及原索引超过 100,000 的音符高亮可用，连续播放跨过范围边界仍在播放且无引擎错误。完整范围/边界流程对应 8547393，最终 30661bc 另核对普通和 760×620 窗口、末段高亮、选项和退出。最后一个读取者退出释放线程，正常关闭码 0。源 MIDI 和旧指法字节完整。证据 evidence/measure-windows-2026-11-20.json，原记录 work/original-product-reset/p16-window。

新增修复：启动恢复谱面路径后通过已有资料事务发布注册表，再安装内存快照，避免恢复后导入误判外部修改；真实外部修改仍拒绝覆盖。长时间线按视口宽度留出标签间距，谱面诊断/演奏顺序/DuET 说明移入既有选项。

下一入口：外部 MusicXML 原谱仍整曲排版和映射，4 MiB/100,000 音符上限及纸谱创建 80 页上限仍在；继续原谱重复/跳转上下文与全局身份的范围化，以及曲中调号投影。然后完成 P16 的 DuET 实际生成、持久初稿、取消/超时与采用，及 P17 的变换一致性/ABC；本轮未运行模型。完整录音 B06，旧实现退役/来源审计/正式包 B07。不重跑已通过的 B01–B04 流程。

Debug：target/debug/panthesia-desktop.exe，源码 30661bc 加原有九项目录调整，SHA256 6F60AD44FE6C08D4D4A33B09B19FA8E1A913DA07C2E8F08D91F136B256182E85。Web/协议与最终嵌入前端 Debug 构建通过，四项后端定向检查通过；35 条旧引擎警告与 Vite 分块警告尚在。正式 Release 仍为 a67ea54。15 个旧未匹配身份保留回执，九项原有未提交修改保持。Goal v6 与两小时审核规则未变。

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
