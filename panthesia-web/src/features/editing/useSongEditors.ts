import { useCallback, useRef, useState, useEffect } from "react";
import type { LoadedSong } from "../../api";
export type SongEditor =
  "options" | "scores" | "meter" | "hands" | "fingering" | "fingeringWorkbench";
type Toggle = boolean | ((current: boolean) => boolean);
/** Editors share a source-bound stack. Only the top editor mounts; saved drafts remain in their stores. */
export function useSongEditors(song: LoadedSong | null) {
  const scope = JSON.stringify([song?.engineId, song?.contentId]);
  const current = useRef(scope);
  current.current = scope;
  const [state, setState] = useState<{ scope: string; stack: SongEditor[] }>({
    scope,
    stack: [],
  });
  useEffect(() => {
    setState((previous) =>
      previous.scope === scope ? previous : { scope, stack: [] },
    );
  }, [scope]);
  const active = state.scope === scope ? (state.stack.at(-1) ?? null) : null;
  const toggle = useCallback(
    (kind: SongEditor, value: Toggle) =>
      setState((previous) => {
        const stack = previous.scope === current.current ? previous.stack : [];
        const open =
          typeof value === "function" ? value(stack.at(-1) === kind) : value;
        if (!open)
          return {
            scope: current.current,
            stack: stack.filter((item) => item !== kind),
          };
        const index = stack.indexOf(kind);
        return {
          scope: current.current,
          stack: index >= 0 ? stack.slice(0, index + 1) : [...stack, kind],
        };
      }),
    [],
  );
  const setSongOptions = useCallback(
    (value: Toggle) => toggle("options", value),
    [toggle],
  );
  const setScoresDialog = useCallback(
    (value: Toggle) => toggle("scores", value),
    [toggle],
  );
  const setMeterDialog = useCallback(
    (value: Toggle) => toggle("meter", value),
    [toggle],
  );
  const setHandsDialog = useCallback(
    (value: Toggle) => toggle("hands", value),
    [toggle],
  );
  const setFingeringDialog = useCallback(
    (value: Toggle) => toggle("fingering", value),
    [toggle],
  );
  const setFingeringWorkbenchOpen = useCallback(
    (value: Toggle) => toggle("fingeringWorkbench", value),
    [toggle],
  );
  return {
    active,
    songOptions: active === "options",
    scoresDialog: active === "scores",
    meterDialog: active === "meter",
    handsDialog: active === "hands",
    fingeringDialog: active === "fingering",
    fingeringWorkbenchOpen: active === "fingeringWorkbench",
    setSongOptions,
    setScoresDialog,
    setMeterDialog,
    setHandsDialog,
    setFingeringDialog,
    setFingeringWorkbenchOpen,
  };
}
