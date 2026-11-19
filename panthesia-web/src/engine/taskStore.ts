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
function createTaskMonitor(engineId?: string) {
  let snapshot: TaskFrame = { tasks: [], error: "", observed: false };
  let serialized = JSON.stringify(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: number | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TaskFrame) => {
    const signature = JSON.stringify(next);
    if (signature === serialized) return;
    snapshot = next;
    serialized = signature;
    for (const notify of [...listeners]) notify();
  };
  const poll = async () => {
    const ticket = generation;
    if (inFlight === ticket || !listeners.size) return;
    inFlight = ticket;
    clearTimeout(timer);
    try {
      const tasks = readTasks(
        await api.commandForEngine<unknown>(engineId, { type: "tasks" }),
      );
      if (ticket === generation && listeners.size)
        publish({ tasks, error: "", observed: true });
    } catch (error) {
      if (ticket === generation && listeners.size)
        publish({
          ...snapshot,
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (ticket === generation) {
        inFlight = undefined;
        if (listeners.size) {
          const active = snapshot.tasks.some((task) =>
            ["queued", "running", "committing"].includes(task.state),
          );
          timer = setTimeout(
            () => void poll(),
            snapshot.error ? 1500 : active ? 250 : 1000,
          );
        }
      }
    }
  };
  return {
    getSnapshot: () => snapshot,
    refresh: poll,
    subscribe(notify: () => void) {
      listeners.add(notify);
      if (listeners.size === 1) {
        generation++;
        void poll();
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          generation++;
          clearTimeout(timer);
          inFlight = undefined;
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
