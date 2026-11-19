import { useEffect, useSyncExternalStore } from "react";
import { getReplayEditor } from "./features/review/replayEditorStore";
import type { HistoryScoreReview } from "./historyScoreFocus";
import { useHistoryReplay } from "./useHistoryReplay";
import { HistoryReplayTransport } from "./HistoryReplayTransport";
import { TaskActivity } from "./engine/TaskActivity";
export function ScoreHistoryReplay({
  engineId,
  review,
  enabled,
  cursor,
  activity,
}: {
  engineId?: string;
  review: HistoryScoreReview;
  enabled: boolean;
  cursor: (position: number | null) => void;
  activity: (active: boolean) => void;
}) {
  const editor = getReplayEditor(review.contentId, review.historyId);
  const { source, rate } = useSyncExternalStore(
    editor.subscribe,
    editor.getPreferences,
    editor.getPreferences,
  );
  useEffect(() => {
    if (editor.getSnapshot().title !== review.title)
      editor.update({ title: review.title });
  }, [editor, review.title]);
  const replay = useHistoryReplay(
    review.contentId,
    review.historyId,
    enabled,
    cursor,
    activity,
    engineId,
    review.source,
  );
  const attached = replay.phase !== "idle",
    playing = replay.phase === "running" || replay.phase === "paused";
  return (
    <div aria-label="谱面历史声音回放">
      <div className="score-review-replay">
        <label>
          回放{" "}
          <select
            aria-label="谱面回放来源"
            value={source}
            disabled={attached || replay.busy}
            onChange={(e) =>
              editor.update({
                source: e.target.value as "actual" | "reference",
              })
            }
          >
            <option value="actual">实际演奏</option>
            <option value="reference">当轮参考音</option>
          </select>
        </label>
        <label>
          速度{" "}
          <select
            aria-label="谱面回放速度"
            value={rate}
            disabled={replay.busy}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (attached)
                void replay.control("rate", value).then((ok) => {
                  if (ok) editor.update({ rate: value });
                });
              else editor.update({ rate: value });
            }}
          >
            {[0.25, 0.5, 0.75, 1].map((n) => (
              <option key={n} value={n}>
                {n * 100}%
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!enabled || replay.busy || playing}
          onClick={() => void replay.play(source, rate)}
        >
          {replay.busy && !attached ? "正在准备回放…" : "随谱回放"}
        </button>
        <button
          disabled={!attached && !replay.busy && !replay.stopPending}
          onClick={() => void replay.stop()}
        >
          {replay.stopPending ? "重试停止回放" : "停止回放"}
        </button>
      </div>
      {replay.busy && <TaskActivity contentId={review.contentId} />}
      <HistoryReplayTransport
        duration={review.duration}
        replay={replay}
        prefix="谱面"
        references={review.notes}
        measures={review.measures}
      />
      {replay.error && <span role="alert">{replay.error}</span>}
      {replay.sourceIssue && (
        <p role="status">
          可用上方“返回原演奏记录”重新读取资料，再打开谱面批阅。
        </p>
      )}
    </div>
  );
}
