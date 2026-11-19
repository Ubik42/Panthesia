# 歌曲核心与派生关系

更新：2026-11-19。本轮实施，后续迁移按 modernization-roadmap.md。

## 关系与归属

| 对象 | 身份 | 存储与用途 |
| --- | --- | --- |
| 作品 MusicalWork | work ID | 已有 repertoire 登记，关联多份演奏 |
| 演奏 PerformanceEdition | 原始文件内容 ID | 多个文件位置属于同一内容，原始时序独立保存 |
| 练习 PracticeEdition | 源演奏 ID + Variant 参数的版本化哈希 | 转调、网格量化、时值和调性参数，按需派生，无需维护 C 调 / 量化 MIDI 副本 |
| 谱面 NotationEdition | 演奏 ID + 谱面版本 ID | MusicXML/MXL 内容、文件位置、质量和采用状态 |
| 生成 NotationGeneration | 源内容 + 生成器实现身份 + 生成参数 | DuET 完整输出和来源；谱面版本引用生成记录 |

SongProject 是对现有持久记录的共享读取投影。管理与谱面工作区已接入；运行时已使用同一 Variant 及 PracticeEdition 身份算法。当前持久化仍沿用 repertoire、web-preferences、曲目 sidecar 和 notation-drafts。后续切换主流程时逐一替换旧拼接适配，避免增加第二套登记。

采用状态以具体谱面版本 ID 为准。同内容、不同位置或用途的两个谱面版本可分别登记，不能仅用内容哈希标记两者同时采用。

## DuET 生产链

当前歌曲原始 MIDI → 校验内容身份 → 本机 DuET 后台任务 → 原演奏副本及模型输出 → MusicXML 解析 → 持久初稿 → 演奏顺序预览 → 用户采用 → 注册谱面版本。

生成记录位于资料目录 notation-generations/<generation ID>；每次推理使用独立 run 子目录，成功后写 manifest。相同源内容、模型 / 实现、设备设置和标题复用已完成的 MusicXML，并核对内容哈希。生成身份包含 DuET Python 实现、包版本、Torch 版本、模型权重与配置、软件内适配器；模型输出保留 notes.json 和 report.json。

本机运行环境按 PANTHESIA_DUET_PYTHON / PANTHESIA_DUET_MODEL、资料目录 duet-runtime.json、默认路径发现。默认使用共享 Transkun Python 环境已安装的 duet-score 和共享 DuET 权重。软件调用禁止自动下载，任务支持取消与超时，不占用音频实时线程。

duet-runtime.json 可配置 python、model、device（auto / cuda / cpu）。本轮本机 CUDA 调用通过。环境安装向导、运行环境设置 UI 和独立发行依赖尚未完成。

## 记谱规范及后续迁移

MusicXML 是主要乐谱交换格式；原始 MIDI 提供演奏时序。Verovio 显示谱面，MuseScore 用于编辑和 PDF。ABC 后续按实际用途提供适配，不作为第三套音乐核心。

DuET 从原始演奏推断乐谱，练习量化和转调作为独立参数。practice_score 按转调参数生成显示副本，更新音符、八度和调号；原 MusicXML 与谱面内容身份继续指向源文件。映射时渲染音高先还原到原谱，再用原有音符身份取得当前练习时序。量化改变 MIDI 时序，当前所选谱面的书面节奏保持原样；按网格重新记谱、和弦符号和装饰记号的完整转调仍待实现。

后台 Playback 发布包包含当前有效演奏和 source_file，两者必须一起切换。ScoreVersions 为纯读取；当前关联谱在切换 / 解除关联事务中登记，关联谱 ID 由内容及规范化位置决定。读取、预览与登记使用同一算法，避免读取触发写入及切换后旧谱面无法选回。

DuET input_id 进入逐音映射属于后续批次。当前自动初稿保持 automaticDraft 质量，采用操作不自动提高为人工校对。

本轮没有迁移或覆盖用户源文件。后续涉及存储替换时，提供可恢复迁移和明确旧适配退出条件。
