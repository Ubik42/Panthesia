import { useCallback, useRef, useState } from "react";
import type { Workspace } from "../../app/useWorkspaceNavigation";

/** Sections of the settings page (interface-design.md §6). */
export type SettingsSection = "devices" | "library" | "appearance" | "notes" | "keyboard" | "shortcuts" | "tools" | "backup" | "about";

/** Product pages own presentation; the existing workspace adapter owns guarded engine transitions. */
export function useProductScreens(workspace: Workspace) {
  const [front, setFront] = useState<"home" | "settings" | null>("home");
  const [practice, setPractice] = useState<"setup" | "parts" | "split" | "performance" | "freePlay">("setup");
  const [splitTrack, setSplitTrack] = useState<number | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("devices");
  // The page the settings page returns to: home, or the practice page it was opened from.
  const settingsReturn = useRef<"home" | null>("home");
  const screen = front ?? (workspace === "practice" ? practice : "home");
  const show = useCallback((page: typeof practice) => {
    setFront(null);
    setPractice(page);
  }, []);
  return {
    screen,
    splitTrack,
    settingsSection,
    setSettingsSection,
    home: () => setFront("home"),
    settings: (section?: SettingsSection) => {
      if (front !== "settings") settingsReturn.current = front === "home" || workspace !== "practice" ? "home" : null;
      if (section) setSettingsSection(section);
      setFront("settings");
    },
    leaveSettings: () => setFront(settingsReturn.current),
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
