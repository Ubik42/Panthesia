# 当前交接

更新：2026-11-20。当前目标为原创应用实现、Synthesia 全套主流程交互复刻、扩展后台化。长期 Goal 按用户本次指令重新建立，执行协议见 [current-goal.md](current-goal.md)，唯一队列见 [current-plan.md](current-plan.md)。

## 当前进度

B00 工程调查与入口清理已完成；下一批 B01：歌曲/资产持有、移动后自动关联、版本归并、左右手标注归属。主产品仍有旧实现，完整原创与完整交互复刻都未完成。

来源清单、依赖图与参考索引在 evidence/。旧控制计划和旧交接已移至 archive/2026-11-20；旧日志只作历史证据。默认 Cargo 目标改为 panthesia-desktop；CI 围绕当前 Windows 桌面，旧原生与评分批量测试流程退出活动目录。

## 最近可运行包

`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，Release，源码 a67ea54，指纹 73D7A4E9CB84481A33E1EB8BB03B6E45373E0A82250478F9F9BE36A78ACD3CA0。29 个文件哈希核对、独立窗口启动通过；前端、IPC、音频、制谱 WASM 与 PDF 就绪。它是此前版本，不包含本轮后续架构改造。

三张主界面证据：work/ui-simplification/runtime/synthesia-evidence.json；目录导航：folder-evidence.json；运行包：work/ui-simplification/package-evidence.json。UI01/UI02/UI05 主布局已有，其余下级面板、主页和自由演奏等仍需完成。

## 下一批直接入口

- 读取 goal-state.json 并检查方向审核是否到期；不重复本轮整库调查。
- 从 engine/library.rs、library_monitor.rs、library_workspace.rs 和 core/repertoire.rs 的实际读写路径进入 B01。
- 查清扫描根、内容 ID、缓存与工作区如何共同生成五条失效 Look at the Sky 记录。
- 建立 SongRepository 与管理副本路径，优先使移动后能自动恢复播放；接入统一查询后退出旧列表拼接。
- 左右手先完整导入，不按中央 C 重算用户已有手别；旧原始字节 contentId 保持兼容。

## 工作区保护

本轮前已有九项未提交的曲库路径/文档修改：docs/pages/practice-library.md、engine 的 library/main/package_commands、web README、Tauri main、三份曲库脚本。不能覆盖或回退；需要在这些文件继续开发时保留其意图并整合。允许替换旧实现和删除退役代码，用户文件与设置的迁移按 song-core.md 执行。

旧完整记录见 [历史交接](archive/2026-11-20/modernization-handoff.md)。评分分支说明见 [assessment-separation.md](assessment-separation.md)。

## B00 有限检查

活动文档 20 份、48 个本地链接核对通过；Cargo metadata 确认默认目标为 panthesia-desktop；活动工作流 YAML 可解析；两份新增脚本可解析，方向检查点已记录。此批未重编桌面、未重跑旧评分测试、未重打包；最近运行包仍为 a67ea54。
