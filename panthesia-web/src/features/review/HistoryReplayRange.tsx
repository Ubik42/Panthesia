import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { HistoryMeasureSpan } from "../../historyScoreFocus";
import type { HistoryReplay } from "../../useHistoryReplay";
import { HistoryReplayClips } from "./HistoryReplayClips";
import { getReplayEditor, replayRange } from "./replayEditorStore";
import { rangeSourceChanged } from "./historySource";
import "./historyReplayEditor.css";
export type ReplayReference = {
  at: number;
  end: number;
  measure: number;
  songTime?: number;
  pitch?: number;
  track?: number;
};
export function HistoryReplayRange({
  replay,
  prefix,
  references,
  measures,
  duration,
  refreshSource,
}: {
  replay: HistoryReplay;
  prefix: string;
  references: ReplayReference[];
  measures?: HistoryMeasureSpan[] | null;
  duration?: number;
  refreshSource?: () => void | Promise<void>;
}) {
  const exact = !!measures?.length;
  const spans = useMemo(() => {
    if (exact)
      return measures!.map((m) => ({
        ...m,
        start: m.at,
        partial:
          m.songStart > m.measureStart + 0.000001 ||
          m.songEnd < m.measureEnd - 0.000001,
      }));
    const ordered = [...references].sort((a, b) => a.at - b.at),
      counts = new Map<number, number>();
    const result: {
      measure: number;
      occurrence: number;
      start: number;
      end: number;
      partial?: boolean;
    }[] = [];
    let previous: ReplayReference | undefined;
    const seen = new Set<string>();
    for (const n of ordered) {
      const last = result.at(-1);
      const key =
        n.songTime == null
          ? ""
          : `${n.track}:${n.pitch}:${Math.round(n.songTime * 1000000)}`;
      const rewind =
        previous &&
        n.songTime != null &&
        previous.songTime != null &&
        (n.songTime < previous.songTime - 0.000001 ||
          (seen.has(key) && n.at > previous.at + 0.000001));
      previous = n;
      if (last?.measure === n.measure && !rewind) {
        seen.add(key);
        last.end = Math.max(last.end, n.end);
        continue;
      }
      seen.clear();
      seen.add(key);
      const occurrence = (counts.get(n.measure) ?? 0) + 1;
      counts.set(n.measure, occurrence);
      result.push({ measure: n.measure, occurrence, start: n.at, end: n.end });
    }
    return result;
  }, [references, measures]);
  const store = getReplayEditor(replay.contentId, replay.historyId);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const archiveEnd =
    duration != null && Number.isFinite(duration) && duration >= 0
      ? duration
      : replay.end;
  const firstMeasure = spans[0]?.measure ?? 1;
  useEffect(() => {
    store.initialize(firstMeasure, archiveEnd, replay.historySource);
  }, [store, firstMeasure, archiveEnd, replay.historySource]);
  const positiveInteger = (value: string) =>
    /^\d+$/.test(value.trim()) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
      ? Number(value)
      : null;
  const measure = positiveInteger(state.range.measure),
    occurrence = positiveInteger(state.range.occurrence);
  const selectedIndex = spans.findIndex(
      (span) => span.measure === measure && span.occurrence === occurrence,
    ),
    selected = spans[selectedIndex];
  const range = replayRange(state.range, archiveEnd);
  const rangeChanged = rangeSourceChanged(
    state.rangeSource,
    replay.historySource,
  );
  const rangeErrorId = useId(),
    measureErrorId = useId();
  const editingBlocked = state.busy || !!state.receipt;
  const attached = replay.phase !== "idle",
    playbackBlocked = replay.busy || !attached;
  const change = (field: keyof typeof state.range, value: string) => {
    if (!editingBlocked)
      store.update({
        range: { ...state.range, [field]: value },
        rangeSource: state.rangeSource,
        initialized: true,
        notice: "",
      });
  };
  const pickSpan = (index: number) => {
    const span = spans[index];
    if (!span || editingBlocked) return;
    store.update({
      range: {
        measure: String(span.measure),
        occurrence: String(span.occurrence),
        start: String(span.start),
        end: String(exact ? span.end : (spans[index + 1]?.start ?? archiveEnd)),
      },
      initialized: true,
      rangeSource: replay.historySource ?? state.rangeSource,
      notice: "",
    });
  };
  const locate = async () => {
    if (!selected) return;
    if (
      replay.loop &&
      !(await replay.control("loop", 0, { end: replay.end, enabled: false }))
    )
      return;
    await replay.control("seek", selected.start);
  };
  const startLoop = async () => {
    if (range.error || rangeChanged) return;
    await replay.play(state.source, state.rate, {
      start: range.start,
      end: range.end,
    });
  };
  return (
    <details
      className="history-replay-range replay-editor"
      open={state.rangeOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== store.getSnapshot().rangeOpen)
          store.update({ rangeOpen: open });
      }}
    >
      <summary>
        小节定位与循环回放
        {replay.loop
          ? ` · ${replay.loop.start.toFixed(2)}–${replay.loop.end.toFixed(2)} 秒 · 已循环 ${replay.loopRounds} 次`
          : ""}
      </summary>
      <div className="replay-editor-body">
        {rangeChanged && (
          <div className="replay-editor-conflict" role="status">
            <strong>
              {state.rangeSource?.performanceRevision
                ? "演奏资料已有更新"
                : "这份范围尚未记录演奏版本"}
            </strong>
            <p>
              原起止秒数继续保留。可重新采用小节范围，或核对秒数后沿用当前输入。
            </p>
            <button
              disabled={editingBlocked}
              onClick={() => store.adoptRangeSource(replay.historySource!)}
            >
              保留秒数，采用当前演奏版本
            </button>
          </div>
        )}
        <div className="replay-range-navigation">
          <label>
            演奏第{" "}
            <input
              type="text"
              inputMode="numeric"
              maxLength={128}
              aria-label={`${prefix}回放小节`}
              aria-invalid={measure === null}
              aria-describedby={measureErrorId}
              value={state.range.measure}
              disabled={editingBlocked}
              onChange={(event) => change("measure", event.target.value)}
            />{" "}
            小节
          </label>
          <label>
            第{" "}
            <input
              type="text"
              inputMode="numeric"
              maxLength={128}
              aria-label={`${prefix}回放小节次数`}
              aria-invalid={occurrence === null}
              aria-describedby={measureErrorId}
              value={state.range.occurrence}
              disabled={editingBlocked}
              onChange={(event) => change("occurrence", event.target.value)}
            />{" "}
            次
          </label>
          <button
            disabled={editingBlocked || !selected || archiveEnd <= 0}
            onClick={() => pickSpan(selectedIndex)}
          >
            {exact ? "采用小节范围" : "采用参考范围"}
          </button>
          <button
            disabled={playbackBlocked || !selected}
            onClick={() => void locate()}
          >
            {exact ? "跳到小节起点" : "跳到参考起音"}
          </button>
        </div>
        <div className="replay-editor-actions" aria-label="依次选择演奏小节">
          <button
            disabled={editingBlocked || selectedIndex <= 0}
            onClick={() => pickSpan(selectedIndex - 1)}
          >
            上一个演奏小节
          </button>
          <button
            disabled={
              editingBlocked ||
              !spans.length ||
              selectedIndex >= spans.length - 1
            }
            onClick={() => pickSpan(selectedIndex + 1)}
          >
            下一个演奏小节
          </button>
          <span className="replay-editor-hint">
            {selected
              ? `第 ${selectedIndex + 1} / ${spans.length} 个演奏小节`
              : `已保留 ${spans.length} 个演奏小节范围`}
          </span>
        </div>
        {(measure === null || occurrence === null || !selected) && (
          <p id={measureErrorId} className="replay-editor-hint">
            {measure === null || occurrence === null
              ? "小节和次数请输入大于 0 的整数。"
              : "这次演奏没有所选小节次数的范围，可直接填写起点和终点。"}
          </p>
        )}
        <div className="replay-range-fields">
          <label>
            起点（秒）
            <div className="replay-range-field">
              <input
                type="text"
                inputMode="decimal"
                maxLength={128}
                aria-label={`${prefix}回放循环起点`}
                aria-invalid={!!range.error}
                aria-describedby={range.error ? rangeErrorId : undefined}
                value={state.range.start}
                disabled={editingBlocked}
                onChange={(event) => change("start", event.target.value)}
              />
              <button
                disabled={editingBlocked || playbackBlocked}
                onClick={() =>
                  change("start", String(Number(replay.position.toFixed(3))))
                }
              >
                取当前位置
              </button>
            </div>
          </label>
          <label>
            终点（秒）
            <div className="replay-range-field">
              <input
                type="text"
                inputMode="decimal"
                maxLength={128}
                aria-label={`${prefix}回放循环终点`}
                aria-invalid={!!range.error}
                aria-describedby={range.error ? rangeErrorId : undefined}
                value={state.range.end}
                disabled={editingBlocked}
                onChange={(event) => change("end", event.target.value)}
              />
              <button
                disabled={editingBlocked || playbackBlocked}
                onClick={() =>
                  change("end", String(Number(replay.position.toFixed(3))))
                }
              >
                取当前位置
              </button>
            </div>
          </label>
        </div>
        {range.error && (
          <p id={rangeErrorId} className="replay-editor-hint">
            {range.error}
          </p>
        )}
        <div className="replay-editor-actions">
          <button
            className="replay-editor-primary"
            disabled={
              replay.busy || !!range.error || editingBlocked || rangeChanged
            }
            onClick={() => void startLoop()}
          >
            {attached ? "循环回放选段" : "从选段开始循环听"}
          </button>
          <button
            disabled={playbackBlocked || !replay.loop}
            onClick={() =>
              void replay.control("loop", 0, {
                end: replay.end,
                enabled: false,
              })
            }
          >
            关闭回放循环
          </button>
          <button
            disabled={editingBlocked || archiveEnd <= 0}
            onClick={() => store.pick(0, archiveEnd, replay.historySource)}
          >
            采用整次演奏范围
          </button>
          {!range.error && (
            <span className="replay-editor-hint">
              选段长 {(range.end - range.start).toFixed(3)} 秒
            </span>
          )}
        </div>
        <p className="replay-editor-hint">
          {exact
            ? "按当轮保存的小节边界定位，休止小节也可选择；等音等待包含在该小节时长内。"
            : "旧记录按首个保留参考起音定位，范围到下一小节的首个参考起音。"}
          循环终点不播放，跨界持音在起点重新建立。
        </p>
        {selected?.partial && (
          <p className="replay-editor-hint">
            本次只演奏了所选小节的一部分，采用范围仅包含已演奏部分。
          </p>
        )}
        <HistoryReplayClips
          replay={replay}
          duration={archiveEnd}
          rangeContextVisible
          refreshSource={refreshSource}
        />
      </div>
    </details>
  );
}
