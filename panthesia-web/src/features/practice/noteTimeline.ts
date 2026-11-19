import type { LoadedSong } from "../../engine/sessionTypes";

type Note = LoadedSong["notes"][number];
type FingerAction = NonNullable<LoadedSong["fingerActions"]>[number];

/** First position strictly after a value in an ordered musical sequence. */
export function after<T>(
  items: readonly T[],
  value: number,
  coordinate: (item: T) => number,
) {
  let low = 0,
    high = items.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (coordinate(items[middle]) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A static interval tree includes long sustained notes that start far before the viewport. */
export class NoteTimeline {
  private readonly notes: readonly Note[];
  private readonly maximumEnd: Float64Array;

  constructor(notes: readonly Note[]) {
    this.notes = [...notes].sort(
      (a, b) => a.tick - b.tick || a.pitch - b.pitch,
    );
    this.maximumEnd = new Float64Array(Math.max(1, notes.length * 4));
    if (notes.length) this.build(1, 0, notes.length);
  }

  private build(node: number, low: number, high: number): number {
    if (high - low === 1)
      return (this.maximumEnd[node] = this.notes[low].endTick);
    const middle = low + Math.floor((high - low) / 2);
    return (this.maximumEnd[node] = Math.max(
      this.build(node * 2, low, middle),
      this.build(node * 2 + 1, middle, high),
    ));
  }

  visit(from: number, to: number, render: (note: Note) => void) {
    if (!this.notes.length || to < from) return;
    const walk = (node: number, low: number, high: number) => {
      if (this.maximumEnd[node] < from || this.notes[low].tick > to) return;
      if (high - low === 1) {
        render(this.notes[low]);
        return;
      }
      const middle = low + Math.floor((high - low) / 2);
      walk(node * 2, low, middle);
      walk(node * 2 + 1, middle, high);
    };
    walk(1, 0, this.notes.length);
  }
}

/** Held-finger actions are ordered once per annotation update, rather than per note and frame. */
export class FingerActionTimeline {
  private readonly byNote = new Map<string, FingerAction[]>();

  constructor(actions: readonly FingerAction[]) {
    for (const action of actions) {
      if (!action.valid) continue;
      const key = `${action.track}:${action.index}`;
      const rows = this.byNote.get(key);
      if (rows) rows.push(action);
      else this.byNote.set(key, [action]);
    }
    for (const rows of this.byNote.values()) rows.sort((a, b) => a.at - b.at);
  }

  current(
    note: Note,
    position: number,
    speed: number,
  ): FingerAction | undefined {
    const rows = this.byNote.get(`${note.track}:${note.index}`);
    if (!rows) return;
    for (
      let index = after(rows, position, (action) => action.at) - 1;
      index >= 0;
      index--
    ) {
      if (Math.abs(rows[index].validationRate - speed) < 0.0001)
        return rows[index];
    }
  }

  keyLabel(
    note: Note,
    position: number,
    speed: number,
  ): FingerAction | undefined {
    const rows = this.byNote.get(`${note.track}:${note.index}`);
    if (!rows) return;
    const current = this.current(note, position, speed);
    return (
      current ??
      rows.find((action) => Math.abs(action.validationRate - speed) < 0.0001)
    );
  }
}
