# 当前交接

更新：2026-11-20。目标仍为原创 Panthesia 应用实现、Synthesia 全套交互复刻、扩展后台化。执行协议 [current-goal.md](current-goal.md)，唯一队列 [current-plan.md](current-plan.md)，持久状态 [goal-state.json](goal-state.json)。

## 当前批次 B03

B00–B02 已完成；当前实现 fb37bd7，B03 继续。主页/最近歌曲、完整选曲→设置→演奏/返回、音轨卡片、独立图形分手、分类设置/目录、La/书签/循环及初始自由演奏已接入。App.tsx 的主检查栏已退出，昂贵琴键/谱面只在演奏页挂载；页面组件与 useProductScreens 分离。原生宽屏与 760×620 已检查，左/右/双手等待入口均核对。

下一轮直接补 P09/P10 的官方细节，再继续 P11：声部持续预听与原曲音色名称；设置拖拽/全部声部、按模式/自动配色；完整键/音符标签及仅自己声部；设备/快捷键叶页的官方结构、窄屏节拍器入口和时间线视觉；导航/播放/后台/编辑协调从 App.tsx 抽出。双指触控尚未实现。只完成这些既定范围，不引入新工作台或评分。官方行为清单见 interaction-model.md 本批补充；新增分手拖线参考 assignHands-3/4 已加入索引。

后端 SetPartHands 由受保护的 practice_edit 存储线程执行：整首按分界音生成分手并合并至多 4096 个逐音修正；整轨左/右/背景会明确清除此轨旧覆盖。稳定身份支持变换视图分手。5000 音符定向检查覆盖指法/原字节保留、旧 proof 拒绝与变换视图；未跑旧评分套件。

Debug：target/debug/panthesia-desktop.exe，SHA256 F2368E8D9B2BD1F38CEC92F13160C75B773C2F0B1DE59E1683A37D794CC55E6C，fb37bd7 加原有目录调整，custom-protocol 嵌入前端。独立桌面完整核对数据写入、弹出菜单及输入/返回；最终窗口正常关闭。证据 evidence/product-pages-2026-11-20.json，原记录 work/original-product-reset/b03-window。书签保存和循环采用会关闭弹出菜单，检查时应验证持久目录/当前 passage，再重新打开；不要等待隐藏消息。

正式 Release 仍为 a67ea54；本批不完成外部音源听感、长时间性能、全录音和整体成品。真实用户资料未用于本批检查，15 个旧未匹配身份继续保留。B02 音乐域与 v2/v20 协议详见 music-domain.md，无需重跑旧迁移。

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
