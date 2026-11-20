# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B05

B00–B04 已收束。当前实现 0fe4dc5，本批 2331d0c、63cd930、c35484a、0fe4dc5；详见 current-plan.md 的 B05/P15 检查点。分页 SVG、32 MiB / 16 页缓存、准备阶段共享租期、无 SVG 的 MEI 索引、压缩谱统一解码与实际升降音修复已接入。最后一个读者退出即释放排版线程，纸谱聚焦等待异步页面后执行。

21 页/8,000 音符实际桌面：首屏只渲染一页，全部定位、跳过零，末页可读。缓存淘汰、准备取消/共享/重开和线程释放有原始记录。完整流程对应 c35484a；最终 0fe4dc5 另做压缩谱首屏及离开页面核查，正常关闭退出码 0。原 MIDI、旧指法与未匹配标注完整。证据 evidence/paged-notation-2026-11-20.json；独立资料 work/original-product-reset/p15-window。不要把此负载当作无限长谱证明。

下一入口仍为 P15：整曲排版、元数据和映射的范围化，保留源身份与全局时间；4 MiB / 100,000 音符限制及纸谱 80 页限制仍在。随后做曲中调号投影，将常驻谱面诊断移入既有选项，再沿 duet_score/score_jobs/duet_worker 完成结果持久归属、取消/超时、采用与变换一致性。P16/P17 未完成，完整录音 B06，旧实现退役/来源审计/正式包 B07。不重跑 B01–B04 已通过流程。

Debug：target/debug/panthesia-desktop.exe，源码 0fe4dc5，加原有九项目录调整，SHA256 243613D49F70DC59DC0C9D6B060C064B3763F9EC6CADA8ED5238BBCF29C153D1。Web、引擎和最终 Debug 构建通过。正式 Release 仍为 a67ea54。15 个旧未匹配身份保留回执，已有九项未提交修改保持。方向检查仍按 current-goal.md 每两小时执行；本批未改 Goal 正文。

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
