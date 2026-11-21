import { api } from "../../api";
import type { MusicReceipt } from "../../engine/commands.generated";
import {
  musicImportMessage,
  checkMusicReceipt,
} from "../imports/musicImportClient";
import { readPreparedSong } from "../imports/preparationPersistence";
import type { WorkSources } from "./workProgressStore";

export interface BackgroundRead {
  id: string;
  engineId: string;
  available: () => boolean;
  read: (valid: () => boolean) => Promise<number | void>;
  issue: (message: string) => void;
}
const pending = (phase: string) =>
  ["uploading", "queued", "running", "committing", "unconfirmed"].includes(
    phase,
  );
const identity = (before: MusicReceipt, next: MusicReceipt) =>
  before.id === next.id &&
  before.engineId === next.engineId &&
  before.kind === next.kind;
/** Observe admitted preparation requests. File transfer, requeue and opening results remain explicit actions. */
export function pendingPreparationReads(
  sources: WorkSources,
  engineId: string,
): BackgroundRead[] {
  const reads: BackgroundRead[] = [];
  const add = (
    receipt: MusicReceipt | undefined,
    available: () => boolean,
    apply: (next: MusicReceipt) => void,
    issue: (message: string) => void,
  ) => {
    if (!receipt || receipt.engineId !== engineId || !pending(receipt.phase))
      return;
    reads.push({
      id: receipt.id,
      engineId,
      available,
      issue,
      read: async (valid) => {
        const next = checkMusicReceipt(
          receipt,
          await api.readMusicImport(receipt.id),
        );
        if (!valid() || !available()) return;
        if (!identity(receipt, next))
          throw new Error("原请求的来源回复不一致，请返回原工作台核对。");
        if (next.phase === "done" && !readPreparedSong(next.song))
          throw new Error("任务已结束，曲目结果尚未完整读取。原请求继续保留。");
        apply(next);
        return next.phase === "uploading" || next.phase === "unconfirmed"
          ? 15_000
          : 1000;
      },
    });
  };
  for (const item of sources.imports.getSnapshot().items) {
    if (item.state === "done") continue;
    const available = () =>
      !sources.imports.getSnapshot().busy &&
      sources.imports
        .getSnapshot()
        .items.some(
          (row) =>
            row.id === item.id &&
            row.receipt?.id === item.receipt?.id &&
            row.state !== "done",
        );
    add(
      item.receipt,
      available,
      (next) => {
        const message = musicImportMessage(next);
        if (next.phase === "done" && next.song)
          sources.imports.complete(item.id, next.song, next);
        else
          sources.imports.patch(item.id, {
            receipt: next,
            state:
              next.phase === "cancelled"
                ? "pending"
                : next.phase === "error"
                  ? "error"
                  : "review",
            message,
          });
      },
      (message) => {
        if (available()) sources.imports.patch(item.id, { message });
      },
    );
  }
  const piece = sources.piecePackage.getSnapshot();
  const pieceAvailable = () =>
    !sources.piecePackage.getSnapshot().busy &&
    sources.piecePackage.getSnapshot().receipt?.id === piece.receipt?.id &&
    !sources.piecePackage.getSnapshot().result;
  if (!piece.result)
    add(
      piece.receipt,
      pieceAvailable,
      (next) => {
        const current = sources.piecePackage.getSnapshot();
        if (
          next.phase === "done" &&
          current.summary &&
          next.song?.contentId !== current.summary.contentId
        )
          throw new Error(
            "曲目包结果与原预览的来源不同，请返回曲目包工作台核对。",
          );
        if (
          JSON.stringify(current.receipt) === JSON.stringify(next) &&
          !current.error
        )
          return;
        sources.piecePackage.update({
          receipt: next,
          phase:
            next.phase === "done"
              ? "ready"
              : next.phase === "cancelled"
                ? "preview"
                : next.phase === "error"
                  ? "error"
                  : "review",
          result: next.song ?? undefined,
          error:
            next.phase === "error" || next.phase === "unconfirmed"
              ? next.error || musicImportMessage(next)
              : "",
          message: musicImportMessage(next),
          ...(next.phase === "done" ? { refreshPending: true } : {}),
        });
      },
      (message) => {
        if (
          pieceAvailable() &&
          sources.piecePackage.getSnapshot().error !== message
        )
          sources.piecePackage.update({ error: message });
      },
    );
  const exercise = sources.exercise.getSnapshot();
  const exerciseAvailable = () =>
    !sources.exercise.getSnapshot().busy &&
    sources.exercise.getSnapshot().receipt?.id === exercise.receipt?.id &&
    !sources.exercise.getSnapshot().result;
  if (!exercise.result)
    add(
      exercise.receipt,
      exerciseAvailable,
      (next) => {
        const current = sources.exercise.getSnapshot();
        if (
          JSON.stringify(current.receipt) === JSON.stringify(next) &&
          !current.error
        )
          return;
        sources.exercise.update({
          receipt: next,
          phase:
            next.phase === "done"
              ? "ready"
              : next.phase === "cancelled"
                ? "editing"
                : next.phase === "error"
                  ? "error"
                  : "review",
          result: next.song ?? undefined,
          error:
            next.phase === "error" || next.phase === "unconfirmed"
              ? next.error || musicImportMessage(next)
              : "",
          message: musicImportMessage(next),
          ...(next.phase === "done"
            ? { dirty: false, refreshPending: true }
            : {}),
        });
      },
      (message) => {
        if (
          exerciseAvailable() &&
          sources.exercise.getSnapshot().error !== message
        )
          sources.exercise.update({ error: message });
      },
    );
  return reads;
}
