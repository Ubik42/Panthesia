# 固定乐谱语料

`manifest.json` 是逐文件来源、许可、版本和 SHA-256 清单。

- 五份带风险特征的 MusicXML 来自 W3C Music Notation Community Group 的 MusicXML Test Suite，固定提交 `0618bdee1bfcb965ffdd9f4e52271c909d744fd1`。这些文件适用本目录的 MIT `LICENSE`。
- `musescore-4.7.7-five-finger.musicxml` 是用 MuseScore Studio 4.7.7 对项目原创五指练习实际导出的谱面。
- `audiveris-5.11.0-five-finger.mxl` 是用 Audiveris 5.11.0 对上述练习的 MuseScore PDF 实际识别的结果。
- 两个原创练习派生文件随项目使用 GPL-3.0-or-later，见仓库根目录 `LICENSE`。工具程序没有放入源码或成品包。

自动识谱样例用于记录能力和误差；它不表示任意纸谱均可正确识别。运行 `scripts/inspect-notation-corpus.ps1` 可检查文件摘要并输出逐谱能力报告。
