# Panthesia 主线交接

更新：2026-11-19。当前分支 main。原长期 Goal 已清除；本次为用户明确授权的评分分支隔离和主线收束。

## 当前续接点

- 评分完整保存到本地 feature/assessment-lab，提交 ca4aeb5；包含此前实现和最后未提交的独立评估上下文。
- main 只提供连续播放和按键引导。已删除 round_save 模块、内部轮次发布请求、专用分析队列以及播放 / 变换 / 退出时的评分等待；实时音符不进入评分器或表现采集器。
- 主界面为曲库 / 演奏两区；成绩、反馈、表现目标、达标日课和速度阶梯退出主线入口。曲库按最近打开整理，扫描目录统一显示 / 添加 / 停止扫描；谱面版本、转调量化、声音和外观继续使用现有实现。
- MIDI、谱面、设置中的旧目标、历史和回放保留；旧高级模式在运行中按普通连续播放处理。原九项用户曲库修改前后补丁哈希相同，继续保持未提交。未经要求不推送。
- 计划以 current-goal.md、modernization-roadmap.md 和 assessment-separation.md 为准。以下评分阶段记录用于追溯，不能据其“下一批 / active”字样恢复旧方向。

## 本次：主线收束

源码与成品提交见下方交付状态。新增 note_guidance：只记所需琴键，错键不会产生分数、错误阈值或成绩；正常循环在轮次边界直接续播。practice_policy 在命令入口隔离高级模式和评分写入，旧 flow 模式接入 listen。保留的旧历史模型用于资料读取和备份兼容。手动演奏录音是独立 MIDI 录音，不属于评分回放。

受影响引擎编译与前端构建通过。一项新定向检查覆盖无输入循环、旧表现目标不阻塞播放、错键不计分、按键放行、即时切换、评分接口不可用、源 MIDI 和旧目标保留。日志 work/mainline-scope/{engine-check,mainline-test,web-build,desktop-build}.log。未跑全套旧评分测试。

隔离原生实例使用此前合成数据副本。六条旧历史及回放哈希保持一致，连续播放无需键盘输入；实际 audioLevel=0.18954101，声音 ready。按键引导能停住 / 放行，切回连续播放清除等待；运行状态 summary=null、各评分计数为零、storage.operation=null。界面没有成绩或晋级入口；1360px / 800px 无横向溢出。自动发现 Output 目录在管理界面可见。MIDI 导入后 +2 半音、1/16 量化及九个谱音显示正常，原始文件哈希一致。证据 work/mainline-scope/runtime/{native-evidence,ui-evidence,catalog-score-evidence}.json 和 mainline-{waterfall,score,folders,narrow}.png。原生检查后仅移除命令面板残余历史入口，并补充目录空状态 / 自动目录停止扫描按钮，最终运行包重新编译。

已知边界：复杂大曲整曲谱面容量限制和偶发帧间隔问题继续保留，DuET 环境仍由本机配置。本次收束不代表这些既有问题全部解决。

## 历史：自动轮次准备与回放解耦

- bootstrap 新建有界单线程 round-analysis 队列，共用现有任务注册与状态。pending_save::post_round_preparation 只处理冻结的轮次事实，独立于存储线程；移除旧 post_exclusive 入口。成绩、练习条件和历史根发布后可续练，存储线程较慢不会直接堵住后续一轮的成绩准备。
- 自动轮次的回放物化、完整性校验和 JSON 编码移入 DeferredWrite；只冻结 capture / report / 内容与历史身份 / 时长，结果发布阶段不再先构造回放字节。手动保存沿用确认完成后的语义。历史与回放继续进入原事务和失败重试队列；编码失败、IO 失败及退出等待继续由现有队列接管，未新增平行历史存储。
- 增加保存积压约束：待写批达到八个文件项后，新轮次准备在后台等待容量；当前正在写的批另算。通常为历史与最多七份回放，其他设置写入也占用容量。等待发生在轮次边界，任务使用原 waitingStorage 状态，避免磁盘长期停顿时无限积累冻结回放；队列错误将结束等待并保留当前轮供重试。
- practice_conditions::Scope 保存精确歌曲、音符、轨道、人手分配和逐音声音规则的根身份。reset 只保留仍匹配的 scope；编辑上下文和轮次结果带回同一缓存，不随每轮判定数据重建。原 practice-v1 身份字符串算法保持原样，速度、选段等条件仍分别记录。顺带修正 round_analysis::Selection 对逐音伴奏规则变化的失效判定，避免沿用错误的目标计数与表现评估。

有限检查：受影响引擎编译通过；两项定向检查通过，未跑全套回归。第一项暂停存储线程，分别准备并发布两轮；两轮均恢复 playing，历史各增加一次、scope 根相同。随后使历史写入失败，恢复路径后重试，二份回放分别保留 90 / 70 力度输入，历史与队列根一致、未重复计数。第二项核对 scope 跨 reset / 速度 / 选段变化复用，并在手别与逐音伴奏变更后重新计算，结果与原算法一致；伴奏变更同时使评估失效。日志 work/round-preparation-{check,test}.log、round-scope-test.log。

原生隔离运行使用同一合成 36,000 音符 / 25 分钟 MIDI、连续模式与两秒循环，自动输入仅在隔离实例中进行。基线四个相邻轮期间隔 2019.7–2030.4ms，本批 1998.8–2016.8ms；均无输入命令错误。短时帧间隔 P95 基线 7.2ms / 本批 7.3ms，P99 均 7.5ms，不能据此声称整体渲染性能提高。五轮历史和五份回放已落盘；每份 48 个参考 / 48 个判定 / 96 个输入，条件与 120 BPM 一致，原始 MIDI 哈希保持一致。证据 work/round-preparation-{baseline,updated}/measurement.json、updated/history-evidence.json、updated/loop-after.png。原生检查后仅合并了等待状态名称并整理新增代码格式，最终运行包重新编译。

当前完整成绩汇总仍在发布前完成，以便日课、阶梯和自适应调速消费同一评估结果；仍复用编辑 Context 创建无音频临时 Player。下一批解除这层依赖，后续性能结论继续依据实际曲目。用户曲库与设置未用于检查。

## 上一批：连续取景与前方密度

- 新 KeyboardViewport 使用小数白键坐标；绘制、琴键材质、音符布局、点击命中及范围外计数共用这一模型。删除旧整数缩放 / 平移函数。支持 Ctrl 滚轮以指针为锚点缩放、Shift 滚轮、Alt / 中键拖动平移、按钮及可配置操作。相机限制在 MIDI 0–127；手动取景局部露出的黑键可正确点击，固定 / 歌曲 / 设备预设按真实上下限裁切相邻黑键，88 键模式保持实际 21–108。
- 新 usePianoViewportGestures 将操作每帧合并一次提交。瀑布区域双指横向缩放 / 平移，纵向调整前方预览；琴键区保留双指和弦，触摸音符选择推迟到抬指以免与手势冲突。按住琴键调整视野不会提前松键，抬指、失焦和取消仍止音。
- 前方预览统一使用 PreviewBarsControl，支持 0.5–16 小节、0.25 小节步长，PgUp / PgDown 默认增减一小节，设置中可改键；复合拍和变拍号按实际小节长度求时域。速度快捷键每次增减 5 BPM，沿用原曲速度图和现有速度边界。
- Piano 的 RAF、PianoEffects、WaterfallSprites 和键盘画布在显示偏好变化时保持实例；当前呈现参数通过 ref 读取。键盘缓存按新几何失效，复用画布，不因视野改变重建绘制循环。范围外计数改为歌曲音高前缀统计，不随相机移动扫描全曲。显示设置独立保存手动相机，切到自动预设不清除它；界面备份纳入相机，旧备份缺字段可读取。

有限检查：三个模型检查覆盖锚点、边缘黑键、MIDI 边界、变拍号小数预览、旧 / 新界面备份与旧快捷键冲突优先级；日志 work/piano-viewport-model-test.log。桌面构建 work/piano-viewport-desktop-final.log 通过。隔离原生操作使用合成 36,000 音符 / 25 分钟 MIDI，已验证鼠标、真实 CDP 双指、琴键和弦、持续按键缩放后止音、PgUp / PgDown、缩放快捷键、预设切回及重开恢复；取景不改播放速度，实际 120→125 BPM 快捷调整正确。中键平移及局部黑键 pitch=1 命中正确；800px 无横向溢出。收尾修正预设外相邻黑键裁切后，原生补查 88 键上下限为 21–108，左右边缘实际输入分别为 21 / 108，切回手动相机且绘制代数仍为 1；证据 work/piano-viewport-runtime/preset-final-evidence.json。

短时播放帧间隔采样 565 帧，P50 6.9ms、P95 7.1ms、P99 7.3ms，最大 7.5ms；相机 / 密度变化时绘制代数仍为 1。该数据仅说明此隔离场景，不代表长期复杂曲目性能结论。证据 work/piano-viewport-runtime/{native-evidence,edge-evidence}.json，实际截图 continuous-viewport.png、narrow-viewport.png。仅使用隔离引擎、曲库和 WebView 数据；未运行全套回归。

## 上一批：曲库练习进度与恢复

- Collection 的练习信息移入 library_progress，通过不可变历史在读取工作线程派生，支持取消。最近练习与打开时间分开；完整整曲与学习评审使用同一资格函数，同条件比较仍用原条件模型。未增加平行存储或修改用户数据格式。
- SongBrowser 提供最近练习筛选，曲名 / 最近练习 / 保留记录数 / 练习状态双向排序，保存本机排序偏好。按作品聚合多个演奏版本，列表显示歌曲汇总，详情显示当前演奏版本的上次范围、声部、BPM、命中率与判定音符数。完整整曲与分段分别显示，当前目录与筛选有练习概况。
- “按上次条件继续”复用历史操作持久回执、来源修订与后台恢复，核对当前引擎 / 曲目后进入演奏页。已验证从另一首歌恢复连续模式、90 BPM、转调 +2、1/16 量化及原秒数选段；不新增历史，不自动播放。
- 原生检查发现同一文件的普通 Windows 路径与扩展前缀导致重复行，修复为 App、练习路径模型、目录和歌曲模型共用 pathIdentity。扩展 UNC 也统一比较。目录按路径计文件数，作品按内容计练习记录；原始路径继续用于读取，不重命名文件。最终提示注明连续 / 完整演奏 / 背谱适用条件，生成技术练习隐藏整曲成绩说明并单独标识复习。

有限检查：一项新增后端投影检查、一项原有学习证据检查、一项路径 / 聚合模型检查通过。覆盖近 90 天、分段、中途保存、等音、失败重开、未来时间、声部与同条件次数；普通 / 扩展 / UNC 路径及同内容多副本不重复累计。日志 work/library-progress-{test,evidence-test,model-test}.log。桌面构建 work/library-progress-desktop-final.log 通过，未运行全套回归。

原生隔离数据用四份合成 MIDI：一份完整整曲、两份分段记录、另一份只打开未练；其中两份演奏归入同一作品，目录中还有重复条目。修复前错误显示 12 首 / 13 份演奏、已练习 5 首 / 整曲 2 首，修复后为正确的 8 首 / 9 份演奏、已练习 2 首 / 整曲 1 首。练习根目录实际四个文件，目录计数为 4。按最近、次数、状态的双向顺序与历史一致；最近练习默认选中最近练过的演奏版本。B 版本分段 100% 同时显示仅判定 1/5 音及无完整整曲记录。

恢复入口成功找回所选 B 版本及保存条件，状态 ready；历史仍为三条，四份源 MIDI 与导入副本哈希一致。排序偏好刷新后恢复。证据 work/library-progress-runtime/{setup-evidence,native-evidence,final-layout-evidence}.json；1360px / 800px 实际画面 progress-{wide,narrow}-final.png，无横向溢出。源样例均在隔离 work 根中，未使用正式用户曲库。

## 上一批：选曲试听与演奏衔接

- song_audition 负责后台读取、MIDI 时间线和声音归属，useSongAudition 只管理请求、进度和错误。删除 SongBrowser 用 setTimeout 逐音发送普通 Note 的旧生产实现。试听不进入真人输入、练习计分、累计时间或录音。
- 播放所选演奏原 MIDI 的前八秒，保留力度、原通道、音色及踏板 / 控制事件。换曲、停止、关闭曲库、返回当前演奏、打开所选版本均释放声音；恢复当前演奏的音轨音色。演奏开始和真人输入也可接管。
- 请求独立标识、提前取消记录及完成时状态检查防止迟到结果接管声音；旧停止不影响新试听。引擎自然结束，界面三秒失联后停止，解析和追赶事件有上限。
- 试听提供准备取消、活动状态和秒数进度；800px 窗口中的试听 / 开始演奏并排，宽窗继续使用侧栏。缺少内容身份时不再把多个未索引曲目误标为当前歌曲。

检查范围：两项针对性核心检查通过，覆盖原 MIDI 力度 / 通道 / 音色 / 踏板、自然结束、练习状态 / 历史 / 源文件不变、提前取消 / 迟到完成 / 旧停止、真人接管和失联停止。日志 work/song-audition-test.log。桌面构建 work/song-audition-desktop-final.log 通过；未运行全套回归。

原生桌面使用独立引擎资料根、WebView 目录与两份合成 MIDI，禁用该实例的物理输入，选择内置钢琴。试听实际输出峰值 0.0456416；界面刻意忙碌约 650ms 时，引擎位置 0.8125→1.4716s，仍在播放。切歌后旧请求停止、新试听继续；返回演奏页后试听停止。前后位置、状态、输入计数、计分、练习时间、踏板、按键及历史均不变。证据 work/song-audition-runtime/native-evidence.json。

八秒自然结束、试听后打开所选 B 版本（32 音符）、原 MIDI 哈希不变均通过；见 handoff-evidence.json。1360px / 800px 两个窗口实际检查，最终窄窗按钮同一行、无横向溢出，见 layout-evidence.json、audition-{wide,narrow}-final.png。上述输出电平为内置音源检查；其他音源沿用现有输出路径及此前连接证据，本批未逐设备重新验收。

## 上一批：循环衔接与后台持久化

- PracticeMatcher 暴露待判定攻击与匹配窗口。到达终点且所有攻击已结算时直接收尾；存在待判定攻击时保留迟到输入窗口，避免固定增加半秒停顿。
- 自动轮次先冻结报告并后台分析，再安装新历史根和排队保存，随后续练。历史序列化、历史事务和回放写盘不再是正常续练的前置条件；手动保存继续等待落盘。分析、进阶决策和回放编码仍在续练前执行。
- 保存队列保留每个回放路径，合并最新历史根，先写不可变回放、后提交历史。相同身份冲突拒绝覆盖。失败保留待写根，仍可重试；准备阶段延续 pending 至结果安装，读操作比对保存版本，退出仍等待队列清空。
- 短段目标计数由全曲扫描改为二分范围后遍历，继续使用原分手选择。

有限验证：Debug 桌面构建通过；三项针对性检查覆盖迟到按键、持有磁盘线程时先续练、历史提交失败后重试、多个回放及未知 / 冲突路径保护。日志 work/round-handoff-test.log、round-queued-storage-test.log。未跑全套回归。

实际桌面使用隔离引擎根与 WebView 目录，导入 36,000 音符 / 25 分钟合成 MIDI，关闭特效、固定 88 键范围、预览四小节，连续模式两秒循环、通过测试输入补齐所需音。前后各 11 秒（前两秒预热），同一 IPC 采样方式。改造前循环周期 2524.8–2547.5ms，改造后 1999.3–2034.5ms。帧间隔 p95 约 7.2ms、p99 约 7.6ms，前后基本相同；单次最大帧间隔 75.7→10.3ms 仅为该次观测，不能据此宣称消除全部渲染掉帧。改造后一次辅助输入遇到短暂分析边界，表明分析期控制排除仍存在。见 work/loop-latency-runtime/{baseline,after}-measurement.json。

暂停并确认队列清空后，重启同一隔离程序：9 条历史与 9 份回放完整，历史内容一致，源 MIDI 与导入副本字节相同。证据 work/loop-latency-runtime/reopen-evidence.json。以上为合成曲协议输入与原生画面观察，不代替物理键盘及复杂正式谱长期练习。

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

## P4：三音源主音量、即时控制与插件资料批次

- 内置、VST3 和 MIDI 路由统一消费当前主音量，启动 / 输出切换 / 设备切换后重新应用。Pianoteq 使用输出端增益与短渐变，峰值读取改为真实增益后电平；MIDI 保留歌曲 CC11，并叠加主音量，CC121 / GM 复位后恢复主值。原始 MIDI、CC7 与击键力度不变。
- 演奏栏新增静音 / 恢复按钮，三种音源均可调音量。修正刚调音量后静音时恢复旧值的问题。取消静音记住本次会话的非零音量；重启时若主音量为零，恢复按钮采用默认音量。
- 新 PlaybackAdjustmentQueue 替代旧无应答 pendingAdjust：速度、主音量、即时模式和时间线定位不再进入全局 requestBusy 通道。原通道会直接拒绝连续调整，现按来源串行并合并同类最新值，取消 / 换歌后忽略旧结果。队列检查中在途最大为 1，待处理 0.3 被 0.4 替换，来源变化取消旧应答。
- Sound Owner 显式接收资料根，VST3 状态从 CWD 迁到资料目录。首次复制旧状态并保留原件，新目标已有资料时优先使用；更新保留 .previous.bin，恢复失败停用本次覆盖。设备设置显示插件是否从资料恢复，消除升级包与插件状态的运行目录耦合。

仅运行相关增益、MIDI 控制器与状态迁移检查，证据 work/master-gain-test.log、midi-master-volume-test.log、plugin-state-migration-test.log；队列场景见 work/master-volume-runtime/queue-evidence.json。实际桌面在内置 / Pianoteq / Microsoft GS 三路使用静音恢复及音量键盘操作，Pianoteq 的电平从 0.002901 降到 0.00000375 以下并恢复至 0.04890；静音后切换到 Pianoteq，250 ms 后电平约 2.96e-10。Windows MIDI 无应用内电平回读，证据覆盖真实端口连接与命令 / 控制器路径，不把 null 电平当作声波验证。见 volume-evidence.json。

即时控制实际链：播放中改到 90 BPM、定位到 4.4512 秒，status 仍 playing；弹对后继续 / 连续可切换。见 realtime-controls-evidence.json。旧模拟 MIDI 导入及 WebView 调试过程中，原生窗口重置视口曾影响坐标点击，最终音量操作改用可观察的 Home / End 键盘控制；仅保存最终可确认链路。

迁移实际链：旧插件状态复制前后 SHA-256 均为 7218a2318cf0e04d26633e98314ce09190a9ea0303de0b3063e5906df8c94705，新资料文件与原字节相同，插件报告已恢复且无警告。换到 launch-b 运行目录后仍从同一资料恢复，未在新 CWD 建立状态目录。见 plugin-state-evidence.json、plugin-reopen-evidence.json、plugin-profile-settings.png。检查的资料根及工作目录均隔离，未读取 / 改写正式插件预设。

本批 Release 预览包已生成于 outputs/releases/Panthesia-20261119-audio-profile，源码提交 f3331da。当前工作区既有曲库路径调整仍未提交，构建记录标记 dirty=true，源码内容指纹 228CE979FF6A580982837B5E1F13743472144485A20751A6D17EC29D67916273。29 个文件校验一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首、9 音符，MIDI 已连接。见 work/audio-profile-release.log、work/audio-profile-package-check/release-evidence.json、startup.log。后续按主流程和原范围做交付审计，官方矩阵未关闭项继续有效。

## P2 / P4：谱页预览与采用后直接演奏批次

- 新增 ScoreDocumentPreview，共用演奏谱面的 Verovio 渲染器、SVG 清理和内容缓存。导入 MusicXML / MXL、DuET 保留初稿和已有版本均可在采用前显示真实谱页，支持翻页、放大及失败重试；原谱预览明确说明采用后应用练习变换。
- 已有版本的预览命令按需返回同一次读取的谱面字节；限制读取大小，并核对实际内容指纹。只读预览继续走后台读取，不安装演奏映射，不切换当前谱面。分区隐藏 / 来源变化 / 关闭时取消本地排版任务。
- 初稿新增“添加并打开演奏”，版本新增“使用并打开演奏”或“打开谱面演奏”。先完成保存 / 采用及会话刷新，再结束当前操作、检查歌曲身份，进入对应谱面演奏页。失败保留原有恢复入口。
- 歌曲关系、文件位置 / 名称及演奏顺序明细改为可展开辅助信息；谱页加载后将预览滚入当前窗口。谱面管理窗口接入现有皮肤颜色，白纸保持读谱对比。

受影响 Desktop Debug 与前端生产构建通过。隔离资料 work/song-core-duet-runtime 中，已保存 DuET 版本显示 9 个音符；打开已保留 DuET 初稿、150% 放大、采用并返回演奏通过。另从内置练习 MusicXML 导入，预览后仅保存版本，再采用并打开演奏通过。最终源码从内置谱切回 DuET 谱：源演奏内容身份相同，+2 半音 / 1/16 量化及其 editionId 完全相同，演奏页 9 个谱音正常显示。1000×800 窗口未出现横向溢出，谱页预览自动移至内容区顶部 8 像素处。未运行全套回归或重新执行 DuET 推理，复用此前真实生成的保留初稿。

证据：work/score-document-desktop.log；work/score-document-runtime/flow-evidence.json、import-version-evidence.json、final-workflow-evidence.json，及 final-visible-preview.png / duet-draft-preview.png。早期操作脚本的选择器和状态读取修正后，最终链以 final-workflow-evidence.json 为准，其中 practiceVariant 读取实际返回字段。

后续集中按主流程做交付审计及原功能矩阵未完成项；复杂曲目记谱质量和外部推理环境仍需对应实际使用范围。整体 Goal 继续 active。

## P3 / P4：歌曲、设备与自定义键盘取景批次

- 新增 keyboardViewport 纯计算模块，统一音域、白键边缘、按歌曲取景、缩放和平移。Piano 与瀑布消费同一个范围，指针击键继续使用同一几何。删除 fullRange 布尔分支及 App 换歌时强制改写 49 / 88 键的副作用，练习变换不再强制展开 88 键。
- 新增取景工具栏：歌曲音域、49 / 88 键、MIDI 设备和自定义范围；显示实际音区、视窗外音符数量及适合歌曲入口。放大 / 缩小与平移按钮立即生效，Ctrl + 滚轮以指针位置缩放，Shift + 滚轮平移；普通滚轮继续交给原界面滚动。变化时释放屏幕按住的琴键，避免持音残留。
- 显示设置新增自定义上下限和实体键盘音域，支持常用 25 / 49 / 61 / 76 / 88 键预置。设备配置按 MIDI 输入名称保存；未设置的设备明确提示暂用 88 键，用户输入音域不冒充硬件自动识别。只影响显示，范围外自动伴奏 / 移八度策略仍属 P14 未完成范围。
- 新范围进入现有偏好事务与界面备份，旧备份缺少新字段时仍可读取；旧 49 / 88 键设置保持原值。新资料默认歌曲音域。备份预览显示设备与音区名称。

受影响 Desktop Debug / 前端构建通过。一次取景边界检查覆盖 MIDI 0–127、单音极端位置、缩放和平移的白键一致性、两个设备范围的独立选择及固定范围保持，见 work/keyboard-viewport-domain.log。实际桌面使用全新隔离资料 work/keyboard-viewport-runtime：五指练习取景 50–76，放大 / 平移至 64–86，Ctrl 滚轮至 67–83；选择 49 键再换至低音练习仍为 36–84。播放中缩放与平移前后状态均为 playing，位置从 0.0003022 前进至 0.0747993 秒。为已连接 Keystation 61 MK3 设置 36–96，偏好实际保存后重启，显示继续为该 61 键范围。

证据：work/keyboard-viewport-desktop.log；work/keyboard-viewport-runtime/viewport-evidence.json、reopen-evidence.json、zoom-pan.png、device-range.png、reopened.png。首段自动化曾在预备拍操作，后续补充 playing 场景；持久化检查等待实际保存完成，最终以 settings / playing / reopen 字段为准。未跑全套回归。

P05 / P06 主行为已落地。P07 按白键逐档缩放和平移，像素级连续取景仍记为部分；设备范围外音符的伴奏 / 移八度尚未实现。其余原功能矩阵状态继续有效，整体 Goal active。

## P3 / P4：组合演奏工作区与页内跟随批次

- 新增 PracticeStage，单独谱面、瀑布及组合视图共用原演奏状态和 A/B 范围。组合可自动排列或选择上下 / 左右，分隔条支持拖动、方向键和边界键；拖动只更新本地比例，释放后写入偏好。视图、排列、比例进入现有布局及界面备份，旧记录缺少字段时补默认值。
- 单独谱面 / 组合视图切换保持同一个 Notation 实例，保留当前谱页与缩放。瀑布及其读数在隐藏时不挂载。保持原先音频控制与后台任务边界。
- 谱面工具栏保留翻页、跟随和缩放；指法、节奏来源、导出及可定位纸谱收进“谱面选项”。阅读区改为自适应剩余空间，组合窗口中可独立滚动。
- 新增 IntervalTimeline，把瀑布已有的静态区间树提取为共用算法，NotationTimeIndex 按有效演奏秒数使用。替换逐帧 mapping.filter / find 全表扫描，保留长延音、同时起音和精确端点。跟随滚动到同页当前音符；缩放、分隔条和视图变化不改变引擎位置。

受影响 Desktop Debug 与前端构建通过。两项针对检查：共用索引对 10000 个短音及跨全曲长音的边界语义与原筛选一致，瀑布 tick 区间保持原结果；旧界面备份和保存布局缺少新增字段时可解码。见 work/combined-stage-domain.log、combined-stage-backup.log。

实际桌面使用全新隔离资料 work/combined-stage-runtime，并导入本地构造的 48 小节 / 192 音检查谱。定位 90.1 秒后第 38 小节音符在阅读区域内；150% 放大前后位置仍为 90.1 秒，竖 / 横滚动将同一音符保持可见。单独谱面 / 组合切换 DOM 实例相同。播放中拖动分隔条，状态保持 playing，位置从 90.1044 继续至 90.2289；720×800 上下排列无横向溢出，谱面 / 键盘高约 270 / 151 像素。最后源码重启恢复 combined / rows / 63%，播放中改到 125% 后状态仍 playing，位置从 90.1082 至 90.1475；Alt+V 从谱面切入组合，未捕获页面错误。

证据：work/combined-stage-desktop.log；work/combined-stage-runtime/combined-evidence.json、final-reopen-evidence.json；combined-start.png、final-columns.png、final-rows-narrow.png、final-reopened.png。只做上述受影响检查，未执行全套回归。原生全屏、纸谱与高 DPI 的组合覆盖仍按功能矩阵待核对，整体 Goal active。

## P3：时间线旁保存与重开练习段批次

- 新增 SavedPassageBar，直接保存当前 A/B 为命名练习段，选择已保存段落、查看范围 / 起始 BPM / 模式，并打开该段循环；管理按钮返回原 PassageDialog。未引入第二套持久化目录。
- 新增 tickAtSeconds，与 secondsAtTick 共用当前有效演奏速度图。原始 / 量化条件下均按当前网格写入 TickRange，已有后端验证内容身份、网格、边界和停止演奏条件。
- 复用 readPractice / editPractice / usePracticeEdits 的来源与目录版本约束，提交成功而刷新失败时只重试刷新。快捷栏按内容保持选中项，演奏 / 标注版本变化后重新读取并暂锁旧目录，避免打开后跳回第一条或使用旧版本。
- 已保存段落恢复原速度、声部和练习模式；BPM 与模式在打开前显示。保存只在暂停且无按键时可用，正式录音 / 完整演奏 / 活动计划沿用原限制。转调、量化或网格改变时旧段落提示核对，隐藏失效范围摘要。

受影响 Desktop Debug / 前端构建通过。一次 tick / 秒往返检查覆盖变速点及精确边界，见 work/saved-passage-time-check.log。实际桌面在全新隔离资料 work/saved-passage-runtime 中，设置 0.55–2.05 秒 A/B，保存“第二句循环”；另保存 2.50–3.75 秒“第三句”。分别改变当前速度后打开，恢复各自保存速度 1.0，循环端点准确；选中第二条在打开及管理窗口返回后仍保持，未捕获页面错误。

转调 +2 后快捷栏提示条件变化并禁用打开；恢复原条件后 2 条段落仍可读取与使用。最后源码重启后再次打开“第三句”，范围为 2.50–3.75 秒，显示 100 BPM / 弹对后继续。720×800 截图检查完成。证据 work/saved-passage-desktop.log、work/saved-passage-runtime/flow-evidence.json、reopen-conditions-evidence.json、final-reopen-evidence.json，以及 final-opened.png / final-narrow.png / final-reopened.png。

早期脚本等待隐藏的原生 option 和短暂提示文本，后续改为检查真实目录、循环状态与选中 ID；保存未因此重复执行，最终目录保留 2 条。未跑全套回归。下一步优先把段落的练习变换条件明确纳入核心快照与迁移，减少转调后重复核对；独立书签与 MIDI marker 仍待实现。整体 Goal active。

## P1 / P3：段落练习版本快照与恢复批次

- PassagePreset 新增可选 practice，直接复用 core::song_project::PracticeEdition / Variant，统一来源、变换参数和身份。普通、精确 A/B、MusicXML、纸谱及两类指法保存入口均记录快照。
- OpenPassage 从 lib.rs 提取到 passage_practice。通过已有后台 song-switch 准备隔离音乐状态，恢复保存的转调 / 量化、核对网格及范围，再提交偏好和 Playback；无效范围不会替换当前音乐数据和练习条件。保留正确的偏好写入路径、恢复状态、未变换时的撤销与映射规则。
- 旧段落从 grid 的 practice-v1 读取变换，目录读取只做兼容投影；成功打开才补齐快照。手工调号缺失时采用原默认信息。新快照核对计算身份与源演奏归属。
- 快捷栏和管理窗口允许恢复有快照的段落，展示原调 / 移调、量化、BPM 和模式；管理列表的速度改为 BPM。原始文件与当前歌曲投影仍共用同一内容身份。
- 备份新增版本 20，曲目包新增版本 16；新快照在解码时校验身份与归属，范围按对应变换后的实际演奏验证。旧格式继续可读，更新相关既有谱面 / 拍内往返检查的版本断言。指法与纸谱的重复生成比较先归一旧快照，避免相同内容被误判为修改。

只执行 1 项组合核心检查，覆盖普通 / 精确段落的条件恢复、旧记录补齐及新旧内容相等、准备失败保持原变换及音乐快照、备份 20 / 曲目包 16 往返，通过。见 work/passage-practice-core-test.log；受影响 Desktop Debug / 前端构建通过，见 passage-practice-desktop.log。

实际桌面复用隔离资料 work/saved-passage-runtime。先从 +5 / 1/16 打开旧“第三句”，恢复原调 / 原始时序及 2.5–3.75 秒范围，并持久化迁移快照；再在 +2 / 1/16 下保存 0.6–1.8 秒“移调量化选段”，改至 -3 / 1/8 后打开，恢复 +2 / 1/16 与准确范围。段落快照、演奏 practice ID 和歌曲 project.practice.id 三者完全相同；原始 MIDI SHA-256 不变。最终源码重启后再次恢复成功，快捷栏与管理窗口都显示 100 BPM 和 +2 / 1/16，未捕获页面错误。

证据 work/passage-practice-runtime/restore-evidence.json、final-reopen-evidence.json、restored.png、final-reopened.png、manager.png。未执行全套回归。谱面选段仍核对当前原谱身份，切换原谱版本后的自动选回是下一项数据核心衔接；随后处理计划 / 速度阶梯条件协同、独立书签和其他矩阵未完成项。整体 Goal active。

## P3：保存段落恢复原谱版本

- passage_practice 在恢复练习变换后，以 ScoreRange 原谱指纹查找当前演奏已登记的版本。实际读取、核对内容并解析后，验证原演奏顺序和范围，随后与练习设置一起在后台事务提交。切换过谱面或使用 MIDI 即时谱后，均可直接打开原谱选段。
- 保存旧谱面的替代版本仍留在登记中。原谱缺失 / 改变或范围不一致时返回具体提示；失败准备不替换当前音乐数据与练习条件。现有范围字段已足够，不增加持久字段或交换格式版本。快捷栏反馈明确包含谱面恢复。
- 一项核心行为测试通过，覆盖原谱恢复、转调量化恢复、其他版本保留、失败隔离与 MIDI 内容不变。Debug 构建及实际桌面操作通过：替代谱面 +2 / 1/16 → 原谱原调选段 0–2 秒；重启保留原谱；解除谱面后再次从快捷栏恢复，实际谱页 1 页 / 2 音。
- 证据：work/passage-notation-core-test.log、passage-notation-desktop.log、passage-notation-runtime/{evidence,reopen-evidence,page-evidence}.json 与 reopened.png。使用独立样例目录，未修改用户资产。源码提交 1cefcd3。
- 下一批集中衔接计划 / 速度阶梯与统一练习版本，之后按功能矩阵处理独立书签等既定缺口。整体 Goal 继续 active。

## P3：日课与速度阶梯统一练习版本

- core::PracticeEdition::resolve 集中快照验证和旧签名推导。LadderPreset / RoutineItem 保存可选快照；直接阶梯、日课阶梯与普通项目打开都会恢复自身的转调、量化及时值，随后核对范围与评分条件。继续使用现有后台准备和事务提交。
- 命名段落即使与当前练习条件或采用谱面不同，也可直接加入计划。隔离状态先恢复其版本 / 谱面 / 范围，再捕获项目，当前会话与磁盘关联不变。打开项目后才采用原谱。旧重复网格拒绝和临时修改当前声部计算范围的分支已删除。
- 阶梯方案、表单、级别、运行状态、保存详情和计划来源摘要改用 BPM；方案列表展示转调与量化。BPM 按选段起点换算，保留曲内变速，输入精度沿用 1% 原速。只读阶梯目录向旧记录提供推导快照，不改写原数据。
- 备份 21 / 曲目包 17 完整带入新语义，并验证演奏归属与内嵌版本一致性。新快照、旧无快照、计划原谱恢复、阶梯开始、曲目包导入后开始、备份及非法身份检查已覆盖。受影响 score_ranges 模块 6 项通过，未执行全套回归。样例根路径使用与桌面相同的绝对目录，保持导入位置检查有效。
- 桌面实际检查：在 -3 / 1/8 下应用 +2 / 1/16 阶梯，恢复 30 BPM；从日课打开同阶梯同样恢复。界面输入 30 / 60 / 15 BPM，级别与运行状态一致。样例 MIDI 内容哈希不变。重启后阶梯保存进度及日课再次打开均恢复 +2 / 1/16，BPM 表单 30–72 / 步长 6 生成 8 级。证据 work/planned-editions-runtime/{evidence,bpm-evidence,ui-apply-evidence,reopen-evidence}.json 与 ladder.png / applied.png / final-bpm-editor.png；构建及受影响检查日志 work/planned-editions-*.log。
- 下一批为独立演奏位置书签、MIDI marker 和时间线 / 循环联动，属于既定矩阵缺口。整体 Goal active。

## P3：书签、MIDI marker 与循环定位

- core::song_bookmarks 集中定义个人书签及容量 / 身份 / 名称 / tick 验证。midi-file 读取 Marker / CuePoint 并排序去重；源演奏身份归属、转调量化的 tick 位置和原 MIDI 内容不变。
- 新增 Bookmarks / SaveBookmark / RemoveBookmark，加入原 practice_catalog 后台读写、来源检查和所属集合合并。书签可随备份 22、曲目包 18 导出与导入，备份摘要、是否有可导出内容及包预览同步显示书签。
- 演奏页时间线旁新增紧凑书签栏：当前点命名保存、改名删除、MIDI 来源标记 / 收藏、两书签间循环及全曲标记位置。App 快捷键统一提供默认 Alt+1–9，允许重设，焦点和模态优先级沿用原系统。循环外跳转先退出循环并保留播放状态，所有视图共用原 seek。
- 修复新增书签栏与旧选段栏的同值 React key 导致重复 DOM；两组件身份区分并保持当前歌曲归属。
- 一项核心检查通过（含补充旧曲目包替换导入保留个人书签）：MIDI 标记去重、非法归属 / 越界拒绝、+5 / 1/16 后 tick / 秒投影、备份 22 / 包 18 往返和包导入、个人书签删除、原文件内容不变。Debug 构建通过，未运行全套回归。
- 原生桌面使用独立 3 音 MIDI：自动读取 3 个源标记，保存 0.25 / 1.25 秒位置，循环 0.25–1.25，跳至循环外 0 秒，Alt+2 定位 0.25，改名。重启后 2 个个人书签完整；+3 / 1/16 下收藏源标记并删除，连续播放中循环外跳转保留 playing。源 MIDI 哈希一致。证据 work/bookmarks-core-test.log、bookmarks-desktop-final.log、bookmarks-runtime/{evidence,reopen-evidence}.json 与 bookmarks.png。
- 下一批按既定矩阵 P12 / P13 衔接循环失败阈值和下一轮预览，再集中检查性能及成品体验。整体 Goal active。

## P3：循环错误重开与下一轮预览

- 新增 loop_practice，主 tick 与自然结束复用同一收尾方法。普通等音 / 连续循环按错音 + 漏音阈值触发，阈值可关闭，规则经原后台目录写入全局偏好。保存后回起点，repetitions 不增加，重开计数单独展示。日课 / 阶梯 / 录音 / 聆听沿用各自规则。
- 失败轮使用已有自动保存、回放和累计时间流程；history context 增加可选 loop_restart，详情显示原因。该记录为同任务失败，不能建立或延长熟练连续次数，不作为完整演奏周证据。备份新增 23，旧记录默认无此结果。
- 瀑布 / 组合视图在循环末尾显示一轮淡色起点音符和源网格，预览开关位于时间线；当前与下轮窗口均限制在实际循环范围。预览无选择命中、键盘效果、声音或计分。显示偏好与界面备份已覆盖开关。
- 仅执行两项针对性核心检查：等音错音 / 连续漏音 / 关闭阈值 / 正常完成与备份结果语义；同任务失败会清零熟练连续次数。两项通过，未跑全套回归。见 work/loop-practice-core-test.log 与 loop-practice-history-test.log。
- 原生桌面独立 12 音 MIDI，0–2 秒循环：设置阈值 1 后等音错音自动保存并重开，完成次数 0；连续不弹时漏音同样重开。异步保存的历史详情均保留 loop_restart=1。关闭阈值后预览开关改变 Canvas 图像，position / status / noteEpoch 不变；起点源网格与淡色音符已目视检查。原 MIDI 哈希不变。
- 重启恢复阈值 3、关闭预览的偏好及两次失败记录；不会自动开始演奏。引擎资料根与 WEBVIEW2_USER_DATA_FOLDER 均位于 work/loop-practice-runtime，未使用日常资料。证据该目录下 wait-evidence.json、flow-preview-evidence.json、reopen-evidence.json 和 preview-on / off.png / workspace-preview.png / loop-settings.png；桌面构建日志 work/loop-practice-desktop-final.log。
- 下一批集中解决长曲瀑布和循环收尾等待 / 保存后的延迟，进一步解除实时线程与分析 / 持久化耦合，再按原功能矩阵继续。整体 Goal active。

## 交付状态
当前主线运行包：outputs/releases/Panthesia-20261119-mainline-practice/Panthesia.exe。程序源码 449a3e3；实验分支 feature/assessment-lab / ca4aeb5。运行包包含本次主线收束全部代码，评分版旧包只作为历史存档。源码指纹 7A9670E0647CB16F0498900CA1D9D53F7B2503C148F7600AEB88A6CC3CD4FA76；dirty=true 对应原有九项未提交修改。29 个包内文件哈希一致，独立 --window-check 返回 PASS，visible / frontend / IPC / audio / notationWasm / pdfPages ready，内置 5 首 / 9 音符，MIDI connected。证据 work/mainline-scope/{release,independent-check}.log 和 package-check/{release-evidence.json,startup.log}。本次定向任务完成，不恢复已清除的长期 Goal。

此前评分版运行包为 outputs/releases/Panthesia-20261119-round-preparation，程序源码提交 50dfb76。包含独立自动轮次分析队列、回放物化 / 校验 / 编码后移、待写容量约束、范围身份跨轮复用及逐音伴奏规则的评估失效处理。manifest 标记 dirty=true（原有九项曲库修改），源码指纹 82C8270D3410E84BC935A5C49A6D63CA0CE823B95D2AC05F35204D6494E2407F。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。运行包检查使用独立引擎、曲库与 WebView 目录。日志 work/round-preparation-release.log、round-preparation-independent-check.log 及 round-preparation-package-check/{release-evidence.json,startup.log}。


上一批运行包为 outputs/releases/Panthesia-20261119-piano-viewport，主要改造提交 2779cb1，最终程序源码提交 be9e507。包含连续取景、鼠标 / 双指操作、前方密度和可配置快捷键、稳定绘制生命周期、取景保存 / 备份、5 BPM 速度快捷调整及固定预设的真实琴键边界。manifest 标记 dirty=true（原有九项曲库修改），源码指纹 6E34BFBE070E899A7E1D0FBFD9A2D5C856C6F664F76552526E8E399543F858DD。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。检查使用独立引擎、曲库和 WebView 目录。日志 work/piano-viewport-release-final.log、piano-viewport-independent-check.log 及 piano-viewport-package-check/{release-evidence.json,startup.log}。outputs/releases/Panthesia-20261119-continuous-viewport 是固定预设边界修正前的中间包，交付使用 piano-viewport。

前一批运行包为 outputs/releases/Panthesia-20261119-library-practice，主要改造提交 927ec75，最终程序源码提交 264bd5e。包含曲库练习投影、四类双向排序、按历史条件恢复、Windows / UNC 路径统一与目录去重，并明确整曲成绩适用模式、区分生成技术练习提示。manifest 标记 dirty=true（原有曲库路径修改），源码指纹 80F9F6E034DD1AFFBC36C658AE91599B77FCBC93FD50595B838C494855E9F1FB。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。检查隔离引擎与 WebView 资料。见 work/library-practice-release.log、library-practice-independent-check.log 及 library-practice-package-check/{release-evidence.json,startup.log}。

outputs/releases/Panthesia-20261119-library-progress 为本批中间构建（927ec75），未包含最终整曲 / 技术练习提示区分；交付使用上面的 library-practice。


上一批运行包为 outputs/releases/Panthesia-20261119-song-audition，程序源码提交 4dd4619，包含独立引擎选曲试听、请求取消与止音衔接、进度显示、窄窗操作布局和当前歌曲误标修复。manifest 标记 dirty=true（原有曲库路径修改），源码指纹 F4B9FE04B49B638B3C9A5FE433EE0C021E519CCF9254C7EF81979AA5A25BF769。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。检查隔离引擎与 WebView 资料。见 work/song-audition-release.log、song-audition-independent-check.log 及 song-audition-package-check/{release-evidence.json,startup.log}。


上一批运行包为 outputs/releases/Panthesia-20261119-loop-latency，程序源码提交 21d85bb，包含循环按待判定音符结算、自动轮次后台持久化与长曲选段计数优化。manifest 标记 dirty=true（原有曲库路径修改），源码指纹 663AA6D7BBEB937F19AE12525ECDE976230086A37FB0028CF410D3F2206546CB。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。检查隔离引擎与 WebView 资料。见 work/round-handoff-release.log、loop-latency-independent-check.log 及 loop-latency-package-check/{release-evidence.json,startup.log}。


上一批运行包为 outputs/releases/Panthesia-20261119-loop-practice，程序源码提交 d9c76fc，包含普通循环错误阈值重开、失败结果语义和瀑布下一轮预览。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 CCE8BF4AF70D3B7961062B57CB219D54A5571C076BE236BCAA141FBE135E3E58。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。独立启动同样隔离 WebView2 用户目录。见 work/loop-practice-release.log 及 loop-practice-package-check/{release-evidence.json,startup.log}。


上一批运行包为 outputs/releases/Panthesia-20261119-bookmark-navigation，程序源码提交 d9f63d0，包含个人书签、MIDI 标记、数字定位与书签循环，并修正旧包替换导入的书签保护。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 CF7EAC06EFD11B0D8056576006F1953D847B9924B36FCDD39F3BFB92B575ACD4。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/bookmark-navigation-release.log、bookmarks-core-test.log 和 bookmark-navigation-package-check/{release-evidence.json,startup.log}。

outputs/releases/Panthesia-20261119-bookmarks 为本批中间包，源码 f01c584；尚未包含旧包替换的书签保护修正，交付使用上面的 bookmark-navigation。


上一批运行包为 outputs/releases/Panthesia-20261119-planned-editions，程序源码提交 378bf23，包含日课 / 速度阶梯的统一练习版本、命名段落跨条件入计划、计划恢复原谱及阶梯 BPM 界面。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 20CFFC3FBBA2AE58F8CF3BB7D24ED820EB20FF7CA3994A7EBC7847F776136517。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/planned-editions-release.log 和 work/planned-editions-package-check/{release-evidence.json,startup.log}。最终 Debug 构建 work/planned-editions-desktop-final.log；核心 6 项检查 work/planned-editions-affected-test.log。


上一批运行包为 outputs/releases/Panthesia-20261119-passage-notation，程序源码提交 1cefcd3，加入谱面段落的原谱查找、验证和同步恢复。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 467DA9968B38CA16363773425C009C3C3449FCAC8E0D7CE2C78FAE6A42BFDE3B。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/passage-notation-release.log 及 work/passage-notation-package-check/{release-evidence.json,startup.log}。


上一批运行包为 outputs/releases/Panthesia-20261119-practice-editions，程序源码提交 e9cd047，覆盖段落练习版本快照、跨条件恢复、旧记录兼容及对应备份 / 曲目包语义。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 C4EFCF2E4D3642CE7A99AB20CE22B50E9C56C8FD94B98D6BF60704A94A08C706。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/practice-editions-release.log 及 work/practice-editions-package-check/release-evidence.json / startup.log。

上一批运行包为 outputs/releases/Panthesia-20261119-saved-passages，程序源码提交 416a2ca，加入演奏时间线旁的 A/B 保存及段落重开。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 7F099C7977172C7FACFC7093ADF78CF3C9992A7B1F019F23EE5B9B24076C6029。29 个文件哈希一致；独立 --window-check 返回 PASS，visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/saved-passages-release.log 及 work/saved-passages-package-check/release-evidence.json / startup.log。

上一批运行包为 outputs/releases/Panthesia-20261119-combined-practice，程序源码提交 0df57c4，包含组合视图、页内跟随、保持演奏位置的缩放及共用区间索引。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 39356B911D24AF8B2CD572F52C2D2C225E0838AA82D7EAB5597981CEC339AA07。29 个文件哈希一致，独立 --window-check 返回 PASS：visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/combined-practice-release.log 及 work/combined-practice-package-check/release-evidence.json / startup.log。

上一批运行包为 outputs/releases/Panthesia-20261119-keyboard-viewport，程序源码提交 93f3ec0，加入本批统一取景。manifest 标记 dirty=true（工作区原有曲库路径修改），源码指纹 D8AC21089D9D30BD69C360FA40EA43EBEF950C29B54896A8FF0B0C2B92B8147B，29 个文件哈希一致。独立 --window-check 为 PASS：visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首 / 9 音符，MIDI 已连接。见 work/keyboard-viewport-release.log 和 work/keyboard-viewport-package-check/release-evidence.json / startup.log。

上一批运行包为 outputs/releases/Panthesia-20261119-score-workflow，程序源码提交 324387e，增加采用前谱页预览、直接返回演奏与谱面管理皮肤。构建包含工作区原有曲库路径调整，manifest 标记 dirty=true，源码指纹 E0B97E1CB127F57F32453A4B43C35BEB12A0D928A2ECF69960ACC186C150D186。29 个文件哈希一致；独立 --window-check 返回 PASS：visible、frontend、IPC、audio、notationWasm、pdfPages 均 ready，内置曲库 5 首、9 音符、MIDI 已连接。见 work/score-workflow-release.log 及 work/score-workflow-package-check/release-evidence.json / startup.log。

此前 audio-profile（f3331da）、focused-practice（070f511）、song-practice（39263e3）与 independent（af146d8）继续留作历史版本。DuET 推理依赖本机已配置的 Python 与模型，运行包未包含大型推理环境。整体 Goal 仍 active，未经要求未推送。

## 数据与工作方式

允许重构替换旧实现，原用户资产和历史通过明确迁移保护。生成输出使用隔离测试目录；正式用户数据不参与检查。每批只做受影响编译及关键行为 / 小范围界面验证，主要时间用于实现。不得因为模型声明、拆文件或测试通过而宣称整体完成。
