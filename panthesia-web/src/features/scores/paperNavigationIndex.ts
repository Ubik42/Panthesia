import type { LoadedSong, Note } from "../../api";
import type { PaperAttachment, PaperNoteAnchor } from "./paperTypes";

export const paperNoteKey = (note: Pick<Note, "track" | "index">) =>
  `${note.track}:${note.index}`;
export function paperNoteIndex(song: LoadedSong | null | undefined) {
  const ordered: { note: Note; measure: number }[] = [];
  const byMeasure = new Map<number, Note[]>();
  const byKey = new Map<string, { note: Note; measure: number }>();
  const duplicates = new Set<string>();
  if (song)
    for (const note of song.notes) {
      let low = 0,
        high = song.measures.length - 1,
        measure = 0;
      while (low <= high) {
        const middle = (low + high) >> 1,
          bar = song.measures[middle];
        if (note.tick < bar.startTick) high = middle - 1;
        else if (note.tick >= bar.endTick) low = middle + 1;
        else {
          measure = middle + 1;
          break;
        }
      }
      if (!measure) continue;
      const row = { note, measure },
        key = paperNoteKey(note);
      if (byKey.has(key)) duplicates.add(key);
      byKey.set(key, row);
      ordered.push(row);
      const group = byMeasure.get(measure) ?? [];
      group.push(note);
      byMeasure.set(measure, group);
    }
  const compare = (a: Note, b: Note) =>
    a.tick - b.tick || a.track - b.track || a.index - b.index;
  for (const group of byMeasure.values()) group.sort(compare);
  ordered.sort((a, b) => a.measure - b.measure || compare(a.note, b.note));
  const position = new Map(
    ordered.map((row, index) => [paperNoteKey(row.note), index]),
  );
  return { ordered, byMeasure, byKey, duplicates, position };
}
export function markedPaperNotes(
  index: ReturnType<typeof paperNoteIndex>,
  attachment: PaperAttachment,
  grid: string | undefined,
) {
  const marked = new Set<string>();
  for (const anchor of attachment.noteAnchors ?? []) {
    const key = paperNoteKey(anchor),
      target = index.byKey.get(key);
    const asset =
      attachment.format === "pdf"
        ? attachment.pages[0]
        : attachment.pages[anchor.page - 1];
    if (
      target &&
      !index.duplicates.has(key) &&
      target.note.pitch === anchor.pitch &&
      target.measure === anchor.measure &&
      anchor.grid === grid &&
      asset?.id === anchor.assetId &&
      asset.available
    )
      marked.add(key);
  }
  return marked;
}
export function nextUnmarkedPaperNote(
  index: ReturnType<typeof paperNoteIndex>,
  marked: Set<string>,
  selected?: Note,
) {
  const start = selected
    ? (index.position.get(paperNoteKey(selected)) ?? -1)
    : -1;
  for (let offset = 1; offset <= index.ordered.length; offset++) {
    const row = index.ordered[(start + offset) % index.ordered.length];
    const key = paperNoteKey(row.note);
    if (!marked.has(key) && !index.duplicates.has(key)) return row;
  }
  return undefined;
}
export function paperAnchorAt<T extends { measure: number }>(
  anchors: readonly T[],
  measure: number,
): T | undefined {
  let low = 0,
    high = anchors.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (anchors[middle].measure <= measure) low = middle + 1;
    else high = middle;
  }
  return anchors[low - 1];
}
export function paperAnchorIndex(
  anchors: readonly PaperNoteAnchor[] | undefined,
) {
  return new Map(
    (anchors ?? []).map((anchor) => [paperNoteKey(anchor), anchor]),
  );
}
