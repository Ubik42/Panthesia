import { useEffect, useState } from "react";
import type { MediaExportKind } from "../engine/commands.generated";
import type { MediaExportSource } from "../features/exports/mediaExportStore";
import type { DeviceObject } from "../features/screens/MusicDeviceList";

export type DisplaySection = "display" | "appearance" | "keyboard" | "shortcuts" | "backup";

/** Which application dialogs are open, and their opening parameters. */
export function useAppDialogs() {
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
  const [mediaExport, setMediaExport] = useState<(MediaExportSource & { kind?: MediaExportKind }) | null>(null);

  const openSoundSettings = (device?: DeviceObject) => {
    setSettingsDevice(device);
    setSettingsTab("sound");
    setSettingsReturnToScores(false);
    setSettings(true);
  };

  return {

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
    mediaExport, setMediaExport,
  };
}
