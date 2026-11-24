import { useCallback, type MutableRefObject } from "react";
import type { EngineCommand } from "../api";
import type { ControlSnapshot, PlaybackStore } from "../features/practice/playbackStore";
import { route, type Workspace } from "../stores/route";

/** The guarded change between home and the open song (stores/route `request`), and why it is
 * not possible right now. */
export function useWorkspaceChange(o: {
  workspace: Workspace;
  busy: boolean;
  startupReady: boolean;
  state: ControlSnapshot;
  binding: boolean;
  requestPending: boolean;
  requestBusy: MutableRefObject<boolean>;
  playback: PlaybackStore;
  run: (command: EngineCommand) => Promise<boolean>;
  clearLiveNotes: () => void;
  openPath: MutableRefObject<(path: string) => Promise<boolean>>;
}) {
  const { workspace, busy, startupReady, state, requestBusy, playback, run, clearLiveNotes } = o;
  const changeWorkspace = useCallback(async (next: Workspace, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (next === workspace) { route.navigate(next); return true; }
    if (requestBusy.current || busy || !startupReady || state.recording) return false;
    clearLiveNotes();
    const originEngine = playback.getEngineId();
    return route.request(next, async (from, to) => {
      if (from === "practice" && to !== "practice" && !(await run({ type: "pause" }))) return false;
      const live = playback.getSnapshot();
      return originEngine === live.stateOrder?.engineId && !requestBusy.current &&
        !live.recording && live.startup?.ready !== false && !live.storage?.operation;
    }, signal);
  }, [busy, startupReady, state.recording, workspace, run, clearLiveNotes, playback, requestBusy]);
  const workspaceUnavailable = o.binding ? "正在读取当前练习，完成后可切换工作区。"
    : state.storage?.operation ? "正在保存练习资料，完成后可切换工作区。"
    : state.storage?.error ? "练习资料保存需要处理，请查看恢复入口。"
    : o.requestPending ? "正在处理当前操作，完成后可切换工作区。"
    : !startupReady ? "启动恢复完成后可切换工作区。"
    : state.recording ? "请先停止录音，再切换工作区。"
    : null;
  /** Return to the song being edited (a work entry's source), opening its file if needed. */
  const resumeEditingSong = async (contentId: string, path?: string) => {
    if (!(await changeWorkspace("practice"))) return false;
    if (playback.getSnapshot().contentId !== contentId) {
      if (!path || !(await o.openPath.current(path))) return false;
    }
    return playback.getSnapshot().contentId === contentId;
  };
  return { changeWorkspace, workspaceUnavailable, resumeEditingSong };
}
