import { api, type LoadedSong } from "../../api";
import { readPreparedSong } from "./preparationPersistence";
import type {
  ImportedSong,
  MusicReceipt,
} from "../../engine/commands.generated";
export type {
  ImportedSong,
  MusicReceipt,
} from "../../engine/commands.generated";
export class PendingMusicImport extends Error {
  constructor(
    message: string,
    public receipt: MusicReceipt,
  ) {
    super(message);
    this.name = "PendingMusicImport";
  }
}
export class CancelledMusicImport extends Error {
  constructor(message = "后台任务已取消，原文件保留，可以继续导入") {
    super(message);
    this.name = "CancelledMusicImport";
  }
}
export interface MusicPreparationOptions {
  receipt?: MusicReceipt;
  signal?: AbortSignal;
  changed?: (receipt: MusicReceipt) => void | Promise<void>;
}
export function checkMusicReceipt(
  previous: MusicReceipt,
  next: MusicReceipt,
): MusicReceipt {
  // Cancellation before admission has a native tombstone with no file metadata.
  // Keep the original descriptor while displaying its deliberately uncertain result.
  if (
    next.id === previous.id &&
    next.engineId === previous.engineId &&
    next.kind === previous.kind &&
    next.phase === "unconfirmed" &&
    next.name === "待确认请求" &&
    next.size === 0 &&
    next.received === 0 &&
    !next.song &&
    !next.cancellable
  )
    next = {
      ...next,
      name: previous.name,
      size: previous.size,
      received: previous.received,
      catalogOnly: previous.catalogOnly ?? false,
    };
  if (
    next.id !== previous.id ||
    next.engineId !== previous.engineId ||
    next.kind !== previous.kind ||
    next.name !== previous.name ||
    next.size !== previous.size ||
    (next.catalogOnly ?? false) !== (previous.catalogOnly ?? false) ||
    (next.song &&
      (next.song.catalogOnly ?? false) !== (next.catalogOnly ?? false)) ||
    !Number.isSafeInteger(next.received) ||
    next.received < 0 ||
    next.received > next.size ||
    ![
      "uploading",
      "queued",
      "running",
      "committing",
      "done",
      "error",
      "cancelled",
      "unconfirmed",
    ].includes(next.phase) ||
    (next.song != null && !readPreparedSong(next.song)) ||
    (next.phase === "done" && !next.song) ||
    (previous.song &&
      next.song &&
      (previous.song.contentId !== next.song.contentId ||
        previous.song.sourcePath !== next.song.sourcePath))
  )
    throw new Error("导入回执与原文件或请求不一致，原记录继续保留。");
  if (previous.phase === "done" && next.phase !== "done") return previous;
  if (
    ["cancelled", "error"].includes(previous.phase) &&
    ["uploading", "queued", "running", "committing"].includes(next.phase)
  )
    return previous;
  if (
    previous.phase === "committing" &&
    ["uploading", "queued", "running"].includes(next.phase)
  )
    return previous;
  if (
    previous.phase === "running" &&
    ["uploading", "queued"].includes(next.phase)
  )
    return previous;
  if (previous.phase === "queued" && next.phase === "uploading")
    return previous;
  if (
    previous.phase === "uploading" &&
    next.phase === "uploading" &&
    next.received < previous.received
  )
    return previous;
  return next;
}

/** An old engine's settled result is read-only; it must never admit another write. */
export async function readPreviousMusicResult(
  receipt: MusicReceipt,
  options: MusicPreparationOptions = {},
): Promise<ImportedSong> {
  let latest = receipt;
  try {
    latest = checkMusicReceipt(receipt, await api.readMusicImport(receipt.id));
    await options.changed?.(latest);
  } catch (failure) {
    throw new PendingMusicImport(
      `原导入结果尚未读到：${failure instanceof Error ? failure.message : String(failure)}`,
      latest,
    );
  }
  if (latest.phase === "done" && latest.song) return latest.song;
  if (latest.phase === "cancelled")
    throw new CancelledMusicImport(latest.error || undefined);
  if (latest.phase === "error")
    throw new Error(latest.error || "原文件准备未完成，可以重新排队。");
  throw new PendingMusicImport(
    latest.error || "原准备中断，请先核对曲库中的保存结果，再重新排队。",
    latest,
  );
}

/** A fully transferred file can be observed and finished without its browser File. */
export async function resumeMusicImport(
  original: MusicReceipt,
  options: MusicPreparationOptions = {},
): Promise<ImportedSong> {
  if (!["midi", "score"].includes(original.kind))
    throw new Error("此请求属于其他工作台，请返回原入口读取结果。");
  let receipt = original;
  const publish = async (next: MusicReceipt) => {
    next = checkMusicReceipt(original, next);
    receipt = next;
    await options.changed?.(next);
  };
  try {
    cancelled(options.signal);
    const state = await api.state();
    if (original.catalogOnly && (state.musicImportVersion ?? 0) >= 4) {
      await publish(await api.readMusicImport(original.id));
      cancelled(options.signal);
      if (receipt.phase === "unconfirmed" && receipt.song) {
        await publish(await api.finishMusicImport(receipt.id));
      } else if (
        state.stateOrder?.engineId !== receipt.engineId &&
        receipt.phase !== "done"
      ) {
        return readPreviousMusicResult(receipt, options);
      }
    } else {
      if (state.stateOrder?.engineId !== original.engineId) {
        if ((state.musicImportVersion ?? 0) >= 3)
          return readPreviousMusicResult(original, options);
        throw new Error("练习室已重新启动，请先核对曲库中的结果，再重新排队。");
      }
      await publish(await api.readMusicImport(original.id));
    }
    cancelled(options.signal);
    if (receipt.phase === "uploading") {
      if (receipt.received < receipt.size)
        throw new PendingMusicImport(
          "文件尚未传完，请补选原文件后继续传输。",
          receipt,
        );
      await publish(await api.finishMusicImport(receipt.id));
    }
    return await awaitMusicPreparation(receipt, {
      ...options,
      changed: publish,
    });
  } catch (failure) {
    if (receipt.phase === "done" && receipt.song) return receipt.song;
    if (receipt.phase === "cancelled")
      throw new CancelledMusicImport(receipt.error || undefined);
    if (receipt.phase === "error")
      throw new Error(receipt.error || "文件导入失败");
    if (failure instanceof PendingMusicImport) throw failure;
    throw new PendingMusicImport(
      `原导入请求保留：${failure instanceof Error ? failure.message : String(failure)}`,
      receipt,
    );
  }
}
interface Options extends MusicPreparationOptions {
  bpm?: number;
}
export const musicImportMessage = (receipt: MusicReceipt) => {
  switch (receipt.phase) {
    case "uploading":
      return receipt.kind === "exercise"
        ? "练习参数已保留，等待生成"
        : receipt.kind === "package"
          ? "曲目包预览已保留，等待准备导入"
          : `正在传输 ${Math.round((receipt.received / Math.max(1, receipt.size)) * 100)}%`;
    case "queued":
      return receipt.kind === "exercise"
        ? "等待后台生成技术练习"
        : "等待后台导入";
    case "running":
      return receipt.kind === "exercise"
        ? "正在生成演奏、指法与恢复资料"
        : "正在读取与整理曲目";
    case "committing":
      return "正在保存，完成后可继续";
    case "done":
      return (
        receipt.error ||
        (receipt.song?.importWarnings?.length
          ? `已保存，附带 ${receipt.song.importWarnings.length} 条导入提示`
          : "") ||
        (receipt.kind === "exercise"
          ? "技术练习已生成，可以打开练习"
          : receipt.kind === "package"
            ? "曲目包已保存，可以打开练习"
            : "已保存到本地曲库")
      );
    case "cancelled":
      return (
        receipt.error ||
        (receipt.kind === "exercise"
          ? "已取消，练习参数保留"
          : "已取消，原文件保留")
      );
    case "error":
      return receipt.error || "准备失败，原有文件和参数保留";
    case "unconfirmed":
      return receipt.error || "保存结果待确认，请重新读取回执";
  }
};
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledMusicImport();
}
function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledMusicImport());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new CancelledMusicImport());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
/** Polling only observes the admitted operation; it never creates or repeats a write. */
export async function awaitMusicPreparation(
  initial: MusicReceipt,
  options: MusicPreparationOptions = {},
): Promise<ImportedSong> {
  let receipt = initial;
  const deadline = performance.now() + 120000;
  while (true) {
    cancelled(options.signal);
    if (receipt.phase === "done" && receipt.song) return receipt.song;
    if (receipt.phase === "cancelled")
      throw new CancelledMusicImport(
        receipt.kind === "exercise"
          ? "后台任务已取消，练习参数保留"
          : undefined,
      );
    if (receipt.phase === "error")
      throw new Error(receipt.error || "曲目准备失败");
    if (
      receipt.phase === "unconfirmed" ||
      receipt.phase === "uploading" ||
      performance.now() > deadline
    )
      throw new PendingMusicImport(musicImportMessage(receipt), receipt);
    await wait(200, options.signal);
    const next = await api.readMusicImport(receipt.id);
    receipt = checkMusicReceipt(receipt, next);
    await options.changed?.(receipt);
  }
}
/** Resuming always reuses the same import identity. A late commit is never submitted twice. */
export async function importMusicFile(
  file: File,
  options: Options = {},
): Promise<ImportedSong> {
  const kind = /\.(musicxml|xml|mxl)$/i.test(file.name)
    ? "score"
    : /\.(mid|midi)$/i.test(file.name)
      ? "midi"
      : null;
  if (!kind) throw new Error("请选择 MIDI、MusicXML 或 MXL 文件");
  const limit = kind === "score" ? 4_000_000 : 32_000_000;
  if (!file.size || file.size > limit)
    throw new Error(`文件为空或超过 ${limit / 1_000_000} MB`);
  if (
    !file.name.trim() ||
    new TextEncoder().encode(file.name).length > 1024 ||
    file.name.includes("\0")
  )
    throw new Error("文件名无效或过长，请调整后重新添加。");
  if (
    !options.receipt &&
    kind === "score" &&
    (!Number.isInteger(options.bpm ?? 120) ||
      (options.bpm ?? 120) < 20 ||
      (options.bpm ?? 120) > 400)
  )
    throw new Error("乐谱默认速度应为 20 到 400 BPM");
  if (options.signal?.aborted && options.receipt)
    throw new PendingMusicImport(
      "已停止等待读取，请继续读取原导入结果。",
      options.receipt,
    );
  cancelled(options.signal);
  const state = await api.state().catch((failure: unknown) => {
    if (options.receipt)
      throw new PendingMusicImport(
        `原导入请求保留，练习室状态读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
        options.receipt,
      );
    throw failure;
  });
  const catalogOnly = (state.musicImportVersion ?? 0) >= 4;
  if (
    !options.receipt &&
    (state.storage?.operation ||
      state.storage?.error ||
      (!catalogOnly && state.recording) ||
      state.startup?.ready === false)
  )
    throw new Error("请先结束录音、保存或恢复，再继续导入");
  let receipt = options.receipt;
  if (receipt && state.stateOrder?.engineId !== receipt.engineId) {
    if (receipt.catalogOnly && (state.musicImportVersion ?? 0) >= 4)
      return resumeMusicImport(receipt, options);
    if ((state.musicImportVersion ?? 0) >= 3)
      return readPreviousMusicResult(receipt, options);
    throw new PendingMusicImport(
      "练习室已重启，请先核对曲库中的保存结果，再重新排队。",
      receipt,
    );
  }
  if (!state.stateOrder?.engineId || !state.musicImportVersion) {
    if (!api.desktop && file.size > 3_000_000)
      throw new Error("当前引擎版本只支持 3 MB 文件，请更新音乐引擎后继续。");
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const song = await api.commandForEngine<LoadedSong>(
      state.stateOrder?.engineId,
      kind === "midi"
        ? { type: "importMidi", bytes, name: file.name }
        : {
            type: "importScore",
            bytes,
            name: file.name,
            default_bpm: options.bpm ?? 120,
          },
    );
    return {
      contentId: song.contentId,
      title: song.title,
      sourcePath: song.sourcePath,
      importWarnings: song.importWarnings ?? [],
      catalogOnly: false,
    };
  }
  let submitted = false;
  const publish = async (value: MusicReceipt) => {
    if (receipt) value = checkMusicReceipt(receipt, value);
    receipt = value;
    await options.changed?.(value);
  };
  try {
    if (receipt) {
      await publish(await api.readMusicImport(receipt.id));
      if (
        receipt.catalogOnly &&
        receipt.phase === "unconfirmed" &&
        receipt.song
      )
        await publish(await api.finishMusicImport(receipt.id));
    } else {
      const versioned = (state.musicImportVersion ?? 0) >= 2;
      const requestId = `${versioned ? "p2-" : ""}${crypto.randomUUID()}`;
      const request: Parameters<typeof api.beginMusicImport>[0] = {
        engineId: state.stateOrder.engineId,
        requestId,
        ...(versioned ? { createdAtMs: Date.now() } : {}),
        name: file.name,
        size: file.size,
        kind,
        defaultBpm: options.bpm ?? 120,
        ...(catalogOnly ? { catalogOnly: true } : {}),
      };
      // Keep an addressable identity before sending. A lost response cannot orphan an upload.
      await publish({
        id: `${request.engineId}-${requestId}`,
        engineId: request.engineId,
        name: file.name,
        kind,
        size: file.size,
        received: 0,
        phase: "uploading",
        taskId: null,
        song: null,
        error: null,
        cancellable: true,
        catalogOnly,
      });
      await publish(await api.beginMusicImport(request));
    }
    if (!receipt) throw new Error("文件传输未创建回执");
    if (
      receipt.name !== file.name ||
      receipt.size !== file.size ||
      receipt.kind !== kind
    )
      throw new Error("原文件与导入回执不一致，请保留文件并重新排队");
    if (receipt.phase === "uploading") {
      for (
        let offset = receipt.received;
        offset < file.size;
        offset += 524288
      ) {
        cancelled(options.signal);
        await publish(
          await api.writeMusicImport(
            receipt.id,
            offset,
            file.slice(offset, offset + 524288),
          ),
        );
      }
      cancelled(options.signal);
      submitted = true;
      await publish(await api.finishMusicImport(receipt.id));
    } else submitted = !["error", "cancelled"].includes(receipt.phase);
    return await awaitMusicPreparation(receipt, {
      signal: options.signal,
      changed: publish,
    });
  } catch (failure) {
    if (!receipt) throw failure;
    if (
      failure instanceof CancelledMusicImport &&
      !submitted &&
      receipt.phase === "uploading"
    ) {
      try {
        await publish(await api.cancelMusicImport(receipt.id, receipt.kind));
      } catch {
        throw new PendingMusicImport(
          "停止传输的结果尚未确认，请继续读取原请求。",
          receipt,
        );
      }
    } else if (
      !(failure instanceof PendingMusicImport) &&
      !["done", "error", "cancelled"].includes(receipt.phase)
    ) {
      try {
        await publish(await api.readMusicImport(receipt.id));
      } catch {
        /* Keep the last acknowledged identity. */
      }
    }
    if (receipt.phase === "done" && receipt.song) return receipt.song;
    if (receipt.phase === "cancelled")
      throw new CancelledMusicImport(receipt.error || undefined);
    if (receipt.phase === "error")
      throw new Error(receipt.error || "文件导入失败");
    if (failure instanceof PendingMusicImport) throw failure;
    throw new PendingMusicImport(
      `导入结果待确认：${failure instanceof Error ? failure.message : String(failure)}。请继续读取原请求。`,
      receipt,
    );
  }
}
/** Explicit requeue only follows a settled request and a ready data store. */
export async function reconcileMusicRequeue(
  receipt?: MusicReceipt,
): Promise<ImportedSong | null> {
  const state = await api.state();
  if (
    state.storage?.operation ||
    state.storage?.error ||
    state.startup?.ready === false
  )
    throw new Error("请先等待保存或恢复完成，再重新排队。");
  if (
    receipt &&
    (state.stateOrder?.engineId === receipt.engineId ||
      (state.musicImportVersion ?? 0) >= 3)
  ) {
    let latest: MusicReceipt | undefined;
    try {
      latest = checkMusicReceipt(
        receipt,
        await api.readMusicImport(receipt.id),
      );
    } catch (failure) {
      if (!/回执已过期/.test(String(failure))) throw failure;
    }
    if (latest?.phase === "done" && latest.song) return latest.song;
    if (
      latest &&
      ["uploading", "queued", "running", "committing"].includes(latest.phase)
    )
      throw new Error("原请求仍在处理，请继续读取或取消当前文件。");
  }
  const tasks = await api.command<import("../../engine/taskStore").Task[]>({
    type: "tasks",
  });
  if (
    tasks.some(
      (task) =>
        ["准备导入曲目", "生成技术练习与恢复资料", "导入曲目包"].includes(
          task.label,
        ) && ["queued", "running", "committing"].includes(task.state),
    )
  )
    throw new Error("还有导入任务正在处理，请等待或取消后再重新排队。");
  return null;
}
