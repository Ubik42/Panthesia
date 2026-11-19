import type { ScoreJobProgress } from "../scores/scoreJobProgress";
import { activitySignal } from "../activity/activitySignal";
import type {
  MediaExportDraft,
  MediaExportKind,
  MediaExportListing,
  ScoreJobRequest,
} from "../../engine/commands.generated";
export interface MediaExportSource {
  contentId: string;
  title: string;
  path?: string;
  engineId?: string | null;
}
interface State {
  artifact: MediaExportDraft | null;
  job?: ScoreJobRequest;
  status?: ScoreJobProgress;
  action: "prepare" | "save";
  busy: boolean;
  submitting: boolean;
  supported: boolean;
  listing: MediaExportListing;
  error: string;
  message: string;
}
function createSlot(source: MediaExportSource, kind: MediaExportKind) {
  let state: State = {
    artifact: null,
    action: "prepare",
    busy: false,
    submitting: false,
    supported: false,
    listing: { drafts: [], issues: [], totalSize: 0, capacity: 1_073_741_824 },
    error: "",
    message: "",
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  return {
    source: { ...source },
    kind,
    getSnapshot: () => state,
    canForget: () =>
      !listeners.size && !state.busy && !state.submitting && !state.job,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch: Partial<State>) => {
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
      activitySignal.changed();
    },
    beginRead: () => {
      const next = ++generation;
      return () => generation === next;
    },
  };
}
const slots = new Map<string, ReturnType<typeof createSlot>>();
export function mediaExportSlot(
  source: MediaExportSource,
  kind: MediaExportKind,
) {
  const key = JSON.stringify([source.engineId ?? null, source.contentId, kind]);
  let slot = slots.get(key);
  if (!slot) {
    while (slots.size >= 16) {
      const oldest = [...slots].find(([, value]) => value.canForget());
      if (!oldest) break;
      slots.delete(oldest[0]);
    }
    slot = createSlot(source, kind);
    activitySignal.changed();
  }
  slots.delete(key);
  slots.set(key, slot);
  return slot;
}
export function hasWorkingMediaExports() {
  return [...slots.values()].some((slot) => {
    const state = slot.getSnapshot();
    return state.busy || state.submitting || !!state.job;
  });
}

export const mediaExportSessions = () =>
  [...slots].map(([key, slot]) => ({
    key,
    slot,
    source: slot.source,
    kind: slot.kind,
    state: slot.getSnapshot(),
  }));
