# Panthesia 当前开发交接

更新：2026-11-19。Goal active。工程 D:\Music\_tools\Panthesia，分支 main。本轮基线 de7c0a2。

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

1. 曲库已按歌曲聚合，提供演奏版本与文件位置选择、搜索、同歌归组 / 拆分及直接开始演奏。后续集中处理演奏工作区与谱面重新记谱。
2. 继续收敛谱面管理中的多层操作。成功打开已消费，历史记录默认折叠；无需重新处理已验证的打开回执。
3. DuET 原始输入身份已进入 MusicXML、引擎对应和谱页元素。旧生成结果继续走原有匹配；重新制谱会产生带来源身份的新结果。后续按正常曲目使用反馈改善复杂记谱，避免重复建设第二套对应算法。
4. 量化练习谱已从有效 MIDI 重新生成；原谱可独立选择。转调已处理和弦根音 / 低音、各声部 / 谱表调号和常见装饰音升降记号。复杂分手和记谱质量继续按实际曲目反馈改善；自定义调号、微分音及其他乐器的完整移调声明仍有限制。
5. 让演奏与版本切换直接消费统一核心，替换仍依赖路径及偏好拼接的旧适配。DuET 环境路径目前用自动发现 / duet-runtime.json / 环境变量配置，后续接入软件设置页。

P3/P4 按 roadmap 推进。P1 与上述 P2 主流程已落地；重新记谱和演奏工作区仍有明确剩余项，整体重构继续 active。

## P2：统一歌曲曲库批次

- core::song_catalog 提供轻量歌曲关系投影。Engine 通过目录扫描器已核对的曲目快照补齐尚未演奏过的曲目；只读查询不写 repertoire、不解析谱面文件。全量登记与编辑继续使用已有事务。
- SongBrowser 按 work_id 聚合歌曲，按内容身份聚合演奏；相同内容的多个位置合入同一版本。相同标题仍可代表不同独立歌曲，关系由内容身份和明确归组确定。
- 曲库详情直接选择演奏版本、文件位置并开始演奏；歌曲与版本文件名均参与搜索。收藏和最近记录按内容身份读取，文件夹树保持实际目录范围。分页继续按歌曲每页 60 项，分组和查找索引缓存到输入变化时更新。
- 曲库使用同一 SongPerformanceManager 的嵌入模式完成归组 / 拆分，减少管理层级。切回演奏页重读歌曲关系，隐藏演奏页暂停该查询。
- 界面操作检查：6 个实际文件聚合为 5 首歌曲；归组后 4 首 / 5 份演奏，搜索“低音”显示所属歌曲，选定低音版本后进入正确演奏与同歌关系，拆分后恢复 5 首。还完成未演奏内置曲的归组与拆分。歌曲查询前后 repertoire 文件哈希一致。

证据：work/song-core-duet-runtime/song-catalog-start.json、song-catalog-flow.json、song-catalog-grouped.png、song-catalog-narrow.png。演奏页实时关系刷新补充 song-catalog-live.json。构建日志 work/song-catalog-desktop.log；本批执行受影响构建与这条实际操作链路，未运行全套回归。

## P2：逐音来源及同歌归组批次

- DuET worker 对照官方 MIDI 读取结果核对输入顺序，在实际记谱时捕获 input_id，并给每个写出音符（含延音拆分及倚音）写入 MusicXML note@id。记录源内容、原音轨 / 音符事件索引、音高和起止时间，额外保存 input-identity.json。
- engine::duet_alignment 校验这些来源与原演奏，再建立对应；时差仍记录实际值，来源确定度与记谱质量分别处理。来源缺失或不匹配时使用原有匹配流程；自动谱面质量仍为 automaticDraft。
- Verovio 保留来源 ID，谱页映射优先按这些已校验身份建立，跳过渲染 MIDI 的重解码与时间匹配。定位与高亮继续取当前演奏版本的时序，支持转调和量化后的练习。
- 演奏页增加管理演奏版本，可搜索曲库中另一份 MIDI 归入当前歌曲，可将版本设为独立歌曲。拆分复用原独立身份和已有资料，避免反复归组累积空歌曲。各演奏的谱面、练习条件与历史继续各自保存。
- 允许在转调 / 量化条件下预览、保存及采用谱面，统一按原演奏核对，再按当前参数显示。

本机实际从软件生成 15 音音阶谱面并采用，保持 +2 半音及 1/16 网格；引擎报告 alignmentSource=duetIdentity、coverage=100。界面完成一次归组与拆分。证据在 work/song-core-duet-runtime/duet-identity-adoption.json / PNG；最终运行检查补充 direct-map-evidence.json。只运行重复音来源 / 谱页身份及归组身份复用两项针对性测试；日志 work/duet-identity-test.log、work/song-grouping-test.log，桌面构建 work/duet-identity-desktop.log。

## P2：量化练习谱与转调批次

- 新增 core::practice_engraving，直接从有效 MIDI 生成临时 MusicXML。双谱表按音区分配，处理和弦、重叠声部、附点、休止、拍号变化和跨小节延音；片段身份对应稳定的音轨 / 音符索引。派生身份包含 PracticeEdition 与记谱器版本，显示文档另有内容指纹。
- 已有关联谱与纯 MIDI 均可使用量化练习谱；有原谱时可切换书面节奏来源。映射以当前练习谱片段身份和拍位为准，点击定位及小节循环使用有效演奏的实际时间。末小节循环终点限制在实际 MIDI 时长，谱面补齐休止不延长循环。
- SourceScore 提供独立原谱显示查询。原谱精细选段继续查询原谱顺序；临时量化谱使用普通小节定位 / 循环。临时谱不参与原谱个人标记导出和可定位纸谱制作。
- 转调改为按调号计算统一的音程拼写，独立处理各 part / staff；更新和弦根音 / 低音及常见装饰音升降记号，八度转调保持原调号。原 note ID 与时值不变。非传统调号和微分音装饰记号有明确限制，原调指板图在显示副本中退出。
- 显示准备继续在已有后台只读任务执行。生成量化谱时不再将原谱字节展开成临时 JSON 后又丢弃。

检查：一个复合样例覆盖和弦、重叠声部、跨小节延音、拍号变化和打击乐排除；生成 MusicXML 再解码后有音高音符的音高与时值一致。转调检查覆盖双谱表调号、和弦、装饰记号、八度和来源 ID。实际桌面中，9 音低音练习在 +2 半音 / 1/16 条件下得到 9 个谱面对应、unmapped=0、following=true；切回原谱后为 9 音，解除关联后继续由 MIDI 生成量化谱；点击末音定位 4.8 秒，末小节循环为 4.8 至 5.25 秒。

证据：work/practice-engraving-test.log、practice-transpose-test.log、practice-engraving-desktop.log；work/song-core-duet-runtime/practice-engraving.json、practice-engraving.png、practice-engraving-midi-only.png。全部使用隔离资料目录，未执行全套回归。下一批进入 P3 演奏工作区：主次操作收敛、实时模式 / BPM / 定位循环 / 音源状态，以及瀑布性能；DuET 环境设置页仍待接入。

## P3：演奏工具栏与瀑布绘制批次

- 转调 / 量化移入练习工具栏，详情以浮层展开，支持 Escape 和外部点击收起。日常状态少占一整行，1440×1000 样例的瀑布画布由 483 增至 517 像素高。原练习参数、外观、手别、循环和音源入口继续可用。
- BPM 数字输入使用独立文本草稿：允许清空和输入中间值，Enter / 失焦提交，Escape 取消，超出范围给出明确提示。提交仍使用当前曲目的实时速度通道。模式切换纳入按类型合并的实时队列，避免经过全局请求锁时静默丢失操作。
- 新增 PianoKeyboard，集中管理琴键材质、静态底图和当前高亮图。只有按键、必弹音、自动播放音或对应颜色改变时重画高亮；修复非当前音符覆盖琴键颜色的行为。Piano 的循环负责时间、可见音符与合成，琴键绘制移出主组件。
- 瀑布音符标签缓存为位图；EffectSprites 缓存光晕及光束纹理，限制数量与总像素内存。发光位置、透明度和粒子继续逐帧运动，不在每个脉冲上重复创建渐变。
- Piano 的订阅过滤音频电平、性能计数及同值快照；暂停时无需因这些后台读数重画。最新桌面实际暂停 1.5 秒记录 0 次绘制，虚拟键按下得到 MIDI 62、松开后清空。

对照使用隔离资料目录和合成的 6,144 音符 MIDI，连续播放 8.5 秒，1440×1000 窗口。最终结果为：渐变创建 78,489 → 9,712，文字绘制 7,552 → 5,324。两版帧间隔中位数均 6.9ms、P95 均 7.1ms，均无超过 33ms 的样本；这次证据证明绘制工作减少，不能据此声称所有歌曲的掉帧已解决。本轮未降低分辨率、网格透明度、音符数量或关闭特效。

实际控件检查：85 BPM 提交成功，120 草稿取消后恢复 85，999 被拒绝并提示范围，随后恢复 100；等音模式确实等待 6 个必弹音，切到连续后无需输入继续推进。宽 / 窄窗口浮层在屏幕内，无横向溢出。只执行受影响构建和这条实际操作 / 绘制对照，没有运行全套回归。

证据：work/practice-workspace-desktop.log；work/practice-workspace-runtime 下 waterfall-before.json、waterfall-final.json、controls.json、keyboard-smoke.json 及 workspace-final.png、transform-popover-wide.png、transform-popover-narrow.png、live-keyboard.png。下一批继续 P3 音源与制谱环境设置、演奏主次操作及谱面 / 瀑布一致操作，随后进入 P4 成品外观与运行包。

## 交付状态

现有正式运行包为 outputs/releases/Panthesia-20261119-independent。其程序源码提交为 af146d8。后续功能批次为本地源码，尚未推送或制作新正式包。

## 数据与工作方式

允许重构替换旧实现，原用户资产和历史通过明确迁移保护。生成输出使用隔离测试目录；正式用户数据不参与检查。每批只做受影响编译及关键行为 / 小范围界面验证，主要时间用于实现。不得因为模型声明、拆文件或测试通过而宣称整体完成。
