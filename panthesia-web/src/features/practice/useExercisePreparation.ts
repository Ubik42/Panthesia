import { useSyncExternalStore } from "react";
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

/** Generate the exercise in the engine and open it. Generation is one synchronous command. */
export function useExercisePreparation(
  store: ExerciseSessionStore,
  actions: ExercisePreparationActions,
) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const start = async () => {
    if (store.getRecoverySnapshot().protected) {
      store.retrySave();
      return;
    }
    if (!store.claim()) return;
    try {
      await actions.runPreparation(async () => {
        const current = store.getSnapshot();
        store.update({ phase: "working", message: "正在生成技术练习…" });
        const { result, engineId } = await generateExercise(current.spec);
        store.update({
          result,
          phase: "ready",
          error: "",
          message: "技术练习已生成。",
          dirty: false,
          refreshPending: true,
        });
        await actions.refreshGenerated({ contentId: result.contentId, engineId });
        store.update({ refreshPending: false, message: "练习已打开。" });
      });
    } catch (failure) {
      const current = store.getSnapshot();
      store.update(
        current.result
          ? { phase: "ready", error: `练习已生成，读取未完成：${message(failure)}`, refreshPending: true }
          : { phase: "error", error: message(failure), message: "参数保留，调整后可以重试。" },
      );
    } finally {
      store.update({ busy: false });
    }
  };
  return {
    ...state,
    start,
    cancel: async () => {},
    requeue: async () => store.useAgain(),
    cancelling: false,
    locked: state.busy || state.phase === "ready",
  };
}
