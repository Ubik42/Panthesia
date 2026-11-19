import {
  checkMusicReceipt,
  musicImportMessage,
  type ImportedSong,
  type MusicReceipt,
} from "./musicImportClient";
import { createPersistentSession } from "../../app/createPersistentSession";
import {
  importFileDigest,
  importSource,
  importable,
  restoreImportQueue,
  type ImportItem,
  type ImportQueueState,
} from "./importQueueModel";
export { importable } from "./importQueueModel";
export type { ImportItem, ImportQueueState } from "./importQueueModel";
export function createImportQueueStore() {
  const session = createPersistentSession(restoreImportQueue, {
    key: "neothesia.import-queue.v1",
    maxCharacters: 2_000_000,
    failureMessage: "导入队列尚未暂存，请保留当前窗口并重试保存。",
  });
  const state = session.getSnapshot;
  const update = (
    change:
      Partial<ImportQueueState> | ((old: ImportQueueState) => ImportQueueState),
  ) => {
    session.update(typeof change === "function" ? change(state()) : change);
  };
  const ensureItem = (file: File, receipt?: MusicReceipt) => {
    const current = state().items.find(
      (item) =>
        item.file === file || (!!receipt && item.receipt?.id === receipt.id),
    );
    if (current) return current;
    if (!importable(file)) return undefined;
    if (state().items.length >= 500) {
      update({
        error: "普通导入队列已满。配对批次仍保留进度，请在批量配对中继续。",
      });
      return undefined;
    }
    const item: ImportItem = {
      id: crypto.randomUUID(),
      file,
      source: importSource(file),
      state: "pending",
      message: "等待导入",
    };
    update({ items: [...state().items, item] });
    return item;
  };
  const patch = (id: string, change: Partial<ImportItem>) => {
    const items = state().items.map((item) => {
      if (item.id !== id) return item;
      let next = change;
      if (item.receipt && change.receipt) {
        const receipt = checkMusicReceipt(item.receipt, change.receipt);
        if (receipt !== change.receipt)
          next = { ...change, receipt, message: musicImportMessage(receipt) };
      }
      const result = { ...item, ...next };
      if (
        item.state === "done" &&
        item.song &&
        result.receipt?.phase === "done"
      ) {
        result.state = "done";
        result.song = item.song;
      }
      return result;
    });
    update({ items });
  };
  const complete = (id: string, song: ImportedSong, receipt?: MusicReceipt) => {
    patch(id, {
      state: "done",
      song,
      receipt: receipt
        ? { ...receipt, phase: "done", song, error: null, cancellable: false }
        : undefined,
      message: song.importWarnings?.length
        ? `已保存，附带 ${song.importWarnings.length} 条导入提示`
        : "已保存到本地曲库",
    });
    update({
      refreshPending: true,
      refreshScope:
        song.catalogOnly && state().refreshScope !== "session"
          ? "catalog"
          : "session",
      refreshVersion: state().refreshVersion + 1,
    });
  };
  const imported = (file: File, song: ImportedSong, receipt?: MusicReceipt) => {
    const current = ensureItem(file, receipt);
    if (current) complete(current.id, song, receipt);
  };
  return {
    ...session,
    update,
    claim() {
      if (state().busy) return false;
      update({ busy: true, stopping: false, error: "" });
      return true;
    },
    patch,
    add(files: File[]) {
      if (!files.length) return;
      const known = new Set(state().items.map((item) => item.file));
      const valid = files.filter((file) => {
        if (!importable(file) || known.has(file)) return false;
        known.add(file);
        return true;
      });
      const available = Math.max(0, 500 - state().items.length);
      update((old) => ({
        ...old,
        items: [
          ...old.items,
          ...valid.slice(0, available).map((file): ImportItem => ({
            id: crypto.randomUUID(),
            file,
            source: importSource(file),
            state: "pending",
            message: "等待导入",
          })),
        ],
        error:
          valid.length > available
            ? "一次最多保留 500 个文件，请移除已完成项后继续添加。"
            : files.some((file) => !importable(file))
              ? "普通导入支持 MIDI、MusicXML 与 MXL；PDF 和图片请使用批量配对。"
              : "",
      }));
    },
    imported,
    complete,
    async attach(id: string, file: File) {
      const item = state().items.find((item) => item.id === id);
      if (!item || state().busy) return;
      if (file.name !== item.source.name || file.size !== item.source.size)
        throw new Error("请选择与原名称和大小一致的文件。");
      if (
        item.receipt &&
        !item.source.sha256 &&
        !["cancelled", "error"].includes(item.receipt.phase)
      )
        throw new Error(
          "原请求缺少内容指纹，请先读取结果；需要重新传输时，先取消原请求再重新排队。",
        );
      const sha256 = await importFileDigest(file);
      if (item.source.sha256 && sha256 !== item.source.sha256)
        throw new Error("所选文件内容与原文件不同，请重新选择原文件。");
      const current = state().items.find((row) => row.id === id);
      if (
        !current ||
        state().busy ||
        current.source.name !== item.source.name ||
        current.source.size !== item.source.size ||
        current.source.sha256 !== item.source.sha256 ||
        current.receipt?.id !== item.receipt?.id
      )
        throw new Error("队列项目已变化，请重新补选文件。");
      if (current.song) return;
      patch(id, {
        file,
        source: { ...current.source, sha256 },
        message: "原文件内容已核对，可以继续",
      });
    },
    track(file: File, receipt?: MusicReceipt, unconfirmed = false) {
      if (receipt?.phase === "done" && receipt.song) {
        imported(file, receipt.song, receipt);
        return;
      }
      const current = ensureItem(file, receipt);
      if (!current) return;
      if (receipt && current.receipt && current.receipt.id !== receipt.id) {
        if (!["error", "cancelled"].includes(current.receipt.phase))
          throw new Error("原文件仍有待确认的导入请求，请先读取或取消原请求。");
        patch(current.id, { receipt: undefined });
      }
      patch(current.id, {
        receipt,
        state: unconfirmed
          ? "review"
          : !receipt || receipt.phase === "cancelled"
            ? "pending"
            : receipt.phase === "error"
              ? "error"
              : "review",
        message: unconfirmed
          ? "保存结果待确认，请先核对曲库"
          : receipt
            ? receipt.error || "已有导入请求，可以继续读取原结果"
            : "等待重新导入",
      });
    },
  };
}
export type ImportQueueStore = ReturnType<typeof createImportQueueStore>;
