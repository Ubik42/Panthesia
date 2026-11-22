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
export function paintSections(
  ctx: CanvasRenderingContext2D,
  sections: readonly Section[],
  generated: boolean,
  tick: number,
  span: number,
  pixels: number,
  baseline: number,
) {
  if (!sections.length) return;
  ctx.save();
  ctx.font = "600 13px sans-serif";
  ctx.textAlign = "left";
  for (let i = Math.max(0, at(sections, tick)); i < sections.length && sections[i].tick < tick + span; i++) {
    const section = sections[i];
    const y = section.tick < tick ? 14 : baseline - (section.tick - tick) * pixels - 22;
    if (y < 14 && section.tick >= tick) continue;
    const width = ctx.measureText(section.label).width + 12;
    ctx.globalAlpha = generated ? 0.7 : 1;
    ctx.fillStyle = stageInk.sectionTag;
    ctx.beginPath();
    ctx.roundRect(6, y - 13, width, 18, 4);
    ctx.fill();
    ctx.fillStyle = stageInk.sectionText;
    ctx.fillText(section.label, 12, y + 1);
  }
  ctx.restore();
}
