import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Hand, Eraser } from "lucide-react";
import { api, pitchName, type LoadedSong, type EngineCommand } from "../../api";
import type {
  HandUndoState,
  PracticePart,
} from "../../engine/commands.generated";
import {
  keyboardLayout,
  viewportFromRange,
  normalizeKeyboardRange,
} from "../practice/keyboardViewport";
import { ScreenHeader } from "./ScreenHeader";
type Paint = PracticePart | "inherit";
const sourceKey = (s: LoadedSong) =>
  JSON.stringify([
    s.engineId,
    s.contentId,
    s.scoreRevision,
    s.annotationRevision,
    s.grid,
  ]);
export function HandSplitScreen({
  song,
  trackId,
  disabled,
  back,
  command,
}: {
  song: LoadedSong;
  trackId: number;
  disabled: boolean;
  back: () => void;
  command: (c: EngineCommand) => Promise<boolean>;
}) {
  const [origin] = useState(() => sourceKey(song));
  const [proof, setProof] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [paint, setPaint] = useState<Paint>("LeftHand");
  const [wholeSplit, setWholeSplit] = useState(false);
  const [rightPaint, setRightPaint] = useState<Paint>("RightHand");
  const roll = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    kind: "pan" | "split";
    x: number;
    y: number;
    start: number;
    note?: number;
  } | null>(null);
  const [line, setLine] = useState<{
    x: number;
    y: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [draft, setDraft] = useState<Record<string, Paint>>({});
  const [start, setStart] = useState(0);
  const [span, setSpan] = useState(
    Math.min(8, Math.max(2, Math.ceil(song.duration))),
  );
  const [split, setSplit] = useState(60);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const track = song.tracks.find((t) => t.id === trackId);
  const stale = origin !== sourceKey(song);
  const dirty = wholeSplit || Object.keys(draft).length > 0;
  useEffect(() => {
    let active = true;
    void api
      .commandForEngine<HandUndoState>(song.engineId ?? undefined, {
        type: "handUndoState",
      })
      .then((v) => {
        if (active) setProof(v.proof);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const notes = useMemo(
    () => song.notes.filter((n) => n.track === trackId),
    [song.notes, trackId],
  );
  const visible = useMemo(
    () =>
      notes.filter(
        (n) => n.start + n.duration > start && n.start < start + span,
      ),
    [notes, start, span],
  );
  const range = useMemo(() => {
    const r = notes.reduce(
      (r, n) => ({
        low: Math.min(r.low, n.pitch),
        high: Math.max(r.high, n.pitch),
      }),
      { low: 48, high: 72 },
    );
    return normalizeKeyboardRange(r.low - 2, r.high + 2);
  }, [notes]);
  const layout = useMemo(
    () => keyboardLayout(viewportFromRange(range)),
    [range],
  );
  const keys = useMemo(
    () => new Map(layout.map((k) => [k.pitch, k])),
    [layout],
  );
  const setNote = (index: number, value: Paint) => {
    if (stale || saving || disabled) return;
    setDraft((d) => ({ ...d, [index]: value }));
  };
  const setBySplit = () => {
    if (visible.length > 4096) {
      setError("当前范围音符过多，请缩小时间范围后分配。");
      return;
    }
    setDraft((d) => ({
      ...d,
      ...Object.fromEntries(
        visible.map((n) => [
          n.index,
          n.pitch < split ? "LeftHand" : "RightHand",
        ]),
      ),
    }));
  };
  const leave = () => {
    if (dirty) setLeaving(true);
    else back();
  };
  const save = async () => {
    if (saving || disabled || !proof || stale) return;
    const changes = Object.entries(draft);
    if (changes.length > 4096) {
      setError("一次最多保存 4096 个音符，请缩小范围。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const hints = changes
        .filter(([, part]) => part !== "inherit")
        .map(([index, part]) => ({
          track_id: trackId,
          note_index: Number(index),
          part: part as PracticePart,
        }));
      const clear = changes
        .filter(([, part]) => part === "inherit")
        .map(([i]) => [trackId, Number(i)] as [number, number]);
      const operation: EngineCommand = wholeSplit
        ? {
            type: "setPartHands",
            content_id: song.contentId,
            track: trackId,
            part: null,
            split_pitch: split,
            proof,
            hints,
            clear: clear.map(([, index]) => index),
          }
        : {
            type: "applyHands",
            content_id: song.contentId,
            hints,
            clear,
            proof,
          };
      if (await command(operation)) {
        setDraft({});
        back();
      } else setError("分手未能保存，请重试。");
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,select,textarea"))
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setStart((v) =>
          Math.max(
            0,
            Math.min(
              Math.max(0, song.duration - span),
              v + (e.key === "ArrowLeft" ? -span : span),
            ),
          ),
        );
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        setSpan((v) =>
          Math.max(2, Math.min(32, e.key === "PageUp" ? v / 2 : v * 2)),
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [song.duration, span]);
  useEffect(() => {
    const svg = roll.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setStart((v) =>
        Math.max(
          0,
          Math.min(
            Math.max(0, song.duration - span),
            v + (e.deltaY / 500) * span,
          ),
        ),
      );
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [song.duration, span]);
  const point = (x: number, y: number) => {
    const rect = roll.current!.getBoundingClientRect();
    return {
      x: ((x - rect.left) / rect.width) * 1000,
      y: ((y - rect.top) / rect.height) * 480,
    };
  };
  const finishGesture = (x: number, y: number) => {
    const g = gesture.current;
    gesture.current = null;
    setLine(null);
    if (!g || g.kind !== "split" || stale || disabled || saving) return;
    const end = point(x, y);
    if (Math.hypot(end.x - g.x, end.y - g.y) < 5 && g.note !== undefined) {
      setNote(g.note, rightPaint);
      return;
    }
    const changes = visible
      .filter((n) => {
        const y = 410 - ((n.start + n.duration / 2 - start) / span) * 410;
        return y >= Math.min(g.y, end.y) && y <= Math.max(g.y, end.y);
      })
      .map((n) => {
        const y = 410 - ((n.start + n.duration / 2 - start) / span) * 410;
        const x =
          g.x +
          (end.x - g.x) *
            (Math.abs(end.y - g.y) < 1 ? 0.5 : (y - g.y) / (end.y - g.y));
        const k = keys.get(n.pitch)!;
        return [n.index, (k.x + k.w / 2) * 1000 < x ? paint : rightPaint];
      });
    if (changes.length > 4096) {
      setError("当前范围超过 4096 个音符，请缩小范围。");
      return;
    }
    setDraft((d) => ({ ...d, ...Object.fromEntries(changes) }));
  };
  return (
    <main className="product-hand-screen product-page">
      <ScreenHeader
        title={`${track?.name ?? "音轨"} · 自定义分手`}
        back={leave}
        backLabel="音轨"
        backDisabled={saving}
        backSide="right"
      />
      <div className="product-hand-body">
        <aside className="product-hand-tools" aria-label="分手工具">
          <h2>分配音符</h2>
          {(
            [
              ["LeftHand", "左手"],
              ["RightHand", "右手"],
              ["Other", "不分手"],
              ["inherit", "沿用音轨"],
            ] as [Paint, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={paint === value}
              onClick={() => setPaint(value)}
              disabled={saving}
            >
              {value === "inherit" ? <Eraser /> : <Hand />}
              {label}
            </button>
          ))}
          <button
            disabled={saving || disabled || stale}
            aria-pressed={wholeSplit}
            onClick={() => setWholeSplit((v) => !v)}
          >
            分开整首歌曲
          </button>
          <label>
            分界音
            <select
              aria-label="分界音"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            >
              {Array.from({ length: 49 }, (_, i) => i + 36).map((p) => (
                <option key={p} value={p}>
                  {pitchName(p)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={saving || disabled || stale} onClick={setBySplit}>
            按音高分配
          </button>
          <label>
            显示范围
            <select
              aria-label="分手显示范围"
              value={span}
              onChange={(e) => setSpan(Number(e.target.value))}
            >
              {[2, 4, 8, 16, 32].map((v) => (
                <option key={v} value={v}>
                  {v} 秒
                </option>
              ))}
            </select>
          </label>
          {dirty && (
            <button
              onClick={() => {
                setDraft({});
                setWholeSplit(false);
              }}
              disabled={saving}
            >
              撤销本次修改
            </button>
          )}
        </aside>
        <section className="product-hand-roll">
          <div className="product-hand-time">
            <button
              aria-label="前一段"
              disabled={start <= 0}
              onClick={() => setStart((s) => Math.max(0, s - span))}
            >
              <ChevronLeft />
            </button>
            <label>
              时间
              <input
                type="number"
                min={0}
                max={song.duration}
                step={1}
                aria-label="分手起始时间"
                value={start}
                onChange={(e) =>
                  setStart(
                    Math.max(
                      0,
                      Math.min(song.duration, Number(e.target.value) || 0),
                    ),
                  )
                }
              />
            </label>
            <span>— {Math.min(song.duration, start + span).toFixed(1)} 秒</span>
            <button
              aria-label="后一段"
              disabled={start + span >= song.duration}
              onClick={() =>
                setStart((s) =>
                  Math.min(Math.max(0, song.duration - span), s + span),
                )
              }
            >
              <ChevronRight />
            </button>
          </div>
          <svg
            ref={roll}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.button !== 2) return;
              const p = point(e.clientX, e.clientY);
              if (p.y > 410) return;
              e.preventDefault();
              const n = (e.target as Element).closest("[data-note-index]");
              gesture.current = {
                kind: e.button === 2 ? "split" : "pan",
                x: p.x,
                y: p.y,
                start,
                note: n ? Number(n.getAttribute("data-note-index")) : undefined,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
              if (e.button === 2) setLine({ ...p, x2: p.x, y2: p.y });
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g) return;
              const p = point(e.clientX, e.clientY);
              if (g.kind === "pan")
                setStart(
                  Math.max(
                    0,
                    Math.min(
                      Math.max(0, song.duration - span),
                      g.start + ((p.y - g.y) / 410) * span,
                    ),
                  ),
                );
              else setLine({ x: g.x, y: g.y, x2: p.x, y2: p.y });
            }}
            onPointerUp={(e) => finishGesture(e.clientX, e.clientY)}
            onPointerCancel={() => {
              gesture.current = null;
              setLine(null);
            }}
            viewBox="0 0 1000 480"
            preserveAspectRatio="none"
            aria-label="分手音符瀑布"
            className="product-hand-svg"
          >
            <defs>
              <clipPath id="hand-roll-clip">
                <rect width="1000" height="410" />
              </clipPath>
            </defs>
            <g clipPath="url(#hand-roll-clip)">
              {wholeSplit && (
                <>
                  <rect
                    x={0}
                    y={0}
                    width={(keys.get(split)?.x ?? 0.5) * 1000}
                    height={410}
                    fill="#4c99df22"
                  />
                  <line
                    x1={(keys.get(split)?.x ?? 0.5) * 1000}
                    x2={(keys.get(split)?.x ?? 0.5) * 1000}
                    y1={0}
                    y2={410}
                    stroke="#ddd"
                    strokeDasharray="5 5"
                  />
                </>
              )}
              {line && (
                <g pointerEvents="none">
                  <path
                    d={`M0 ${line.y} L${line.x} ${line.y} L${line.x2} ${line.y2} L0 ${line.y2}Z`}
                    fill="#4c99df66"
                  />
                  <path
                    d={`M${line.x} ${line.y} L1000 ${line.y} L1000 ${line.y2} L${line.x2} ${line.y2}Z`}
                    fill="#91c94366"
                  />
                  <line
                    x1={line.x}
                    y1={line.y}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="#eee"
                    strokeWidth={2}
                  />
                </g>
              )}
              {layout
                .filter((k) => !k.black)
                .map((k) => (
                  <line
                    key={k.pitch}
                    x1={k.x * 1000}
                    x2={k.x * 1000}
                    y1={0}
                    y2={410}
                    stroke="#ffffff12"
                  />
                ))}
              {song.measures
                .filter((m) => m.start >= start && m.start < start + span)
                .map((m) => (
                  <g key={m.number}>
                    <line
                      x1={0}
                      x2={1000}
                      y1={410 - ((m.start - start) / span) * 410}
                      y2={410 - ((m.start - start) / span) * 410}
                      stroke="#ffffff55"
                    />
                    <text
                      x={5}
                      y={403 - ((m.start - start) / span) * 410}
                      fill="#eee"
                    >
                      {m.displayNumber ?? m.number}
                    </text>
                  </g>
                ))}
              {visible.map((n) => {
                const k = keys.get(n.pitch);
                if (!k) return null;
                const value = draft[String(n.index)];
                const part =
                  value === "inherit"
                    ? track?.part
                    : value === "LeftHand"
                      ? "left"
                      : value === "RightHand"
                        ? "right"
                        : value === "Other"
                          ? "other"
                          : wholeSplit
                            ? n.pitch < split
                              ? "left"
                              : "right"
                            : n.part;
                const color =
                  part === "left"
                    ? "#4c99df"
                    : part === "right"
                      ? "#91c943"
                      : "#a6adb5";
                return (
                  <rect
                    key={n.index}
                    data-note-index={n.index}
                    role="button"
                    tabIndex={0}
                    aria-label={`${pitchName(n.pitch)}，${n.start.toFixed(2)}秒，${part === "left" ? "左手" : part === "right" ? "右手" : "未分手"}`}
                    x={k.x * 1000 + 1}
                    width={Math.max(3, k.w * 1000 - 2)}
                    y={410 - ((n.start + n.duration - start) / span) * 410}
                    height={Math.max(7, (n.duration / span) * 410)}
                    rx={3}
                    fill={color}
                    stroke={value ? "#fff" : "#223f55"}
                    strokeWidth={value ? 2 : 1}
                    onPointerDown={(e) => {
                      if (e.button === 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        setNote(n.index, paint);
                      }
                    }}
                    onPointerEnter={(e) => {
                      if (e.buttons === 1) setNote(n.index, paint);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setNote(n.index, paint);
                      }
                    }}
                  >
                    <title>
                      {pitchName(n.pitch)} · {n.start.toFixed(2)} 秒
                    </title>
                  </rect>
                );
              })}
            </g>
            {[
              ...layout.filter((k) => !k.black),
              ...layout.filter((k) => k.black),
            ].map((k) => (
              <rect
                key={k.pitch}
                x={k.x * 1000}
                y={410}
                width={k.w * 1000}
                height={k.black ? 43 : 70}
                fill={k.black ? "#20252d" : "#f4f3eb"}
                stroke="#777"
                strokeWidth={1}
              />
            ))}
          </svg>
        </section>
        <aside
          className="product-hand-tools product-hand-right"
          aria-label="右键分手工具"
        >
          <h2>右键分配</h2>
          {(
            [
              ["LeftHand", "左手"],
              ["RightHand", "右手"],
              ["Other", "不分手"],
              ["inherit", "沿用音轨"],
            ] as [Paint, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              aria-label={`右键${label}`}
              aria-pressed={rightPaint === value}
              disabled={saving}
              onClick={() => setRightPaint(value)}
            >
              {label}
            </button>
          ))}
          <p>右键拖出分界线，调整一段音符。</p>
        </aside>
      </div>
      <footer className="product-page-footer">
        <span>
          {stale
            ? "曲目标注已变化，请重新打开分手编辑。"
            : dirty
              ? `${wholeSplit ? "整首分手 · " : ""}${Object.keys(draft).length} 个逐音修正待保存`
              : "点击或拖过音符分配手别"}
        </span>
        {leaving && dirty && (
          <>
            <span>当前修改尚未保存。</span>
            <button onClick={() => setLeaving(false)}>继续编辑</button>
            <button disabled={saving} onClick={back}>
              放弃修改并返回
            </button>
          </>
        )}
        {error && <span role="status">{error}</span>}
        <button
          className="product-hand-continue"
          disabled={saving || disabled || stale || !proof}
          onClick={() => {
            if (dirty) void save();
            else back();
          }}
        >
          {saving ? "正在保存…" : "继续"}
        </button>
      </footer>
    </main>
  );
}
