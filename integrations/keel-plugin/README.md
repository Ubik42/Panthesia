# Panthesia 插件（Keel）

在 Keel 中浏览 MIDI 与乐谱文件时，显示与 Panthesia 歌曲详情相同的歌曲信息：时长、速度、调、音域，这首歌有哪些资料（演奏 MIDI、五线谱、ABC、谱页、原曲、人声、伴奏）和图层，以及钢琴卷帘缩略图。歌曲旁的 `.panthesia` 清单随乐曲文件一起移动。

## 提供的内容

- **缩略图**：`.mid`、`.midi`、`.kar`、`.musicxml`、`.mxl`、`.abc` 的钢琴卷帘图，颜色与 Panthesia 一致（右手绿、左手蓝）。
- **用 Panthesia 练习**：资产右键菜单“打开”分组中的条目，也是歌曲信息对话框的“开始练习”按钮。Panthesia 打开这首歌并直接进入演奏，使用上次的练习方式与左右手；Panthesia 已在运行时转交给原窗口。
- **歌曲信息**：在 Inspector 的“Panthesia”区块点“查看歌曲信息”，打开歌曲信息对话框：资料（每类资料的状态——当前、生成、已登记、找不到、同文件夹中发现——与文件名）、概览、图层与来源，用词与 Panthesia 歌曲详情相同。
- **元数据**：标题、时长、速度及来源、拍号、调及来源、小节、轨道、音符、音域、资料（如“MIDI · 五线谱 · 人声”）、图层、是否有清单。
- **可排序字段**：`bpm`、`musicalKey`（如“Eb 小调”）、`durationSeconds`、`songMaterials`。
- **伴生文件**：`.panthesia` 歌曲清单。浏览时隐藏，在主文件的“附件”中列出，并随主文件移动、改名、进回收站和恢复。

## 资料如何得到

Keel 不向插件提供文件位置。插件为每首歌在系统临时目录中重建一个小副本：歌曲本身、它的 `.panthesia` 清单（Keel 把同名清单挂在同名文件之一上，插件会在同名文件上查找）和文件夹清单 `song.panthesia`，以及与同文件夹其他文件同名的空占位文件；然后运行 `Panthesia.exe probe --detached`。这样 Panthesia 能按与歌曲详情相同的规则判断哪些音频、人声和谱面属于这首歌。清单中引用的、不在同一文件夹的文件显示为“已登记”。分析完立即删除副本；结果按歌曲、清单与文件夹内容缓存在插件数据目录中。

## 需要

- 本机安装了 Panthesia，并且至少启动过一次。Panthesia 启动时把自己的位置写入 Windows 的 App Paths（`HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\Panthesia.exe`），插件从那里找到它。也可以用环境变量 `PANTHESIA_EXE` 指定。
- 插件以**非受限模式**运行：需要启动 `Panthesia.exe probe`、`locate` 子进程，并启动 Panthesia 本身。它不访问网络，只读取 Keel 交给它的文件内容与文件名，不修改任何文件。

## 用 Panthesia 打开与生成资料

- **双击打开**：在 Keel 的设置 → 资产 → 打开方式中登记外部程序 `Panthesia.exe`，设为 `.mid`、`.musicxml`、`.mxl`、`.abc` 的双击默认程序。Panthesia 打开文件并显示歌曲详情。
- **直接练习**：Keel 不向插件提供文件位置。插件把库内相对路径与文件大小交给 `Panthesia.exe locate`，它在资源库文件夹和 Panthesia 设置中的曲目文件夹里找到大小相同的文件，再以 `Panthesia.exe --play <文件>` 启动。链接文件夹中的歌曲需要位于曲目文件夹内；找不到时插件提示原因。
- 缺少的资料（五线谱、ABC、转录、人声分离）在 Panthesia 的歌曲详情中生成，生成的文件写在歌曲旁边，Keel 会自动看到。

## 许可

GPL-3.0-or-later，与 Panthesia 相同。
