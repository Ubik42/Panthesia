import { useSyncExternalStore, type SetStateAction } from "react";
import { registerCloseParticipant } from "../../app/closePreparation";
import type {
  RecommendationDraft,
  RecommendationAccepted,
} from "./recommendationTypes";

// Keep the user's preview and choices when the plan dialog is reopened.
const drafts = new Map<string, RecommendationDraft>();
const listeners = new Set<() => void>();
let warningInstalled = false;
const warnOnExit = () => {
  if (warningInstalled || typeof window === "undefined") return;
  warningInstalled = true;
  registerCloseParticipant("recommendation-preview", { label: "专项复习预览", pending: () =>
    [...drafts.values()].some((draft) => draft.edited && (draft.chosen.length || draft.retired.length || Object.keys(draft.edits).length || draft.name !== "专项复习"))
      ? "当前预览和选择只保留在这次运行中；已加入的计划继续保留。" : null });
  window.addEventListener("beforeunload", (event) => {
    if (
      [...drafts.values()].some(
        (draft) =>
          draft.edited &&
          (draft.chosen.length ||
            draft.retired.length ||
            Object.keys(draft.edits).length ||
            draft.name !== "专项复习"),
      )
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = (key: string): RecommendationDraft => {
  warnOnExit();
  let draft = drafts.get(key);
  if (!draft) {
    draft = {
      rows: [],
      retired: [],
      chosen: [],
      edits: {},
      note: "",
      duePage: null,
      passageAvailability: null,
      name: "专项复习",
      message: "",
      stale: false,
      edited: false,
      receipt: null,
      filter: "all",
    };
    drafts.set(key, draft);
  }
  return draft;
};
export function useRecommendationDraft(
  routineId: string | null,
  day: string | null,
) {
  const key = JSON.stringify([routineId, day]);
  const draft = useSyncExternalStore(subscribe, () => read(key));
  const set =
    <K extends keyof RecommendationDraft>(field: K) =>
    (value: SetStateAction<RecommendationDraft[K]>) => {
      const current = read(key);
      const next =
        typeof value === "function"
          ? (
              value as (
                previous: RecommendationDraft[K],
              ) => RecommendationDraft[K]
            )(current[field])
          : value;
      drafts.set(key, {
        ...current,
        [field]: next,
        edited: current.edited || field === "chosen" || field === "name",
      });
      listeners.forEach((listener) => listener());
    };
  return {
    ...draft,
    updateDraft: (patch: Partial<RecommendationDraft>) => {
      drafts.set(key, { ...read(key), ...patch });
      listeners.forEach((listener) => listener());
    },
    rememberSaved: (receipt: RecommendationAccepted) => {
      for (const scope of new Set([key, JSON.stringify([receipt.id, day])])) {
        drafts.set(scope, { ...read(scope), receipt });
      }
      listeners.forEach((listener) => listener());
    },
    clearSaved: (receipt: RecommendationAccepted) => {
      for (const [scope, current] of drafts) {
        if (
          current.receipt?.id === receipt.id &&
          JSON.parse(scope)[1] === day
        ) {
          drafts.set(scope, { ...current, receipt: null });
        }
      }
      listeners.forEach((listener) => listener());
    },
    touch: () => set("edited")(true),
    setRows: set("rows"),
    setRetired: set("retired"),
    setChosen: set("chosen"),
    setEdits: set("edits"),
    setDuePage: set("duePage"),
    setName: set("name"),
    setMessage: set("message"),
    setStale: set("stale"),
    setFilter: set("filter"),
  };
}
