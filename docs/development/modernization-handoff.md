# Panthesia 当前开发交接

更新：2026-11-19。Goal active。工程 D:\Music\_tools\Panthesia，分支 main。本轮基线 dd23568。

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
5. 让演奏与版本切换直接消费统一核心，替换仍依赖路径及偏好拼接的旧适配。DuET 环境路径的自动发现 / 配置文件 / 环境变量已统一到 duet_runtime，并接入软件设置页。

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

## P3：DuET 环境设置与音源状态批次

- 桌面新增 duet_runtime 模块，共用有效配置解析、路径状态和设备选择；duet_score 退出原有内嵌配置解析。读取、保存、检查与生成不再各自决定 Python / 模型位置。
- “演奏与制谱设置”分为设备与声音、DuET 制谱。制谱页可编辑 / 浏览 Python 程序、模型目录及自动 / CUDA / CPU，明确显示当前生效位置和来源。环境检查读取本机包、模型配置与 CUDA 状态；检查与编辑草稿不写配置。
- 谱面管理的“添加与初稿”页可直接进入 DuET 配置，关闭后返回同一管理工作区。关闭设置时暂存未保存输入，当前软件会话重新打开可继续；保存后下次制谱使用新配置。
- 保存按原内容指纹检查版本，拒绝覆盖外部或其他请求已改变的设置；写前按内容身份备份旧字节，再原子替换。恢复自动查找采用同一保存流程。
- 主演奏区音源入口显示连接中、连接错误、未连接和已连接状态，异常时可直接进入设置；设备与声音页继续提供原输入、音源、发声设备及试音操作。

实际桌面从谱面管理进入配置，识别 Python 3.12.13、DuET 0.1.0、Torch 2.11.0+cu128 与 RTX 4080。选择 CPU 的检查返回 effectiveDevice=cpu；关闭重开保留输入，保存后读取到 cpu。过期 revision 保存被拒绝，恢复自动查找时旧配置备份与原字节完全一致；设置关闭后返回谱面管理。重启实际桌面后 revision 与保存结果一致、device=auto，声音入口为 ready，设备页演奏音源选择器仍可用。1000×800 截图无横向溢出，计算设备标签完整显示。

本批只做受影响桌面构建和上述操作链路，使用 work/duet-settings-runtime 隔离资料；未重复 DuET 模型推理或运行全套回归。证据：work/duet-runtime-desktop.log、work/duet-settings-runtime/settings-evidence.json、reopen-evidence.json、settings-wide.png、settings-narrow.png、settings-reopen-narrow.png。后续继续演奏工作区的版本 / 谱面 / 音源状态整合、减少重复弹窗及 P4 成品外观与运行包。

## P3：跨视图 A/B 范围与循环批次

- usePracticeRange 维护来源明确的选段草稿，复用 Snapshot.passage 类型。支持按当前位置设置 A / B，也可从 MIDI 即时谱、量化 / 关联 MusicXML、瀑布点选首尾音符；首尾顺序不限制，范围包含两处音符的实际时值。切视图继续选段，切歌与练习条件改变后清理旧来源。
- 时间线集中启用 / 退出循环，显示草稿端点及范围在全曲中的位置；实际循环仍由引擎 passage 表示。移除打开侧栏循环设置的重复按钮，按小节细调仍从“小节与分段”进入。短于十秒的窗口显示百分之一秒，减少整数秒刻度重复。
- MIDI 即时谱和 MusicXML 高亮范围内音符，瀑布降低范围外音符的透明度。只在选音模式生成瀑布命中对象，普通播放继续复用既有绘制缓存。
- PracticeTimeline 从 PracticeReadouts 拆出，主工作区直接导入；静态刻度和范围按钮使用独立缓存边界。谱面内的循环命令改走主工作区受来源约束的实时调用。
- 引擎 Loop 命令在正在播放 / 暂停时保持相应状态；退出循环保留当前位置。MeasureLoop 已通过同一命令实现，避免不同入口采用不同退出行为。

桌面实际链路：MIDI 简谱选起音，再切瀑布选终音，得到 1.20–4.05 秒，与当前 MIDI 音符起止完全一致；播放中退出循环，位置从 1.4684 继续到 1.4917，status 保持 playing。量化谱重新选段得到 1.80–5.25 秒，6 个谱面音符高亮；换另一内容 MIDI 后端点自动清空。按当前位置手动标记得到 0.60–2.40 秒，退出后停留 0.60，状态 ready。

宽度 1440 / 1000 / 720 的范围按钮均在可见窗口内，无根节点横向滚动。窄窗发现过旧 flex 换列造成控件进入右侧隐区，已在实际几何检查后修正。最终截图使用 manual-range-1440.png、manual-range-1000.png、manual-range-720.png；早期 notation-selection-narrow.png 是修正前检查材料，不作最终布局依据。

证据位于 work/practice-range-runtime/range-evidence.json、layout-evidence.json 及上述 PNG；受影响桌面构建 work/practice-range-desktop.log。使用隔离资料与内置练习副本，仅检查这条用户链路与受影响构建，未运行全套回归。后续进入 P4：统一演奏表面、皮肤与特效设置，整理剩余耦合及运行包；视图切换时复用谱面渲染结果仍可继续优化。

## P4：外观工作区与谱面排版复用批次

- 界面设置新增“外观与光效”分区，把皮肤、琴键材质、落键效果和练习网格集中展示；音符名称 / 指法仍在“音符显示”。主演奏页的“外观与网格”和瀑布光效条都可直接进入新分区，分区选择沿用现有持久会话。
- 三种皮肤改为可视选择，设置窗口、控件、页签与页脚采用相应皮肤变量。增加只恢复外观参数的按钮，保持其他显示、按键与布局设置。修正原深色窗口与浅色文字变量混用造成的低对比度。
- PianoAppearancePreview 使用演奏页同一 PianoKeyboard / PianoEffects 渲染器，展示实际材质、光效风格和网格透明度。手动演示七个落键，结束后停止逐帧绘制；切分区、关闭窗口或隐藏应用时停止演示。减少动画遵循界面与系统选项。玻璃琴键标签改为浅色，提高暗部对比度。
- Notation 排版移至 scoreRenderCache，按显示字节内容缓存最多三份 / 估算 32 MiB 的 SVG、MIDI 与渲染逐音证据；命中时不再创建 Verovio worker。每次仍向当前引擎核验映射，缓存不持有跨版本令牌。转调与量化显示以实际字节区分。

实际桌面检查三种皮肤与落键演示，1440×1000、720×800 外观窗口无横向溢出；重启后仍为 rosewood / ivory / ripple / performance，外观设置已恢复。当前短曲切回谱面没有增加排版 worker，测得 124 ms；改变转调后产生新排版，恢复原调未新增排版。初次检查直接比较运行中 SVG 全文受动态高亮影响，后改用实际 worker 计数判断是否重新排版，动态高亮不作为缓存失效证据。无页面运行错误。

证据：work/appearance-cache-desktop.log；work/practice-range-runtime/appearance-cache-evidence.json、appearance-studio.png、appearance-midnight.png、appearance-rosewood.png、appearance-narrow.png、appearance-reopen.png、appearance-reopen-evidence.json。使用前批隔离资料，未运行全套回归。本批仍为开发版源码；后续继续统一演奏表面及剩余设置弹窗、整理解耦退出项，再制作新运行包并独立启动核对。

## P4：统一纯 MIDI 谱面批次

- 原始时序且没有关联谱面的 MIDI 也由 core::practice_engraving 生成临时 MusicXML。simplified 显示角色采用 1/16 书面网格，quantized 仍按有效演奏记谱；两者分别进入显示派生身份。记谱器版本升级 v2。
- 简化谱的逐音身份和延音分段映射回原演奏时序，点击、跟随与 A/B 选段继续消费有效 MIDI；显示整理不更改 Variant、播放数据或源文件。score_mapping 在纯 MIDI 上使用对应的简化记谱身份核验。
- 删除 MidiPracticeScore 和其专用 CSS，清理主界面、主题和范围高亮中的旧路径。纯 MIDI、量化练习谱和所选 MusicXML 统一使用 Notation / Verovio / 逐音映射 / 缓存。
- 谱面工具栏和演奏顺序栏采用当前皮肤，简化谱隐藏不能使用的正式谱面导出操作，并说明显示节奏与实际演奏的区别。演奏版本栏同步谱面名称。
- 重写运行包使用说明，按选曲、音源、三类谱面、练习变换、循环、DuET、外观和资料保护组织，替代累计开发日志。

核心仅执行 practice_engraving 两项相关检查，通过复调往返和非网格演奏时序独立性。实际桌面导入隔离 MIDI：原音起点 0.105208 / 0.3125 秒，时值 0.122917 / 1.25 秒。简化谱点选定位到 0.105208，循环范围 0.105208–1.5625，5 个片段高亮；切 1/16 演奏量化再恢复原始时序，音高 / 起点 / 时值与导入时完全一致。1000×800 无横向溢出，无页面错误。证据 work/unified-midi-engraving-test.log、work/practice-range-runtime/unified-midi-evidence.json 及 unified-midi-wide.png / unified-midi-narrow.png。

本批已制作 Release 练习预览包 outputs/releases/Panthesia-20261119-song-practice，程序源码提交 39263e3。当前工作区原有的曲库路径调整仍未提交，运行包按实际工作区构建，manifest 标记 dirty=true，内容指纹 88461BBFD65F1874E7A1DD3AE8342BB894D0AED8213FB096002BD6D4E2AAEE3B。29 个打包文件哈希核对一致。

从发布目录启动的 Release 进程可正常响应。Release 无开发调试端口，未使用失败的 CDP 连接作为功能结果；改用程序现有 --window-check，以另一份隔离资料独立运行，实际返回 PASS：visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首、9 音符、MIDI 已连接。证据 work/song-practice-release.log、work/song-practice-package-check/startup.log。最终同源码 Debug 构建及上述纯 MIDI 操作链再次通过，截图已更新到当前皮肤工具栏。早期 Debug 构建曾因构建中新增样式而拒绝登记，最终 Release / Debug 构建已稳定登记。

其余设置界面统一、演奏页信息收敛与主流程交付审计继续待做；官方功能矩阵中的部分 / 待做 / 外部依赖项目维持原状态。DuET 环境依赖仍使用本地 Python / 模型设置，本包未包含大型推理环境。

## P4：专注演奏与统一练习设置批次

- 新增 PracticeContextPanel，集中演奏版本、谱面、转调 / 量化、手别、外观、音源与高级练习设置。普通布局内联显示，专注布局从右上角展开同一组控件；组件负责展开、来源切换、外部点按与 Esc 收起，隐藏时暂停版本栏读取。移除主界面被主题长期隐藏的旧紧凑光效条挂载。
- 专注布局收起全局菜单与低频歌曲操作，保持曲名、视图、时间线、BPM、播放模式和播放控制。右上角有音源连接提示，从设置面板仍可访问全部练习入口。返回曲库后全局菜单正常显示。
- practiceFocus 进入已有显示偏好、布局方案与界面备份，新增“专注演奏布局”设置项；旧记录缺少此字段时采用普通布局，旧备份继续可读。已有预置“专注练习”会启用新布局，读谱 / 选曲预置恢复普通布局。
- 收敛展开面板的换行与尺寸，修正旧样式隐藏新增按钮的问题；专注面板内转调设置采用内联展开；普通布局改为向下弹出，并提高定位规则优先级，解除旧规则同时限定上下边界所造成的压缩。普通弹层样式以当前源码注入隔离桌面核对，高度从约 41 增至 210 像素，证据 focus-popover-evidence.json / focus-normal-variant.png；最终样式随 Release 构建进入程序。

实际桌面在 1000×800 的演奏区由 293.33 增至 491.67 像素。播放中切换时状态保持 playing，位置从 0.205509 继续到 0.237105；Esc 收起后焦点返回入口。面板中量化切换并恢复成功，BPM 可改到 90。1000 / 720 宽度下展开设置无横向溢出，按钮无断字；重启软件从曲库进入演奏后，专注偏好恢复，设置面板保持收起。

证据 work/practice-focus-desktop.log；work/practice-range-runtime/focus-evidence.json、focus-reopen-evidence.json、focus-score.png、focus-waterfall.png、focus-settings-1000.png、focus-settings-720.png。仅检查受影响编译与这条实际操作链路，使用原隔离资料与内置练习副本。本批 Release 预览包已生成于 outputs/releases/Panthesia-20261119-focused-practice，源码提交 070f511（主改造 dc0d8fe）。实际工作区含既有未提交曲库路径调整，manifest 标记 dirty=true；内容指纹 C51D68A52BEBD4B7F81E634313D1239F09731CB12E2BC85279BDE1E673602914。29 个文件校验一致，独立 --window-check 返回 PASS，界面 / IPC / 音色 / Verovio / PDF ready，内置 5 首、9 音符、MIDI 已连接。证据 work/focused-practice-release.log、work/focused-practice-package-check/release-evidence.json、startup.log。首轮构建期间发现普通弹层定位冲突，修正后原构建因源码变化拒绝登记；最终包已按固定源码重新构建。

下一批先核对各音源主音量、试听及界面能力是否一致：当前 PracticeTransport 的 volumeAvailable 仅判断“内置钢琴”，外部音源控制能力需按真实后端处理。随后核对音源 / 制谱设置运行状态及主流程交付项。原官方矩阵中的部分、待做和外部依赖范围仍有效，整体 Goal active。

## 交付状态

当前可试用运行包为 outputs/releases/Panthesia-20261119-focused-practice，程序源码提交 070f511，包含构建时工作区原有本地修改，来源及内容校验记录在包内。此前 song-practice（39263e3）与 independent（af146d8）继续留作历史版本。新包覆盖歌曲核心、DuET 接入、统一谱面、循环、外观及专注布局，整体 Goal 仍 active，未经要求未推送。

## 数据与工作方式

允许重构替换旧实现，原用户资产和历史通过明确迁移保护。生成输出使用隔离测试目录；正式用户数据不参与检查。每批只做受影响编译及关键行为 / 小范围界面验证，主要时间用于实现。不得因为模型声明、拆文件或测试通过而宣称整体完成。
