<p align="center"><img src="assets/panthesia-banner.svg" alt="Panthesia" width="900"></p>

# Panthesia

开源的 Windows 钢琴练习软件：打开一首歌就能练。

- 打开 MIDI、MusicXML、ABC 或 `.panthesia` 文件，进入歌曲页，一键开始连续播放或等待按键练习。
- 歌曲页列出一首歌的全部资料（演奏、五线谱、ABC、谱页、原曲、人声、伴奏）与图层（手别、指法、和弦、段落、歌词），缺少的可以生成。
- 演奏舞台：WebGL 瀑布与光效、五线谱跟随、和弦级数与歌词、虚拟双手、伴奏与人声分轨同步变速。
- 输出到内置音源、Windows MIDI 或 VST3（如 Pianoteq）。
- 歌曲数据写在文件旁的 `.panthesia` 清单中，随文件移动。曲库由 [Keel](integrations/keel-plugin/) 管理。

开发中。使用说明见 [docs/pages/guide.md](docs/pages/guide.md)；目标与阶段见[开发计划](docs/development/current-plan.md)，最近进展见[进度记录](docs/development/progress.md)。

## 构建

需要 Rust、Node.js/npm、Windows WebView2。

```powershell
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd
```

正式包使用 `scripts/package-practice.ps1`。

## 许可

GPL-3.0。部分初始代码来自 [Neothesia](https://github.com/PolyMeilex/Neothesia)；来源与第三方许可见 [NOTICE](NOTICE.md)。
