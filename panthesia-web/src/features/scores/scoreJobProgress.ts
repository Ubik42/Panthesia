import type { ScoreJobStatus } from "../../engine/commands.generated";

/** Progress snapshots retain status; file payloads stay in their owning result slots. */
export type ScoreJobProgress = Omit<
  ScoreJobStatus,
  "draft" | "pdf" | "preparedExport" | "mediaExport"
>;
export function scoreJobProgress(status: ScoreJobStatus): ScoreJobProgress {
  const {
    draft: _draft,
    pdf: _pdf,
    preparedExport: _export,
    mediaExport: _media,
    ...progress
  } = status;
  return progress;
}
