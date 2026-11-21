<p align="center"><img src="assets/panthesia-banner.svg" alt="Panthesia" width="900"></p>

# Panthesia

开源的 Windows 钢琴练习软件。交互参照 Synthesia：主页 → 选曲 → 歌曲设置 → 演奏。支持 MIDI 与 MusicXML，带五线谱显示、转调与量化版本、实时光效，以及 Windows MIDI、内置音源与 VST3（如 Pianoteq）输出。

开发中。目标与阶段见[开发计划](docs/development/current-plan.md)，最近进展见[进度记录](docs/development/progress.md)。

## 构建

需要 Rust、Node.js/npm、Windows WebView2。

```powershell
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd
```

正式包使用 `scripts/package-practice.ps1`。

## 许可

GPL-3.0。部分初始代码来自 [Neothesia](https://github.com/PolyMeilex/Neothesia)；来源与第三方许可见 [NOTICE](NOTICE.md)。
