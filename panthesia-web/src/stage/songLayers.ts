import type { LoadedSong } from "../engine/sessionTypes";
import type { DisplayPreferences } from "../features/settings/displayPreferences";
import { stageInk } from "../features/practice/stageTheme";

type Chord = NonNullable<LoadedSong["harmony"]>["chords"][number];
type Syllable = { tick: number; text: string };
export type LyricLine = { tick: number; end: number; syllables: Syllable[] };

/** Karaoke lyrics mark a new line with `/` or `\` before a syllable, or a line break. */
export function lyricLines(lyrics: LoadedSong["importedLayers"]["lyrics"]): LyricLine[] {
  const lines: LyricLine[] = [];
  let current: Syllable[] = [];
  const close = () => {
    if (current.length) lines.push({ tick: current[0].tick, end: current[0].tick, syllables: current });
    current = [];
  };
  let broken = false;
  for (const item of lyrics) {
    if (broken || /^[/\\]/.test(item.text)) close();
    broken = /[\r\n]$/.test(item.text);
    const text = item.text.replace(/^[/\\]/, "").replace(/[\r\n]+/g, "");
    if (text) current.push({ tick: item.tick, text });
  }
  close();
  lines.forEach((line, i) => (line.end = lines[i + 1]?.tick ?? Infinity));
  return lines;
}

function at<T extends { tick: number }>(items: readonly T[], tick: number) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid].tick <= tick) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function chordText(chord: Chord, mode: DisplayPreferences["chordLabels"]) {
  if (!chord.harte) return "";
  return mode === "degree" ? chord.degree : mode === "name" ? chord.name : `${chord.degree}  ${chord.name}`;
}

/** Chord labels at their starting lines (right edge) and the current chord, large, above the keys. */
export function paintChords(
  ctx: CanvasRenderingContext2D,
  chords: readonly Chord[],
  mode: DisplayPreferences["chordLabels"],
  tick: number,
  span: number,
  pixels: number,
  baseline: number,
  width: number,
) {
  if (mode === "off" || !chords.length) return;
  ctx.save();
  ctx.textAlign = "right";
  ctx.font = "600 13px sans-serif";
  ctx.fillStyle = stageInk.chord;
  for (let i = Math.max(0, at(chords, tick)); i < chords.length && chords[i].tick < tick + span; i++) {
    const chord = chords[i];
    if (chord.tick < tick) continue;
    const text = chordText(chord, mode);
    const y = baseline - (chord.tick - tick) * pixels - 6;
    // The current chord is written large just above the keys; keep the small labels clear of it.
    if (text && y < baseline - 44) ctx.fillText(text, width - 10, y);
  }
  const current = chords[at(chords, tick)];
  const text = current && current.endTick > tick ? chordText(current, mode) : "";
  if (text) {
    ctx.font = "700 30px sans-serif";
    ctx.shadowColor = stageInk.shadow;
    ctx.shadowBlur = 6;
    ctx.fillStyle = stageInk.currentChord;
    ctx.fillText(text, width - 16, baseline - 18);
  }
  ctx.restore();
}

/** The current lyric line above the keys, sung syllables bright. */
export function paintLyrics(ctx: CanvasRenderingContext2D, lines: readonly LyricLine[], tick: number, baseline: number) {
  const line = lines[at(lines, tick)];
  if (!line || tick >= line.end) return;
  ctx.save();
  ctx.font = "500 22px sans-serif";
  ctx.textAlign = "left";
  ctx.shadowColor = stageInk.shadow;
  ctx.shadowBlur = 6;
  let x = 16;
  for (const syllable of line.syllables) {
    ctx.fillStyle = syllable.tick <= tick ? stageInk.lyricSung : stageInk.lyric;
    ctx.fillText(syllable.text, x, baseline - 20);
    x += ctx.measureText(syllable.text).width;
  }
  ctx.restore();
}

type Section = NonNullable<LoadedSong["sections"]>["items"][number];
/** Section names as tags at their starting lines, above the measure labels on the left. */
type Measure = LoadedSong["measures"][number];
/** How a measure is labelled on the stage: its number (inside its section when the song has
 * sections, counting from 1 at the section's first measure) and the section it starts, if any. */
export type MeasureLabel = { number: number; section: string | null; sectionName: string | null };
const labelCache = new WeakMap<readonly Measure[], { sections: readonly Section[] | null; labels: MeasureLabel[] }>();
export function measureLabels(measures: readonly Measure[], sections: readonly Section[] | null): MeasureLabel[] {
  const cached = labelCache.get(measures);
  if (cached && cached.sections === sections) return cached.labels;
  const labels: MeasureLabel[] = [];
  // A section belongs to the measure it starts in; a section starting in the second half of a
  // measure (a pickup) counts from the next one.
  const firstOf = (tick: number) => {
    const i = measures.findIndex((m) => m.endTick > tick);
    if (i < 0) return measures.length;
    const m = measures[i];
    return tick - m.startTick > (m.endTick - m.startTick) / 2 ? i + 1 : i;
  };
  const starts = (sections ?? []).map((s) => ({ index: firstOf(s.tick), label: s.label })).sort((x, y) => x.index - y.index);
  let next = 0;
  let current: { index: number; label: string } | null = null;
  measures.forEach((m, i) => {
    let begins: string | null = null;
    while (next < starts.length && starts[next].index <= i) {
      current = starts[next++];
      if (current.index === i) begins = current.label;
    }
    labels.push(
      current
        ? { number: i - current.index + 1, section: begins, sectionName: current.label }
        : { number: m.displayNumber ?? m.number, section: null, sectionName: null },
    );
  });
  labelCache.set(measures, { sections, labels });
  return labels;
}

/** "副歌 · 第 3 小节" for a song with sections, otherwise "第 12 小节". */
export function measureCaption(song: Pick<LoadedSong, "measures" | "sections">, measure: number) {
  const index = song.measures.findIndex((m) => m.number === measure);
  if (index < 0) return `第 ${measure} 小节`;
  const label = measureLabels(song.measures, song.sections?.items.length ? song.sections.items : null)[index];
  return label.sectionName ? `${label.sectionName} · 第 ${label.number} 小节` : `第 ${label.number} 小节`;
}

/** Measure numbers and section names at the right edge of the waterfall, on their bar lines.
 * The current section is shown in the readout above the timeline, so nothing is pinned here. */
export function paintMeasureLabels(
  ctx: CanvasRenderingContext2D,
  rows: readonly { y: number; label: MeasureLabel; prefix: string; meter: string | null }[],
  sections: boolean,
  generated: boolean,
  width: number,
) {
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const right = width - 10;
  for (const row of rows) {
    const text = `${row.prefix}${row.label.number}${row.meter ? `  ${row.meter}` : ""}`;
    ctx.font = "600 12px sans-serif";
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = stageInk.measureLabel;
    ctx.fillText(text, right, row.y);
    if (sections && row.label.section) pill(ctx, row.label.section, right - ctx.measureText(text).width - 8, row.y, generated);
  }
  ctx.restore();
}

function pill(ctx: CanvasRenderingContext2D, label: string, right: number, baselineY: number, generated: boolean) {
  ctx.font = "600 12px sans-serif";
  const width = ctx.measureText(label).width + 14;
  ctx.globalAlpha = generated ? 0.75 : 0.95;
  ctx.fillStyle = stageInk.sectionTag;
  ctx.beginPath();
  ctx.roundRect(right - width, baselineY - 13, width, 18, 9);
  ctx.fill();
  ctx.fillStyle = stageInk.sectionText;
  ctx.textAlign = "center";
  ctx.fillText(label, right - width / 2, baselineY);
  ctx.textAlign = "right";
}
