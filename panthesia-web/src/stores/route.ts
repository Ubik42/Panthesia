import { create } from "zustand";

/** Whether a song session is open in the engine (practice) or not (home). */
export type Workspace = "home" | "practice";
/** Pages of an open song: details over the start page, its sub-pages, the stage, free play. */
export type SongPage = "setup" | "parts" | "split" | "performance" | "freePlay";
/** Sections of the settings page (interface-design.md §6). */
export type SettingsSection = "devices" | "library" | "appearance" | "notes" | "keyboard" | "shortcuts" | "tools" | "backup" | "about";
export type Screen = "home" | "settings" | SongPage;

type RouteState = {
  workspace: Workspace;
  /** A workspace change waiting for the engine. */
  pending: Workspace | null;
  /** A page shown over the workspace (start page or settings), or none. */
  front: "home" | "settings" | null;
  page: SongPage;
  splitTrack: number | null;
  settingsSection: SettingsSection;
  /** Where the settings page returns to. */
  settingsReturn: "home" | null;
  sequence: number;
};

/** The one route of the application (frontend-architecture.md §4): which page is shown and
 * the guarded change of the engine workspace. */
export const useRoute = create<RouteState>()(() => ({
  workspace: "home",
  pending: null,
  front: "home",
  page: "setup",
  splitTrack: null,
  settingsSection: "devices",
  settingsReturn: "home",
  sequence: 0,
}));

export const screenOf = (s: Pick<RouteState, "front" | "workspace" | "page">): Screen => s.front ?? (s.workspace === "practice" ? s.page : "home");
export const useScreen = () => useRoute(screenOf);

const set = useRoute.setState,
  get = useRoute.getState;

export const route = {
  home: () => set({ front: "home" }),
  settings: (section?: SettingsSection) => {
    const { front, workspace } = get();
    set({
      settingsReturn: front === "settings" ? get().settingsReturn : front === "home" || workspace !== "practice" ? "home" : null,
      ...(section ? { settingsSection: section } : {}),
      front: "settings",
    });
  },
  setSettingsSection: (settingsSection: SettingsSection) => set({ settingsSection }),
  leaveSettings: () => set({ front: get().settingsReturn }),
  resume: () => set({ front: null }),
  show: (page: SongPage) => set({ front: null, page }),
  split: (track: number) => set({ front: null, page: "split", splitTrack: track }),
  setSongSetup: (value: boolean) => set({ front: null, page: value ? "setup" : "performance" }),
  /** Change the workspace at once (no engine work in between). */
  navigate: (workspace: Workspace) => set({ workspace, pending: null, sequence: get().sequence + 1 }),
  /** Change the workspace after `prepare` succeeds; a newer request or an abort cancels it. */
  request: async (next: Workspace, prepare: (from: Workspace, next: Workspace) => Promise<boolean>, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    const from = get().workspace;
    const ticket = get().sequence + 1;
    if (from === next) {
      set({ pending: null, sequence: ticket });
      return true;
    }
    set({ pending: next, sequence: ticket });
    const cancel = () => get().sequence === ticket && set({ pending: null, sequence: ticket + 1 });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (!(await prepare(from, next)) || get().sequence !== ticket || get().workspace !== from || signal?.aborted) return false;
      set({ workspace: next });
      return true;
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (get().sequence === ticket) set({ pending: null });
    }
  },
};
