# 歌曲、资产与练习数据规范

更新：2026-11-20。以下区分当前实现与 B01/B02 目标，避免投影模型被误认为已经统一存储。

## 当前真实状态

已有 MusicalWork、PerformanceEdition、PracticeEdition、NotationEdition 和 NotationGeneration。SongRepository 接管歌曲/演奏/来源位置/谱面目录，数据库在 data/library/songs.sqlite3；MIDI 在 data/library/assets/midi/<contentId>.mid，原字节 BLAKE3 身份保持不变。文件副本变化时另存 <contentId>-restored-N.mid，原字节保持原状；两个位置使用同一份内容标注。

普通文件演奏的标注文档为 data/library/annotations/<contentId>.json，版本 1，包含 contentId 和 annotations。轨道手别、逐音覆盖、指法、小节和采用谱面关联在同一文档中提交；文件名身份、文档身份和演奏身份必须一致。未来版本、错误身份和损坏文档拒绝覆盖，不回退旧附件重新覆盖新状态。

迁移先读取旧管理副本的 RON，再读取外部来源；原字节按哈希保存到 library/legacy-inputs。旧 preferences.songs[contentId].parts 原先最后生效，首次迁入时沿用该优先级，并保存 preferences-before-annotations.json。采用新文件演奏后不再写回 parts；自动/自己弹/静音及可见性仍是每次练习的会话配置。逐音、指法及旧保存日志经过原有文件事务发布，旧 Sidecar 日志仍指向旧 RON。

workspace 不再逐条追加为选曲结果，旧条目经一次性导入中心目录；部分元数据、位置修复和后台索引仍在过渡缓存。内置模板、生成练习和曲目包现已接入持有资产与 JSON 标注。SongProject 继续作为关系与练习变换的读取投影。

MusicXML/MXL 字节保存在 library/assets/notation/<BLAKE3>.musicxml|mxl；命名、版本与采用关系分别保存。已变化的占用文件原地保留，正确字节另存 restored-N。打开歌曲与启动恢复时在后台迁入配套谱面，原始外部文件保持原状。PDF/图片继续使用既有 score-attachments 内容目录与校验，当前没有强制搬到另一目录。

生成练习保存 library/assets/exercises/<practiceId>.mid，以稳定的练习身份关联 library/annotations/<practiceId>.json。practiceId 沿用既有规范，缓存字节由标准速度、双手和一次重复生成；该逻辑身份与 MIDI 原字节哈希分别校验。旧 song-assets 仅作为兼容读取来源，首次迁入时保存旧资料快照。

单演奏曲目包使用 panthesia-piece 第 19 版，包含原始 MIDI、MusicXML 版本、纸谱及标注、手别/指法和练习变换参数。导入恢复至持有目录；旧 neothesia-piece 第 1–18 版继续可读。此格式覆盖一份演奏。正常文件歌曲的“导出完整歌曲”使用外层 panthesia-song 第 1 版，将同一歌曲的全部演奏包、名称、分组锁和谱面版本关系一起保存；生成练习等独立内容继续使用单演奏包。外层最多 128 份演奏，容器 256 MB，全部内层资产展开合计 512 MB；超限或缺失资产会拒绝制作，避免得到不完整备份。

歌曲恢复在同一文件事务中准备全部演奏，活动演奏最后恢复。文件提交后，通过 library/pending-song-imports/<receiptHash>.json 回执将关系一次写入 SQLite；应用中断后可幂等重放，完成后清除回执。合并/保留优先沿用本地已有关系，使用包内容时恢复归档关系。谱面身份与校对状态随歌曲恢复，路径和版本位置重绑定到持有资产。演奏记录与设备设置继续由本机资料备份管理。

普通打开、启动恢复、历史打开与旧练习加载复用 load_pipeline::Prepared::retain_assets；生成练习复用 exercise_loading。旧 repertoire.json 变化时只补入新记录与未登记位置，中心库已有分组、标题和谱面决定保持有效。

Look at the Sky 已迁移至真实资料目录：当前五个文件对应四份内容，主演奏与原调自动对齐字节相同。四份演奏属于同一歌曲，四条旧身份可重联；另一份旧内容未命中并保留历史。量化版旧设置 0=Other、1=RightHand、2=LeftHand 已进入内容标注。原源文件与旧资料哈希未变，迁移前冷快照和逐文件回执保存在 work/original-product-reset。摘要见 evidence/annotation-migration-2026-11-20.json。

## 目标对象与归属

| 对象 | 主键与归属 | 内容 |
| --- | --- | --- |
| Song | 稳定 SongId | 一首作品/练习的列表对象，不使用标题作为身份 |
| Performance | PerformanceId + 原始字节 contentId | 一份采用的演奏，原始时序、力度、踏板和音轨 |
| Asset | 字节哈希 + 媒体类型 | 受管理的 MIDI/MusicXML/PDF/图片；实际持有文件 |
| SourceLocation | 独立位置 ID → Asset/Performance | 原路径、当前路径、存在状态、最近核对、来源；位置变化不改变内容身份 |
| TrackPartAssignment | Performance + TrackId | 左/右/背景/自定义；与自动/自己弹/静音分开 |
| NoteAnnotation | Performance + NoteId | 手别覆盖、指法；带旧 track/index 映射和源内容 ID |
| PracticeTransform | Performance + 规范化参数及算法版本哈希 | 转调、量化、调性与时值策略；按需生成缓存 |
| ScoreEdition | ScoreEditionId → Performance + Asset | MusicXML 或纸谱版本、采用状态、对齐信息 |
| Generation | 源身份 + 引擎/模型/参数版本 | DuET/其他任务的输入、完整输出、失败与采用回执 |
| Passage/Bookmark | Performance + 音乐位置/范围 | 以 tick/小节及版本记录，时间显示由 tempo map 派生 |

多份位置指向相同内容时去重。不同演奏归同一歌曲需要已有明确关系或用户确认；同名、原调/C调后缀和相似音符数不能单独成为自动合并凭据。

## 导入和文件移动

默认导入受管理副本：读取源文件一次 → 算哈希 → 写临时资产 → 核对并提交中心记录 → 建立来源位置。文件移动后，管理副本仍能播放；后台扫描更新来源。纯引用导入为明确的可选策略，缺失时按内容在已登记目录中自动关联，不能将错误文件猜作同一版本。

扫描和查询在后台执行。旧路径不以可播放歌曲重复灌入列表；可恢复的位置问题进入后台记录。设置页展示已登记的扫描根和可用状态，用户无需重新逐条添加已有目录。内容变化建立新资产身份并保留关联修订；不继承同路径另一首曲子的设置。

## 左右手与音符稳定性

原始轨道结构保存；用户手别覆盖属于演奏，外部文件移动不会改变归属。MIDI 格式没有普遍强制的“左手/右手”标准字段，已有轨名只作提示。音轨音高统计也只作初值。

B02 更换解析包装前明确旧 NoteId、TrackId 与新模型之间的映射。旧逐音编号无法唯一投影时记录未映射项，保留原记录，不静默按相邻音符套用。中央 C 不能替代实际左右手分配。

## 派生版本与谱面

原始演奏持久保存；C 调、其他转调和练习量化由参数生成。已有用户副本作为历史演奏版本导入，不批量删除。练习渲染与音频使用同一派生身份和音乐时间。量化规则明确单位、起点/时值及重叠处理，原始表现版本可直接返回。

MusicXML 是主要谱面交换格式；PDF/图片保留纸面来源，内部演奏模型保留发生顺序和重复经过。ABC 作为按需导出，不要求另存为主文件或参与每次练习。杜绝“有一张开头示意图”等同于完整谱面功能的完成声明。

DuET 后台任务绑定源演奏、实现/模型身份和参数，输出保存为初稿，用户采用后登记 ScoreEdition。取消、重启和旧结果不会覆盖当前采用版本。量化 MIDI 和 MusicXML 的时间一致性要在采用路径核对。

## 迁移完成条件

1. 迁移前有可恢复快照、计数及哈希，源 MIDI 与谱面保持原状。
2. 旧 contentId、每轨设置、逐音标注、谱面关联和段落都有映射或明确的未映射记录。
3. 新存储完成核对后切换单一写入口；旧格式仅通过导入兼容读取。
4. 目录/数据库/资产损坏不导致破坏性空库覆盖；日志保存具体原因，普通界面给出可理解的状态。
5. 迁移检查使用独立资料；对用户真实库先做只读调查，实际迁移按上述事务和快照机制执行。

## B01 收束状态

8b1d4ff：旧资料编辑、默认值恢复、外部来源导入与路径重联统一进入 owned_annotations；旧位置仅承接历史谱系，活动标注写入 library/annotations。Workspace 的 data_root 为不落盘的读取上下文，扫描别名时读取当前内容标注；目录结果在去重前再次应用该值。原生重定位使用后台 RelinkLibrary 事务及带内容身份的打开命令。

migrate-saved-library 工具先只读发现，再在独占锁与冷快照下逐内容提交；移动或改名文件须通过字节哈希，旧附件来源单独登记，生成练习依稳定规格身份恢复。真实迁移结果为 23 已迁入、15 未匹配、0 失败；未匹配记录及其设置保持原状。库中尚未采用的整个外部数据集无需预先复制。证据见 evidence/b01-closure-2026-11-20.json。旧解析器与音符身份的原创替换属于当前 B02。
