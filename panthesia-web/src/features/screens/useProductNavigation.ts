import { useRef } from "react";
import type { EngineCommand } from "../../api";
import type { Workspace } from "../../stores/route";
import type { useProductScreens } from "./useProductScreens";
/** Guarded engine transitions and page transitions form one navigation operation. */
export function useProductNavigation(options: {
  screens: ReturnType<typeof useProductScreens>;
  changeWorkspace: (next: Workspace, signal?: AbortSignal) => Promise<boolean>;
  run: (command: EngineCommand) => Promise<boolean>;
  clearLiveNotes: () => void;
  closeMenu: () => void;
}) {
  const current = useRef(options);
  current.current = options;
  const pending = useRef(false);
  const navigate = async (action: (o: typeof options) => Promise<boolean>) => {
    if (pending.current) return false;
    pending.current = true;
    try {
      return await action(current.current);
    } finally {
      pending.current = false;
    }
  };
  return {
    resumePractice: (signal?: AbortSignal) =>
      navigate(async (o) => {
        if (!(await o.changeWorkspace("practice", signal)) || signal?.aborted)
          return false;
        o.screens.resume();
        o.closeMenu();
        return true;
      }),
    goHome: () =>
      navigate(async (o) => {
        if (!(await o.changeWorkspace("home"))) return false;
        o.clearLiveNotes();
        o.screens.home();
        o.closeMenu();
        return true;
      }),
    openFreePlay: () =>
      navigate(async (o) => {
        if (
          !(await o.changeWorkspace("practice")) ||
          !(await o.run({ type: "pause" }))
        )
          return false;
        o.clearLiveNotes();
        o.screens.show("freePlay");
        return true;
      }),
  };
}
