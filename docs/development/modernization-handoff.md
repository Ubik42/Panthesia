# Panthesia 当前开发交接

更新：2026-11-19。Goal active。工程 D:\Music\_tools\Panthesia，分支 main。基线 bc2626c。

## 当前主线

按用户新指示推进歌曲管理与演奏体验，详见 modernization-roadmap.md 和 current-goal.md。此前按元数据、来源和分组顺序推进的安排已停止。Synthesia 功能表作为覆盖清单，后续按管理和演奏收益安排。

## 本轮已落地 P1

- core 新增 practice_transform 和 song_project；运行时重用同一练习变换定义。派生练习身份由原演奏内容及参数确定，管理投影与演奏输出使用同一身份。
- ReadRepertoire 返回 SongProject，连接已有作品、演奏、采用谱面、练习条件和生成记录。曲库资料面板与谱面管理共用摘要。沿用已有登记和偏好数据，未建立平行数据库。
- 软件内 MIDI 制谱生产入口改为 generate_duet_score，后台调用本机 DuET。记录包实现、模型、配置和适配器身份，持久保存 MusicXML、notes.json、报告及其他模型输出；相同输入与生成器复用成果。MuseScore 继续负责编辑和 PDF。
- 生成结果接入初稿、演奏顺序预览、添加并使用及再次打开流程。首次生成保存回执读取顺序错误已修正。
- 原数据格式的 generation 字段为可选新增项，既有初稿可继续读取。用户原始 MIDI、谱面与历史未用作本轮检查材料。

## 一次关键链路检查

桌面 Debug 自包含协议构建通过；前端生产构建通过。新增核心身份行为测试 1 项通过，未跑全套回归。

隔离目录 work/song-core-duet-runtime 中使用内置五指练习副本。软件内真实调用本机 CUDA DuET，report.json 为 complete、input_coverage 为 1，9 个输入音符完成；随后复用相同 generation，未重复推理。软件预览匹配率 100%，添加并使用后 hasScore=true，重新启动后采用谱面及 DuET 来源仍存在。+2 半音、1/16 量化时，管理和演奏的 practice ID 一致；检查后恢复原始条件。

证据：work/song-core-domain-test.log、work/song-core-duet-desktop-build.log；work/song-core-duet-runtime 下 adoption-evidence.json、transform-evidence.json、reopen-evidence.json 与截图。单一短样例证明调用和采用链路；复杂曲目可读性仍需产品迭代。

## P2 本轮改造

- 演奏页新增 SongEditionBar，直接选择同歌演奏版本、已登记谱面和 MIDI 即时谱，展示当前转调与量化条件。采用前核对原演奏顺序，采用后刷新会话；切歌准备期间禁用旧歌曲的版本操作。
- 新增 core::practice_score，按练习参数生成 MusicXML 显示副本，转调音符、八度与调号；原文件不改写。取消“有练习变换就隐藏关联谱”的旧规则。渲染音高回归源谱语义进行对应，再通过稳定音符索引跟随当前量化后的 MIDI 时序。
- ScoreVersions 从写事务移到后台纯读取，读取不再补写版本；切换及解除关联时登记当前谱面。关联谱版本使用内容与位置计算稳定 ID，管理投影、预览和记忆当前谱面共用此算法。
- 修复后台切歌遗漏 source_file 的问题。Playback 现在一起传递原始演奏与有效演奏，旧引用随其他音乐状态在音频线程外回收。此前可能用上一首歌核对当前谱面或派生练习。
- 打开结果遇到短暂会话绑定时继续等待展示；展示成功后消费回执。历史接续记录在新打开完成后自动折叠，减少演奏页占用。

检查证据更新在 work/song-editions-core.log、work/song-editions-desktop.log 和 work/song-core-duet-runtime/edition-*.json / PNG。一次实际链路完成切到不同内容的音阶曲、切至 MIDI 即时谱、选回原关联谱，再启用 +2 半音和 1/16 网格；hasScore=true、对应率 100%，预览来源与当前演奏一致，新打开回执为 presented。只运行一项新增 XML 转调测试，并检查实际桌面操作链路；未执行全套回归。窄窗口检查发现旧谱面布局仍为空钢琴区预留 102px，已取消这块无效占位。

## P2 后续集中推进

1. 演奏页选择栏已落地；曲库同歌多演奏的合并 / 拆分、选择管理仍需完成，现有资料编辑不能作为最终主入口。
2. 继续收敛谱面管理中的多层操作。成功打开已消费，历史记录默认折叠；无需重新处理已验证的打开回执。
3. 消费 DuET notes.json 的 input_id，建立原演奏音符到生成谱面音符的身份映射；目前已保存来源，仍由原有顺序 / 音高对齐工作。
4. 转调音符与调号显示、量化后的光标对应已落地。当前 MusicXML 的书面节奏继续使用所选谱面；按 MIDI 量化参数重新记谱、和弦符号及装饰记号的完整转调尚需推进。
5. 让演奏与版本切换直接消费统一核心，替换仍依赖路径及偏好拼接的旧适配。DuET 环境路径目前用自动发现 / duet-runtime.json / 环境变量配置，后续接入软件设置页。

P3/P4 按 roadmap 推进。当前只能认定 P1 数据身份、共享投影和本机 DuET 制谱采用链路落地；整体重构继续 active。

## 交付状态

现有正式运行包为 outputs/releases/Panthesia-20261119-independent。其程序源码提交为 af146d8。后续功能批次为本地源码，尚未推送或制作新正式包。

## 数据与工作方式

允许重构替换旧实现，原用户资产和历史通过明确迁移保护。生成输出使用隔离测试目录；正式用户数据不参与检查。每批只做受影响编译及关键行为 / 小范围界面验证，主要时间用于实现。不得因为模型声明、拆文件或测试通过而宣称整体完成。
