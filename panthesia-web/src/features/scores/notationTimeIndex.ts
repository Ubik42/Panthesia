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

/** Scroll the score panel only; keeping the app's transport and other pane stationary matters. */
/** `frames` are enclosing elements, outermost first (system, staff): the first one that fits the
 * viewport is kept wholly in view; otherwise the note is centred. */
export function revealNotationNote(viewport: HTMLElement, note: Element, frames: (Element | null)[] = []) {
  const box = viewport.getBoundingClientRect(),
    target = note.getBoundingClientRect();
  if (!box.height || !box.width || !target.height) return;
  const margin = Math.min(24, box.height / 5);
  const line = frames
    .map((frame) => frame?.getBoundingClientRect())
    .find((rect) => rect && rect.height <= box.height);
  if (line) {
    if (line.top < box.top || line.bottom > box.bottom)
      viewport.scrollTop += line.top - box.top - Math.min(8, (box.height - line.height) / 2);
  } else if (target.top < box.top + margin || target.bottom > box.bottom - margin)
    viewport.scrollTop +=
      target.top + target.height / 2 - box.top - box.height * 0.4;
  if (target.left < box.left + margin || target.right > box.right - margin)
    viewport.scrollLeft +=
      target.left + target.width / 2 - box.left - box.width / 2;
}
