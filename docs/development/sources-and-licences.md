# 来源与许可

Panthesia 以 GPL-3.0-or-later 发布。本页记录代码来源、第三方内容的许可，以及发布前必须处理的问题（2026-11-22 审计）。对外声明见仓库根目录 [NOTICE.md](../../NOTICE.md)。

## 代码来源

- 部分初始代码来自 [Neothesia](https://github.com/PolyMeilex/Neothesia)（GPL-3.0）。2026-11-20 的逐文件比对以上游 `bb3be49d` 为基线：全部 1126 个文本文件中，62 个与上游相同、19 个仅品牌替换、42 个同路径但修改。此后 R0–R2 删除了旧原生界面、旧渲染器、`midi-file`、`piano-layout` 与旧曲库；MIDI 读取、音乐时间与琴键几何由 `panthesia-music`、`panthesia-keyboard` 按规范重写。仍保留的来源声明见 NOTICE。
- 开发中查看过上游代码，本项目不宣称严格的 clean-room 实现。
- 虚拟双手的手部网格与关节比例来自 WebXR `generic-hand` 模型（[immersive-web/webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles)，Meta 贡献，W3C Software and Document License），文件未修改，见 `panthesia-web/public/models/generic-hand/NOTICE.md`。渲染用 [Three.js](https://threejs.org/)（MIT）。
- 虚拟双手参考了 [V9011N/pygame-piano-animator](https://github.com/V9011N/pygame-piano-animator) 的公开视频观感。该仓库没有许可证，Panthesia 没有复制或移植它的源码、参数表与权重（2026-11-21 用户决定）。

## 源码中直接包含的第三方代码

| 内容 | 许可 | 位置与运行包中的文本 |
| --- | --- | --- |
| Signalsmith Stretch 1.1.1 与其 dsp 库 | MIT | `panthesia-audio/vendor/signalsmith-stretch`；运行包 `ThirdParty/Signalsmith-Stretch/` |
| MIDIVisualizer 光晕与粒子公式（改编，提交 `1c942137`） | MIT | `third-party/MIDIVisualizer/LICENSE`；运行包 `ThirdParty/MIDIVisualizer/` |
| audio_thread_priority 0.35.1（未修改，随附源码包） | MPL-2.0 | `third-party/audio_thread_priority/`；运行包同名目录 |
| Verovio（WASM） | LGPL-3.0 | `panthesia-web/public/verovio/`；运行包 `ThirdParty/Verovio/` |
| PDF.js | Apache-2.0 | `panthesia-web/public/pdfjs/`；运行包 `ThirdParty/PDF.js/` |

## 依赖

- **Rust**：`cargo metadata` 统计桌面程序实际编入的 548 个 crate，许可全部与 GPL-3.0 兼容。以 MIT / Apache-2.0 为主，另有 MPL-2.0（Symphonia 等，未修改）、Unicode-3.0、Zlib、ISC、BSD、Unlicense、CC0，以及 LGPL-2.1（oxisynth 及其 chorus、reverb）。没有缺少许可声明或带非商用、AGPL 条款的依赖。
- **前端生产依赖**：React、react-dom（MIT），@tauri-apps/api（Apache-2.0 或 MIT），lucide-react（ISC），pdf-lib（MIT），pdfjs-dist（Apache-2.0）。

## 内置资源

- 入门练习（`panthesia-engine/assets/starter-pack`）：本项目自制，GPL-3.0，许可文本随目录。
- **内置音色库 `default.sf2`：发布阻塞。** 文件 INFO 块为“Grand Piano One”，Studio AX（www.studioax.com），2000-06-26，v1.33。找不到它的许可文本；2007 年 linux-audio-user 邮件列表中有用户称其为 35 美元的付费产品。确认可以再分发之前，它不能放进公开发布的运行包。处理方式需要用户决定：换成允许再分发的钢琴音色库（如 GeneralUser GS、FluidR3 GM），取得 Studio AX 的授权，或运行包不带音色库、首次启动时让用户选择 `.sf2`。

## 外部工具与模型

- DuET 模型为 CC BY-NC 4.0，不随运行包分发。
- Transkun、BS-RoFormer、DuET 由用户本机的 `music-transcription` 工具调用，Panthesia 只启动其进程、读取输出文件。

## 评分功能所在分支

评分、达标、日课、历史回放等功能在本地分支 `feature/assessment-lab`（保存点 ca4aeb5，未推送）。主线没有“开启评分”的设置；如果继续使用该分支，使用独立的 `PANTHESIA_DATA_ROOT`。
