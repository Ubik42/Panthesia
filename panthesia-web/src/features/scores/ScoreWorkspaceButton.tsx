import { useMemo, useSyncExternalStore } from "react";
import type { LoadedSong } from "../../api";
import type { ScoreWorkspaceStore } from "./scoreWorkspaceStore";

const emptySubscribe = () => () => {};
export function ScoreWorkspaceButton({
  store,
  song,
  disabled,
  expanded,
  open,
}: {
  store: ScoreWorkspaceStore;
  song: LoadedSong | null;
  disabled?: boolean;
  expanded?: boolean;
  open: () => void;
}) {
  const slot = useMemo(
    () =>
      song
        ? store.forSource({
            engineId: song.engineId ?? undefined,
            contentId: song.contentId,
            scoreRevision: song.scoreRevision ?? 0,
            title: song.title,
            path: song.sourcePath,
          })
        : undefined,
    [store, song?.engineId, song?.contentId],
  );
  // Only the small label subscribes. Progress does not redraw the piano workspace.
  const snapshot = () => {
    const state = slot?.getSnapshot();
    if (!state) return "";
    if (
      state.jobBusy ||
      state.submissionPending ||
      state.pdfBusy ||
      state.pdfSubmission ||
      state.pdfAdopting
    )
      return "处理中";
    if (state.refreshPending) return "已保存";
    if (
      state.pendingDraft ||
      state.filePreview ||
      (state.pdfLast &&
        (!state.pdfLast.paperId || state.pdfLast.adoptionPending))
    )
      return "待核对";
    if (state.job || state.pdfJob) return "待查看";
    if (
      state.error ||
      state.draftIssues.length ||
      state.pdfError ||
      state.pdfIssues.length
    )
      return "需处理";
    if (
      state.pdfDrafts.some(
        (draft) => draft.contentId === state.source.contentId && !draft.paperId,
      )
    )
      return "有 PDF 初稿";
    if (state.drafts.length) return `${state.drafts.length} 份初稿`;
    return "";
  };
  const label = useSyncExternalStore(
    slot?.subscribe ?? emptySubscribe,
    snapshot,
    snapshot,
  );
  const detail =
    label === "处理中"
      ? "当前曲目的谱面任务正在处理，可以打开查看进度或取消"
      : label === "已保存"
        ? "谱面操作结果已保存，可以打开重新读取界面资料"
        : label === "待核对"
          ? "当前曲目保留了初稿，打开后可以继续核对与保存"
          : label === "待查看"
            ? "原谱面请求保留，打开后可以继续读取原任务"
            : label === "需处理"
              ? "上次谱面操作需要处理，打开查看具体信息"
              : "管理当前曲目的谱面版本、原谱与本机保留初稿";
  return (
    <button
      disabled={disabled || !song}
      onClick={open}
      aria-label="谱面管理"
      aria-description={detail}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={detail}
    >
      谱面管理
      {label && (
        <span
          aria-hidden="true"
          className={`preparation-button-status ${label === "待核对" || label === "需处理" ? "needs-review" : ""}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}
