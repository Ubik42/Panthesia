import { useMemo, useSyncExternalStore } from "react";
import type { LoadedSong } from "../../api";
import { scoreExportSlot } from "./scoreExportStore";

export function ScoreExportButton({
  song,
  disabled,
  expanded,
  open,
}: {
  song: LoadedSong;
  disabled?: boolean;
  expanded: boolean;
  open: () => void;
}) {
  const slot = useMemo(
    () => scoreExportSlot(song.engineId, song.contentId, { title: song.title, path: song.sourcePath }),
    [song.engineId, song.contentId],
  );
  const snapshot = () => {
    const state = slot.getSnapshot();
    if (state.busy || state.submitting) return state.job ? "制作中" : "处理中";
    if (state.saving) return "保存中";
    if (state.job) return "待查看";
    if (state.error) return "需处理";
    if (state.artifact)
      return state.artifact.savedPath ? "已另存" : "成品待保存";
    const pending = state.items.filter(
      (item) => item.contentId === song.contentId && !item.savedPath,
    ).length;
    return pending ? `${pending} 份成品` : "";
  };
  const label = useSyncExternalStore(slot.subscribe, snapshot, snapshot);
  const detail =
    label === "制作中" || label === "待查看"
      ? "原制作任务保留，可以继续读取进度或取消"
      : label === "成品待保存"
        ? "已保留制作完成时的个人标记谱，可以直接另存"
        : "制作个人指法、分手和持音换指的 MusicXML 副本，管理本次打开软件时保留的成品";
  return (
    <button
      disabled={disabled}
      onClick={open}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label="导出标记谱"
      title={detail}
    >
      导出标记谱
      {label && (
        <span
          aria-hidden="true"
          className={`preparation-button-status ${label === "成品待保存" || label === "需处理" ? "needs-review" : ""}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}
