import type { LoadedSong } from "../../api";
import type { HandProposal } from "../../engine/commands.generated";
import type { HandDraft, HandChoice } from "./handEditorStore";
export const sameHandNote = (
  left: { pitch: number; start: number } | undefined,
  right: { pitch: number; start: number },
) => !!left && left.pitch === right.pitch && left.start === right.start;
export function handMeasureAt(song: LoadedSong, start: number) {
  let low = 0,
    high = song.measures.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (song.measures[middle].start <= start) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}
export function rebaseHandDraft(
  song: LoadedSong,
  draft: HandDraft,
  source: string,
): HandDraft {
  const indices = new Set([
    ...draft.accepted,
    ...draft.touched,
    ...Object.keys(draft.values).map(Number),
  ]);
  const notes = new Map(
    song.notes
      .filter((note) => note.track === draft.track && indices.has(note.index))
      .map((note) => [note.index, note]),
  );
  if (
    [...indices].some(
      (index) =>
        !sameHandNote(
          draft.anchors[index],
          notes.get(index) ?? { pitch: -1, start: -1 },
        ),
    )
  )
    throw new Error("原音符位置已改变，请复制输入后重新选择这份选段。");
  const measures = [...notes.values()].map((note) =>
    handMeasureAt(song, note.start),
  );
  const retainedFirst = Math.max(
    1,
    Math.min(song.measures.length, draft.first),
  );
  const retainedLast = Math.max(
    retainedFirst,
    Math.min(song.measures.length, draft.last),
  );
  const first = measures.length
    ? Math.min(retainedFirst, ...measures)
    : retainedFirst;
  const last = measures.length
    ? Math.max(retainedLast, ...measures)
    : retainedLast;
  return { ...draft, first, last, source, generation: null, page: 0 };
}
export function mergeHandSuggestions(
  draft: HandDraft,
  proposals: HandProposal[],
  generation: string,
  source: string,
): HandDraft {
  const oldTouched = new Set(draft.touched),
    oldChosen = new Set(draft.accepted),
    touched = new Set<number>(),
    accepted = new Set<number>(),
    values: Record<number, HandChoice> = {};
  // Reserve every explicit choice before filling the remaining automatic slots.
  for (const row of proposals) {
    if (
      !sameHandNote(draft.anchors[row.index], row) ||
      !oldTouched.has(row.index)
    )
      continue;
    touched.add(row.index);
    if (draft.values[row.index]) values[row.index] = draft.values[row.index];
    if (oldChosen.has(row.index)) accepted.add(row.index);
  }
  for (const row of proposals) {
    if (accepted.size >= 4096) break;
    if (
      !touched.has(row.index) &&
      row.part !== "Other" &&
      row.part !== row.saved &&
      row.confidence >= 80
    ) {
      accepted.add(row.index);
      values[row.index] = row.part;
    }
  }
  const anchors = Object.fromEntries(
    proposals
      .filter(
        (row) =>
          accepted.has(row.index) ||
          touched.has(row.index) ||
          values[row.index],
      )
      .map((row) => [row.index, { pitch: row.pitch, start: row.start }]),
  );
  return {
    ...draft,
    values,
    accepted: [...accepted],
    touched: [...touched],
    anchors,
    generation,
    source,
    page: 0,
  };
}
