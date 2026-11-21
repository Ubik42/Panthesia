# 技术调研 2026-11

为分层歌曲模型、和弦级数、伴奏音轨、导入整理和音频转 MIDI 做的调研。结论已写入 [current-plan.md](current-plan.md)。

## 1. 参考：《情话》钢琴瀑布 V2（BV1x2xM6PEkq）

制作工具为 "Piano Falls by HOTHOT v1.0.2"（UP 主自制）。只读到 640×360 画面（高清需登录，CDN 下载返回 HTTP 567）。截图在 `work/research/chord-degree-reference/`。

画面上的信息层：

| 位置 | 内容 |
| --- | --- |
| 左上 | 拍号 `4/4`、速度 `♩=65.4` |
| 音符块 | 首调级数数字（`1`–`7`，变音加 `♯`/`♭` 前缀，如 `♭7`、`♯5`），颜色区分左右手 |
| 琴键 | 白键和黑键都标级数（黑键标 `♯x`/`♭y` 两种） |
| 横线 | 小节线贯穿瀑布；段落标记写在小节线上（如 `Chorus`） |
| 右侧边栏 | 每个和弦在起始小节线处显示两种写法：级数 + 和弦名，如 `6m11 Bm11`、`5m7 Am7`、`3⁷/♯5 F♯/A♯`、`1/3 D/F♯` |
| 左下 | 当前调 `D`，当前歌词一行（如"一生要多长才够等待"） |
| 右下 | 当前和弦大字：`1sus2 Dsus2`、`1add9 Dadd9` |
| 顶部 | 快捷键条：Degree、Labels、Markers、Analyze、Theme、Range、Zoom、Sustain、MIDI 输出、FX |

要点：级数用首调简谱写法（`4 5 3m 6m`），转位写成 `1/3`，扩展和弦（`m11`、`add9`、`sus2`）完整保留。歌词、段落、和弦、调性都是叠加在瀑布上的可选图层，可以分别开关。

## 2. 和弦与级数识别

Rust 生态没有可直接用的符号域和声分析库（`kord` 只解析和弦名，MIT）。自己实现：

1. 拍网格：从 tempo map 生成；转录 MIDI 没有可靠 tempo map 时先做节拍追踪。
2. 分段：按拍切，相邻同和弦合并。
3. 特征：每段 12 维音级分布，按时值和力度加权，最低音额外加权（决定转位）。
4. 匹配：三和弦、七和弦、sus、add、dim、aug、N（无和弦）模板。
5. 平滑：HMM / Viterbi，偏向保持当前和弦。
6. 调性：Krumhansl-Schmuckler 在 4–8 小节窗口上估计，Temperley 式转调惩罚平滑。
7. 级数：调内和弦直接给级数；次属和弦标 `V/x`；调外音和弦标借用；无法解释时显示原和弦名。

内部表示用 Harte 语法（root:quality/bass）。显示层提供两种写法：首调级数（`6m7`）与和弦名（`Bm7`）。

验证数据：本地 Hooktheory（16,383 段，带 harmony 与 keys 标注）和 POP909（909 首，`chord_midi.txt`、`key_audio.txt`、`beat_midi.txt`）。离线可用 music21 做对照，不进运行时。

## 3. 段落结构

可做粗粒度建议：按小节特征（音级分布、和弦序列、音符密度）建自相似矩阵，用 checkerboard novelty 找边界，聚类后按启发式命名（开头低密度为前奏，重复最多、密度最高为副歌）。结果标记为 AI 来源，供用户修改。参考：Eldeeb & Malandro 2025（arXiv 2509.16566，含 Lakh MIDI 人工边界）。

## 4. 伴奏音轨（人声 / 原曲）

- **找文件**：同目录或同名（`_人声.wav`、`vocals.wav`、`source/*.mp3`），再按时长（误差 < 2%）与 chroma 相关性确认。音频指纹（Chromaprint）对钢琴翻弹无效。
- **对齐**：MIDI 直接算 chroma，与音频 chroma 做 DTW（长曲用多分辨率 MrMsDTW，参考 synctoolbox）。输出 tick → 秒的分段线性映射，锚点 2–5 秒一个，检查单调性。
- **人声分离**：离线预处理。当前链路已用 BS-RoFormer-SW 六轨分离。
- **变速**：练习时改 BPM，音频需要保持音高变速。用 signalsmith-stretch（MIT，C++ 头文件库，Rust 绑定 `ssstretch`）。Rubber Band 为 GPL/商业双许可，可用但不必要。
- **时钟**：伴奏开启时以音频样本位置为主时钟，MIDI 调度经映射换算。

## 5. 导入整理：hibikiwtnb/piano-midi-cleanup

许可证 **AGPL-3.0**，只借鉴思路，不复制代码。Python 管线：分离 → ByteDance 转录 → BPM / 第一拍 → 规则清理 → 分手 → 重叠裁切。

值得借鉴：

- **PedalGuard**：裁切音符时，以"实际发声结束时间（含踏板）是否改变"作为判据，限制在 0.1 s 内。
- **分手**：50 ms 分组 + beam search（宽度 32）+ 代价函数（手掌跨度舒适 12、硬限 14 半音，左右手音域，移动距离，超 5 指惩罚）。比按音高切分稳定。第二演奏者按整小节启用。
- **工程纪律**：每条规则写明阈值、理由与未验证部分，保留失败记录。

应避免：阈值只在 8 首曲目上调过，绑定特定转录模型；固定速度假设；文档与代码阈值不一致；踏板平滑、量化均未实现。

更好的替代：节拍追踪用 Beat This!（ISMIR 2024）或 madmom；演奏 MIDI 到谱面可参考 partitura 与 Nakamura 的 HMM 方法；手别分离可参考 Nakamura merged-output HMM 与 "Cluster and Separate"（ISMIR 2024，GNN）。

## 6. 音频转 MIDI：Transkun

本地版本 **Transkun 2.0.1**，即 PyPI 最新版（2024-09-28，MIT）。2025–2026 年没有找到明确优于它的可用开源钢琴转录系统。

| 系统 | Note onset F1（MAESTRO） | 许可 |
| --- | --- | --- |
| Transkun V2 | 98.3 | MIT |
| Aria-AMT | 97.6 | 代码 Apache-2.0，权重未确认 |
| hFT-Transformer | 97.4 | 代码 MIT，权重单独许可 |
| ByteDance high-res | 96.7 | 未确认 |

- 转录链路在 `D:\Music\_tools\music-transcription`：BS-RoFormer-SW 六轨分离 → Transkun 2.0.1 → DuET → MusicXML。Panthesia 内没有转录代码。
- **待核对**：pip 包的默认模型是 V2 No Pedal Ext（不输出踏板）。本地 `transkun/pretrained/2.0.pt` 是哪一版需要做哈希比对；需要踏板时应使用带踏板的 V2 权重。
- **DuET** 不是音频转录，是 performance MIDI → MusicXML（`duet-score` 0.1.0，代码 MIT，权重 CC BY-NC 4.0）。`duet_runtime.rs` 让 DuET 借用 Transkun 的 venv，并硬编码 `D:\cs\...` 模型路径，应拆分并改为设置项。

## 7. 本地语料 `D:\Music\MIDI`

约 41,000 个文件、7.3 GB。没有统一的"每首一个文件夹"结构，按来源分为五区：

| 区 | 数据形态 | 用途 |
| --- | --- | --- |
| `B站纯钢琴演奏视频转MIDI` | 每首：`source.json`、原视频/音频、六轨分离（含 `vocals.wav`）、`piano_raw.mid`（演奏）、`score.mid` + `score.musicxml`（DuET）、逐帧拍点 `frames.csv`；部分有 `versions/` 原调/C 大调 × 自动对齐/乐谱量化 | 完整分层歌曲样本：演奏 + 谱面 + 伴奏 + 版本 |
| `KAIRCI ACG …` | 100 首：文件名含 BPM 与调（`yama - Oz - BPM76 - Gmajor.mid`），同名伴奏 `.wav` 与 `_人声.wav`，有 `人声匹配清单.csv` | 伴奏同步；文件名元数据解析；含 macOS `._*` 垃圾文件 |
| `周杰伦midi 126首` | 每首一个文件夹，多个来源各异的版本（如 `七里香 [12和弦].mid`、`ROCK版七里香.mid`） | 多版本归并；多轨 MIDI |
| `SNH48钢琴PDF谱` | PDF + Audiveris/MuseScore 识谱的 MIDI/MXL 初稿 | 纸谱与识谱质量边界 |
| `Datasets` | POP909（和弦/调/拍标注）、Hooktheory（和声 JSON）、MAESTRO（`.midi`，踏板）、GiantMIDI、Mutopia、Open_Pop_Style、`catalog.csv` | 和弦识别验证；性能与解析回归 |

没有 ABC 文件，没有歌词。代表性测试子集见 current-plan.md 第 3.6 节。
