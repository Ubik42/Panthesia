import { IntervalTimeline } from "../practice/intervalTimeline";
type Timed = { start: number; end: number };
/** Map the adopted performance once; long ties share the waterfall's interval query. */
export class NotationTimeIndex<T extends Timed> {
  private readonly timeline: IntervalTimeline<T>;
  constructor(notes: readonly T[]) {
    this.timeline = new IntervalTimeline(
      notes,
      (note) => note.start,
      (note) => note.end,
    );
  }
  at(position: number) {
    const active: T[] = [];
    this.timeline.visit(position, position + 0.03, (note) => active.push(note));
    return { active, next: active[0] ?? this.timeline.nextAt(position) };
  }
}
