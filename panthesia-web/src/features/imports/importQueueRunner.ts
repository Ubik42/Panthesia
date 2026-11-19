import { api } from "../../api";
import { taskInterruption } from "../../engine/taskErrors";
import { importFileDigest } from "./importQueueModel";
import type { ImportQueueStore } from "./importQueueStore";
import {
  CancelledMusicImport,
  PendingMusicImport,
  importMusicFile,
  musicImportMessage,
  resumeMusicImport,
  checkMusicReceipt,
} from "./musicImportClient";

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
const runners = new WeakMap<
  ImportQueueStore,
  ReturnType<typeof createRunner>
>();
export type ImportQueueRefresh = (catalogOnly?: boolean) => Promise<void>;
export async function refreshImportQueue(
  store: ImportQueueStore,
  changed: ImportQueueRefresh,
) {
  const before = store.getSnapshot();
  await changed(before.refreshScope === "catalog");
  if (store.getSnapshot().refreshVersion === before.refreshVersion)
    store.update({ refreshPending: false, refreshScope: null });
}
/** The queue, rather than its dialog, owns an active transfer and the pause boundary. */
function createRunner(store: ImportQueueStore) {
  let cancelling = false;
  const durable = () => {
    if (store.getSnapshot().storageError) store.retrySave();
    if (store.getSnapshot().storageError)
      throw new Error("导入进度尚未暂存，请先处理下方保存提示，再继续传输。");
  };
  return {
    pause() {
      if (store.getSnapshot().busy) store.update({ stopping: true });
    },
    async cancelCurrent() {
      if (cancelling) return;
      store.update({ stopping: true });
      const item = store
        .getSnapshot()
        .items.find((item) => item.state === "working");
      if (!item?.receipt) {
        store.update({
          error: "当前文件正在核对或创建请求，将在本文件结束后暂停。",
        });
        return;
      }
      cancelling = true;
      try {
        const receipt = checkMusicReceipt(
          item.receipt,
          await api.cancelMusicImport(item.receipt.id, item.receipt.kind),
        );
        if (
          store.getSnapshot().items.find((row) => row.id === item.id)?.receipt
            ?.id !== receipt.id
        )
          return;
        if (receipt.phase === "done" && receipt.song)
          store.complete(item.id, receipt.song, receipt);
        else
          store.patch(item.id, {
            receipt,
            message: musicImportMessage(receipt),
          });
      } catch (failure) {
        store.update({
          error: `${message(failure)}。队列将在当前文件结束后暂停。`,
        });
      } finally {
        cancelling = false;
      }
    },
    async refresh(changed: ImportQueueRefresh) {
      if (!store.claim()) return;
      try {
        await refreshImportQueue(store, changed);
      } catch (failure) {
        store.update({
          error: `已导入结果保留，列表读取失败：${message(failure)}`,
        });
      } finally {
        store.update({ busy: false, stopping: false });
      }
    },
    async run(changed: ImportQueueRefresh, only?: string) {
      if (!store.claim()) return;
      try {
        const start = store.getSnapshot();
        const bpm = /^\d+$/.test(start.bpmInput.trim())
          ? Number(start.bpmInput)
          : NaN;
        const needsBpm = start.items.some(
          (item) =>
            item.state !== "done" &&
            (!only || item.id === only) &&
            /\.(xml|musicxml|mxl)$/i.test(item.source.name) &&
            (!item.receipt ||
              ["error", "cancelled"].includes(item.receipt.phase)),
        );
        if (needsBpm && (!Number.isInteger(bpm) || bpm < 20 || bpm > 400))
          throw new Error("乐谱默认速度应为 20 到 400 BPM。原输入已保留。");
        durable();
        const ids = start.items
          .filter(
            (item) => item.state !== "done" && (!only || item.id === only),
          )
          .map((item) => item.id);
        let lastCatalogRefresh = Date.now();
        for (const id of ids) {
          if (store.getSnapshot().stopping) break;
          const item = store.getSnapshot().items.find((item) => item.id === id);
          if (!item || item.state === "done") continue;
          if (item.state === "review" && !item.receipt) {
            store.update({
              error: "该文件的旧保存结果尚未核对，请先查看曲库，再重新排队。",
            });
            break;
          }
          const receipt =
            item.receipt && !["error", "cancelled"].includes(item.receipt.phase)
              ? item.receipt
              : undefined;
          if (!item.file && !receipt) {
            store.patch(id, { message: "请补选原文件后继续导入" });
            if (only)
              store.update({
                error: "原文件尚未补选。已保存结果和其他队列项目继续保留。",
              });
            continue;
          }
          store.patch(id, {
            state: "working",
            receipt,
            message: receipt ? "正在读取原导入请求…" : "正在核对文件内容…",
          });
          try {
            if (item.file && !item.source.sha256) {
              // Hash before admission. A reselected file can never append unrelated bytes.
              const sha256 = await importFileDigest(item.file);
              store.patch(id, { source: { ...item.source, sha256 } });
            }
            durable();
            const options = {
              receipt,
              changed: (next: Parameters<typeof musicImportMessage>[0]) => {
                store.patch(id, {
                  receipt: next,
                  message: musicImportMessage(next),
                });
                durable();
              },
            };
            const song = item.file
              ? await importMusicFile(item.file, {
                  ...options,
                  bpm: needsBpm ? bpm : start.bpm,
                })
              : await resumeMusicImport(receipt!, options);
            store.complete(
              id,
              song,
              store.getSnapshot().items.find((row) => row.id === id)?.receipt,
            );
          } catch (failure) {
            const interruption = taskInterruption(failure);
            if (failure instanceof PendingMusicImport) {
              store.patch(id, {
                state: "review",
                receipt: failure.receipt,
                message: failure.message,
              });
              store.update({
                stopping: true,
                error:
                  "当前文件的请求已保留，队列已暂停。可读取原结果或补选文件。",
              });
            } else if (
              failure instanceof CancelledMusicImport ||
              interruption === "cancelled"
            ) {
              store.patch(id, {
                state: "pending",
                receipt: undefined,
                message:
                  failure instanceof CancelledMusicImport
                    ? failure.message
                    : "已取消，原文件保留，等待继续导入",
              });
              store.update({ stopping: true });
            } else if (interruption === "pending") {
              store.patch(id, {
                state: "review",
                message: "保存结果待确认，请先核对曲库",
              });
              store.update({ stopping: true });
            } else
              store.patch(id, { state: "error", message: message(failure) });
          }
          const progress = store.getSnapshot();
          if (progress.storageError) break;
          // Publish accumulated catalog additions during a long batch. This reader does
          // not reload the active performance; legacy imports keep their final refresh.
          if (
            progress.refreshPending &&
            progress.refreshScope === "catalog" &&
            Date.now() - lastCatalogRefresh >= 2500
          ) {
            lastCatalogRefresh = Date.now();
            try {
              await refreshImportQueue(store, changed);
            } catch (failure) {
              store.update({
                error: `文件已保存，曲库暂未读齐：${message(failure)}。可继续导入或稍后重读结果。`,
              });
            }
          }
        }
        if (store.getSnapshot().refreshPending) {
          try {
            await refreshImportQueue(store, changed);
          } catch (failure) {
            store.update({
              error: `文件已保存，列表读取未完成：${message(failure)}。可只重读结果。`,
            });
          }
        }
      } catch (failure) {
        store.update({ error: message(failure) });
      } finally {
        store.update({ busy: false, stopping: false });
      }
    },
  };
}
export function getImportQueueRunner(store: ImportQueueStore) {
  let runner = runners.get(store);
  if (!runner) {
    runner = createRunner(store);
    runners.set(store, runner);
  }
  return runner;
}
