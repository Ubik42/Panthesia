# 当前交接

更新：2026-11-20。当前目标为原创应用实现、Synthesia 全套主流程交互复刻、扩展后台化。长期 Goal 按用户本次指令重新建立，执行协议见 [current-goal.md](current-goal.md)，唯一队列见 [current-plan.md](current-plan.md)。

## 当前进度

B00 已完成，B01 继续收束。文件演奏的内容标注、统一导入、移动回退和后台轨道编辑已接入，Look at the Sky 已实际迁移。完整原创与完整界面复刻仍未完成。

## 最近可运行包

`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，Release，源码 a67ea54，指纹 73D7A4E9CB84481A33E1EB8BB03B6E45373E0A82250478F9F9BE36A78ACD3CA0。29 个文件哈希核对、独立窗口启动通过；前端、IPC、音频、制谱 WASM 与 PDF 就绪。它是此前版本，不包含本轮后续架构改造。

三张主界面证据：work/ui-simplification/runtime/synthesia-evidence.json；目录导航：folder-evidence.json；运行包：work/ui-simplification/package-evidence.json。UI01/UI02/UI05 主布局已有，其余下级面板、主页和自由演奏等仍需完成。

## B01 当前改造与下一入口

实现提交：4613db3；上一批目录与副本提交 1dfa556、43bd4ee。

普通文件演奏使用 library/assets/midi 副本和 library/annotations/<contentId>.json。旧 RON 与旧有效 parts 只在首次采用时迁入，并保存原字节快照；后续普通演奏不再写回 parts。轨道播放职责仍是会话配置。Track 编辑的普通命令和 adjust_playback 都进入后台事务，旧 Sidecar 日志明确恢复旧 RON 地址。旧 workspace 条目追加已移除，目录记录一次性导入 SQLite。

六项定向存储检查通过；独立桌面 IPC 完成分手/指法保存、移动源文件、按旧位置打开和重启恢复。证据位于 work/original-product-reset/annotation-window2。最终 Debug 已构建并重新打开独立资料确认；正式包仍是上文 a67ea54。开发构建包含原有九项未提交工作，不把其来源混入本轮提交。

真实 Look at the Sky 已迁移：五个来源、四份内容、一个歌曲、四条可播放记录，量化版轨 1=右手、轨 2=左手。原源文件与旧设置/工作区哈希未变；未匹配旧身份保留。最终回执 work/original-product-reset/look-at-the-sky-migration-final-20261120.json，冷快照同名 .snapshot；首次迁移前快照也保留。工程工具 examples/migrate-song-project.rs 支持先生成计划，再在独占资料锁和冷快照下执行 --apply；已完成的报告与快照不会被覆盖。摘要见 evidence/annotation-migration-2026-11-20.json。

下一批继续 B01：从 library_scores、score_attachments、package_commands 接入谱面/PDF 资产持有及完整备份，再迁出内置模板、生成练习、曲目包等非文件演奏入口和旧元数据兼容写入。其余真实曲库随后迁移。不要重复当前六项检查或整库调查；新改动只检查关联风险。B01 尚未完成，不能直接进入 B02 或宣称整体交付。

## B01 后续检查点：持有谱面与可移植演奏

2026-11-20，源码 c72d1fb。MusicXML/MXL 进入 library/assets/notation；内置模板和生成练习迁入 library/assets/midi|exercises 与 library/annotations。旧文件原样保留并经导入快照记录。启动恢复在后台准备持有资产，重新捕获标注和配套谱面的观察记录；歌曲读取优先使用中心持有副本。

单演奏包升级 panthesia-piece 第 19 版，原始 MIDI 与转调/量化参数分开保存；MusicXML 和纸谱一起导入，文件提交后立即登记目录。旧第 1–18 版可读。完整歌曲多演奏归档仍待完成。

三项关联检查通过：源谱丢失/副本变化恢复、旧内置/生成练习迁移、原始 MIDI+变换+手别/指法+谱面包往返。当前 Debug 桌面已构建；独立资料完成原生导入→保存谱面→转调量化→包往返→目录登记→关闭重开，启动无警告。两次独立窗口均正常关闭。摘要 evidence/owned-assets-2026-11-20.json；完整记录 work/original-product-reset/unified-assets-window。正式运行包仍为 a67ea54，本轮没有修改前端或实际迁移其他用户曲库。

下一批仍为 B01：完整歌曲归档；元数据/位置修复和 routine 等兼容入口的旧写入收束；其余真实曲库的可恢复迁移。不要重跑本批三项或此前六项检查。保持主流程复刻 Synthesia、扩展留后台和评分隔离边界。

## 工作区保护

本轮前已有九项未提交的曲库路径/文档修改：docs/pages/practice-library.md、engine 的 library/main/package_commands、web README、Tauri main、三份曲库脚本。不能覆盖或回退；需要在这些文件继续开发时保留其意图并整合。允许替换旧实现和删除退役代码，用户文件与设置的迁移按 song-core.md 执行。

旧完整记录见 [历史交接](archive/2026-11-20/modernization-handoff.md)。评分分支说明见 [assessment-separation.md](assessment-separation.md)。

## B00 有限检查

活动文档 20 份、48 个本地链接核对通过；Cargo metadata 确认默认目标为 panthesia-desktop；活动工作流 YAML 可解析；两份新增脚本可解析，方向检查点已记录。此批未重编桌面、未重跑旧评分测试、未重打包；最近运行包仍为 a67ea54。
