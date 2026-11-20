# MIDI、音乐时间与音符身份

更新：2026-11-20。B02 实现提交 c706a2d；当前桌面目标已使用新领域模块。完整检查摘要见 [批次证据](evidence/music-domain-2026-11-20.json)。

## 实现与依赖

panthesia-music 按 SMF/MIDI 事件规范新写输入包装、通道状态、时间图和稳定音符身份；通用格式读取使用 midly 0.5.3。panthesia-keyboard 按 MIDI 音高与七白键几何关系新写范围和布局。现有消费者的 Rust 导入别名 midi_file/piano_layout 暂时保持，Cargo 实际指向新包。旧包仍在仓库供退役与一个内置素材兼容检查使用，桌面普通依赖图已排除它们。

新代码由本次 Codex 工作生成；已查看旧 API 和身份规则以建立确定迁移。实现来源、消费者切换和行为证据分别记录，不声称严格 clean-room。新包沿用当前项目 GPL-3.0-or-later 声明；总许可与其他素材审核继续按 P21。

## 源演奏与兼容视图

Performance 保存原始字节、原字节 BLAKE3、PPQ、tick 事件、原始物理轨号、NoteOn 身份、松键及踏板结束位置。同音按通道 FIFO 配对；跨轨 NoteOff 仍对应原 NoteOn 的物理轨道。音符松键与踏板实际延音结束分别记录。踏板、Reset Controllers、All Notes Off 和 All Sound Off 有独立语义；第 10 MIDI 通道为 GM 打击乐通道。

NoteId = 原物理轨号 + 该轨正力度 NoteOn 的出现序号；contentId 在文档或源演奏层提供作用域。变换只产生派生音高和时值，source 保持原始演奏。NoteMapping 连接当前视图索引和旧 release-order 索引；无法由旧读取器表示的尾部音符没有 legacy_index。该旧索引账本只负责映射，声音和时间由新源事件决定。

普通加载、原始 MIDI 导入、曲目包、生成练习、转调量化和播放载荷已接入。播放事件携带 source_note 和全局源顺序；逐音自动/自己弹/静音查询直接使用源身份，避免同音同刻的旧时间键冲突。Player、声音路由和屏幕消费者的进一步拆分归 B04/B07。

## 时间规则与当前输入边界

TempoTrack 用整数累计 tick × 每四分音符微秒，最后转为纳秒，避免每段截断累计误差。无速度时使用 120 BPM；同刻速度按物理轨/事件顺序确定最后有效值。MusicalTime 使用源 tick 与有理数小节长度；拍号变化可切开不完整小节。弱起、小节长度覆盖和显示编号独立处理；同刻冲突拍号明确拒绝。

当前接受按 PPQ 计时的 SMF 0/1 和单序列格式 2。SMPTE 时间码与多轨格式 2 返回明确错误；不会将独立序列混成同一演奏。输入最多 32 MB、4096 轨、200 万事件、100 万小节。准备阶段支持取消；通用解析器自身的单次 parse 不可中断，外层数量检查和后续扫描/小节生成有边界。

规格依据：[MIDI Association 的 SMF 说明](https://midi.org/standard-midi-files)、[midly Timing](https://docs.rs/midly/latest/midly/enum.Timing.html)、[midly Format](https://docs.rs/midly/latest/midly/enum.Format.html)、[MidiMessage](https://docs.rs/midly/latest/midly/enum.MidiMessage.html) 和 [General MIDI](https://midi.org/general-midi)。

## 标注文档与归档

library/annotations/<contentId>.json 第 2 版保存 annotations、noteIdentity 和 unmapped。noteIdentity 使用 smf-track-noteon-v1，只有被引用的音符进入映射；track/index 是当前视图位置，映射值是稳定源 NoteOn 序号。指法、逐音手别、逐音播放规则和换指动作均经映射恢复，换指的两个引用同时有效才应用。

旧 v1/外部 RON 按旧映射投影；旧读取器不存在的索引不会落到新恢复的音符上。无法对应的原行、已知源身份和原因进入 unmapped，后续编辑继续保存。迁移前原 JSON 按字节哈希存入 legacy-inputs；捕获事务同时提交快照和新文档。普通读为只读投影，后台采用或第一次编辑完成持久迁移。

单演奏曲目包第 20 版携带 noteArchive，包括稳定身份和未应用记录；旧 1–19 版在解码阶段按旧索引投影一次。导入、合并、恢复及再导出使用当前身份。外层整歌格式继续使用 panthesia-song 第 1 版。

## 检查边界与后续

仅使用内置素材与独立合成 MIDI：5 个音乐、1 个琴键、2 个标注检查通过。Debug 嵌入前端构建通过；独立桌面完成 v1 采用、旧手别/指法、新恢复音符编辑、转调量化、播放、即时等待切换、暂停定位、整歌导出和新资料目录恢复，两个窗口正常关闭。原合成 MIDI 字节一致，未知行在导出与恢复后仍完整。

观察到引擎输出音频信号，短片段中回调未超预算；本批没有完成听感、长时间性能、Windows MIDI 或 Pianoteq 验收。这些继续由 B04 完成。正式 Release 仍为 a67ea54；当前 Debug 对应 c706a2d 加原有目录调整。实际用户资料的 v2 迁移采用惰性后台路径，本批未将真实歌曲作为检查夹具。
