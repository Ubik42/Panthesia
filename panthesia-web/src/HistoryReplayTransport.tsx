import { useEffect, useId, useRef, useState } from "react";
import { HistoryReplayRange, type ReplayReference } from "./HistoryReplayRange";
import type { HistoryMeasureSpan } from "./historyScoreFocus";
import type { HistoryReplay } from "./useHistoryReplay";
export function HistoryReplayTransport({
  replay,
  prefix,
  references = [],
  measures,
  duration,
  refreshSource,
}: {
  replay: HistoryReplay;
  prefix: string;
  references?: ReplayReference[];
  measures?: HistoryMeasureSpan[] | null;
  duration?: number;
  refreshSource?: () => void | Promise<void>;
}) {
  const [target, setTarget] = useState(0),
    [dragging, setDragging] = useState(false);
  const [text, setText] = useState("0"),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const errorId = useId();
  const edited = useRef(false);
  const attached = replay.phase !== "idle";
  const displayEnd = attached ? replay.end : (duration ?? replay.end);
  const min = replay.loop?.start ?? 0;
  const max = replay.loop ? Math.max(min, replay.loop.end - 0.001) : replay.end;
  useEffect(() => {
    if (!dragging) setTarget(replay.position);
  }, [replay.position, dragging]);
  useEffect(() => {
    if (!editing) setText(String(Number(replay.position.toFixed(3))));
  }, [replay.position, editing]);
  useEffect(() => {
    edited.current = false;
    setDragging(false);
    setEditing(false);
    setError("");
    setText("0");
  }, [replay.contentId, replay.historyId, replay.engineId]);
  const seek = async (value: number) => {
    if (!attached || replay.busy) return;
    if (!Number.isFinite(value) || value < min || value > max + 0.000001) {
      setError(`请输入 ${min.toFixed(3)} 到 ${max.toFixed(3)} 秒之间的位置。`);
      return;
    }
    setError("");
    const applied = await replay.control("seek", value);
    setDragging(false);
    if (applied) {
      edited.current = false;
      setEditing(false);
    }
  };
  const seekText = () => {
    const value = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim())
      ? Number(text)
      : NaN;
    void seek(value);
  };
  const commitSlider = () => {
    if (!dragging) return;
    void seek(Math.max(min, Math.min(max, target)));
  };
  return (
    <div className="history-transport">
      <button
        disabled={replay.busy || !attached || replay.phase === "finished"}
        onClick={() =>
          void replay.control(replay.phase === "paused" ? "resume" : "pause")
        }
      >
        {replay.phase === "paused" ? "继续回放" : "暂停回放"}
      </button>
      <input
        type="range"
        aria-label={`${prefix}回放进度`}
        min={min}
        max={Math.max(min, max || 1)}
        step={0.001}
        value={Math.max(min, Math.min(target, max || 1))}
        disabled={!attached || replay.busy}
        onChange={(event) => {
          setDragging(true);
          setTarget(Number(event.target.value));
        }}
        onPointerUp={commitSlider}
        onKeyUp={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(event.key)
          )
            commitSlider();
        }}
        onPointerCancel={() => {
          setDragging(false);
          setTarget(replay.position);
        }}
      />
      <div className="replay-transport-position">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${prefix}回放定位秒数`}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          value={text}
          maxLength={128}
          disabled={!attached || replay.busy}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            if (!edited.current) setEditing(false);
          }}
          onChange={(event) => {
            edited.current = true;
            setEditing(true);
            setText(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              seekText();
            } else if (event.key === "Escape") {
              event.preventDefault();
              edited.current = false;
              setEditing(false);
              setError("");
            }
          }}
        />
        <span>秒</span>
        <button disabled={!attached || replay.busy} onClick={seekText}>
          定位回放
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert">
          {error}
        </p>
      )}
      <HistoryReplayRange
        replay={replay}
        prefix={prefix}
        references={references}
        measures={measures}
        duration={duration}
        refreshSource={refreshSource}
      />
      <span role="status" aria-live="off">
        {replay.position.toFixed(1)} / {displayEnd.toFixed(1)} 秒 ·{" "}
        {replay.stopPending
          ? "停止结果待确认"
          : {
              idle: "已停止",
              running: "正在回放",
              paused: "已暂停",
              finished: "回放结束",
            }[replay.phase]}
      </span>
    </div>
  );
}
