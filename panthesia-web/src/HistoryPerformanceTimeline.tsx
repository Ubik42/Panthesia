import { memo, useMemo, useState } from "react";

export type TimelineNote = {
  at: number;
  end: number;
  pitch: number;
  velocity: number;
  measure?: number;
  color: string;
};
const pitchName = (n: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][n % 12]}${Math.floor(n / 12) - 1}`;

// All notes remain in the plot. Consecutive equal-color rectangles share a path so playback
// updates move one cursor instead of reconciling two DOM nodes per note.
export const HistoryPerformanceTimeline = memo(function HistoryPerformanceTimeline({
  references, actual, start, end, position,
}: {
  references: TimelineNote[];
  actual: TimelineNote[];
  start: number;
  end: number;
  position: number | null;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const plot = useMemo(() => {
    const pitches = [...new Set([...references, ...actual].map((n) => n.pitch))].sort((a, b) => b - a);
    const width = Math.min(12000, Math.max(800, (end - start + .5) * 120));
    const span = Math.max(.1, end - start + .5);
    const x = (at: number) => 70 + Math.max(0, at - start) / span * (width - 90);
    const paths: { color: string; segments: string[] }[] = [];
    const lanes = new Map<number, TimelineNote[]>();
    const add = (notes: TimelineNote[], actual: boolean) => {
      for (const n of notes) {
        const row = pitches.indexOf(n.pitch);
        const left = x(n.at), top = 26 + row * 30 + (actual ? 12 : 0);
        const length = Math.max(3, x(n.end) - left);
        let path = paths.at(-1);
        if (!path || path.color !== n.color) { path = { color: n.color, segments: [] }; paths.push(path); }
        path.segments.push(`M${left.toFixed(2)},${top}h${length.toFixed(2)}v9h-${length.toFixed(2)}z`);
        const lane = row * 2 + Number(actual);
        const entries = lanes.get(lane) ?? [];
        entries.push(n); lanes.set(lane, entries);
      }
    };
    add(references, false); add(actual, true);
    for (const notes of lanes.values()) notes.sort((a, b) => a.at - b.at);
    const runs = paths.map(({color, segments}) => ({ color, d: segments.join("") }));
    const laneEnds = new Map<number, number[]>();
    for (const [lane, notes] of lanes) {
      let right = -Infinity;
      laneEnds.set(lane, notes.map((n) => right = Math.max(right, x(n.at) + Math.max(3, x(n.end) - x(n.at)))));
    }
    return { pitches, width, span, x, runs, lanes, laneEnds };
  }, [references, actual, start, end]);
  const height = Math.max(90, plot.pitches.length * 30 + 35);
  const staticPlot = useMemo(() => <>
    {Array.from({ length: Math.min(20, Math.ceil(end - start)) + 1 }, (_, i) => {
      const at = start + (end - start) * i / Math.max(1, Math.min(20, Math.ceil(end - start)));
      return <text key={`t${i}`} x={plot.x(at)} y={14} fill="#939aa6">{at.toFixed(1)}s</text>;
    })}
    {plot.pitches.map((p, row) => <g key={p}>
      <text x={4} y={36 + row * 30} fill="#cdd2dc">{pitchName(p)}</text>
      <line x1={65} x2={plot.width} y1={51 + row * 30} y2={51 + row * 30} stroke="#343d46" />
    </g>)}
    {plot.runs.map(({ color, d }, index) => <path key={index} d={d} fill={color} pointerEvents="none" />)}
  </>, [plot, start, end]);
  return <svg aria-label="参考与实际按键时间线" role="img" width={plot.width} height={height}
    data-reference-notes={references.length} data-actual-notes={actual.length}
    onMouseLeave={() => setTooltip(null)}
    onMouseMove={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - bounds.left, py = event.clientY - bounds.top - 26;
      const row = Math.floor(py / 30), offset = py - row * 30;
      const isActual = offset >= 12 && offset <= 21;
      if (py < 0 || (offset > 9 && !isActual)) { setTooltip(null); return; }
      const lane = row * 2 + Number(isActual);
      const notes = plot.lanes.get(lane) ?? [], ends = plot.laneEnds.get(lane) ?? [];
      const at = start + (px - 70) / (plot.width - 90) * plot.span;
      let lo = 0, hi = notes.length;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (notes[m].at <= at) lo = m + 1; else hi = m; }
      let n: TimelineNote | undefined;
      for (let i=lo-1; i>=0 && ends[i]>=px; i--) {
        if (px >= plot.x(notes[i].at) && px <= plot.x(notes[i].at) + Math.max(3, plot.x(notes[i].end) - plot.x(notes[i].at))) { n=notes[i]; break; }
      }
      if (!n) {
        setTooltip(null); return;
      }
      setTooltip(`${pitchName(n.pitch)} · ${isActual ? "实际" : `第 ${n.measure} 小节 · 参考`}力度 ${n.velocity}`);
    }}>
    <title>{tooltip ?? `参考 ${references.length} 个音，实际 ${actual.length} 个音。上行为参考，下行为实际演奏。`}</title>
    {staticPlot}
    {position != null && position >= start && position <= end &&
      <line x1={plot.x(position)} x2={plot.x(position)} y1={0} y2={plot.pitches.length * 30 + 30} stroke="#f5c15c" pointerEvents="none" />}
  </svg>;
});
