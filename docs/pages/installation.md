# 启动与安装

当前本地 Windows 运行包：`outputs/releases/Panthesia-20261120-synthesia-layout`。从完整目录内打开 `Panthesia.exe` 或 `Open.cmd`；移动运行包时保持目录完整。该包源码为 a67ea54，后续源码改动不会自动更新旧包。

当前软件仍在开发；文件移动后自动关联、完整下级界面与原创替换的状态见[当前计划](../development/current-plan.md)。本页不将旧原生/上游版本作为 Panthesia 下载入口。

## 从源码运行

工程目录 `D:\Music\_tools\Panthesia`。需要 Rust、Node.js/npm 和 Windows WebView2。

```powershell
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd
```

`Open-Web.cmd` 用于本机浏览器开发调试。正式打包使用 `scripts/package-practice.ps1 -Destination <新目录> -Configuration Release`。

歌曲原件可以保持在用户音乐目录中；未来的数据迁移遵循[歌曲数据规范](../development/song-core.md)。不要把内部索引/sidecar 的手工编辑作为日常安装步骤。
