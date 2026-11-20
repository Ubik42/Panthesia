# 原创应用实现替换清单

目标：Panthesia 自己的应用实现；前端交互依据 Synthesia 规格复刻；通用开源库按许可使用。GitHub 独立仓库和独立提交根已成立，源代码的原创替换仍在进行。

## 处理原则

以功能协议、标准格式和当前需求独立实现应用逻辑，避免继续复制 Neothesia 实现或只更换名称。每个替换记录规格、实现来源、消费者和旧路径退出位置。已查看上游代码的现状如实记录，不宣称严格 clean-room 开发。

现有来源声明在相关实现仍存在时准确保留。替换完成后按实际残留内容更新 NOTICE；第三方素材和依赖的归属独立记录。Git 历史中出现旧源码与当前主产品是否引用旧实现分别记录；本轮不强制改写远端历史。

## 模块台账

| 旧实现/资源 | 当前作用 | 处置与关闭条件 | 任务 |
| --- | --- | --- | --- |
| midi-file 应用包装 | 已退出桌面普通依赖；仅一项兼容检查作为旧行为参照 | c706a2d 的 panthesia-music 接管产品消费者；旧包物理删除并入 P20 | P05–P06 完成 / P20 |
| piano-layout | 已退出桌面普通依赖 | c706a2d 的 panthesia-keyboard 接管范围/几何；旧包物理删除并入 P20 | P07 完成 / P20 |
| core utils/config/recorder 等沿用 | 部分实际使用，部分仅旧入口使用 | 逐文件确认消费者；活动实现替换，旧入口专用的随退役移除 | P07/P12/P20 |
| wgpu-jumpstart、旧 render、panthesia-image、nuon | 旧原生/编码路径，默认桌面关闭 native-render | 退出当前交付依赖；旧原生消费者退役后移除源码及 workspace 项 | P20 |
| panthesia 原生 UI | 旧默认运行目标，与新 Tauri 产品并存 | B00 退出默认目标；P20 消除活动引用后移除旧 UI | B00/P20 |
| panthesia-cli、ffmpeg-encoder、panthesia-ai | 旧编码/AI wrapper，当前主流程未使用 | 不作为现成扩展重新拉回；后台有明确需求时独立适配通用工具，随后移除旧包 | P16/P20 |
| .github 旧原生 CI/打包及 Flatpak | 默认构建/发布目标错误，残留原作者应用标识 | B00 停止默认旧工作流并移除重复旧 macOS 包；根 Flatpak 和其余旧平台入口在 P20 消除引用后移除 | B00 |
| 旧产品文档/链接 | 上游下载、Fork、旧成品和旧评分要求 | 当前说明重写；历史记录隔离，不将归属声明误作产品入口 | B00/P22 |
| 原图标、字体、SF2、曲目与模型 | 非代码资源，不能由源码重写自动消除归属 | 独立清单、来源和授权；需要替换时使用自有/许可明确资源 | P21 |
| 第三方通用库 | midly、cpal、midir、rtrb、oxisynth、Verovio、PDF.js 等 | 固定依赖版本、核对许可并随包带必要通知；不把其全部重写列为原创目标 | P21 |

## 完成判断

来源基线见 evidence/source-origin-2026-11-20.json。该比较只能找到已知相同/改名/同路径的候选，不能自动认定其他文件原创。

每项关闭须记录：新实现提交、消费者接入点、旧依赖退出点、必要行为证据、身份/格式迁移结果。最终从产品依赖图和实际运行包复核，而非依靠搜索不到 Neothesia 字符串。兼容导入器可读取旧格式；它应具有窄接口和退出/导出路径，不能继续携带整套旧应用。

当前 LICENSE/NOTICE 不在“批量删除旧名”操作里修改。原创应用层完成、第三方声明收束和最终许可选择分别留证据。若需要新的原创源码发布基线，先生成可审阅导出和来源清单，再决定共享远端历史处理。

## B01 新实现记录

SongRepository 由本次 Codex 工作按当前数据规范与 SQLite 事务协议新写，消费者为目录扫描、歌曲加载、歌曲关系编辑、桌面路径校验及关系备份恢复。它仍使用现有 core 的 RepertoireRegistry、SongSidecar 与旧 MIDI 读取包装，因此此项不关闭 P05–P07，也不改变现有 LICENSE/NOTICE。旧 repertoire.json 正常写入已退出；workspace 投影、imports 和旧 RON 适配器待 P01/P04 收束后退出。

2026-11-20，4613db3：新增 core/song_annotations 文档适配器和工程迁移命令；文件演奏/导入/编辑接入新地址，旧 Sidecar 日志仍兼容旧目标。新文档复用现有 SongSidecar 数据类型与校验器，不宣称旧 core 已完成独立替换。移除选曲对旧 workspace 的条目追加；非文件演奏与旧元数据兼容入口仍待退出。

2026-11-20，c72d1fb：新增 notation_assets 不可变谱面持有模块；内置/生成练习、曲目包、启动恢复和目录登记接入统一资产。删除旧内置缓存覆盖写法和多处谱面拷贝写法。Package 第 19 版使用 Panthesia 标识，旧格式解析保持窄兼容。此批继续使用旧 MidiFile、Player、SongSidecar 和运行时实现；P05–P07 与原创应用来源替换仍未完成。证据见 evidence/owned-assets-2026-11-20.json。

2026-11-20，16081cf：新增 portable_song 与 song_repository/archive，负责歌曲归档、跨演奏关系和中断恢复；普通导出、预览、暂存导入和恢复接入。共享文件加载退出历史/旧练习的旁路；旧 repertoire 导入改为补入。谱面身份刷新与归档恢复兼容。继续复用现有单演奏格式、Player、MidiFile 与 SongSidecar；P05–P07、完整前端复刻及来源替换继续执行。当前正式包保持 a67ea54；本批 Debug 与独立运行证据见 evidence/song-archive-2026-11-20.json。

2026-11-20，8b1d4ff：新增 owned_annotations 与 library_migration，以及只读计划/冷快照迁移命令。替换外部旧附件的活动写入和直接复制路径；原生重定位转入后台事务。旧目录缓存不再覆盖内容标注，真实资料迁移有回执与未匹配记录。B01 已收束，旧 MidiFile、piano-layout 与音乐时间消费者仍待当前 B02 独立替换；本批不关闭 P05–P07。原有目录调整继续留在工作区，发布包保持 a67ea54。

## B02 新实现记录

c706a2d：panthesia-music 与 panthesia-keyboard 由本次 Codex 按标准格式、音乐时间与琴键几何规格生成，未复制旧模块实现；为迁移已查看旧 API 与索引规则，并对三份内置 MIDI 做确定映射核对。消费者切换使用 Cargo package alias；别名保持不代表旧包仍被使用。桌面 --edges normal 依赖图已排除旧 MIDI/布局及 native-render 库。旧配置/FPS/资源模块退出默认编译；VST3 的旧状态位置使用独立窄适配。

新增标注 v2 和曲目包 v20，源 NoteId 与未映射原行进入持久化及归档。旧结构 SongSidecar、Player、标注校验与其他 core 模块仍存在，原创替换整体继续 P12/P20；本批不宣称整个工程已经完成来源清理。规格、作者/生成来源、消费者和检查边界见 [music-domain.md](music-domain.md)，证据见 evidence/music-domain-2026-11-20.json。

## B03 新实现记录

fb37bd7：features/screens 页面、图形分手与状态控制器由本次 Codex 根据当前产品规范和 Synthesia 官方指南实现；使用自有品牌、Lucide 图标和自绘 SVG/Canvas，不将官方参考图作为产品资源。新 SetPartHands 操作接入既有后台事务与稳定源身份。旧主检查栏退出活动产品 JSX；原 HandsDialog、旧工作区恢复及其他过渡模块尚有按需消费者，物理退役仍需 P11/P20 按引用收束。此批没有宣称旧应用实现整体退出。

## B03 下级交互实现记录

0784d41、b8660d2、472cdda：声部控制器、导航控制器、设备对象列表、独立标签呈现、双指分手、音色预听乐句和调性拼写按官方行为规格由本次 Codex 编写。使用官方截图作结构参考，自有品牌和当前许可图标；没有将官方图片作为产品素材。四个旧检查栏/音轨表单组件及 74 条失去消费者的样式选择器已删除，旧侧栏布局设置退出正常设置菜单。

这些改造继续复用现有设备、录音、试听调度、SongConfig、practice_edit 和偏好保存服务；它们的来源替换仍按 B04/P20 台账推进。页面拆分与删除旧组件不能证明 Neothesia 应用实现已经整体退出。保留的旧偏好读取和备份只承担用户配置兼容，未改写原始 MIDI。

## B03/P11 控制器与退役记录

6082c0f：本次 Codex 按现有产品规格拆分演奏、键盘、源绑定编辑会话和后台回执导航。此项主要整理既有实现并删除旧路径，来源分类为重构，不能作为这些模块全部从零原创的证明。删除 PracticeLibraryPanel、usePracticePanels、CurrentPracticeBar、PracticeReturnBar、WorkspaceNavigation 及孤立样式；原始标注和兼容资料保持。底层播放/音源和旧 core 的独立替换继续 B04/P20，许可及历史版权记录仍有效。

## B04 会话和渲染实现记录

db70b6a、f5a4e4c：PlaybackSession 的通用游标/等待/节拍接口由本次 Codex 按当前两种练习模式及时间边界编写；角色/MIDI 输出适配和音乐位置投影由现有实现重构接入，未据此宣称整个 Player 已从零原创。删除旧 Driver 的 pending_save::tick 包装与 Player 内重复的推进、游标、时钟和节拍状态；保留资料事务确认。原有音源 owner/CPAL/oxisynth/midir/VST3 和设备适配继续使用，来源及许可按 P20/P21 收束。

WaterfallSprites 的有界完整音符纹理、长音符分段回退和静态琴键标签缓存为本次性能改造；沿用现有自绘素材，不增加官方参考图片。当前产品依赖中的其他旧 core/Player 配置和历史功能仍需 P20 物理退役，不能以会话拆分替代整体来源结论。

## B05/P15 谱面封装记录

2331d0c、63cd930、c35484a、0fe4dc5：本次 Codex 按页面需求重构自有 worker 协议、页源缓存及租期封装，新增渲染输入准备、有界解码服务接口，并修正现有生成谱的变音记号。Verovio toolkit/WASM 继续使用既有第三方版本，未修改其实现；MEI 仍由它生成。此记录不代表第三方排版器或现有旧 core 已被原创替换。P20/P21 的物理退役与来源审计继续。
