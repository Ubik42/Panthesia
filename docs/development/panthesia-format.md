# `.panthesia` 歌曲清单格式（版本 1）

歌曲数据跟着文件走：清单放在乐曲文件旁边，用相对路径引用素材，自身保存图层与练习设置。规则来源见 [current-plan.md](current-plan.md) 3.1、3.7。机器校验用 [panthesia-format.schema.json](panthesia-format.schema.json)。

## 文件

- UTF-8 JSON，不带 BOM，最大 32 MB。
- 单个乐曲文件：主文件旁同名清单，`七里香.mid` → `七里香.panthesia`。
- 歌曲文件夹：根目录 `song.panthesia`。
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
| `role` | `performance`、`score`、`paper`（PDF / 图片谱）、`stem`、`source`（原音频 / 视频）、`annotation-source`（如 POP909 `chord_midi.txt`）；未知角色保留 |
| `path` | 相对清单所在目录，用 `/` 分隔，可用 `../`；不得为绝对路径或盘符 |
| `blake3`、`bytes` | 内容哈希（小写十六进制）与字节数，创建引用时记录 |
| `stem` | `role` 为 `stem` 时必需：`vocals`、`accompaniment`、`piano`、`drums`、`bass`、`other` 或其他名称 |
| `range` | 可选 `[起, 止]` 秒，引用长音视频中的一段 |
| `label` | 可选显示名 |

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
| `provenance` | `{ origin: "human" \| "imported" \| "generated", tool, toolVersion, paramsHash, createdAt }`；`createdAt` 为 Unix 毫秒 |
| `confidence` | 0–1，只用于 `generated` |
| `status` | `draft` 或 `accepted`，缺省 `accepted` |
| `dependsOn` | 依赖的图层名数组 |
| `unmatched` | 无法核对的条目，原样保留 |

人工结果（`human`）不被自动重算覆盖；`generated` 结果在工具版本变化时可重算。时间一律用所属演奏的 tick。

| 图层 | 内容 |
| --- | --- |
| `hands` | `tracks`：`{ "轨道序号": "left" \| "right" \| "other" }`；`notes`：`[{ "note": [t, o, p], "part": "left" }]` |
| `fingering` | `notes`：`[{ "note": [t, o, p], "finger": 1–5 }]`；`changes`：持音换指 `[{ "note": [t,o,p], "atTick": …, "from": 1–5, "to": 1–5 }]` |
| `playback` | 逐音演奏者：`notes`：`[{ "note": [t,o,p], "player": "auto" \| "human" }]` |
| `meter` | 拍号与弱起修正：`pickupTicks`、`segments`：`[{ "measure", "numerator", "denominator" }]` |
| `keys` | `items`：`[{ "tick", "key": "G:maj" }]` |
| `chords` | `items`：`[{ "tick", "endTick", "chord": "C:maj7/E" }]`（Harte 语法） |
| `sections` | `items`：`[{ "tick", "endTick", "label": "主歌" }]` |
| `beats` | `items`：`[{ "tick", "downbeat": true }]` |
| `lyrics` | `lines`：`[{ "tick", "endTick", "text" }]` |
| `tempo` | `items`：`[{ "tick", "bpm" }]`（如来自文件名的 BPM） |
| `passages` | 保存的练习段：`items`：`[{ "id", "name", "startTick", "endTick", "notes", "speed", "settings" }]` |
| `bookmarks` | `items`：`[{ "id", "name", "tick" }]` |

未知图层原样保留。

## 派生版本 `variants`

```json
{ "id": "c-major", "label": "C 大调", "performance": "main", "transpose": -7, "quantize": { "grid": "1/16" }, "tempoScale": 1.0 }
```

派生版本是对演奏与谱面的纯函数，可随时重算；只保存参数。

## 设置 `settings`

练习与显示的个人设置，按需出现：

| 键 | 说明 |
| --- | --- |
| `practice` | `mode`（`wait` / `listen`）、`speed`、`countIn`、`metronome`、`hands`、`latency` |
| `tracks` | `{ "轨道序号": { "visible", "player", "color", "name", "sound": { "program", "volume" } } }` |
| `lastPosition` | 上次停止的位置（tick） |

## 生成者

其他工具可以在导出时直接写清单（例如 `D:\Music\_tools\music-transcription` 导出 B 站曲目时）。要求：遵守本格式与 Schema，`provenance.origin` 写 `generated` 并填写 `tool`、`toolVersion`；不得覆盖已有清单中 `origin` 为 `human` 的图层。

## 导出与分享

`.neopiece` 只用于分享：把清单和它引用的文件打包，路径改写为包内路径。导入时解包到用户选择的文件夹并生成文件夹清单。
