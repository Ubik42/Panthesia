import { createPersistentSession } from "../../app/createPersistentSession";
import {
  decodeInterfaceBackup,
  type InterfaceBackup,
  type Group,
} from "./interfaceBackupModel";
import {
  normalizeDisplayPreferences,
  type DisplayPreferences,
} from "../../displayPreferences";
import {
  canonicalSetting,
  decodeLayouts,
  settingsObject,
  type SavedLayout,
} from "./layoutModel";
import { activitySignal } from "../activity/activitySignal";

export type SettingsSection =
  "display" | "layout" | "keyboard" | "shortcuts" | "backup";
export interface InterfacePreview {
  backup: InterfaceBackup;
  baseline: string;
  current: DisplayPreferences;
  layouts: SavedLayout[];
  filename: string;
}
export interface InterfaceExport {
  id: string;
  createdAt: string;
  contents: string;
  path: string | null;
  phase: "prepared" | "saving" | "saved" | "requested" | "unknown";
}
export interface InterfaceWorkbench {
  version: 1;
  section: SettingsSection;
  selected: string;
  name: string;
  selectedBaseline: string;
  preview: InterfacePreview | null;
  groups: Record<Group, boolean>;
  policies: Record<string, "keep" | "replace" | "skip">;
  status: string;
  error: string;
  busy: boolean;
  storageError: string;
  exportPath: string;
  preparedExport: InterfaceExport | null;
  deletedLayout: { row: SavedLayout; raw: string; deletedAt: number } | null;
  shortcutQuery: string;
  shortcutFilter: "all" | "custom" | "unassigned";
  onlyDifferences: boolean;
  layoutNames: Record<string, string>;
}
const initial = (): InterfaceWorkbench => ({
  version: 1,
  section: "display",
  selected: "",
  name: "",
  selectedBaseline: "",
  preview: null,
  groups: { display: true, keyboard: true, shortcuts: true },
  policies: {},
  status: "",
  error: "",
  busy: false,
  storageError: "",
  exportPath: "",
  preparedExport: null,
  deletedLayout: null,
  shortcutQuery: "",
  shortcutFilter: "all",
  onlyDifferences: true,
  layoutNames: {},
});
function decode(raw: string | null): InterfaceWorkbench {
  const empty = initial();
  if (raw === null) return empty;
  try {
    if (raw.length > 4_000_000) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (
      !settingsObject(value) ||
      value.version !== 1 ||
      !["display", "layout", "keyboard", "shortcuts", "backup"].includes(
        String(value.section),
      )
    )
      throw new Error();
    if (
      value.layoutNames !== undefined &&
      (!settingsObject(value.layoutNames) ||
        Object.keys(value.layoutNames).length > 25 ||
        Object.entries(value.layoutNames).some(
          ([key, name]) =>
            key.length > 110 || typeof name !== "string" || name.length > 160,
        ))
    )
      throw new Error();
    for (const key of [
      "selected",
      "name",
      "selectedBaseline",
      "status",
      "error",
      "exportPath",
    ] as const)
      if (
        typeof value[key] !== "string" ||
        value[key].length >
          (key === "selectedBaseline"
            ? 500_000
            : key === "selected"
              ? 100
              : key === "name"
                ? 160
                : 4096)
      )
        throw new Error();
    if (
      (value.shortcutQuery !== undefined &&
        (typeof value.shortcutQuery !== "string" ||
          value.shortcutQuery.length > 200)) ||
      (value.shortcutFilter !== undefined &&
        !["all", "custom", "unassigned"].includes(
          String(value.shortcutFilter),
        )) ||
      (value.onlyDifferences !== undefined &&
        typeof value.onlyDifferences !== "boolean")
    )
      throw new Error();
    const groups = value.groups;
    if (
      !settingsObject(groups) ||
      !["display", "keyboard", "shortcuts"].every(
        (key) => typeof groups[key] === "boolean",
      ) ||
      !settingsObject(value.policies) ||
      Object.keys(value.policies).length > 24 ||
      !Object.values(value.policies).every((policy) =>
        ["keep", "replace", "skip"].includes(String(policy)),
      )
    )
      throw new Error();
    let preview: InterfacePreview | null = null;
    if (value.preview !== null) {
      const source = value.preview;
      if (
        !settingsObject(source) ||
        typeof source.baseline !== "string" ||
        source.baseline.length > 2_000_000 ||
        typeof source.filename !== "string" ||
        source.filename.length > 4096 ||
        !settingsObject(source.current)
      )
        throw new Error();
      const current = normalizeDisplayPreferences(source.current);
      if (canonicalSetting(current) !== canonicalSetting(source.current))
        throw new Error();
      preview = {
        backup: decodeInterfaceBackup(JSON.stringify(source.backup)),
        baseline: source.baseline,
        filename: source.filename,
        current,
        layouts: decodeLayouts(JSON.stringify(source.layouts)),
      };
    }
    let preparedExport: InterfaceExport | null = null;
    if (value.preparedExport != null) {
      const record = value.preparedExport;
      if (
        !settingsObject(record) ||
        typeof record.id !== "string" ||
        !record.id ||
        record.id.length > 100 ||
        typeof record.createdAt !== "string" ||
        record.createdAt.length > 100 ||
        typeof record.contents !== "string" ||
        new Blob([record.contents]).size > 1_000_000 ||
        !["prepared", "saving", "saved", "requested", "unknown"].includes(
          String(record.phase),
        ) ||
        (record.path !== null &&
          (typeof record.path !== "string" || record.path.length > 4096))
      )
        throw new Error();
      decodeInterfaceBackup(record.contents);
      preparedExport = {
        ...record,
        phase: record.phase === "saving" ? "unknown" : record.phase,
      } as InterfaceExport;
    }
    let deletedLayout: InterfaceWorkbench["deletedLayout"] = null;
    if (value.deletedLayout != null) {
      const deleted = value.deletedLayout;
      if (
        !settingsObject(deleted) ||
        typeof deleted.raw !== "string" ||
        deleted.raw.length > 500_000 ||
        typeof deleted.deletedAt !== "number" ||
        !Number.isFinite(deleted.deletedAt)
      )
        throw new Error();
      const rows = decodeLayouts("[" + deleted.raw + "]");
      if (canonicalSetting(rows[0]) !== canonicalSetting(deleted.row))
        throw new Error();
      deletedLayout = {
        row: rows[0],
        raw: deleted.raw,
        deletedAt: deleted.deletedAt,
      };
    }
    return {
      ...empty,
      ...value,
      preview,
      preparedExport,
      deletedLayout,
      busy: false,
      storageError: "",
    } as InterfaceWorkbench;
  } catch {
    return {
      ...empty,
      storageError: "设置窗口的上次输入暂时无法读取，原文已保留。",
    };
  }
}
function createStore() {
  const session = createPersistentSession<InterfaceWorkbench>(decode, {
    key: "neothesia.interface-workbench.v1",
    maxCharacters: 4_000_000,
    failureMessage: "设置窗口输入暂存失败，当前输入继续保留。",
  });
  session.subscribe(() => activitySignal.changed());
  return session;
}
let instance: ReturnType<typeof createStore> | undefined;
export const getInterfaceWorkbench = () => (instance ??= createStore());
export const hasInterfaceInput = (state: InterfaceWorkbench) =>
  !!(
    state.name ||
    state.preview ||
    state.preparedExport ||
    state.deletedLayout
  );

export const hasLayoutNameInput = (
  state: InterfaceWorkbench,
  layouts: SavedLayout[],
) => {
  const row = layouts.find((item) => item.id === state.selected);
  return !!state.name.trim() && (!row || row.name !== state.name.trim());
};
