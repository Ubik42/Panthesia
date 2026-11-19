import type { ScoreJobProgress } from "./scoreJobProgress";
import { activitySignal } from "../activity/activitySignal";
import type {
  PreparedScoreExport,
  ScoreExportCacheItem,
  ScoreExportCacheListing,
  ScoreExportOptions,
  ScoreExportInput,
  ScoreExportPreview,
  ScoreJobRequest,
} from "../../engine/commands.generated";
export interface ScoreExportState {
  options: ScoreExportOptions;
  artifact: PreparedScoreExport | null;
  legacyPreview: ScoreExportPreview | null;
  legacyOptions: ScoreExportOptions | null;
  legacyKey?: string;
  legacySavedKey?: string;
  job?: ScoreJobRequest;
  status?: ScoreJobProgress;
  submitting: boolean;
  busy: boolean;
  saving: boolean;
  supported: boolean;
  items: ScoreExportCacheItem[];
  error: string;
  message: string;
}
export const scoreExportInputKey = (input: ScoreExportInput) =>
  JSON.stringify([
    input.contentId,
    input.scoreRevision,
    input.annotationRevision ?? null,
    input.fingerActionRevision ?? null,
    input.options.fingers,
    input.options.hands,
    !!input.options.substitutions,
    input.options.repeatPolicy,
  ]);
const caches = new Map<string, ScoreExportCacheListing>();
function createSlot(
  contentId: string,
  engineId?: string,
  source?: { title?: string; path?: string },
) {
  let state: ScoreExportState = {
    options: {
      fingers: true,
      hands: true,
      substitutions: true,
      repeatPolicy: "consistent",
    },
    artifact: null,
    legacyPreview: null,
    legacyOptions: null,
    submitting: false,
    busy: false,
    saving: false,
    supported: !!(engineId && caches.has(engineId)),
    items: engineId ? (caches.get(engineId)?.items ?? []) : [],
    error: "",
    message: "",
  };
  let read = 0;
  const listeners = new Set<() => void>();
  return {
    engineId,
    source: { engineId, contentId, ...source },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (change: Partial<ScoreExportState>) => {
      state = { ...state, ...change };
      for (const listener of [...listeners]) listener();
      activitySignal.changed();
    },
    beginRead: () => {
      const ticket = ++read;
      return () => read === ticket;
    },
  };
}
const slots = new Map<string, ReturnType<typeof createSlot>>();
export function scoreExportSlot(
  engineId: string | null | undefined,
  contentId: string,
  source?: { title?: string; path?: string },
) {
  const key = JSON.stringify([engineId ?? null, contentId]);
  let slot = slots.get(key);
  if (!slot) {
    while (slots.size >= 16) {
      const oldest = [...slots].find(([, value]) => {
        const state = value.getSnapshot();
        return !state.busy && !state.saving && !state.submitting && !state.job;
      });
      if (!oldest) break;
      slots.delete(oldest[0]);
    }
    slot = createSlot(contentId, engineId ?? undefined, source);
    activitySignal.changed();
  }
  slots.delete(key);
  slots.set(key, slot);
  return slot;
}
export function replaceScoreExportCache(
  engineId: string,
  listing: ScoreExportCacheListing,
  origin: ReturnType<typeof createSlot>,
) {
  if ((caches.get(engineId)?.revision ?? -1) > listing.revision) return;
  caches.delete(engineId);
  while (caches.size >= 16) {
    const oldest = caches.keys().next().value;
    if (oldest === undefined) break;
    caches.delete(oldest);
  }
  caches.set(engineId, listing);
  for (const slot of slots.values()) {
    if (slot.engineId !== engineId && slot !== origin) continue;
    const state = slot.getSnapshot(),
      artifact = state.artifact;
    const item = artifact
      ? listing.items.find((item) => item.id === artifact.id)
      : undefined;
    slot.update({
      supported: true,
      items: listing.items,
      ...(artifact && item
        ? { artifact: { ...artifact, savedPath: item.savedPath } }
        : artifact && !state.busy && !state.saving
          ? {
              artifact: null,
              message: "原导出成品已释放，可以按当前内容重新制作。",
            }
          : {}),
    });
  }
}
export function hasUnsavedScoreExports() {
  return (
    [...caches.values()].some((cache) =>
      cache.items.some((item) => !item.savedPath),
    ) ||
    [...slots.values()].some((slot) => {
      const state = slot.getSnapshot();
      return (
        state.busy ||
        state.saving ||
        state.submitting ||
        !!state.job ||
        (!!state.artifact && !state.artifact.savedPath)
      );
    })
  );
}

export const scoreExportSessions = () =>
  [...slots].map(([key, slot]) => ({
    key,
    slot,
    source: slot.source,
    state: slot.getSnapshot(),
  }));
