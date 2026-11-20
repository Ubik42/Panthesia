# 工程调查与重置依据

日期：2026-11-20。基线提交 7a07010；当前可运行包提交 a67ea54。调查采用实际源码、Cargo 元数据、原仓库本地 upstream/master 快照及 Synthesia 官方资料。

## 来源基线

[来源清单](evidence/source-origin-2026-11-20.json)逐文件记录路径、内容哈希、行数和对比结果；上游快照 bb3be49d3f7c53698bcc237e90b43066351c37df。方法为受 Git 跟踪的文本文件、换行归一化、旧/新目录名映射，以及只替换品牌后的字节比较。

| 范围 | 与上游相同 | 仅品牌替换 | 同路径但修改 | 无路径匹配 |
| --- | ---: | ---: | ---: | ---: |
| 全部纳入文本 | 62 | 19 | 42 | 1003 |
| 源码/脚本/样式子集 | 48 | 7 | 32 | 895 |

无路径匹配只表示本方法没有命中；修改过也不表示来源义务消失。统计不用于计算原创完成率。二进制素材、字体、音源及依赖另行审计。复跑入口：`python scripts/audit-source-origin.py --upstream D:/Music/_tools/Neothesia --output <新报告>`；旧报告作为基线保留。

piano-layout/lib.rs、wgpu-jumpstart/lib.rs 与 core/utils/fps_ticker.rs 均有完整相同的文件；MIDI 包装和旧原生应用还存在修改后的沿用实现。原仓库作者字段、旧应用包目录、文档与 Flatpak 上游链接也未全部收束。

## 真正运行的模块

[依赖图](evidence/module-graph-2026-11-20.json)显示当前桌面的非可选工作区路径包括：panthesia-desktop、panthesia-engine、panthesia-core、panthesia-vst3、midi-file、piano-layout。native-render 默认关闭，因此旧 WGPU 包装不是新桌面默认运行依赖。此图未代替完整特性与目标平台解析。

旧 panthesia 原生 UI、panthesia-cli、panthesia-ai、nuon、ffmpeg-encoder 等仍在 workspace。根 default-members 却指向旧 panthesia；旧 CI 监听 master，发布旧原生/CLI/macOS 包；另一个 feature CI 大量执行评分/表现测试。这些默认入口与主产品方向冲突，B00 收束。

## 当前耦合点

- App.tsx 2635 行，承担导航、前后台会话、导入、备份、编辑与工具装配；同层仍有旧评分窗口和大量业务表单。
- engine/lib.rs 4572 行，其中含大量旧行为测试与聚合控制。不能把文件行数全当生产代码，也不能据模块已拆出宣称聚合已消失。
- RoutineDialog 2621 行等评分相关实现仍在代码树；主线入口被禁用不代表依赖、类型和存储层已完全退出。
- practice_backup.rs、MusicXML/score playback、PaperReader 各有大型实现；按数据/领域边界分批处理，避免一次重写同时伤及备份与实际演奏。
- 两套图形路线、通用命令联合体、旧路径 sidecar 与新读取投影并存。应优先统一事实来源，随后替换消费者。

## 当前用户可见缺口

1. Look at the Sky 的五条旧路径不可用，新文件已存在；目录发现、身份重联和歌曲归并未完成。
2. 左右手与谱面关联分散存储；文件搬移和解析替换仍可能影响附加标注。
3. 三张主屏已按截图重排，但主页、音轨卡片、分手操作、标签菜单、自由演奏及设置下级仍需复刻。
4. 大曲整谱容量限制与瀑布偶发帧间隔问题尚未消除。
5. 内置声音、Windows MIDI、Pianoteq 分别已有实现；设备实际可用性与各版本源码证据需要分开记录。

## 文档偏移

旧开发首页仍把 2026-11-18 包写作当前版本，并强调评分反馈；多个 roadmap、goal、current-plan 和 product 文件同时发出指令。公开文档保留 Fork、上游下载和跨平台已可用的旧介绍。只在文件头追加一句“以新计划为准”仍会让后续开发读到冲突要求。

本轮将旧控制文件归档，原 URL 改为短跳转；当前计划、Goal、架构、界面、数据与进度各自只有一个职责。历史交付与日志按日期保留，不能复活为当前任务。归档清单及原文件哈希见 [文档清单](evidence/document-reset-manifest.json)。

## 外部依据

- [Synthesia 官方帮助](https://www.synthesiagame.com/support)：九个主要交互入口与实际截图。
- [midly](https://github.com/kovaxis/midly)：格式解析/写入通用库，应用包装独立实现。
- [SQLite 原子提交](https://www.sqlite.org/atomiccommit.html)、[rusqlite](https://docs.rs/rusqlite/latest/rusqlite/)：中心关系存储的事务边界；跨数据库/文件提交仍需自己的提交协议。
- 根 LICENSE/NOTICE 仍适用于现有来源代码。最终来源与许可依据实际替换结果，不能由仓库改名或相似度统计替代。
