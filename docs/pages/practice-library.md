# Public practice library

2026-11-18：新增五首原创入门练习的独立配对包，目录为 `panthesia-engine/assets/starter-pack`，最终运行包附“入门曲库”。每首包含原 MIDI、MusicXML 配对谱、许可、来源、文件摘要和校对说明。程序首次自动配谱，用户已有个人配谱保留。谱面是机器核对音高及起音的自动初稿；MIDI 的原松键时序单独保留。详见 [R2 清单](../development/r2-delivery.md)。

2026-11-16 规划更新：素材按“主仓脚本/清单及审定示例、独立精选曲库包、本地完整扩展库”安排。当前完整第三方数据集仍在仓库外，精选入门包列入 [当前计划 T01](../development/current-plan.md)。下表数量与许可描述保留既有来源记录，本轮未重扫素材或重新核验上游条款；发布素材前逐曲确认来源、许可、修改和校对状态。

Panthesia does not bundle third-party repertoire. The helper script
`scripts/sync-practice-library.ps1` builds a local, source-aware practice and
test library under `D:\Music\MIDI\Datasets` by default.

## Included sources

| Collection | Purpose | Local selection | License handling |
| --- | --- | --- | --- |
| MAESTRO v3.0.0 | Classical performance MIDI | Complete 1,276-file MIDI release | CC BY-NC-SA 4.0; downloaded locally and checksum verified |
| Mutopia Project | Classical teaching and public-domain repertoire | 521 piano-focused files from composer and technique collections in the current sync | Per-piece license retained in `catalog.csv` |
| Pop-K v1.0 | Modern pop-style melody examples | First 256 numbered excerpts by default | CC BY-NC 4.0; downloaded locally and checksum verified |
| GiantMIDI-Piano v1.2 | Automatic transcriptions of classical piano performances | Official Curated v1.2: 7,236 MIDI files, switched 2026-11-19 | Upstream states CC BY 4.0; disclaimer retained; unreviewed transcription category |

These sources are useful for private practice and development coverage, but
their terms are not identical. In particular, the MAESTRO and Pop-K datasets
have non-commercial restrictions. Do not redistribute the downloaded corpus as
part of a Panthesia binary or release.

## Run the sync

From PowerShell at the repository root:

```powershell
.\scripts\sync-practice-library.ps1
```

Use `-PopKCount` to change the bounded Pop-K subset, `-LibraryRoot` to select a
different local destination and `-Force` to re-download or re-expand existing
content. The script verifies official archive checksums before extraction.

The resulting `catalog.csv` records category, title, composer, license, source,
source URL and a library-relative path. Downloaded archives and MIDI files stay
outside Git. Mutopia links can disappear over time; an unavailable individual
piece is reported and skipped without invalidating the rest of the catalogue.

## Product integration status

The native Practice Library scans `catalog.csv` beside watched MIDI folders in
the same background indexing task. Catalogue title, composer, teaching
category, source and license are searchable and appear as read-only provenance
in the song list and information header. User-edited sidecar metadata remains
authoritative and is never overwritten by catalogue data.

Catalogue paths are treated as untrusted input: absolute paths and parent
traversal are rejected, both Windows and portable separators are accepted, and
one malformed row cannot prevent valid songs from loading. Run the real-corpus
inspection without opening the GPU interface with:

```powershell
cargo run -q -p panthesia-core --example library-inspect -- `
  "D:\Music\MIDI\Datasets" "Bach Mutopia"
```

## GiantMIDI-Piano Curated（2026-11-19）

当前采用官方 surname_checked_midis v1.2 发布包，共 7,236 首。筛选依据为视频标题包含作曲家姓氏；音符仍为自动转录，尚未人工逐音校对。
准备与导入入口：

```powershell
python .\scripts\prepare-giantmidi-release.py
.\scripts\import-giantmidi-library.ps1
```

默认曲库为 `D:\Music\MIDI\Datasets`。GiantMIDI 原始准备目录保持在 `D:\Music\MIDI\B站纯钢琴演奏视频转MIDI\GiantMIDI-Piano\source`。
Curated 压缩包保存在曲库 `_archives`；`Classical_Transcription_GiantMIDI\last-import.json` 保存逐文件校验值。
原完整包和未入选曲目的备份已从工作目录移除。需要预览导入时显式传入空的 `-MidiRoot`。
