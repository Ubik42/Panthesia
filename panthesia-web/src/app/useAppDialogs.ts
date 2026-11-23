import { useEffect, useState } from "react";
import type { MediaExportKind } from "../engine/commands.generated";
import type { MediaExportSource } from "../features/exports/mediaExportStore";
import type { DeviceObject } from "../features/screens/MusicDeviceList";

/** Which application dialogs are open, and their opening parameters. */
export function useAppDialogs() {
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editDraftsOpen, setEditDraftsOpen] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [metadataDraftPath, setMetadataDraftPath] = useState<string | null>(null);
  const [settingsDevice, setSettingsDevice] = useState<DeviceObject | undefined>();
  const [exerciseDialog, setExerciseDialog] = useState(false);
  const [passageDialog, setPassageDialog] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [mediaExport, setMediaExport] = useState<(MediaExportSource & { kind?: MediaExportKind }) | null>(null);

  return {

    commandsOpen, setCommandsOpen,
    aboutOpen, setAboutOpen,
    editDraftsOpen, setEditDraftsOpen,
    metadata, setMetadata, metadataDraftPath, setMetadataDraftPath,
    settingsDevice, setSettingsDevice,
    exerciseDialog, setExerciseDialog,
    passageDialog, setPassageDialog,
    progressOpen, setProgressOpen,
    recoveryOpen, setRecoveryOpen,
    mediaExport, setMediaExport,
  };
}
