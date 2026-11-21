import { useSyncExternalStore } from "react";
import { api } from "../api";
export type Task = {
  id: string;
  label: string;
  state:
    "queued" | "running" | "committing" | "succeeded" | "failed" | "cancelled";
  stage:
    | "queued"
    | "preparing"
    | "computing"
    | "reading"
    | "encoding"
    | "decoding"
    | "comparing"
    | "merging"
    | "serializing"
    | "analyzingRound"
    | "restoring"
    | "preparingPlayback"
    | "preparingSong"
    | "preparingPractice"
    | "preparingSound"
    | "readingSound"
    | "connectingSound"
    | "connectingInput"
    | "openingEditor"
    | "preparingScore"
    | "readingScore"
    | "mappingScore"
    | "readingHistory"
    | "readingPlans"
    | "readingLearning"
    | "readingLibrary"
    | "preparingLibrary"
    | "preparingPlans"
    | "committing";
  contentId: string | null;
  fingerprint: string | null;
  error: string | null;
};
const taskStates = new Set([
  "queued",
  "running",
  "committing",
  "succeeded",
  "failed",
  "cancelled",
]);
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
function readTasks(value: unknown): Task[] {
  if (
    !Array.isArray(value) ||
    value.length > 4096 ||
    !value.every((task: unknown) => {
      if (!task || typeof task !== "object" || Array.isArray(task))
        return false;
      const item = task as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.label === "string" &&
        typeof item.stage === "string" &&
        typeof item.state === "string" &&
        taskStates.has(item.state) &&
        nullableText(item.contentId) &&
        nullableText(item.fingerprint) &&
        nullableText(item.error)
      );
    })
  )
    throw new Error("后台任务清单尚未读齐，请重新读取。");
  return value as Task[];
}
export interface TaskFrame {
  tasks: readonly Task[];
  error: string;
  observed: boolean;
}
/** The engine's background tasks: pushed while anyone listens; `refresh` reads them once. */
function createTaskMonitor(engineId?: string) {
  let snapshot: TaskFrame = { tasks: [], error: "", observed: false };
  let serialized = JSON.stringify(snapshot);
  let release: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: TaskFrame) => {
    const signature = JSON.stringify(next);
    if (signature === serialized) return;
    snapshot = next;
    serialized = signature;
    for (const notify of [...listeners]) notify();
  };
  const accept = (value: unknown) => {
    try {
      publish({ tasks: readTasks(value), error: "", observed: true });
    } catch (error) {
      fail(error);
    }
  };
  const fail = (error: unknown) =>
    publish({ ...snapshot, error: error instanceof Error ? error.message : String(error) });
  return {
    getSnapshot: () => snapshot,
    refresh: async () => {
      try {
        accept(await api.commandForEngine<unknown>(engineId, { type: "tasks" }));
      } catch (error) {
        fail(error);
      }
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      if (listeners.size === 1) release = api.subscribeTasks(accept, fail);
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          release?.();
          release = undefined;
          snapshot = { tasks: [], error: "", observed: false };
          serialized = JSON.stringify(snapshot);
        }
      };
    },
  };
}
// Visible task panels and retained device work share one reader for each engine.
const monitors = new Map<
  string | undefined,
  ReturnType<typeof createTaskMonitor>
>();
export function taskMonitor(engineId?: string) {
  let monitor = monitors.get(engineId);
  if (!monitor) {
    monitor = createTaskMonitor(engineId);
    monitors.set(engineId, monitor);
  }
  return monitor;
}
export function useTaskFrame(engineId?: string) {
  const monitor = taskMonitor(engineId);
  return useSyncExternalStore(
    monitor.subscribe,
    monitor.getSnapshot,
    monitor.getSnapshot,
  );
}
export function useTasks(engineId?: string) {
  return useTaskFrame(engineId).tasks;
}
