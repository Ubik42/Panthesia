import { useCallback, useState } from "react";
import type { Workspace } from "../../app/useWorkspaceNavigation";
/** Product pages own presentation; the existing workspace adapter owns guarded engine transitions. */
export function useProductScreens(workspace: Workspace) {
  const [front, setFront] = useState<"home" | "settings" | null>(
    "home",
  );
  const [practice, setPractice] = useState<
    "setup" | "parts" | "split" | "performance" | "freePlay"
  >("setup");
  const [splitTrack, setSplitTrack] = useState<number | null>(null);
  const screen = front ?? (workspace === "practice" ? practice : "library");
  const show = useCallback((page: typeof practice) => {
    setFront(null);
    setPractice(page);
  }, []);
  return {
    screen,
    splitTrack,
    home: () => setFront("home"),
    settings: () => setFront("settings"),
    browse: () => setFront(null),
    resume: () => setFront(null),
    show,
    split: (track: number) => {
      setSplitTrack(track);
      show("split");
    },
    setSongSetup: (value: boolean) => show(value ? "setup" : "performance"),
  };
}
