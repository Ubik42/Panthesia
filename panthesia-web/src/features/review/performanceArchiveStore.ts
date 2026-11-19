import { api } from "../../api";
import { createHistoryReader } from "../../engine/useHistoryRead";
import { requireHistorySource, sameHistorySource } from "./historySource";
export type PerformanceArchive =
  import("../../engine/commands.generated").HistoryPerformanceRead;

interface ArchiveState {
  data: PerformanceArchive | null;
  reading: boolean;
  error: string;
  readAt: number | null;
  canceled: boolean;
}
const slots = new Map<string, ReturnType<typeof createArchive>>();
function createArchive(contentId: string, id: string, engineId?: string) {
  let state: ArchiveState = {
    data: null,
    reading: false,
    error: "",
    readAt: null,
    canceled: false,
  };
  let subscribers = 0;
  const listeners = new Set<() => void>();
  const publish = (change: Partial<ArchiveState>) => {
    state = { ...state, ...change };
    for (const listener of [...listeners]) listener();
  };
  let operation: Promise<void> | null = null;
  let generation = 0;
  let readEngine = engineId;
  let reader = createHistoryReader(engineId);
  const scrollPositions = new Map<string, number>();
  return {
    scrollPositions,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      subscribers++;
      listeners.add(listener);
      return () => {
        subscribers--;
        listeners.delete(listener);
      };
    },
    unused: () => !subscribers && !state.reading,
    load() {
      if (operation) return operation;
      const admitted = ++generation;
      publish({ reading: true, error: "", canceled: false });
      operation = Promise.resolve().then(async () => {
        try {
          const origin = engineId ?? (await api.state()).stateOrder?.engineId;
          if (admitted !== generation) return;
          if (!origin)
            throw new Error("练习室连接尚未准备好，请稍后读取演奏。");
          if (readEngine !== origin) {
            reader.invalidate();
            readEngine = origin;
            reader = createHistoryReader(origin);
            publish({ data: null, readAt: null });
          }
          const request = reader.request<PerformanceArchive>({
            type: "readHistoryPerformance",
            content_id: contentId,
            id,
          });
          const value = await request.result;
          requireHistorySource(value?.source, contentId, id, true);
          if (admitted !== generation) return;
          if (
            value?.contentId !== contentId ||
            value.id !== id ||
            !Number.isFinite(value.duration) ||
            value.duration < 0 ||
            !Array.isArray(value.inputs) ||
            !Array.isArray(value.references) ||
            !Array.isArray(value.referencePedals) ||
            (value.judgments != null && !Array.isArray(value.judgments)) ||
            (value.measures != null && !Array.isArray(value.measures))
          )
            throw new Error("演奏读取结果与原记录不一致，请重新读取。");
          if (request.isCurrent())
            publish({
              data: sameHistorySource(state.data?.source, value.source)
                ? state.data
                : value,
              readAt: Date.now(),
            });
        } catch (failure) {
          if (admitted === generation)
            publish({
              error:
                failure instanceof Error ? failure.message : String(failure),
            });
        } finally {
          operation = null;
          publish({ reading: false });
          trimArchives();
        }
      });
      return operation;
    },
    cancel() {
      // Retain any earlier read while the native task acknowledges cancellation.
      generation++;
      publish({ canceled: true });
      reader.invalidate();
    },
  };
}
export function getPerformanceArchive(
  contentId: string,
  id: string,
  engineId?: string,
) {
  const key = JSON.stringify([engineId ?? null, contentId, id]);
  let slot = slots.get(key);
  if (!slot) {
    if (slots.size >= 4)
      for (const [key, candidate] of slots)
        if (candidate.unused()) {
          slots.delete(key);
          break;
        }
    slot = createArchive(contentId, id, engineId);
    slots.set(key, slot);
  } else {
    slots.delete(key);
    slots.set(key, slot);
  }
  return slot;
}
function trimArchives() {
  for (const [key, slot] of slots) {
    if (slots.size <= 4) break;
    if (slot.unused()) slots.delete(key);
  }
}
