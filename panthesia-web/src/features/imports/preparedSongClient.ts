import { api, type LoadedSong, type Snapshot } from "../../api";
import type {
  ImportedSong,
  MusicReceipt,
} from "../../engine/commands.generated";
import {
  awaitMusicPreparation,
  CancelledMusicImport,
  PendingMusicImport,
  readPreviousMusicResult,
  checkMusicReceipt,
  type MusicPreparationOptions,
} from "./musicImportClient";

interface Operation {
  kind: "exercise" | "package";
  name: string;
  expectedEngineId?: string;
  supported: (state: Snapshot) => boolean;
  submit: (
    engineId: string,
    requestId: string,
    createdAtMs: number,
  ) => Promise<MusicReceipt>;
  legacy: (engineId: string | undefined) => Promise<LoadedSong>;
}
export const compactPreparedSong = (song: LoadedSong): ImportedSong => ({
  contentId: song.contentId,
  title: song.title,
  sourcePath: song.sourcePath,
  importWarnings: song.importWarnings ?? [],
  catalogOnly: false,
});

/** Generated and staged sources share one lifecycle, without replaying an uncertain commit. */
export async function prepareSongOperation(
  operation: Operation,
  options: MusicPreparationOptions = {},
): Promise<ImportedSong> {
  let receipt = options.receipt;
  const cancelled = () =>
    new CancelledMusicImport(`后台任务已取消，${operation.name}的原有选择保留`);
  if (options.signal?.aborted) {
    if (receipt)
      throw new PendingMusicImport(
        "已停止等待读取，请继续读取原请求。",
        receipt,
      );
    throw cancelled();
  }
  const state = await api.state().catch((failure: unknown) => {
    if (receipt)
      throw new PendingMusicImport(
        `原请求保留，练习室状态读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
        receipt,
      );
    throw failure;
  });
  if (
    !receipt &&
    operation.expectedEngineId &&
    operation.expectedEngineId !== state.stateOrder?.engineId
  )
    throw new Error("练习室连接已改变，请重新读取曲目包预览，再确认导入。");
  if (receipt && receipt.engineId !== state.stateOrder?.engineId) {
    if ((state.musicImportVersion ?? 0) >= 3)
      return readPreviousMusicResult(receipt, options);
    throw new PendingMusicImport(
      `练习室已重新启动，请先核对已有${operation.name}结果，再重新处理。`,
      receipt,
    );
  }
  if (
    !receipt &&
    (state.storage?.operation ||
      state.storage?.error ||
      state.recording ||
      state.startup?.ready === false)
  )
    throw new Error(`请先结束录音、保存或恢复，再处理${operation.name}。`);
  if (options.signal?.aborted) throw cancelled();
  if (!state.stateOrder?.engineId || !operation.supported(state))
    return compactPreparedSong(
      await operation.legacy(state.stateOrder?.engineId),
    );
  const publish = async (next: MusicReceipt) => {
    if (receipt) next = checkMusicReceipt(receipt, next);
    receipt = next;
    await options.changed?.(next);
  };
  let sent = !!receipt;
  try {
    if (receipt) {
      if (receipt.kind !== operation.kind)
        throw new Error(
          `原请求属于其他操作，请重新读取${operation.name}窗口。`,
        );
      await publish(await api.readMusicImport(receipt.id));
      if (receipt.phase === "uploading")
        await publish(await api.finishMusicImport(receipt.id));
    } else {
      const requestId = `p2-${crypto.randomUUID()}`;
      const engineId = state.stateOrder.engineId;
      await publish({
        id: `${engineId}-${requestId}`,
        engineId,
        name: operation.name,
        kind: operation.kind,
        phase: "uploading",
        size: 0,
        received: 0,
        taskId: null,
        song: null,
        error: null,
        cancellable: true,
        catalogOnly: false,
      });
      if (options.signal?.aborted) throw cancelled();
      sent = true;
      await publish(await operation.submit(engineId, requestId, Date.now()));
    }
    return await awaitMusicPreparation(receipt!, {
      signal: options.signal,
      changed: publish,
    });
  } catch (failure) {
    if (!receipt || (!sent && failure instanceof CancelledMusicImport))
      throw failure;
    if (!["done", "error", "cancelled"].includes(receipt.phase)) {
      try {
        await publish(await api.readMusicImport(receipt.id));
      } catch {
        /* Keep the original identity even if observation fails. */
      }
    }
    if (receipt.phase === "done" && receipt.song) return receipt.song;
    if (receipt.phase === "cancelled") throw cancelled();
    if (receipt.phase === "error")
      throw new Error(receipt.error || `${operation.name}准备失败`);
    throw new PendingMusicImport(
      `${operation.name}结果待确认：${failure instanceof Error ? failure.message : String(failure)}。请继续读取原请求。`,
      receipt,
    );
  }
}
