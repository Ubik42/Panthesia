import { ArrowRight, ListMusic, Check, FolderSearch } from "lucide-react";
import type { CollectionSong } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { useMemo, useSyncExternalStore } from "react";
import { nextAvailableQueueSong } from "./practicePresentation";
import "./practiceQueue.css";

interface QueueContext {
  contentId: string | null;
  recording: boolean;
  status: string;
  mode: string;
  plan: boolean;
  saveFirst: boolean;
}
function queueContextReader(store: PlaybackStore) {
  let cached: QueueContext | undefined;
  return () => {
    const state = store.getSnapshot();
    const value: QueueContext = {
      contentId: state.contentId,
      recording: state.recording,
      status: state.status,
      mode: state.mode,
      plan: !!state.routine || !!state.ladder?.active,
      saveFirst:
        !state.saved &&
        state.mode !== "listen" &&
        state.score.matched_notes +
          state.score.wrong_notes +
          state.score.missed_notes >
          0,
    };
    if (
      !cached ||
      (Object.keys(value) as (keyof QueueContext)[]).some(
        (key) => value[key] !== cached![key],
      )
    )
      cached = value;
    return cached;
  };
}
export function PracticeQueueStrip({
  store,
  queue,
  busy,
  connected,
  open,
  manage,
  repair,
}: {
  store: PlaybackStore;
  queue: readonly CollectionSong[];
  busy: boolean;
  connected: boolean;
  open: (song: CollectionSong) => Promise<boolean>;
  manage: () => void;
  repair: () => void;
}) {
  const readContext = useMemo(() => queueContextReader(store), [store]);
  const state = useSyncExternalStore(store.subscribe, readContext, readContext);
  if (!queue.length) return null;
  const index = queue.findIndex((song) => song.contentId === state.contentId);
  const following = nextAvailableQueueSong(queue, state.contentId);
  const { saveFirst, plan } = state;
  const recital =
    ["recital", "memory"].includes(state.mode) &&
    ["playing", "paused", "countIn"].includes(state.status);
  const unavailable = !connected
    ? "练习室重新连接后，可继续队列。"
    : state.recording
      ? "请先停止并保存当前录音。"
      : plan
        ? "请先结束当前计划项目或速度阶梯，再切换队列曲目。"
        : recital
          ? "完整演奏结束后可继续下一首。"
          : busy
            ? "当前操作完成后，可继续下一首。"
            : null;
  return (
    <section className="practice-queue-strip" aria-label="练习队列">
      <button
        className="practice-queue-summary"
        onClick={manage}
        aria-label={`查看练习队列，${index >= 0 ? `当前第 ${index + 1} 首，共 ${queue.length} 首` : `共 ${queue.length} 首`}`}
      >
        <ListMusic size={17} />
        <span>练习队列</span>
        <strong>
          {index >= 0 ? `${index + 1} / ${queue.length}` : `${queue.length} 首`}
        </strong>
      </button>
      {following.song ? (
        <button
          className="practice-queue-next"
          disabled={!!unavailable}
          title={
            unavailable ||
            `${saveFirst ? "先保存本轮，再打开" : "打开下一首"}：${following.song.title}`
          }
          onClick={() => {
            if (following.song) void open(following.song);
          }}
        >
          <span>
            <small>{saveFirst ? "保存本轮，继续下一首" : "下一首"}</small>
            <strong>{following.song.title}</strong>
          </span>
          <ArrowRight size={17} />
        </button>
      ) : (
        <span
          className="practice-queue-end"
          data-needs-repair={!!following.skipped || undefined}
        >
          {following.skipped ? <FolderSearch size={15} /> : <Check size={15} />}
          {following.skipped ? "后续曲目需要定位文件" : "已到队列末尾"}
        </span>
      )}
      {following.skipped > 0 && (
        <button
          className="practice-queue-repair"
          onClick={repair}
          title="在曲库中重新定位文件"
        >
          <FolderSearch size={14} />
          {following.skipped} 首待定位
        </button>
      )}
    </section>
  );
}
