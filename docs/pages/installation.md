# 启动与安装

Panthesia 以便携运行包发布：解压后从目录中打开 `Panthesia.exe`（或 `Open.cmd`），移动时保持目录完整。运行包内附《使用说明》、许可与第三方声明。当前软件仍在开发，各部分状态见[当前计划](../development/current-plan.md)。

## 从源码运行

工程目录 `D:\Music\_tools\Panthesia`。需要 Rust、Node.js/npm、Visual Studio C++ 生成工具（编译伴奏变速库）和 Windows WebView2。

```powershell
.\scripts\build-practice.ps1 -Target Desktop -Configuration Debug
.\Open-Desktop.cmd
```

`Open-Web.cmd` 用于本机浏览器开发调试。制作运行包：

```powershell
.\scripts\package-practice.ps1 -Destination <新目录> -Configuration Release
```

歌曲原件可以留在任何位置；歌曲数据写在文件旁的 `.panthesia` 清单中（[格式说明](../development/panthesia-format.md)）。
