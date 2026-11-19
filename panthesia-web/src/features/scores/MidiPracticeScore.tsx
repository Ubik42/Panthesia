import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedSong, Note, Snapshot } from "../../api";
import "./midiPracticeScore.css";

const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const degree = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const sharp = new Set([1, 3, 6, 8, 10]);
const width = 1100,
  left = 90;
const lowerStaff = (note: Note) =>
  note.part === "left" || (note.part !== "right" && note.pitch < 60);
function writtenPitch(pitch: number) {
  return Math.floor(pitch / 12 - 1) * 7 + degree[pitch % 12];
}
const NoteGlyph = memo(function NoteGlyph({
  note,
  x,
  ppq,
  active,
  seek,
}: {
  note: Note;
  x: number;
  ppq: number;
  active: boolean;
  seek: (position:number) => void;
}) {
  const lower = lowerStaff(note);
  const base = lower ? 194 : 94,
    bottom = lower ? 18 : 30;
  const y = base - (writtenPitch(note.pitch) - bottom) * 5;
  const beats = Math.max(0.25, (note.endTick - note.tick) / ppq);
  const whole = beats >= 3.5,
    half = beats >= 1.75,
    flags = beats < 0.375 ? 2 : beats < 0.75 ? 1 : 0;
  const stemUp = y > base - 20,
    tip = y + (stemUp ? -32 : 32),
    stemX = x + (stemUp ? 5.5 : -5.5);
  const ledger = [];
  if (y > base)
    for (let line = base + 10; line <= y; line += 10) ledger.push(line);
  if (y < base - 40)
    for (let line = base - 50; line >= y; line -= 10) ledger.push(line);
  return (
    <g
      className={`midi-score-note ${lower ? "left-hand" : "right-hand"} ${active ? "active" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${names[note.pitch % 12]}${Math.floor(note.pitch / 12) - 1}，跳到此音`}
      onClick={()=>seek(note.start)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          seek(note.start);
        }
      }}
    >
      <rect x={x - 12} y={y - 14} width={24} height={28} fill="transparent" />
      {ledger.map((line) => (
        <line
          key={line}
          x1={x - 10}
          x2={x + 10}
          y1={line}
          y2={line}
          className="ledger"
        />
      ))}
      {sharp.has(note.pitch % 12) && (
        <text x={x - 20} y={y + 5} fontSize={18}>
          ♯
        </text>
      )}
      <ellipse
        cx={x}
        cy={y}
        rx={6.3}
        ry={4.6}
        transform={`rotate(-18 ${x} ${y})`}
        fill={whole || half ? "var(--score-paper)" : "currentColor"}
        stroke="currentColor"
        strokeWidth={1.6}
      />
      {!whole && (
        <>
          <line
            x1={stemX}
            x2={stemX}
            y1={y}
            y2={tip}
            stroke="currentColor"
            strokeWidth={1.4}
          />
          {Array.from({ length: flags }, (_, i) => (
            <path
              key={i}
              d={`M ${stemX} ${tip + (stemUp ? i * 7 : -i * 7)} q ${stemUp ? 13 : -13} ${stemUp ? 9 : -9} 3 ${stemUp ? 18 : -18}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
          ))}
        </>
      )}
      {note.finger != null && (
        <text
          x={x}
          y={stemUp ? y + 20 : y - 14}
          textAnchor="middle"
          className="midi-score-finger"
        >
          {note.finger}
        </text>
      )}
    </g>
  );
});
/** A direct, disposable MIDI reading view. It never rewrites the performance or pretends to be an original score. */
export function MidiPracticeScore({
  song,
  state,
  seek,
}: {
  song: LoadedSong;
  state: Snapshot;
  seek: (position: number) => void;
}) {
  const seekRef=useRef(seek);seekRef.current=seek;
  const seekNote=useCallback((position:number)=>seekRef.current(position),[]);
  const [page, setPage] = useState(0),
    [follow, setFollow] = useState(true);
  const root = useRef<HTMLElement>(null);
  const [barsPerSystem, setBarsPerSystem] = useState(4);
  const barsPerPage = barsPerSystem * 2,
    barWidth = (width - left - 30) / barsPerSystem;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setBarsPerSystem(entry.contentRect.width < 950 ? 2 : 4),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const measures = song.measures;
  const current = Math.max(
    0,
    measures.findIndex(
      (m) => state.position >= m.start && state.position < m.end,
    ),
  );
  const total = Math.max(1, Math.ceil(measures.length / barsPerPage));
  useEffect(() => {
    setPage(0);
    setFollow(true);
  }, [song.contentId]);
  useEffect(() => {
    setPage((previous) =>
      follow
        ? Math.floor(current / barsPerPage)
        : Math.min(previous, total - 1),
    );
  }, [current, follow, barsPerPage, total]);
  const byMeasure = useMemo(() => {
    const map = new Map<number, Note[]>();
    for (const note of song.notes) {
      let lo = 0,
        hi = measures.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (measures[mid].startTick <= note.tick) lo = mid + 1;
        else hi = mid;
      }
      const i = Math.max(0, lo - 1),
        items = map.get(i) ?? [];
      items.push(note);
      map.set(i, items);
    }
    return map;
  }, [song.notes, measures]);
  const first = Math.min(page, total - 1) * barsPerPage;
  useEffect(() => {
    if (!follow || !root.current) return;
    const container = root.current,
      system = container.querySelector<SVGSVGElement>(
        'svg[data-current="true"]',
      );
    if (!system) return;
    const bounds = container.getBoundingClientRect(),
      target = system.getBoundingClientRect();
    const toolbar =
      container.querySelector(".midi-score-toolbar")?.getBoundingClientRect()
        .height ?? 0;
    if (target.bottom > bounds.bottom || target.top < bounds.top + toolbar)
      container.scrollTop += target.top - bounds.top - toolbar - 12;
  }, [current, first, barsPerSystem, follow]);
  return (
    <section
      ref={root}
      className="midi-practice-score"
      aria-label="MIDI 简单五线谱"
    >
      <div className="midi-score-toolbar">
        <span>
          五线谱预览 <small>由 MIDI 直接生成</small>
        </span>
        <div>
          <button
            disabled={page === 0}
            onClick={() => {
              setFollow(false);
              setPage((p) => Math.max(0, p - 1));
            }}
          >
            上一页
          </button>
          <span>
            {page + 1} / {total}
          </span>
          <button
            disabled={page + 1 >= total}
            onClick={() => {
              setFollow(false);
              setPage((p) => p + 1);
            }}
          >
            下一页
          </button>
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            跟随演奏
          </label>
        </div>
      </div>
      <div className="midi-score-paper">
        <h2>{song.title}</h2>
        <p>
          高音谱表：右手　低音谱表：左手　{measures[first]?.numerator ?? 4}/
          {measures[first]?.denominator ?? 4}　♩ ={" "}
          {Math.round((state.bpm || 120)*state.speed)}
        </p>
        {[0, 1].map((system) => {
          const start = first + system * barsPerSystem;
          if (start >= measures.length) return null;
          return (
            <svg
              key={start}
              data-current={current >= start && current < start + barsPerSystem}
              viewBox={`0 0 ${width} 250`}
              role="img"
              aria-label={`${song.title}，第 ${start + 1} 至 ${Math.min(start + barsPerSystem, measures.length)} 小节`}
            >
              {[54, 64, 74, 84, 94, 154, 164, 174, 184, 194].map((y) => (
                <line
                  key={y}
                  x1={left - 45}
                  x2={width - 30}
                  y1={y}
                  y2={y}
                  className="staff-line"
                />
              ))}
              <text x={45} y={89} className="score-clef">
                𝄞
              </text>
              <text x={45} y={187} className="score-clef">
                𝄢
              </text>
              {measures
                .slice(start, start + barsPerSystem)
                .map((measure, bar) => {
                  const x = left + bar * barWidth,
                    span = Math.max(1, measure.endTick - measure.startTick);
                  const visible = byMeasure.get(start + bar) ?? [];
                  const cursor =
                    x +
                    16 +
                    Math.max(
                      0,
                      Math.min(
                        1,
                        (state.position - measure.start) /
                          Math.max(0.01, measure.end - measure.start),
                      ),
                    ) *
                      (barWidth - 32);
                  return (
                    <g key={start + bar}>
                      <text x={x + 8} y={30} className="score-bar-number">
                        {measure.displayNumber ?? measure.number}
                      </text>
                      <line
                        x1={x + barWidth}
                        x2={x + barWidth}
                        y1={54}
                        y2={194}
                        className="bar-line"
                      />
                      {visible.map((n) => (
                        <NoteGlyph
                          key={`${n.track}:${n.index}`}
                          note={n}
                          x={
                            x +
                            17 +
                            ((Math.round(
                              (n.tick - measure.startTick) / (song.ppq / 4),
                            ) *
                              (song.ppq / 4)) /
                              span) *
                              (barWidth - 35)
                          }
                          ppq={song.ppq}
                          active={
                            state.position >= n.start - 0.035 &&
                            state.position < n.start + n.duration
                          }
                          seek={seekNote}
                        />
                      ))}
                      {!visible.some((n) => !lowerStaff(n)) && (
                        <text
                          x={x + barWidth / 2}
                          y={83}
                          className="score-rest"
                        >
                          𝄽
                        </text>
                      )}
                      {!visible.some(lowerStaff) && (
                        <text
                          x={x + barWidth / 2}
                          y={183}
                          className="score-rest"
                        >
                          𝄽
                        </text>
                      )}
                      {current === start + bar && (
                        <line
                          className="score-playhead"
                          x1={cursor}
                          x2={cursor}
                          y1={42}
                          y2={215}
                        />
                      )}
                    </g>
                  );
                })}
            </svg>
          );
        })}
        <footer>
          点击音符可定位。节奏按拍位简化显示，原 MIDI 演奏时序保持不变。
        </footer>
      </div>
    </section>
  );
}
