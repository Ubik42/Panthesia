<p align="center"><img src="assets/panthesia-banner.svg" alt="Panthesia" width="900"></p>

# Panthesia

Panthesia 是 Ubik42 独立维护的本地钢琴练习、乐谱与音乐工作台。项目把选曲、分段练习、看谱跟随、指法、演奏录音和音源连接成日常练琴工作流，并与音频分轨、演奏 MIDI 和自动制谱工具衔接。

当前处于持续开发阶段。实现、实际验证和外部设备依赖分别记录在[功能对照](docs/development/synthesia-feature-matrix.md)、[架构路线](docs/development/modernization-roadmap.md)与[开发交接](docs/development/modernization-handoff.md)。清单中仍有未完成事项。

## 工作流

```text
本地曲库 / MIDI / MusicXML
  → 声部、音源、手别与逐音播放设置
  → 连续播放或按键引导，分段循环、BPM、转调与量化
  → 瀑布、琴键和谱面跟随
  → 保存练习条件，按自己的安排继续练习
```

- 曲库提供文件夹树、多目录监视、搜索、收藏、队列、资料编辑和文件修复。
- 瀑布、琴键、MIDI 练习谱与关联原谱支持外观和网格调整。
- MusicXML/MXL、PDF 和图片谱面各自保留来源，原谱编辑衔接 MuseScore。
- 每个音符可以需要弹奏、自动伴奏或忽略，播放职责与手别独立。
- Windows MIDI、内置钢琴和 Pianoteq VST3 有独立设置与路由，具体兼容证据随交付版本记录。
- 演奏录音、练习条件、备份与曲目包保存在本地。旧历史和回放文件继续保留。

判定、评分、达标日课、表现目标和自动晋级保存在独立分支 `feature/assessment-lab`（`ca4aeb5`）。main 不提供评分开关，普通播放与循环不等待成绩保存。范围与资料兼容说明见[分支边界](docs/development/assessment-separation.md)。

外部音频转谱链使用 BS-RoFormer-SW、Transkun 和 DuET，交付演奏 MIDI、MusicXML 与谱面 MIDI。模型推理在离线工具中完成，日常练习与实时音频可以独立运行。

## 启动

`Open-Desktop.cmd` 准备并启动当前源码对应的中文桌面版。`Open-Web.cmd` 启动本地服务和浏览器界面。`scripts/package-practice.ps1` 按构建来源制作独立运行包。

从源码运行需要 Rust、Node.js/npm 和 Windows WebView2：

```powershell
git clone https://github.com/Ubik42/Panthesia.git
cd Panthesia/panthesia-web
npm ci
npm run desktop:build:dev
cd ..
.\Open-Desktop.cmd
```

## 结构

| 模块 | 职责 |
| --- | --- |
| `panthesia-core` | MIDI / 乐谱语义、练习领域、历史与资料模型 |
| `panthesia-engine` | 播放与练习调度、曲库、设备和后台应用服务 |
| `panthesia-web` | 中文工作区、瀑布、琴键与谱面界面 |
| `panthesia-web/src-tauri` | 桌面壳、文件入口、外部程序与发布 |
| `panthesia-vst3` | VST3 音源宿主 |

现有实现仍有需要继续解耦的部分，职责边界按路线图逐批整理。

## 资料与许可

Panthesia 使用自己的应用标识和发布名称。已有本地资料、曲目包、备份和草稿保留读取兼容。旧桌面资料目录存在时使用原目录锁继续访问；显式配置的资料位置继续生效。

项目保留 GPLv3 许可，见 [LICENSE](LICENSE)。来源代码、第三方资源与模型的归属见 [NOTICE](NOTICE.md)。曲目和音源分别使用其自身许可。
