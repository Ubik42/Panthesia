import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Minus,
  Plus,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { LoadedSong, Snapshot, EngineCommand } from "./api";
import { PracticePositionJump } from "./features/practice/PracticePositionJump";
import {
  seekableMeasures,
  measureBeatLength,
} from "./features/practice/practicePresentation";
import { usePlaybackFields } from "./features/practice/PlaybackView";
import type { PlaybackStore } from "./features/practice/playbackStore";

const navigationFields = [
  "measure",
  "beat",
  "tick",
  "position",
  "passage",
  "contentId",
  "scoreRevision",
] as const;
export function LiveBarNavigator({
  store,
  ...props
}: Omit<ComponentProps<typeof BarNavigator>, "state"> & {
  store: PlaybackStore;
}) {
  const state = usePlaybackFields(store, navigationFields);
  if (
    state.contentId !== props.song.contentId ||
    (state.scoreRevision !== undefined &&
      state.scoreRevision !== props.song.scoreRevision)
  )
    return null;
  return (
    <BarNavigator
      key={`${props.song.engineId}:${props.song.contentId}:${props.song.scoreRevision}`}
      {...props}
      state={state}
    />
  );
}

export function BarNavigator({
  song,
  state,
  start,
  end,
  disabled,
  recital,
  select,
  command,
  condensed = false,
}: {
  song: LoadedSong;
  state: Pick<Snapshot, "measure" | "beat" | "tick" | "position" | "passage">;
  start: number;
  end: number;
  disabled: boolean;
  recital: boolean;
  select: (a: number, b: number) => void;
  command: (c: EngineCommand) => void;
  condensed?: boolean;
}) {
  const [visible, setVisible] = useState(16),
    [first, setFirst] = useState(1),
    [follow, setFollow] = useState(true),
    [draft, setDraft] = useState<{ a: number; b: number } | null>(null),
    [width, setWidth] = useState(0);
  const [expandedByUser, setExpanded] = useState<boolean | null>(null);
  const [focusedMeasure, setFocusedMeasure] = useState<number | null>(null);
  const expanded = expandedByUser ?? !condensed;
  const navigationId = useId();
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ a: number; b: number; moved: boolean } | null>(null),
    anchor = useRef<number | null>(null);
  const pendingFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingFocus.current === null || disabled || !expanded) return;
    if (!document.hasFocus()) {
      pendingFocus.current = null;
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement &&
      !root.current?.contains(active)
    ) {
      pendingFocus.current = null;
      return;
    }
    const target = root.current?.querySelector<HTMLButtonElement>(
      `[data-bar="${pendingFocus.current}"]`,
    );
    pendingFocus.current = null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
  });
  const cellWidth = Math.max(32, 12 + String(song.measures.length).length * 7);
  const capacity = Math.max(1, Math.floor(width / cellWidth) || 16);
  const pageSize = Math.min(visible, capacity);
  const range = seekableMeasures(song, state.passage);
  useEffect(() => {
    const region = root.current;
    if (!region) return;
    const resize = () => {
      if (region.clientWidth > 0) setWidth(region.clientWidth);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(region);
    resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setFirst(1);
    setDraft(null);
    anchor.current = null;
  }, [song.contentId, song.scoreRevision]);
  useEffect(() => {
    if (follow)
      setFirst(Math.floor((state.measure - 1) / pageSize) * pageSize + 1);
  }, [state.measure, pageSize, follow]);
  useEffect(() => setDraft(null), [start, end]);
  const bars = song.measures.slice(first - 1, first - 1 + pageSize),
    selection = draft ?? { a: start, b: end },
    low = Math.min(selection.a, selection.b),
    high = Math.max(selection.a, selection.b);
  const choose = (a: number, b: number) => {
    anchor.current = a;
    setDraft({ a, b });
    select(Math.min(a, b), Math.max(a, b));
  };
  const firstFocusable = bars.find(
    (bar) =>
      !state.passage ||
      (bar.start >= state.passage.start && bar.start < state.passage.end),
  )?.number;
  const preferredFocus = focusedMeasure ?? state.measure;
  const focusedBar = bars.some(
    (bar) =>
      bar.number === preferredFocus &&
      (!state.passage ||
        (bar.start >= state.passage.start && bar.start < state.passage.end)),
  )
    ? preferredFocus
    : firstFocusable;
  return (
    <section className="bar-navigator" aria-label="小节与拍导航">
      <div className="bar-tools">
        <button
          className="practice-navigation-toggle"
          aria-expanded={expanded}
          aria-controls={navigationId}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            size={14}
            style={{ transform: expanded ? undefined : "rotate(-90deg)" }}
          />
          小节导航
        </button>
        <span className="practice-navigation-pages" hidden={!expanded}>
          <button
            aria-label="上一组小节"
            disabled={first === 1}
            onClick={() => {
              setFollow(false);
              setFirst(Math.max(1, first - pageSize));
            }}
          >
            <ChevronLeft size={13} />
          </button>
          <span>
            {first}–{bars.at(-1)?.number} / {song.measures.length}
          </span>
          <button
            aria-label="下一组小节"
            disabled={first + pageSize > song.measures.length}
            onClick={() => {
              setFollow(false);
              setFirst(Math.min(song.measures.length, first + pageSize));
            }}
          >
            <ChevronRight size={13} />
          </button>
          <button
            aria-label="放大小节"
            disabled={pageSize <= 4}
            onClick={() => setVisible(Math.max(4, Math.floor(pageSize / 2)))}
          >
            <Plus size={13} />
          </button>
          <button
            aria-label="缩小小节"
            disabled={pageSize >= Math.min(64, capacity)}
            onClick={() => setVisible(Math.min(64, capacity, pageSize * 2))}
          >
            <Minus size={13} />
          </button>
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            跟随播放
          </label>
        </span>
        <span className="bar-selection">
          {low === high ? `选中第 ${low} 小节` : `选中 ${low}–${high} 小节`}
        </span>
        <button
          disabled={disabled || recital}
          onClick={() =>
            command({
              type: "measureLoop",
              start: low,
              end: high,
              enabled: true,
            })
          }
        >
          {expanded
            ? "循环选段"
            : low === high
              ? `循环第 ${low} 小节`
              : `循环 ${low}–${high} 小节`}
        </button>
      </div>
      <div
        id={navigationId}
        className="practice-measure-navigation"
        hidden={!expanded}
      >
        <div
          className="bar-strip"
          ref={root}
          role="group"
          aria-label="小节概览，方向键移动，按住 Shift 选择范围"
          onPointerMove={(e) => {
            if (!drag.current || disabled || recital) return;
            const element = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-bar]");
            if (
              !element ||
              !root.current?.contains(element) ||
              element.matches(":disabled")
            )
              return;
            const b = Number(element.dataset.bar);
            drag.current.b = b;
            drag.current.moved ||= b !== drag.current.a;
            setDraft({ a: drag.current.a, b });
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            const d = drag.current;
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (disabled || recital) {
              setDraft(null);
              return;
            }
            if (d.moved) choose(d.a, d.b);
            else if (e.shiftKey && anchor.current !== null)
              choose(anchor.current, d.b);
            else {
              anchor.current = d.a;
              setDraft(null);
              command({ type: "seekMeasure", measure: d.a });
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDraft(null);
          }}
          onLostPointerCapture={() => {
            if (drag.current) {
              drag.current = null;
              setDraft(null);
            }
          }}
          onKeyDown={(e) => {
            const current = Number(
              (e.target as HTMLElement)
                .closest("[data-bar]")
                ?.getAttribute("data-bar"),
            );
            if (
              !current ||
              ![
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key) ||
              disabled ||
              recital ||
              !range
            )
              return;
            e.preventDefault();
            const lower = range?.first ?? 1,
              upper = range?.last ?? song.measures.length;
            const target =
              e.key === "Home"
                ? lower
                : e.key === "End"
                  ? upper
                  : current +
                    (e.key === "ArrowLeft"
                      ? -1
                      : e.key === "ArrowRight"
                        ? 1
                        : e.key === "PageUp"
                          ? -pageSize
                          : pageSize);
            const next = Math.max(lower, Math.min(upper, target));
            if (
              next === current &&
              ["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key)
            )
              return;
            pendingFocus.current = next;
            setFollow(false);
            if (e.shiftKey) choose(anchor.current ?? current, next);
            else {
              anchor.current = next;
              command({ type: "seekMeasure", measure: next });
            }
            setFirst(Math.floor((next - 1) / pageSize) * pageSize + 1);
          }}
        >
          {bars.map((bar) => {
            const tickStep = measureBeatLength(song, bar);
            const beats = Math.ceil((bar.endTick - bar.startTick) / tickStep);
            const fraction = Math.max(
              0,
              Math.min(
                1,
                (state.tick - bar.startTick) / (bar.endTick - bar.startTick),
              ),
            );
            return (
              <button
                key={bar.number}
                data-bar={bar.number}
                tabIndex={bar.number === focusedBar ? 0 : -1}
                onFocus={() => setFocusedMeasure(bar.number)}
                aria-label={`第 ${bar.number} 小节${bar.displayNumber != null && bar.displayNumber !== bar.number ? `，谱面编号 ${bar.displayNumber}` : ""}，${bar.numerator}/${bar.denominator}${bar.partial ? "，不完整小节" : ""}`}
                aria-current={
                  state.measure === bar.number ? "location" : undefined
                }
                aria-pressed={bar.number >= low && bar.number <= high}
                disabled={
                  disabled ||
                  recital ||
                  (!!state.passage &&
                    (bar.start < state.passage.start ||
                      bar.start >= state.passage.end))
                }
                className={`bar-cell ${bar.number >= low && bar.number <= high ? "in-range" : ""} ${state.measure === bar.number ? "current" : ""}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.focus();
                  setFollow(false);
                  drag.current = { a: bar.number, b: bar.number, moved: false };
                  root.current?.setPointerCapture(e.pointerId);
                }}
                onClick={(e) => {
                  if (e.detail === 0) {
                    if (e.shiftKey && anchor.current !== null)
                      choose(anchor.current, bar.number);
                    else {
                      anchor.current = bar.number;
                      command({ type: "seekMeasure", measure: bar.number });
                    }
                  }
                }}
                title={`导航第 ${bar.number} 小节 · 谱面编号 ${bar.displayNumber ?? bar.number} · ${bar.numerator}/${bar.denominator} · ${bar.partial ? "弱起或变拍截断 · " : ""}拖动选段，Shift 点击扩展`}
              >
                <span>
                  {bar.number}
                  {bar.displayNumber != null &&
                    bar.displayNumber !== bar.number && (
                      <small className="bar-written-number">
                        谱 {bar.displayNumber}
                      </small>
                    )}
                </span>
                <div className="bar-beats">
                  {Array.from({ length: beats }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        flex:
                          Math.min(
                            tickStep,
                            bar.endTick - bar.startTick - i * tickStep,
                          ) / tickStep,
                      }}
                    />
                  ))}
                </div>
                <small>
                  {bar.partial
                    ? "弱起/短节"
                    : bar.numerator + "/" + bar.denominator}
                </small>
                {state.measure === bar.number && (
                  <b
                    className="bar-cursor"
                    style={{ left: `${fraction * 100}%` }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="beat-tools">
          <button
            aria-label="上一拍"
            disabled={
              disabled ||
              recital ||
              state.position <= Math.max(0, state.passage?.start ?? 0)
            }
            onClick={() => command({ type: "stepBeat", direction: -1 })}
          >
            <SkipBack size={12} />
          </button>
          <button
            aria-label="下一拍"
            disabled={
              disabled ||
              recital ||
              state.position >= (state.passage?.end ?? song.duration)
            }
            onClick={() => command({ type: "stepBeat", direction: 1 })}
          >
            <SkipForward size={12} />
          </button>
          <span>
            {recital
              ? "完整演奏从曲首开始；选段请切换练习模式"
              : "拖动或 Shift 点击选择小节；方向键移动，Shift＋方向键扩展"}
          </span>
        </div>
        <PracticePositionJump
          key={`${song.contentId}:${song.scoreRevision}`}
          song={song}
          state={state}
          disabled={disabled || recital}
          command={command}
        />
      </div>
    </section>
  );
}
