import { useSyncExternalStore } from "react";
import type { ImportQueueStore } from "./importQueueStore";
import { importNeedsFile } from "./importQueueModel";
import { getImportQueueRunner } from "./importQueueRunner";
import { LoaderCircle, ArrowUpRight } from "lucide-react";

/** Subscribe to counts only; file-transfer progress does not redraw the application. */
export function ImportQueueButton({
  queue,
  open,
}: {
  queue: ImportQueueStore;
  open: () => void;
}) {
  const snapshot = () => {
    const state = queue.getSnapshot();
    return `${state.items.filter((item) => item.state !== "done").length}:${state.items.filter((item) => item.state === "review").length}:${state.refreshPending ? 1 : 0}:${state.busy ? 1 : 0}:${state.items.filter(importNeedsFile).length}:${state.storageError ? 1 : 0}`;
  };
  const [remaining, review, refresh, busy, missing, storage] =
    useSyncExternalStore(queue.subscribe, snapshot, snapshot)
      .split(":")
      .map(Number);
  return (
    <button
      onClick={open}
      className={review || storage ? "import-queue-attention" : undefined}
      title={
        storage
          ? "队列暂存需要处理，可打开导入窗口查看原记录。"
          : busy
            ? "文件正在后台导入，可返回查看进度或暂停。"
            : review
              ? `${review} 个文件的导入结果需要确认，原请求已保留`
              : missing
                ? `${missing} 份文件可补选原件后接续，已有结果可直接读取。`
                : remaining
                  ? "继续处理已保留的导入队列"
                  : refresh
                    ? "文件已保存，可以重新读取导入结果与曲库"
                    : "导入 MIDI、MusicXML 或整理谱面配对"
      }
    >
      {busy
        ? `正在导入（${remaining}）`
        : remaining
          ? `继续导入（${remaining}）`
          : refresh
            ? "重读导入结果"
            : "导入曲目"}
      {review > 0 && (
        <span className="import-queue-count">待确认 {review}</span>
      )}
    </button>
  );
}

export function ImportQueueNotice({
  queue,
  open,
}: {
  queue: ImportQueueStore;
  open: () => void;
}) {
  const read = () => {
    const state = queue.getSnapshot(),
      active = state.items.find((item) => item.state === "working");
    return state.busy && active
      ? JSON.stringify([
          active.source.name,
          active.message,
          state.stopping,
          active.receipt?.catalogOnly === true,
        ])
      : "";
  };
  const value = useSyncExternalStore(queue.subscribe, read, read);
  if (!value) return null;
  const [name, message, stopping, catalogOnly] = JSON.parse(value) as [
    string,
    string,
    boolean,
    boolean,
  ];
  return (
    <section className="import-queue-notice" aria-label="后台导入进度">
      <LoaderCircle size={17} aria-hidden="true" />
      <div>
        <strong>正在导入：{name}</strong>
        <span role="status">{message}</span>
        <small>
          {catalogOnly
            ? "曲目先保存到曲库，当前练习继续保留。"
            : "处理期间可浏览曲库与回顾，完成或暂停后可继续演奏。"}
        </small>
      </div>
      <button
        disabled={stopping}
        onClick={() => getImportQueueRunner(queue).pause()}
      >
        {stopping ? "本文件结束后暂停" : "完成本文件后暂停"}
      </button>
      <button onClick={open}>
        <ArrowUpRight size={14} />
        查看导入
      </button>
    </section>
  );
}
