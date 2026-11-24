import { useCallback, useEffect, useRef } from "react";
import type { Workspace } from "../stores/route";
import type { PlaybackStore } from "../features/practice/playbackStore";
import type { EngineCommand } from "../api";
import { samePlaybackSource } from "../features/practice/playbackCommands";
/** Opening an editor never adopts a late result from a different performance. */
export function usePracticeToolNavigation({
  toolContext,
  changeWorkspace,
  playback,
  run,
  setError,
}: {
  toolContext: string;
  changeWorkspace: (next: Workspace, signal?: AbortSignal) => Promise<boolean>;
  playback: PlaybackStore;
  run: (command: EngineCommand) => Promise<boolean>;
  setError: (value: string) => void;
}) {
  const toolIntent = useRef<{
    controller: AbortController;
    context: string;
  } | null>(null);
  useEffect(() => {
    if (toolIntent.current && toolIntent.current.context !== toolContext)
      toolIntent.current.controller.abort();
  }, [toolContext]);
  useEffect(
    () => () => {
      toolIntent.current?.controller.abort();
    },
    [],
  );
  const openPracticeTool = useCallback(
    async (signal: AbortSignal | undefined, open: () => void, pause = true) => {
      toolIntent.current?.controller.abort();
      const intent = new AbortController();
      toolIntent.current = { controller: intent, context: toolContext };
      const abort = () => intent.abort();
      if (signal?.aborted) intent.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const origin = playback.getSnapshot();
      try {
        if (
          !(await changeWorkspace("practice", intent.signal)) ||
          intent.signal.aborted
        )
          return false;
        if (
          pause &&
          ["playing", "countIn"].includes(playback.getSnapshot().status)
        ) {
          if (!(await run({ type: "pause" })) || intent.signal.aborted)
            return false;
        }
        if (intent.signal.aborted) return false;
        const current = playback.getSnapshot();
        if (!samePlaybackSource(origin, current))
          throw new Error("当前练习已改变，请重新选择要执行的操作。");
        open();
        return true;
      } finally {
        signal?.removeEventListener("abort", abort);
        if (toolIntent.current?.controller === intent)
          toolIntent.current = null;
      }
    },
    [changeWorkspace, playback, run, toolContext],
  );
  const launchPracticeTool = useCallback(
    (open: () => void) => {
      void openPracticeTool(undefined, open).catch((failure) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
    },
    [openPracticeTool, setError],
  );
  return { openPracticeTool, launchPracticeTool };
}
