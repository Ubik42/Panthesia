# 当前交接

更新：2026-11-20。原创 Panthesia 应用实现、Synthesia 全套主流程交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前进度与下一入口

B00 完成，B01 继续收束。最新实现 16081cf；此前目录/标注/资产提交为 1dfa556、43bd4ee、4613db3、c72d1fb。

- SQLite 管理歌曲、演奏与来源；持有 MIDI、MusicXML 与内容标注 JSON。内置/生成练习、文件导入、启动、历史和旧练习入口共用持有链。轨道编辑走后台事务，旧 Sidecar 日志兼容旧地址。
- 文件歌曲的常规导出已覆盖整首歌曲全部演奏。panthesia-song 第 1 版组合 panthesia-piece 第 19 版，带歌曲关系、分组锁、谱面身份、手别/指法及练习变换。恢复经文件事务与 SQLite 回执完成，支持中断继续；旧单演奏包仍可读。演奏记录和设备设置留在本机。
- 旧 repertoire 变化只补入新记录/位置，已有分组、标题和谱面决定继续有效。历史和旧练习加载统一进入持有链。应用菜单在选择操作后收起，归档预览列出全部演奏，导出说明已缩短。

下一批 B01 只剩：元数据/位置等旧兼容写入口迁出；其余已保存/登记曲库资料的可恢复迁移与未匹配身份报告。入口 library_edits.rs、library_workspace.rs、library_metadata.rs、library_repairs.rs 和 examples/migrate-song-project.rs。处理真实资料前取得独占锁和冷快照，按实际登记/保存对象迁移；不提前复制尚未采用的整个外部数据集。完成后进入 B02 原创 MIDI/时间模型。主线评分隔离、前端复刻和后台边界继续执行。

## 当前验证与实际资料

本批四项归档检查、一项旧目录保护检查通过；前端构建通过。独立桌面完成两版本导出、另一个资料目录恢复、再导出和最终开发版重开，歌曲关系、转调量化及谱面校对状态保持正确；常规/较窄窗口检查通过，菜单不遮挡归档标题。最终独立窗口已关闭。摘要 evidence/song-archive-2026-11-20.json，完整记录 work/original-product-reset/song-archive-window。开发构建包含原有九项目录调整。

前批标注/持有证据为 evidence/annotation-migration-2026-11-20.json、evidence/owned-assets-2026-11-20.json。不要重复本批与前批已通过的检查，新增变化只检查关联风险。

真实 Look at the Sky 前批已迁移：五来源、四份内容、同一歌曲、四条可播放记录；量化版轨 1=右手、2=左手，未匹配身份保留。本批仅只读核对了实际资料目录，四份持有资产存在、四份演奏仍同组；没有迁移或修改其他真实资料。原回执 work/original-product-reset/look-at-the-sky-migration-final-20261120.json，冷快照同名 .snapshot；首次迁移前快照也保留。

## 最近可运行包

`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，Release，源码 a67ea54，指纹 73D7A4E9CB84481A33E1EB8BB03B6E45373E0A82250478F9F9BE36A78ACD3CA0。29 个文件哈希核对、独立窗口启动通过；前端、IPC、音频、制谱 WASM 与 PDF 就绪。它是此前版本，不包含本轮后续架构改造。

三张主界面证据：work/ui-simplification/runtime/synthesia-evidence.json；目录导航：folder-evidence.json；运行包：work/ui-simplification/package-evidence.json。UI01/UI02/UI05 主布局已有，其余下级面板、主页和自由演奏等仍需完成。

## 工作区保护

本轮前已有九项未提交的曲库路径/文档修改：docs/pages/practice-library.md、engine 的 library/main/package_commands、web README、Tauri main、三份曲库脚本。不能覆盖或回退；需要在这些文件继续开发时保留其意图并整合。允许替换旧实现和删除退役代码，用户文件与设置的迁移按 song-core.md 执行。

旧完整记录见 [历史交接](archive/2026-11-20/modernization-handoff.md)。评分分支说明见 [assessment-separation.md](assessment-separation.md)。

## B00 有限检查

活动文档 20 份、48 个本地链接核对通过；Cargo metadata 确认默认目标为 panthesia-desktop；活动工作流 YAML 可解析；两份新增脚本可解析，方向检查点已记录。此批未重编桌面、未重跑旧评分测试、未重打包；最近运行包仍为 a67ea54。
