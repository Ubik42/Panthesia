# Installation

## 当前个人分支

**当前成品：`outputs/releases/Panthesia-20261118-r2-1735cfc`。** 双击 `Panthesia.exe` 或 `Open.cmd`；保持整个目录。最终包、25 项文件与实际重启恢复通过，详见 [R2 完成清单](../development/r2-delivery.md)。

2026-11-18 R2 统一成品入口与来源见 [R2 完成清单](../development/r2-delivery.md)。移动运行包时保留整个目录，其中“入门曲库”可独立复制使用。以下保留此前交付版本。

此前本地视觉版为 `outputs/releases/Panthesia-20261116-visual-a852c07`，双击 `Panthesia.exe` 或 `Open.cmd` 启动，保留整个目录。内容与证据见 [视觉版交付](../development/visual-delivery.md)。以下保留 R1 基线说明。

2026-11-16：本地日常练习候选版位于仓库 `outputs/releases/Panthesia-20261116-1f5cf57`，双击 `Panthesia.exe` 或 `Open.cmd` 启动。源码为干净提交 `1f5cf57`，移动时保留整个运行包。交付证据与人工使用确认项见 [交付记录](../development/r1-delivery.md)，目标状态见 [当前计划](../development/current-plan.md)。

本地工程使用根目录 `Open-Desktop.cmd` 启动中文桌面练习室，或用 `Open-Web.cmd` 启动浏览器开发版。源码与构建环境见 [工程交接](../development/handoff.md)。

下方下载链接对应上游版本。此分支的 React＋Tauri 练习室及扩展功能由本地源码构建提供。

## How to download

### Windows, MacOS, Ubuntu

Download the latest release from the **Assets** section of the [release page](https://github.com/PolyMeilex/Neothesia/releases)

### Flatpak

<a href="https://flathub.org/apps/details/com.github.polymeilex.neothesia"><img width="240" alt="Download on Flathub" src="https://flathub.org/assets/badges/flathub-badge-en.png"/></a>

### Arch Linux

Arch Linux (**Unofficial AUR** built from source, maintained by @zayn7lie): <https://aur.archlinux.org/packages/neothesia>

## How to run

### On Mac

- Extract
- Right click + open

### On Windows/Linux

- Extract and double click

#### How to get working audio out

(on MacOS audio out is included out of the box)

- Download [default.sf2](https://github.com/PolyMeilex/Neothesia/blob/master/default.sf2)
- On Windows:
    - Place `default.sf2` in the same dir as executable (to make it a default one)
- On Linux:
    - Place `default.sf2` in the Panthesia configuration directory `~/.config/panthesia` (to make it a default one)
- Or select any sf2 file from the in-app menu
