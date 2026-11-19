import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import createModule from "../public/verovio/module.mjs";
import { VerovioToolkit } from "../public/verovio/toolkit.mjs";
import { createMidiValueIndex } from "../public/verovio/midi-value-index.mjs";
import { largeScore } from "./fixtures/large-score";
const directory = fileURLToPath(new URL(".", import.meta.url));
const moduleReady = createModule();
const options = { breaks: "auto", pageWidth: 2100, pageHeight: 2970, scale: 40, svgHtml5: true, svgViewBox: true, xmlIdChecksum: true, expandNever: true };
const note = (step: string, extra = "", head = "", duration = 4) => `<note>${head}<pitch><step>${step}</step>${extra}<octave>4</octave></pitch><duration>${duration}</duration></note>`;
const score = (body: string, attributes = "") => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${attributes}</attributes>${body}</measure></part></score-partwise>`;
function ids(toolkit: InstanceType<typeof VerovioToolkit>) {
  const result: string[] = [];
  for (let page = 1; page <= toolkit.getPageCount(); page++) {
    for (const tag of toolkit.renderToSVG(page).matchAll(/<g\b[^>]*\bclass="[^"]*\bnote\b[^"]*"[^>]*>/g)) {
      const id = tag[0].match(/\bid="([^"]+)"/)?.[1]; if (id) result.push(id);
    }
  }
  return result;
}
test("整谱索引逐音对照原生查询，保留反复、连线和复杂拼写", async () => {
  const fixtures = [
    ["基本音", score(note("C") + note("D") + note("E") + note("F"))],
    ["调号与临时记号", score(note("F", "<alter>1</alter>") + note("F", "<alter>0</alter>") + note("C", "<alter>-1</alter>"), "<key><fifths>2</fifths></key>")],
    ["和弦", score(note("C") + note("E", "", "<chord/>") + note("G", "", "<chord/>"))],
    ["复升降", score(note("C", "<alter>2</alter>") + note("B", "<alter>-2</alter>"))],
    ["三连音与速度", score('<direction><sound tempo="137"/></direction>' + note("C", "", "", 1) + note("D", "", "", 1) + note("E", "", "", 1), "<divisions>3</divisions>")],
    ["倚音与装饰", score('<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>' + '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><notations><ornaments><trill-mark/></ornaments></notations></note>')],
    ["移调与八度线", score('<direction><direction-type><octave-shift type="down" size="8" number="1"/></direction-type></direction>' + note("C") + note("D") + '<direction><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type></direction>', '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>')],
    ["弱起、双谱表、反复和延音", await readFile(join(directory, "../../panthesia-core/src/score_performance_test.musicxml"), "utf8")],
    ["压缩谱面", await readFile(join(directory, "fixtures/pickup-ties.mxl"))],
  ] as const;
  let cached = 0, fallback = 0;
  for (const [name, source] of fixtures) {
    const toolkit = new VerovioToolkit(await moduleReady);
    try {
      toolkit.setOptions(options);
      const loaded = typeof source === "string" ? toolkit.loadData(source) : toolkit.loadZipDataBuffer(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
      expect(Boolean(loaded), name).toBe(true); toolkit.renderToMIDI();
      const index = createMidiValueIndex(toolkit);
      for (const id of ids(toolkit)) {
        const native = toolkit.getMIDIValuesForElement(id);
        if (index.has(id)) { expect(index.get(id), `${name} / ${id}`).toEqual(native); cached++; }
        else fallback++;
      }
    } finally { toolkit.destroy(); }
  }
  expect(cached).toBeGreaterThan(10); expect(fallback).toBeGreaterThan(0);
});
test("22000 音符整谱保留全部页与映射，避免逐音全树查询", async ({}, info) => {
  test.setTimeout(30_000);
  const toolkit = new VerovioToolkit(await moduleReady);
  try {
    toolkit.setOptions(options); const start = Date.now(); toolkit.loadData(largeScore("整谱索引检查").toString()); toolkit.renderToMIDI();
    const index = createMidiValueIndex(toolkit); const rendererIds = ids(toolkit);
    expect(rendererIds).toHaveLength(22_000); expect(index.size).toBe(22_000);
    for (const id of [...rendererIds.filter((_, i) => i % 1000 === 0), rendererIds.at(-1)!]) expect(index.get(id)).toEqual(toolkit.getMIDIValuesForElement(id));
    const result = { version: toolkit.getVersion(), notes: rendererIds.length, indexed: index.size, pages: toolkit.getPageCount(), elapsedMilliseconds: Date.now() - start };
    const output = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "verovio-index-result.json"), JSON.stringify(result, null, 2));
  } finally { toolkit.destroy(); }
});
