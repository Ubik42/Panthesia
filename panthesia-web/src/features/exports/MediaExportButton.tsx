import { useMemo, useSyncExternalStore } from "react";
import type { MediaExportKind } from "../../engine/commands.generated";
import { mediaExportSlot, type MediaExportSource } from "./mediaExportStore";
const empty = () => () => {};
export function MediaExportButton({
  source,
  kind,
  disabled,
  open,
}: {
  source: MediaExportSource | null;
  kind: MediaExportKind;
  disabled?: boolean;
  open: () => void;
}) {
  const slot = useMemo(
    () => (source ? mediaExportSlot(source, kind) : undefined),
    [source?.engineId, source?.contentId, kind],
  );
  const snapshot = () => {
    const state = slot?.getSnapshot();
    if (!state) return "";
    if (state.busy || state.submitting)
      return state.action === "save" ? "保存中" : "制作中";
    if (state.job) return "待查看";
    if (state.error) return "需处理";
    if (state.artifact)
      return state.artifact.savePendingPath ||
        state.artifact.previousPendingPaths?.length
        ? "待确认"
        : state.artifact.savedPath
          ? "已另存"
          : "有成品";
    return "";
  };
  const label = useSyncExternalStore(
    slot?.subscribe ?? empty,
    snapshot,
    snapshot,
  );
  return (
    <button
      disabled={disabled || !source}
      onClick={open}
      aria-haspopup="dialog"
    >
      {kind === "practiceMidi" ? "导出练习版 MIDI" : kind === "midi" ? "导出原始 MIDI" : "导出当前曲目包"}
      {label && (
        <span
          className={`preparation-button-status ${label === "需处理" || label === "待确认" ? "needs-review" : ""}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}
