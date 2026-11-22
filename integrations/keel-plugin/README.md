# Panthesia 插件（Keel）

在 Keel 中浏览 MIDI 与乐谱文件时，显示 Panthesia 读出的歌曲信息与钢琴卷帘缩略图；歌曲旁的 `.panthesia` 清单随乐曲文件一起移动。

## 提供的内容

- **缩略图**：`.mid`、`.midi`、`.kar`、`.musicxml`、`.mxl`、`.abc` 的钢琴卷帘图，按音轨着色。
- **歌曲信息**（Inspector 中的元数据）：标题、时长、BPM 及其来源、拍号、调及其来源、轨道数、音符数、音域、段落标记、是否有歌词。
- **可排序字段**：`bpm`、`musicalKey`（如“Eb 小调”）、`durationSeconds`。
- **伴生文件**：`.panthesia` 歌曲清单。浏览时隐藏，在主文件的“附件”中列出，并随主文件移动、改名、进回收站和恢复。

## 需要

- 本机安装了 Panthesia，并且至少启动过一次。Panthesia 启动时把自己的位置写入 Windows 的 App Paths（`HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\Panthesia.exe`），插件从那里找到它。也可以用环境变量 `PANTHESIA_EXE` 指定。
- 插件以**非受限模式**运行：需要启动 `Panthesia.exe probe` 子进程。它不访问网络，只读取 Keel 交给它的文件内容，在系统临时目录中写一个副本供 Panthesia 分析，分析完立即删除；结果缓存在插件数据目录中，按资产版本区分。

## 用 Panthesia 打开

Keel 不向插件提供文件位置，所以“用 Panthesia 练习”使用 Keel 自带的打开方式：设置 → 资产 → 打开方式，登记外部程序 `Panthesia.exe`，并把它设为 `.mid`、`.musicxml`、`.mxl`、`.panthesia` 等扩展名的双击默认程序。Panthesia 直接打开原文件，修改写在原文件旁的清单中。

## 解析只在一处

所有歌曲信息都来自 `Panthesia.exe probe <文件> --json --thumbnail <png> --size 480x160`。插件只做转接，不解析 MIDI 或乐谱。

## 许可

GPL-3.0-or-later，与 Panthesia 相同。
