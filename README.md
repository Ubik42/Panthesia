<p align="center"><img src="assets/panthesia-banner.svg" alt="Panthesia" width="900"></p>

# Panthesia

Panthesia 是 Ubik42 独立维护的 Windows 钢琴练习软件。当前按“原创应用实现、Synthesia 界面与交互复刻、扩展能力后台化”推进。Neothesia 来源实现仍在逐模块替换；现阶段来源和许可见 [NOTICE](NOTICE.md) 与 [LICENSE](LICENSE)。

## 当前版本

本地可运行版本：`outputs/releases/Panthesia-20261120-synthesia-layout/Panthesia.exe`，源码 a67ea54。已有选曲、歌曲设置、演奏三张主屏的布局改造；完整下级交互、歌曲移动后的自动关联、统一标注存储和原创替换仍在开发。

现有能力包括 MIDI 播放/按键等待、BPM、循环、声部、Windows MIDI/内置音源/Pianoteq 适配、MusicXML/纸谱、DuET 后台制谱、转调量化、皮肤与特效。实现存在与实际交付状态分别记录，不将该列表视为全部功能验收通过。

## 开发入口

- [工程文档](docs/development/README.md)：当前计划、来源调查、架构、交互和数据规范。
- [当前计划](docs/development/current-plan.md)：B00–B07 的唯一任务队列。
- [Goal 提示词](docs/development/current-goal.md)：长期执行和两小时方向检查。
- [最新交接](docs/development/modernization-handoff.md)：可运行包、证据和剩余缺口。

`Open-Desktop.cmd` 启动当前桌面源码；`Open-Web.cmd` 提供开发调试入口。默认 Cargo 目标已切换到当前 Tauri 桌面；建议使用统一脚本准备前端与构建身份：

```powershell
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd
```

需要 Rust、Node.js/npm 和 Windows WebView2。正式包使用 `scripts/package-practice.ps1`，移动时保留完整目录。当前不宣称已交付 Linux/macOS 原生版本。

评分、达标、表现目标和自动晋级位于独立分支 `feature/assessment-lab`；主线普通练习不启用评分。既有用户文件与历史数据通过迁移/导入保护。旧原生入口与打包流程按退役清单退出，详见[原创替换清单](docs/development/source-independence.md)。
