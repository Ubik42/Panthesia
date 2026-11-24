import { create } from "zustand";
import type { MediaExportKind } from "../engine/commands.generated";
import type { MediaExportSource } from "../features/exports/mediaExportStore";
import type { DeviceObject } from "../features/screens/MusicDeviceList";

type Dialogs = {
  commandsOpen: boolean;
  aboutOpen: boolean;
  metadata: boolean;
  metadataDraftPath: string | null;
  settingsDevice: DeviceObject | undefined;
  exerciseDialog: boolean;
  passageDialog: boolean;
  progressOpen: boolean;
  recoveryOpen: boolean;
  mediaExport: (MediaExportSource & { kind?: MediaExportKind }) | null;
};

/** Which application dialogs are open, and their opening parameters. */
export const useDialogs = create<Dialogs>()(() => ({
  commandsOpen: false,
  aboutOpen: false,
  metadata: false,
  metadataDraftPath: null,
  settingsDevice: undefined,
  exerciseDialog: false,
  passageDialog: false,
  progressOpen: false,
  recoveryOpen: false,
  mediaExport: null,
}));

type Update<T> = T | ((previous: T) => T);
/** A setter with React's `setState` signature for one field of the store. */
const setter =
  <K extends keyof Dialogs>(key: K) =>
  (value: Update<Dialogs[K]>) =>
    useDialogs.setState((s) => ({ [key]: typeof value === "function" ? (value as (p: Dialogs[K]) => Dialogs[K])(s[key]) : value }) as Partial<Dialogs>);

export const dialogs = {
  setCommandsOpen: setter("commandsOpen"),
  setAboutOpen: setter("aboutOpen"),
  setMetadata: setter("metadata"),
  setMetadataDraftPath: setter("metadataDraftPath"),
  setSettingsDevice: setter("settingsDevice"),
  setExerciseDialog: setter("exerciseDialog"),
  setPassageDialog: setter("passageDialog"),
  setProgressOpen: setter("progressOpen"),
  setRecoveryOpen: setter("recoveryOpen"),
  setMediaExport: setter("mediaExport"),
};
