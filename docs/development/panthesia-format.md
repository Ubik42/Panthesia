# `.panthesia` 歌曲清单格式（版本 1）

资料从哪里来、哪些算输入哪些算生成，见 [song-pipeline.md](song-pipeline.md)。

歌曲数据跟着文件走：清单放在乐曲文件旁边，用相对路径引用素材，自身保存图层与练习设置。规则来源见 [current-plan.md](current-plan.md) 3.1、3.6。机器校验用 [panthesia-format.schema.json](panthesia-format.schema.json)。

## 文件

- UTF-8 JSON，不带 BOM，最大 32 MB。
- 单个乐曲文件：主文件旁同名清单，`七里香.mid` → `七里香.panthesia`。
- 歌曲文件夹：根目录 `song.panthesia`。
- **标准布局**：一首歌一个文件夹，清单引用的文件全部与 `.panthesia` 放在同一层，以歌名命名：

  ```text
  爱爱爱 - 方大同/
    爱爱爱 - 方大同.panthesia        清单
    爱爱爱 - 方大同.mid              默认演奏
    爱爱爱 - 方大同（乐谱量化）.mid   其他版本：歌名（标签）
    爱爱爱 - 方大同.musicxml         谱面
    爱爱爱 - 方大同.mp4 / .mp3       原视频或原音频
    爱爱爱 - 方大同_钢琴.wav         分轨：歌名_人声 / _伴奏 / _钢琴 …
    爱爱爱 - 方大同.jpg              封面
    转录/                            转录工具的工程（不被清单引用）
  ```

  路径字段仍允许子目录和 `../`（兼容旧清单与数据集旁的单文件清单）。Panthesia 登记或生成文件时，文件不在清单那一层就按上面的名称放进来：同一磁盘建硬链接（不占额外空间，原处文件保留），否则复制。已经在这一层的文件保留原名。
- 写入一律原子替换（同目录临时文件 + 重命名）。只在用户第一次修改某首歌时创建；扫描、打开、分析不生成清单。

## 顶层

```json
{
  "format": "panthesia-song",
  "version": 1,
  "title": "Oz",
  "artist": "yama",
  "metadata": { "composer": "yama", "tags": ["ACG"] },
  "files": [
    { "id": "perf", "role": "performance", "path": "yama - Oz - BPM76 - Gmajor.mid", "blake3": "…64 位十六进制…", "bytes": 18234 },
    { "id": "acc", "role": "stem", "stem": "accompaniment", "path": "../#1 AUDIO/yama - Oz.wav", "blake3": "…", "bytes": 52428800 }
  ],
  "performances": [ { "id": "main", "file": "perf", "label": "原版", "noteIdentity": "smf-track-noteon-v1" } ],
  "scores": [],
  "default": { "performance": "main" },
  "layers": {
    "hands": { "performance": "main", "tracks": { "0": "right", "1": "left" }, "provenance": { "origin": "human" } }
  },
  "variants": [],
  "settings": {},
  "alignments": [],
  "extensions": {}
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `format` | 是 | 固定 `panthesia-song` |
| `version` | 是 | 整数。只在不兼容时递增；读取到更高版本时只读打开，不写回 |
| `title`、`artist` | 否 | 显示用；缺省取文件名 |
| `metadata` | 否 | `subtitle`、`composer`、`arranger`、`collection`、`copyright`、`license`、`difficulty`、`tags`（字符串数组）、`notes` |
| `files` | 是 | 素材引用，见下 |
| `performances` | 是 | 至少一项 |
| `scores` | 否 | 谱面（MusicXML 等）与对应演奏 |
| `default` | 是 | `performance`（必需）、`score`、`variant` |
| `layers` | 否 | 图层，键为图层名 |
| `variants` | 否 | 派生版本（转调、量化、速度） |
| `settings` | 否 | 练习与显示设置 |
| `alignments` | 否 | 谱面 ↔ 演奏、音频 ↔ 演奏的对应 |
| `extensions` | 否 | 其他工具的私有数据，原样保留 |

**兼容**：所有对象中的未知字段在读写时原样保留。新增文件角色、图层或设置项不改版本。

## 文件引用 `files[]`

| 字段 | 说明 |
| --- | --- |
| `id` | 清单内唯一，`[A-Za-z0-9_.-]{1,64}` |
| `role` | `performance`、`score`、`paper`（PDF / 图片谱）、`stem`、`source`（原音频 / 视频）、`annotation-source`（如 POP909 `chord_midi.txt`）、`cover`（歌曲图片，主界面与详情显示）；未知角色保留 |
| `path` | 相对清单所在目录，用 `/` 分隔，可用 `../`；不得为绝对路径或盘符 |
| `blake3`、`bytes` | 内容哈希（小写十六进制）与字节数，创建引用时记录 |
| `stem` | `role` 为 `stem` 时必需：`vocals`、`accompaniment`、`piano`、`drums`、`bass`、`other` 或其他名称 |
| `range` | 可选 `[起, 止]` 秒，引用长音视频中的一段 |
| `label` | 可选显示名 |
| `provenance` | 可选；由程序生成的文件为 `{ "origin": "generated", "tool", "step", "from", "createdAt" }`（`step`：separate / transcribe / engrave / export / frame / omr；`from`：来源文件 id）。没有 `provenance` 的文件是输入。AI 步骤的运行记录（含被判为空的分轨）写在 `extensions.panthesia.steps`，见 [song-pipeline.md](song-pipeline.md) |

**一致性**（打开时）：

1. 按路径找到文件且字节数、哈希一致 → 正常。
2. 路径存在但内容变了 → 演奏文件按下文"音符引用"逐条核对；其他文件提示已改变。
3. 路径不存在 → 在清单所在目录树内（向下，不越出该树）按字节数筛选后比对哈希；找到唯一匹配则更新路径并写回，否则标为缺失。缺失文件不阻塞演奏。

## 演奏与谱面

```json
"performances": [ { "id": "main", "file": "perf", "label": "原版", "noteIdentity": "smf-track-noteon-v1" } ],
"scores": [ { "id": "s1", "file": "xml", "performance": "main", "label": "原谱" } ]
```

`noteIdentity` 指明音符编号协议。`smf-track-noteon-v1`：音符 = （SMF 轨道序号，该轨内按起音时间排序的序号），与 `panthesia-music::NoteId` 一致。

## 音符引用

图层中引用单个音符写作 `[track, onset, pitch]`：轨道序号、起音序号、MIDI 音高。音高用于核对：演奏文件内容变化后，引用的音符若音高不符或已不存在，该条目移入图层的 `unmatched` 数组并提示用户，不删除。

## 图层 `layers`

每个图层是一个对象，共用字段：

| 字段 | 说明 |
| --- | --- |
| `performance` | 时基与音符所属的演奏 id；缺省为 `default.performance` |
| `provenance` | `{ origin: "human" \| "imported" \| "generated", tool, toolVersion, paramsHash, createdAt, review }`；`createdAt` 为 Unix 毫秒；`review` 只用于 `generated`：`"pending"` 表示尚未经 AI 或用户检查润色，检查后写检查者（如 `"ai"`） |
| `confidence` | 0–1，只用于 `generated` |
| `status` | `draft` 或 `accepted`，缺省 `accepted` |
| `dependsOn` | 依赖的图层名数组 |
| `unmatched` | 无法核对的条目，原样保留 |

人工结果（`human`）不被自动重算覆盖；`generated` 结果在工具版本变化时可重算。时间一律用所属演奏的 tick。

首次打开没有清单图层的 MIDI 时，Panthesia 自动生成分手（`hands`，只写没有轨道手别的音符）、指法（`fingering`）、段落（`sections`，文件自带标记时不生成）与和弦（`chords`，有 POP909 和弦文件时不生成），写为 `{ "origin": "generated", "tool": "panthesia-analysis", "toolVersion": "2", "review": "pending" }`、`status: "draft"`。已有的图层不动（`toolVersion` 较旧且仍未检查的草稿会用新分析重新生成）；用户编辑后该图层变为 `human`；演奏文件变化时，引用不到音符的草稿整层丢弃、重新生成（人工内容仍移入 `unmatched`）；给整条音轨指定手别时，替换该音轨的草稿逐音分手。同时，没有 `settings.variant` 且音符不在 1/16 网格上的 MIDI（演奏录制或转录；95% 以上起音已在网格上的编曲文件不需要）写入 1/16 量化（失败时 1/32）的练习版本；原始时值需要用户选择，选择后保存为 `quantize: 0`。由乐谱生成的歌曲不量化。

| 图层 | 内容 |
| --- | --- |
| `hands` | `tracks`：`{ "轨道序号": "left" \| "right" \| "other" }`；`notes`：`[{ "note": [t, o, p], "part": "left" }]` |
| `fingering` | `notes`：`[{ "note": [t, o, p], "finger": 1–5 }]`；`changes`：持音换指 `[{ "note": [t,o,p], "before": [t,o,p], "atTick": …, "from": 1–5, "to": 1–5, "hand": "left" \| "right", "rateMilli" }]`（`before` 为换指前一个音，`rateMilli` 缺省 1000） |
| `playback` | 逐音演奏者：`notes`：`[{ "note": [t,o,p], "player": "auto" \| "human" \| "mute" }]` |
| `meter` | 拍号与弱起修正：`pickupTicks`、`segments`：`[{ "measure", "numerator", "denominator", "displayStart" }]`、`measureLengths`：`[{ "measure", "ticks" }]`；旧式整体修正写在 `correction`：`{ "numerator", "denominator", "pickupTicks" }` |
| `keys` | `items`：`[{ "tick", "key": "G:maj" }]` |
| `chords` | `items`：`[{ "tick", "chord": "C:maj7/3" }]`，Harte 语法（`根音:性质/低音级`，无和弦为 `N`），按 `tick` 排序，每项持续到下一项。Panthesia 写入三种：编辑保存（`human`）、采用自动分析（`generated`，`status: "accepted"`）、打开乐谱时的和弦符号（`imported`，`tool: "score"`）。练习转调时按转调量移动显示 |
| `sections` | `items`：`[{ "tick", "label": "副歌" }]`，每项持续到下一项 |
| `beats` | `items`：`[{ "tick", "downbeat": true }]` |
| `lyrics` | `lines`：`[{ "tick", "endTick", "text" }]` |
| `tempo` | `items`：`[{ "tick", "bpm" }]`（如来自文件名的 BPM） |
| `passages` | 保存的练习段：`items`：`[{ "id", "name", "startTick", "endTick", "notes", "speed", "settings" }]` |
| `bookmarks` | `items`：`[{ "id", "name", "tick" }]` |

未知图层原样保留。

**多个演奏**：图层键 `名称` 属于默认演奏；其他演奏的同名图层用键 `名称:演奏id`，并写 `performance` 字段，例如 `"hands:v2": { "performance": "v2", … }`。

## 派生版本 `variants`

```json
{ "id": "c-major", "label": "C 大调", "performance": "main", "transpose": -7, "quantize": { "grid": "1/16" }, "tempoScale": 1.0 }
```

派生版本是对演奏与谱面的纯函数，可随时重算；只保存参数。

## 设置 `settings`

练习与显示的个人设置，按需出现：

| 键 | 说明 |
| --- | --- |
| `practice` | `mode`（`wait` / `listen`）、`countIn`、`metronome`、`hands`、`latency`、`rounds`、`tracks`（`[{ trackId, mode, visible }]`）、`parts` |
| `tracks` | `{ "轨道序号": { "name", "color", "handColors", "sound": { "volume", "pan", "program" } } }` |
| `variant` | 当前采用的转调、量化与速度参数 |
| `fingeringProfiles` | 各轨道的手型（指法计算用） |
| `performances` | 非默认演奏的设置：`{ "演奏id": { 同上各键 } }` |
| `lastPosition` | 上次停止的位置（tick） |

## 谱面配对与程序数据

- 配对的谱面写为 `files[]` 中 `role: "score"` 的引用和 `scores[]` 中编号为 `score` 的项，`default.score` 指向它；对齐分析快照写在该项的 `analysis` 字段。
- 格式尚未规定的 Panthesia 自身数据写在 `extensions.panthesia`；不认识的扩展内容在重写时原样保留。

## 写入时机（Panthesia）

- 文件在旧集中曲库之外时，手别、指法、逐音演奏者、小节、谱面配对、元数据、练习段、书签、轨道外观与音色、变调量化、手型保存即写入清单；第一次保存这些数据时创建同名清单。
- 只改练习设置（模式、预备拍、节拍器等）不会创建清单；已有清单时一并写入。
- 读写清单在同一进程内串行，避免两处保存互相覆盖。

## 从文件读取的图层（不写入清单）

打开歌曲时从乐曲文件本身读取，随时可以重新得到，因此不写入清单（显示时作为 `imported` 来源）：

- MIDI：歌词（Lyric 事件；没有时读取卡拉 OK 的 Text 事件，`/`、`\` 与换行表示换行）、段落（Marker 与 Cue Point）、调号变化。元信息文本按文件统一识别编码：合法 UTF-8 时按 UTF-8，否则用 chardetng 判断（常见 GBK、Shift-JIS）。
- MusicXML / ABC：打开乐谱生成演奏时，歌词与和弦符号按反复展开到演奏 tick（反复的第 n 遍唱编号为 n 的歌词段，没有时唱第一段；停顿半音符以上或满 20 个音节换行）。歌词写成生成 MIDI 中单独一轨的 Lyric 事件；和弦符号写入该歌曲清单的 `chords` 图层（`imported`，`tool: "score"`）。
- 数据集标注：MIDI 旁的 POP909 `chord_midi.txt`（秒，按该 MIDI 的速度换算 tick）作为导入的和弦。

**舞台上的和声与结构图层的来源顺序**：和弦为清单 `chords` 图层 → POP909 标注 → 自动分析（平均同时发声不足 1.3 个音的单旋律不分析）；段落为清单 `sections` 图层 → MIDI 标记 → 自动分析（只给 前奏 / 尾奏 与按相似归组的 段落 A、B …）。和弦的名称与级数按音符标签使用的同一条调性时间线拼写。文件开头只有一个 C 大调调号、而音符明显属于其他调时，该调号视为音序器默认值，不作为歌曲的调。

## 伴奏音轨（Panthesia 的读取方式）

清单中 `role` 为 `stem` 的文件是伴奏音轨（WAV、FLAC、MP3、Ogg Vorbis，单个最长 30 分钟，采样率须一致）。打开歌曲时在后台解码，按输出设备采样率重采样，并与演奏对齐一次：取 `piano` 或 `accompaniment` 音轨，与演奏比较起音，得到偏移、速率与分段锚点（平均每 5 秒一个）；其余音轨（如人声）视为同一录音切出，沿用这个对齐。对齐结果暂不写入清单，每次打开重新计算（Release 构建约 1 秒以内）。播放时：`piano` 默认关闭（与乐器重复），人声与伴奏默认开启，在演奏界面顶栏“音轨”面板中开关与调音量；只在聆听与跟弹模式中随演奏发声，变速时保持音高。分离结果中近乎静音的音轨不登记（见 [song-pipeline.md](song-pipeline.md)）。

MIDI 中没有任何速度事件时，按清单 `tempo` 图层或文件名中的 BPM（如 `BPM76`）作为速度；内容身份仍按原始字节计算。

## 歌曲包识别

歌曲页的资料卡片列出按文件名规则找到的相关文件（状态“发现”），用户选择“登记”后才写入清单：

- 同名音频为原音频；`<名>_人声`、`vocals.*` 为人声，`<名>_伴奏`、`accompaniment.*` 为伴奏；导出目录中的 `piano.wav` 为钢琴音轨。
- 同名或导出的 `score.musicxml` / `.mxl` / `.abc` 为谱面（选择"配对"走谱面配对）；同名 PDF 为谱页。
- `versions/` 中与基础名同前缀的 MIDI、文件名含 `_原调_`/`_C大调_` 的 MIDI、导出目录中的 `score.mid` 与 `piano_raw.mid` 为同一首歌的版本；`… MIDI` 与 `… AUDIO` 并列时在音频文件夹中找同名音频与人声；`source/`（本级至上两级）中的录音为原音频。
- POP909 的 `chord_*.txt`、`key_audio.txt`、`beat_*.txt` 登记为 `annotation-source`。
- 不按标题合并不同的编配或演奏（例如同一文件夹中的多个"七里香"）。

## 生成者

其他工具可以在导出时直接写清单（例如 `D:\Music\_tools\music-transcription` 导出 B 站曲目时）。要求：遵守本格式与 Schema，`provenance.origin` 写 `generated` 并填写 `tool`、`toolVersion`；不得覆盖已有清单中 `origin` 为 `human` 的图层。

## 导出与分享

`.neopiece` 只用于分享：把清单和它引用的文件打包，路径改写为包内路径。导入时解包到用户选择的文件夹并生成文件夹清单。

## 命令行 `probe`（供 Keel 插件）

```powershell
Panthesia.exe probe <文件> [--json] [--detached] [--thumbnail <png 路径>] [--size 480x160]
```

不打开窗口、不读写资料目录、不经过单实例转交。接受 MIDI、MusicXML、ABC、`.panthesia`（分析默认演奏）。标准输出为一行 UTF-8 JSON，与歌曲页使用的歌曲汇总（引擎 `song_summary`）相同；失败时输出 `{"error": "…"}`，退出码 1。`--detached` 表示文件是副本（Keel 插件把歌曲、清单与同文件夹的空占位文件放在临时目录中），此时清单引用的文件不在磁盘上查找，状态记为 `registered`。

| 字段 | 说明 |
| --- | --- |
| `kind` | `midi` / `musicxml` / `abc` / `manifest` |
| `performancePath` | 实际分析的演奏文件 |
| `facts` | `title`、`artist`（清单中的值，没有时标题取文件名）；`durationSeconds`；`bpm`、`bpmSource`（主拍速，来源 `manifest`、`midi`、`filename`）；`tempoChanges`；`timeSignature`（第一小节）；`key`、`keySource`（`G:maj` 形式，来源依次为 `manifest`、`midi`、`filename`、`estimated`）；`measures`；`tracks`、`notes`、`pitchRange` |
| `materials` | 按固定顺序的资料：`performance`、`musicxml`、`abc`、`paper`、`source`、`vocals`、`accompaniment`，以及有内容时的 `stems`（其他分轨）。每项 `{ kind, label, items }`；`items` 中每个文件 `{ id, path, relative, label, state, origin }`，`state` 为 `current`（正在打开的演奏）、`present`、`missing`、`found`（按命名规则发现、尚未登记）或 `registered`（`--detached` 时） |
| `layers` | `hands`、`fingering`、`chords`、`keys`、`sections`、`lyrics`、`tempo`（有内容时还有 `beats`）：`{ name, label, origin, count }`；`origin` 为清单中的来源，或文件本身带有时为 `imported`，没有时为 `null` |
| `manifest` | `{ path, readOnly }`；没有清单时为 `null` |
| `thumbnail` | 写出的钢琴卷帘 PNG（横轴时间、纵轴音高；颜色与歌曲页一致：右手绿、左手蓝、未分手为强调色） |

## 生成的资料

歌曲页可以生成缺少的资料（引擎 `song_generate`），文件写在演奏文件旁边，同名已存在时加序号，不覆盖任何文件：

- `<名>.musicxml`：由演奏生成五线谱（ABC 歌曲直接转换）；`<名>.abc`：由演奏或五线谱生成 ABC；`<名>.mid`：由乐谱导出演奏。登记为 `score` 或 `performance`。
- 转录与分离调用外部工具 `music-transcription`（位置在设置中指定，或环境变量 `PANTHESIA_TRANSCRIPTION_TOOL`）。工作目录为歌曲文件夹中的 `转录/`（歌曲所在文件夹本身已是该工具的旧式项目时用它）；结果按标准布局以硬链接放到清单旁。结果中的 `vocals.wav` 登记为人声，`piano.wav` 为钢琴分轨，`piano_raw.mid` 为转录版本；`bass`、`drums`、`guitar`、`other` 四条分轨相加写成 `accompaniment.wav`，登记为伴奏。

生成的文件在 `files[]` 中带 `provenance`：`{ "origin": "generated", "tool": "panthesia" | "music-transcription", "createdAt": 毫秒 }`。
