import type { WorkEntry, WorkSource, WorkTarget } from "./workProgressStore";
import type { LoadedSong, Snapshot } from "../../api";
import type { createScoreWorkspaceStore } from "../scores/scoreWorkspaceStore";
import type { ScoreToolRequest } from "../scores/scoreToolRequest";
export type WorkOpenResult = { ok: boolean; error?: string };
type SourceEditor = "passage" | "hands" | "meter";
type SimpleTarget =
  "imports" | "package" | "backup" | "devices" | "exercise" | "drafts";
export interface WorkNavigationHost {
  unavailable: (target: WorkTarget) => string | null;
  prepare: (source: WorkSource, signal: AbortSignal) => Promise<boolean>;
  current: () => LoadedSong | null;
  snapshot: () => Snapshot;
  scores: ReturnType<typeof createScoreWorkspaceStore>;
  openEditor: (target: SourceEditor, signal: AbortSignal) => Promise<boolean>;
  openScores: () => void;
  openScore: (request: ScoreToolRequest | null) => void;
  openSimple: (target: SimpleTarget) => void;
  openInterface: () => void;
  browsePending: (
    id: string | undefined,
    signal: AbortSignal,
  ) => Promise<boolean>;
  openMedia: (entry: WorkEntry & { source: WorkSource }) => void;
  done: () => void;
}
/** Background receipts select an existing product page/editor; they never revive old workspaces. */
export async function openWorkEntry(
  entry: WorkEntry,
  signal: AbortSignal,
  host: WorkNavigationHost,
): Promise<WorkOpenResult> {
  if (signal.aborted)
    return { ok: false, error: "已取消打开，原任务继续保留。" };
  const unavailable = host.unavailable(entry.target);
  if (unavailable) return { ok: false, error: unavailable };
  if (["scores", "score", "passage", "hands", "meter"].includes(entry.target)) {
    if (!entry.source)
      return {
        ok: false,
        error: "任务缺少来源曲目，请从选曲页打开原曲目后继续。",
      };
    if (!(await host.prepare(entry.source, signal)) || signal.aborted)
      return { ok: false, error: "来源曲目尚未打开，任务进度继续保留。" };
    const current = host.current();
    if (!current || current.contentId !== entry.source.contentId)
      return { ok: false, error: "当前曲目已改变，请重新接续原任务。" };
    if (
      entry.target === "passage" ||
      entry.target === "hands" ||
      entry.target === "meter"
    ) {
      if (!(await host.openEditor(entry.target, signal)))
        return { ok: false, error: "当前练习仍在处理，完成后可继续原输入。" };
    } else if (entry.target === "scores") {
      if (entry.stale && entry.restoreScoreKey) {
        const actual = host.snapshot();
        host.scores.recoverPreview(entry.restoreScoreKey, {
          contentId: current.contentId,
          engineId: actual.stateOrder?.engineId,
          scoreRevision: actual.scoreRevision ?? 0,
          title: entry.source.title,
          path: current.sourcePath || entry.source.path,
        });
      }
      host.openScores();
    } else {
      host.openScore(
        entry.scoreTool
          ? {
              id: crypto.randomUUID(),
              contentId: current.contentId,
              engineId: host.snapshot().stateOrder?.engineId,
              kind: entry.scoreTool,
              sourceFingerprint: entry.sourceFingerprint,
            }
          : null,
      );
    }
  } else if (entry.target === "interface-settings") host.openInterface();
  else if (entry.target === "library-open") {
    if (!(await host.browsePending(entry.libraryOpenId, signal)))
      return { ok: false, error: "当前页面仍在处理，可稍后接续曲目打开进度。" };
  } else if (entry.target === "media") {
    if (!entry.source)
      return {
        ok: false,
        error: "导出任务缺少来源曲目，请重新选择要导出的歌曲。",
      };
    host.openMedia({ ...entry, source: entry.source });
  } else
    switch (entry.target) {
      case "imports":
      case "package":
      case "devices":
      case "exercise":
      case "drafts":
        host.openSimple(entry.target);
        break;
      default:
        return {
          ok: false,
          error: "此任务的接续入口暂不可用，原输入继续保留。",
        };
    }
  host.done();
  return { ok: true };
}
