# 谱面语料与渲染基准

MusicXML 导入兼容性语料与 Verovio 渲染基准的固定记录。当前谱面链路：Score IR → MusicXML → Verovio，按页窗口渲染，用 Verovio 的元素 ID 与时间查询做高亮。

## MusicXML 兼容性语料

2026-11-18 新增固定语料位于 `panthesia-engine/assets/notation-corpus`：五份 MIT MusicXML Test Suite 特征样例、实际 MuseScore Studio 4.7.7 导出及 Audiveris 5.11.0 MXL 识别。连同五首原创配对谱，共 12 份进行一处指法修改、导出与重开。逐文件来源、工具版本和 SHA-256 已固定。运行 `scripts/inspect-notation-corpus.ps1` 可核对摘要并查看各谱显示/分析/播放/编辑/导出能力和诊断。下面 8 份 OSMD 语料保留其原有解析范围。

This matrix turns importer compatibility into reproducible evidence. Run:

```powershell
.\scripts\musicxml-compatibility.ps1
```

The runner downloads eight fixtures from OpenSheetMusicDisplay revision
`45ece8fa9f4ff1b51a6dfe29515e18530a64b1aa`, verifies fixed SHA-256 hashes and
stores them only in the system temporary directory. OSMD uses the BSD-3-Clause
license. No network request occurs when the verified cache already exists.

### Current corpus

| Fixture | Export shape | Measures | Events | Tuplets | Pedal | Expected diagnostic |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Bach BWV 846 Prelude | MuseScore 1.2 | 35 | 750 | 0 | 0 | none |
| Clementi Sonatina Allegro | older/unspecified | 76 part-measures | 389 | 0 | 0 | none |
| Clementi Sonatina Andante | MuseScore 1.2 | 52 part-measures | 341 | 267 | 0 | ornaments |
| Pedal function test | MuseScore 3.6.2 | 15 | 67 | 0 | 7 | none |
| Voice alignment | MuseScore 3.6.2 | 4 | 47 | 0 | 0 | none |
| Grace notes | MuseScore 2.3.1 | 4 | 40 | 0 | 0 | none |
| Brooke West sample | compressed MXL | 34 part-measures | 323 | 0 | 0 | invalid/missing mimetype |
| Broad function test | MuseScore 2.3.2 | 41 | 226 | 42 | 0 | ornaments |

Totals: 261 part-measures and 2,183 note/rest events.

### Findings that changed the importer

- Older exports use both `<rest/>` and `<rest></rest>`; both now import.
- Deferred empty elements such as `<pedal/>` must trigger the same diagnostic
  as explicit start/end tags.
- Tuplet event time is exact through `duration/divisions`; ratios and
  bracket/number spans are now preserved independently for display and coaching.
- Warning locations include part plus measure because two piano parts can reuse
  the same measure number.

### Admission rule

A fixture enters the permanent matrix only when:

- its source and redistribution terms are recorded;
- its upstream revision and SHA-256 are pinned;
- expected counts and diagnostics are explicit;
- a failure exits nonzero;
- it adds a distinct exporter, version or notation risk.

The next required additions are current MuseScore plus licensed Dorico and
Finale piano exports. Network-backed corpus checks supplement unit tests; they
do not replace the offline synthetic regression suite.

## Verovio 6.1.0 渲染基准（2026-08-04）

Cycle 089 measured Verovio outside the application before committing Panthesia
to a web view, JavaScript runtime or notation-engine dependency. The upstream
source is pinned at `version-6.1.0` / `682d60684450e780f0a1dcb7e394bda12eea4501`
under the local reference tree. The runnable test shell and generated artifacts
live under `D:\Music\_tools\_test\panthesia-verovio`.

Run the benchmark from the repository root:

```powershell
.\scripts\verovio-benchmark.ps1
```

The wrapper verifies the same eight pinned OSMD/MuseScore fixtures used by the
native importer audit, invokes the pinned NPM/WASM package, writes a JSON report
and retains every SVG page for visual inspection. It also emits one versioned
manifest per score and runs the native Rust validator over all eight manifests.
It does not add Verovio to the shipping application.

Each manifest binds its pages and note evidence to the exact input SHA-256 and
records schema version, renderer/version, source size, zero-based page table,
safe relative SVG paths and every renderer note's nominal time, pitch and
duration. Native validation rejects stale fingerprints, unsupported schemas,
missing/duplicate pages, unsafe paths, duplicate IDs and invalid note values.
Schema 2 additionally records SHA-256 for every SVG page. The native inspector
reads each page and verifies both byte length and content hash, so a replaced or
partially written page cannot pass merely because the top-level score matches.

### Results

Measured on the Windows development machine on 2026-08-04. These are warm
single-process development measurements, not release-device guarantees.

| Measure | Result |
| --- | ---: |
| Inputs loaded | 8 / 8 |
| Module initialization | 76.06 ms |
| Uncompressed ESM/WASM module | 6,983,039 bytes (6.66 MiB) |
| Median / maximum score load | 35.40 / 144.27 ms |
| Median / maximum full-score SVG render | 16.21 / 46.32 ms |
| Worst mean note time+attribute lookup | 0.180 ms |
| Total SVG for eleven pages | 2,511,338 bytes |

The largest fixture was Bach's BWV 846 prelude: 618 note identities across two
pages and 739,594 bytes of SVG. Its full-score render took 46.32 ms. The
compressed MXL fixture loaded and rendered normally.

### Visual and semantic inspection

- the Bach grand staff was readable, correctly grouped and consistently spaced;
- the Clementi fixture retained 78 tuplets, ten slurs, dynamics, ornaments and
  two-staff alignment;
- the compressed MXL path rendered staff notation and tablature, proving the
  archive-to-render path, although it is not a representative piano fixture;
- all sampled note identities resolved through `getTimeForElement` and
  `getElementAttr`, so a native player can address notation without deriving
  timing from SVG geometry;
- all 1,945 rendered note IDs returned nominal MIDI time, pitch and duration;
  six fixtures were unique by that semantic key, while the voice-alignment
  fixture had two two-way ambiguities and the MXL fixture had thirteen;
- all eight generated manifests passed the independent Rust validator against
  the pinned source hashes;
- the pedal fixture rendered seven pedal elements but emitted warnings for two
  time-spanning pedal pairs whose starts did not precede their ends. Pedal
  fidelity must remain diagnostic, not silently claimed as complete.

### Decision

The spike passes the threshold for a synchronized grand-staff proof of concept.
It does **not** justify coupling practice logic to Verovio or loading a complete
score as one live DOM tree.

The proof of concept should therefore:

1. keep the existing Rust score model and alignment identities authoritative;
2. render only the current page plus a small neighbour window;
3. use Verovio XML identities/time queries for highlights;
4. correlate only unique semantic note groups; never resolve unison voices by
   hidden source order;
5. isolate the engine behind a renderer adapter and feature flag;
6. surface import/render warnings, especially pedal and navigation issues;
7. measure cold startup, memory and highlight paint latency inside the actual
   native display boundary before adopting the dependency for production.

The 6.66 MiB module and up to 740 KiB of SVG per tested score are acceptable for
an opt-in prototype but require page virtualization and explicit packaging
measurement.
