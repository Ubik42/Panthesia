import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../api";

export type ExternalProgramKind = "musescore" | "audiveris";
export interface ExternalProgramStatus {
  available: boolean;
  supported?: boolean;
  path: string | null;
  source: "selected" | "environment" | "installed" | null;
  message: string;
  cancelled?: boolean;
}
interface State {
  status: ExternalProgramStatus | null;
  checking: boolean;
  changing: boolean;
  error: string;
  message: string;
}
const adapters = {
  musescore: { read: api.museScoreProgramStatus, select: api.selectMuseScoreProgram, reset: api.resetMuseScoreProgram },
  audiveris: { read: api.audiverisProgramStatus, select: api.selectAudiverisProgram, reset: api.resetAudiverisProgram },
};
function checked(value: ExternalProgramStatus): ExternalProgramStatus {
  if (!value || typeof value.available !== "boolean" || typeof value.message !== "string"
    || value.path !== null && typeof value.path !== "string"
    || value.source !== null && !["selected", "environment", "installed"].includes(value.source)
    || value.cancelled !== undefined && typeof value.cancelled !== "boolean"
    || value.supported !== undefined && typeof value.supported !== "boolean") {
    throw new Error("程序位置回复无法完整读取，原设置保留。请重新检查。");
  }
  return value;
}
function createSlot(kind: ExternalProgramKind) {
  let state: State = { status: null, checking: false, changing: false, error: "", message: "" };
  let initialized = false, checkedAt = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const run = async (action: "read" | "select" | "reset") => {
    if (!api.desktop || state.checking || state.changing) return;
    initialized = true;
    publish({ checking: action === "read", changing: action !== "read", error: "", message: "" });
    try {
      const value = checked(await adapters[kind][action]());
      checkedAt = Date.now();
      publish({ status: value, message: value.cancelled ? "选择已取消，原程序设置保留。" : action === "reset" ? "已恢复自动查找。" : action === "select" ? "程序位置已保存。" : "" });
    } catch (error) {
      initialized = false;
      publish({ error: error instanceof Error ? error.message : String(error) });
    } finally { publish({ checking: false, changing: false }); }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => { if (!initialized || Date.now() - checkedAt > 5000) void run("read"); },
    refresh: () => run("read"), select: () => run("select"), reset: () => run("reset"),
  };
}
const programs = { musescore: createSlot("musescore"), audiveris: createSlot("audiveris") };
/** Program configuration has application lifetime; changing songs never retargets a pending picker. */
export function useExternalProgram(kind: ExternalProgramKind, enabled = true) {
  const slot = programs[kind];
  const state = useSyncExternalStore(slot.subscribe, slot.getSnapshot, slot.getSnapshot);
  useEffect(() => { if (enabled && api.desktop) slot.load(); }, [slot, enabled]);
  return { ...state, kind, refresh: slot.refresh, select: slot.select, reset: slot.reset };
}
export type ExternalProgramController = ReturnType<typeof useExternalProgram>;
