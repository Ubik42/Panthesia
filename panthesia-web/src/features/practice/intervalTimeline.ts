/** A static interval tree shared by waterfall ticks and notation seconds. */
export class IntervalTimeline<T> {
  private readonly rows: readonly T[];
  private readonly maximumEnd: Float64Array;
  constructor(
    rows: readonly T[],
    private readonly start: (row: T) => number,
    private readonly end: (row: T) => number,
    compareEqual: (a: T, b: T) => number = () => 0,
  ) {
    this.rows = [...rows].sort(
      (a, b) => start(a) - start(b) || compareEqual(a, b),
    );
    this.maximumEnd = new Float64Array(Math.max(1, rows.length * 4));
    if (rows.length) this.build(1, 0, rows.length);
  }
  private build(node: number, low: number, high: number): number {
    if (high - low === 1)
      return (this.maximumEnd[node] = this.end(this.rows[low]));
    const mid = (low + high) >>> 1;
    return (this.maximumEnd[node] = Math.max(
      this.build(node * 2, low, mid),
      this.build(node * 2 + 1, mid, high),
    ));
  }
  visit(from: number, to: number, render: (row: T) => void) {
    if (!this.rows.length || to < from) return;
    const walk = (node: number, low: number, high: number) => {
      if (this.maximumEnd[node] < from || this.start(this.rows[low]) > to)
        return;
      if (high - low === 1) {
        render(this.rows[low]);
        return;
      }
      const mid = (low + high) >>> 1;
      walk(node * 2, low, mid);
      walk(node * 2 + 1, mid, high);
    };
    walk(1, 0, this.rows.length);
  }
  nextAt(position: number) {
    let low = 0,
      high = this.rows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.start(this.rows[mid]) < position) low = mid + 1;
      else high = mid;
    }
    return this.rows[low];
  }
}
