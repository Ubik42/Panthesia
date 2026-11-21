import { useEffect, useState } from "react";
import type { MediaExportKind } from "../engine/commands.generated";
import type { MediaExportSource } from "../features/exports/mediaExportStore";
import type { DeviceObject } from "../features/screens/MusicDeviceList";

export type DisplaySection = "display" | "appearance" | "keyboard" | "shortcuts" | "backup";

/** Which application dialogs are open, and their opening parameters. */
export function useAppDialogs() {
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const [displayDialog, setDisplayDialog] = useState(false);
  const [displaySection, setDisplaySection] = useState<DisplaySection | undefined>(undefined);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editDraftsOpen, setEditDraftsOpen] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [metadataDraftPath, setMetadataDraftPath] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"sound" | "duet">("sound");
  const [settingsDevice, setSettingsDevice] = useState<DeviceObject | undefined>();
  const [settingsReturnToScores, setSettingsReturnToScores] = useState(false);
  const [exerciseDialog, setExerciseDialog] = useState(false);
  const [passageDialog, setPassageDialog] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [songFilesOpen, setSongFilesOpen] = useState(false);
  const [mediaExport, setMediaExport] = useState<(MediaExportSource & { kind?: MediaExportKind }) | null>(null);

  // The application menu closes on Escape and on any click outside it or on one of its buttons.
  useEffect(() => {
    if (!appMenuOpen) return;
    const pointer = (event: MouseEvent) => {
      const target = event.target as Element;
      const toggle = target.closest('button[aria-label="应用菜单"]');
      const menu = target.closest(".workspace-topbar");
      if (!toggle && (!menu || target.closest("button"))) setAppMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppMenuOpen(false);
    };
    window.addEventListener("click", pointer);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", pointer);
      window.removeEventListener("keydown", key);
    };
  }, [appMenuOpen]);

  const openSoundSettings = (device?: DeviceObject) => {
    setSettingsDevice(device);
    setSettingsTab("sound");
    setSettingsReturnToScores(false);
    setSettings(true);
  };

  return {
    appMenuOpen, setAppMenuOpen,
    displayDialog, setDisplayDialog, displaySection, setDisplaySection,
    commandsOpen, setCommandsOpen,
    aboutOpen, setAboutOpen,
    editDraftsOpen, setEditDraftsOpen,
    metadata, setMetadata, metadataDraftPath, setMetadataDraftPath,
    settings, setSettings, settingsTab, setSettingsTab, settingsDevice, setSettingsDevice,
    settingsReturnToScores, setSettingsReturnToScores, openSoundSettings,
    exerciseDialog, setExerciseDialog,
    passageDialog, setPassageDialog,
    progressOpen, setProgressOpen,
    recoveryOpen, setRecoveryOpen,
    songFilesOpen, setSongFilesOpen,
    mediaExport, setMediaExport,
  };
}
