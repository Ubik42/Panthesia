import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api";
import { taskInterruption } from "../../engine/taskErrors";
import type { ImportedSong } from "../../engine/commands.generated";
import {
  CancelledMusicImport,
  musicImportMessage,
  PendingMusicImport,
  reconcileMusicRequeue,
} from "../imports/musicImportClient";
import { generateExercise } from "./exerciseGenerationClient";
import type { ExerciseSessionStore } from "./exerciseSessionStore";

export interface PreparedExerciseSource {
  contentId: string;
  engineId?: string;
}
export interface ExercisePreparationActions {
  runPreparation: (work: () => Promise<void>) => Promise<void>;
  refreshGenerated: (source: PreparedExerciseSource) => Promise<void>;
}
const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
export function useExercisePreparation(
  store: ExerciseSessionStore,
  actions: ExercisePreparationActions,
) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const waiting = useRef<AbortController | null>(null);
  const cancellingRequest = useRef<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(
    () => () => {
      waiting.current?.abort();
    },
    [],
  );
  const open = async (result: ImportedSong, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const before = await api.state();
    if (signal?.aborted) return;
    if (before.contentId !== result.contentId) {
      store.update({ message: "正在打开已生成的练习…", refreshPending: true });
      await api.commandForEngine(before.stateOrder?.engineId, {
        type: "openRecent",
        content_id: result.contentId,
      });
    }
    if (signal?.aborted) return;
    const latest = await api.state();
    if (
      latest.contentId !== result.contentId ||
      latest.stateOrder?.engineId !== before.stateOrder?.engineId
    )
      throw new Error("练习或连接已再次切换，请重新打开已生成的练习。");
    store.update({
      refreshPending: true,
      message: "练习已就绪，正在读取练习室…",
    });
    await actions.refreshGenerated({
      contentId: result.contentId,
      engineId: before.stateOrder?.engineId,
    });
    store.update({ refreshPending: false, message: "练习已打开。" });
  };
  const start = async () => {
    if (cancellingRequest.current) return;
    const saved = store.getSnapshot();
    const reusable =
      saved.receipt && !["error", "cancelled"].includes(saved.receipt.phase);
    if (store.getRecoverySnapshot().protected && !saved.result && !reusable) {
      store.retrySave();
      return;
    }
    if (!store.claim()) return;
    const controller = new AbortController();
    waiting.current = controller;
    try {
      await actions.runPreparation(async () => {
        const current = store.getSnapshot();
        if (current.result) {
          await open(current.result, controller.signal);
          return;
        }
        if (current.phase === "review" && !current.receipt)
          throw new Error(
            "上次生成结果待确认，请先核对已有技术练习，再重新生成。",
          );
        store.update({
          phase: "working",
          message: current.receipt
            ? "正在读取原生成结果…"
            : "正在准备技术练习…",
        });
        const previous =
          current.receipt &&
          !["error", "cancelled"].includes(current.receipt.phase)
            ? current.receipt
            : undefined;
        const result = await generateExercise(current.spec, {
          receipt: previous,
          signal: controller.signal,
          changed: (receipt) =>
            store.update({ receipt, message: musicImportMessage(receipt) }),
        });
        store.update({
          result,
          phase: "ready",
          error: "",
          message: "技术练习已生成。",
          dirty: false,
          refreshPending: true,
        });
        await open(result, controller.signal);
      });
    } catch (failure) {
      const current = store.getSnapshot();
      if (current.result)
        store.update({
          phase: "ready",
          error: `练习已生成，读取未完成：${message(failure)}`,
          refreshPending: true,
        });
      else if (failure instanceof PendingMusicImport)
        store.update({
          phase: "review",
          receipt: failure.receipt,
          error: failure.message,
          message: "原请求保留，请继续读取结果。",
        });
      else if (
        failure instanceof CancelledMusicImport ||
        taskInterruption(failure) === "cancelled"
      )
        store.update({
          phase: "editing",
          receipt: undefined,
          message: "已取消，当前练习参数保留。",
          error: "",
        });
      else if (
        taskInterruption(failure) === "pending" ||
        current.phase === "review" ||
        [
          "uploading",
          "queued",
          "running",
          "committing",
          "unconfirmed",
        ].includes(current.receipt?.phase ?? "")
      )
        store.update({
          phase: "review",
          error: message(failure),
          message: "上次生成结果待确认。",
        });
      else
        store.update({
          phase: "error",
          error: message(failure),
          message: "参数保留，调整后可以重试。",
        });
    } finally {
      if (waiting.current === controller) waiting.current = null;
      store.update({ busy: false });
    }
  };
  const cancel = async () => {
    const current = store.getSnapshot();
    if (!current.receipt?.cancellable || cancellingRequest.current) return;
    cancellingRequest.current = current.receipt.id;
    setCancelling(true);
    // Running generation owns busy. Cancellation observes its exact task and does not claim a new generation.
    try {
      const receipt = await api.cancelMusicImport(
        current.receipt.id,
        current.receipt.kind,
      );
      if (store.getSnapshot().receipt?.id !== current.receipt.id) return;
      if (store.getSnapshot().result && receipt.phase === "done") return;
      store.update({ receipt, message: musicImportMessage(receipt) });
      if (receipt.phase === "done" && receipt.song)
        store.update({
          result: receipt.song,
          phase: "ready",
          error: "",
          dirty: false,
          refreshPending: true,
        });
      else if (receipt.phase === "cancelled" && !current.busy)
        store.update({ phase: "editing", receipt: undefined, error: "" });
    } catch (failure) {
      if (
        store.getSnapshot().receipt?.id === current.receipt.id &&
        !store.getSnapshot().result
      )
        store.update({ error: message(failure) });
    } finally {
      cancellingRequest.current = null;
      setCancelling(false);
    }
  };
  const requeue = async () => {
    if (cancellingRequest.current) return;
    if (store.getRecoverySnapshot().protected) {
      store.retrySave();
      return;
    }
    if (!store.claim()) return;
    try {
      const result = await reconcileMusicRequeue(store.getSnapshot().receipt);
      if (result)
        store.update({
          result,
          phase: "ready",
          error: "",
          dirty: false,
          refreshPending: true,
          message: "已采用原请求的生成结果，可以打开练习。",
        });
      else
        store.update({
          phase: "editing",
          receipt: undefined,
          result: undefined,
          error: "",
          message: "已核对原结果，可以调整参数后重新生成。",
        });
    } catch (failure) {
      store.update({ error: message(failure) });
    } finally {
      store.update({ busy: false });
    }
  };
  return {
    ...state,
    start,
    cancel,
    requeue,
    cancelling,
    locked: state.busy || state.phase === "review" || state.phase === "ready",
  };
}
