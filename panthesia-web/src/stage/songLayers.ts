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
    if (text) ctx.fillText(text, width - 10, baseline - (chord.tick - tick) * pixels - 6);
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
