# 当前交接

更新：2026-11-20。当前目标为原创应用实现、Synthesia 全套主流程交互复刻、扩展后台化。长期 Goal 按用户本次指令重新建立，执行协议见 [current-goal.md](current-goal.md)，唯一队列见 [current-plan.md](current-plan.md)。

## 当前进度

B00 已完成。B01 正在实施：SQLite 目录、管理副本、移动回退、明确工程版本归并及关系恢复已接入；完整标注与真实资料迁移仍待收束。主产品仍有旧实现，完整原创与完整交互复刻都未完成。

来源清单、依赖图与参考索引在 evidence/。旧控制计划和旧交接已移至 archive/2026-11-20；旧日志只作历史证据。默认 Cargo 目标改为 panthesia-desktop；CI 围绕当前 Windows 桌面，旧原生与评分批量测试流程退出活动目录。

## 最近可运行包

`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，Release，源码 a67ea54，指纹 73D7A4E9CB84481A33E1EB8BB03B6E45373E0A82250478F9F9BE36A78ACD3CA0。29 个文件哈希核对、独立窗口启动通过；前端、IPC、音频、制谱 WASM 与 PDF 就绪。它是此前版本，不包含本轮后续架构改造。

三张主界面证据：work/ui-simplification/runtime/synthesia-evidence.json；目录导航：folder-evidence.json；运行包：work/ui-simplification/package-evidence.json。UI01/UI02/UI05 主布局已有，其余下级面板、主页和自由演奏等仍需完成。

## B01 本轮改造与下一入口

实现提交：1dfa556、43bd4ee。

- song_repository.rs 接管歌曲/演奏/位置/谱面关系，repertoire 正常写入退出旧 JSON；旧 repertoire/workspace 原字节先存快照。
- 导入、加载与扫描保存完整 MIDI 副本；旧路径及最近使用支持内容回退，失效旧行不直接追加为可播放结果。桌面路径登记校验同步支持管理位置。
- 明确 midi-info.json 工程关系归并演奏，人工拆分被锁定；自动目录不再随 add_folder 全部写成手动目录，扫描根显式传入；带 catalog.csv 的资料集继续按目录延迟读取，自动发现不批量复制。
- 关系恢复日志增加 SQLite 目录与分组锁快照；中断后回退该快照，MIDI 副本保持不可变。
- 只读报告 work/original-product-reset/look-at-the-sky-relocation.json，摘要 evidence/song-relocation-2026-11-20.json。五个当前文件对应四份内容，四条旧路径精确匹配、一条旧身份未找到；实际用户资料未运行新迁移。
- 已通过四项存储/恢复检查、一次目录扫描改名/替换检查及当前桌面编译。日志 work/original-product-reset/{repository-tests,monitor-repository-test,desktop-repository-check}.log。未重打运行包。

继续 B01，不重做整库调查：从 annotation_path、hand_annotations、library::enriched、library_metadata 和 practice_backup 继续；收束 preferences.parts、RON 附件与 workspace 活动写入口，加入完整资产迁移/备份和回退清单，然后实际迁移并核对完整选曲→演奏。导入 imports、副本、workspace 投影和内容附件目前属于过渡路径，不能宣称 P01/P04 已全部完成。当前可运行包仍是上文 a67ea54。

## 工作区保护

本轮前已有九项未提交的曲库路径/文档修改：docs/pages/practice-library.md、engine 的 library/main/package_commands、web README、Tauri main、三份曲库脚本。不能覆盖或回退；需要在这些文件继续开发时保留其意图并整合。允许替换旧实现和删除退役代码，用户文件与设置的迁移按 song-core.md 执行。

旧完整记录见 [历史交接](archive/2026-11-20/modernization-handoff.md)。评分分支说明见 [assessment-separation.md](assessment-separation.md)。

## B00 有限检查

活动文档 20 份、48 个本地链接核对通过；Cargo metadata 确认默认目标为 panthesia-desktop；活动工作流 YAML 可解析；两份新增脚本可解析，方向检查点已记录。此批未重编桌面、未重跑旧评分测试、未重打包；最近运行包仍为 a67ea54。
