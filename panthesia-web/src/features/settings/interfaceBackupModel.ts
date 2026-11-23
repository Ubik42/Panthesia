import { getInterfaceSettings } from "./interfaceSettingsStore";
import {
  normalizeDisplayPreferences,
  type DisplayPreferences,
} from "./displayPreferences";
import { layoutKeys, extractLayout, type SavedLayout } from "./layoutModel";
import { normalizeShortcuts, shortcutActions } from "../../app/shortcuts";
import { canonicalSetting } from "./layoutModel";
export const settingsGroups = {
  display: [
    "pianoMaterial", "effectStyle", "barOpacity", "beatOpacity", "subdivisionOpacity", "gridSubdivision",
    "effectsEnabled", "effectsPreset", "effectsPalette", "effectsIntensity", "reduceMotion",
    "keyLabelMode", "noteLabelMode", "keyLabelsOwnOnly", "noteLabelsOwnOnly",
    "notation",
    "noteLabels",
    "keyLabels",
    "tonic",
    "octave",
    "fontSize",
    "palette",
    "range", "keyboardViewport", "keyboardLow", "keyboardHigh", "keyboardDeviceRanges",
    "previewBars", "loopPreview", "chordLabels", "lyrics", "sections", "meterLabels", "backgroundOpacity", "ledStrip", "recordBpm", "recordClick",
    ...layoutKeys,
  ],
  keyboard: ["keyboardEnabled", "keyboardOctave", "keyCodes"],
  shortcuts: ["shortcuts"],
} as const;
export const groupNames = {
  display: "显示与面板",
  keyboard: "电脑键盘弹奏",
  shortcuts: "操作快捷键",
};
export type Group = keyof typeof settingsGroups;
export type InterfaceBackup = {
  format: "neothesia-interface-settings";
  version: 1;
  createdAt: string;
  preferences: DisplayPreferences;
  layouts: SavedLayout[];
};
export const canonical = canonicalSetting;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function decodeInterfaceBackup(text: string): InterfaceBackup {
  if (new Blob([text]).size > 1_000_000)
    throw new Error("界面设置备份超过 1 MB");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的界面设置备份");
  }
  if (
    !object(raw) ||
    raw.format !== "neothesia-interface-settings" ||
    raw.version !== 1 ||
    !object(raw.preferences) ||
    !Array.isArray(raw.layouts) ||
    raw.layouts.length > 24
  )
    throw new Error("界面设置备份类型、版本或布局数量不支持");
  const sourcePrefs: Record<string, unknown> = {
    ...raw.preferences,
    shortcuts:
      typeof raw.preferences.shortcuts === "object" &&
      raw.preferences.shortcuts !== null
        ? { ...(raw.preferences.shortcuts as Record<string, unknown>) }
        : raw.preferences.shortcuts,
  };
  const prefs = normalizeDisplayPreferences(
      sourcePrefs as Partial<DisplayPreferences>,
    ),
    fields = Object.values(settingsGroups).flat();
  for (const key of fields)
    if (
      key !== "shortcuts" &&
      !(sourcePrefs[key] === undefined && ["keyLabelMode","noteLabelMode","keyLabelsOwnOnly","noteLabelsOwnOnly","keyboardViewport","practiceView","practiceSplitAxis","practiceSplitRatio","keyboardLow","keyboardHigh","keyboardDeviceRanges","practiceFocus","pianoMaterial","effectStyle","barOpacity","beatOpacity","subdivisionOpacity","gridSubdivision","effectsEnabled","effectsPreset","effectsPalette","effectsIntensity","reduceMotion"].includes(key)) &&
      !(key === "uiScale" && raw.preferences[key] === undefined) &&
      canonical(prefs[key]) !== canonical(sourcePrefs[key])
    )
      throw new Error("备份含有无效设置或相互冲突的快捷键，未应用");
  const sourceShortcuts = sourcePrefs.shortcuts;
  if (
    !object(sourceShortcuts) ||
    shortcutActions.some(
      (action) =>
        Object.prototype.hasOwnProperty.call(sourceShortcuts, action.id) &&
        sourceShortcuts[action.id] !== prefs.shortcuts[action.id],
    )
  )
    throw new Error("备份的快捷键无效或互相冲突，请保留原文件后核对。");
  const ids = new Set(),
    names = new Set();
  const layouts = raw.layouts.map((v) => {
    if (
      !object(v) ||
      typeof v.id !== "string" ||
      !v.id ||
      v.id.length > 100 ||
      ids.has(v.id) ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      Array.from(v.name).length > 40 ||
      names.has(v.name) ||
      !object(v.layout)
    )
      throw new Error("备份的布局名称或身份无效/重复");
    const normalized = extractLayout(normalizeDisplayPreferences(v.layout));
    for (const key of layoutKeys)
      if (
        !(["uiScale", "practiceFocus", "practiceView", "practiceSplitAxis", "practiceSplitRatio"].includes(key) && v.layout[key] === undefined) &&
        canonical(normalized[key]) !== canonical(v.layout[key])
      )
        throw new Error(`「${v.name}」的布局尺寸或开关无效`);
    ids.add(v.id);
    names.add(v.name);
    return { id: v.id, name: v.name, layout: normalized };
  });
  return {
    format: "neothesia-interface-settings",
    version: 1,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    preferences: prefs,
    layouts,
  };
}
export function interfaceSnapshot(
  preferences: DisplayPreferences,
): InterfaceBackup {
  const values = getInterfaceSettings().exportValues();
  return {
    format: "neothesia-interface-settings",
    version: 1,
    createdAt: new Date().toISOString(),
    ...values,
    preferences: {
      ...values.preferences,
      ...preferences,
      shortcuts: { ...values.preferences.shortcuts, ...preferences.shortcuts },
    },
  };
}
export function interfaceBaseline(preferences: DisplayPreferences) {
  return canonical([preferences, getInterfaceSettings().baseline()]);
}
export async function restoreInterface(
  backup: InterfaceBackup,
  current: DisplayPreferences,
  baseline: string,
  groups: Record<Group, boolean>,
  policies: Record<string, "keep" | "replace" | "skip">,
): Promise<DisplayPreferences> {
  if (interfaceBaseline(current) !== baseline)
    throw new Error("本机设置或布局已变化，请重新核对后恢复");
  const store = getInterfaceSettings(),
    expected = store.baseline();
  const plan = planInterfaceRestore(
    backup,
    current,
    store.getSnapshot().layouts,
    groups,
    policies,
    () => crypto.randomUUID(),
  );
  await store.restore(plan.preferences, plan.layouts, expected);
  return plan.preferences;
}
export function planInterfaceRestore(
  backup: InterfaceBackup,
  current: DisplayPreferences,
  currentLayouts: SavedLayout[],
  groups: Record<Group, boolean>,
  policies: Record<string, "keep" | "replace" | "skip">,
  makeId: (source: SavedLayout) => string = (source) => "import:" + source.id,
) {
  const result = { ...current };
  for (const [group, fields] of Object.entries(settingsGroups))
    if (groups[group as Group])
      for (const field of fields)
        (result as unknown as Record<string, unknown>)[field] =
          backup.preferences[field];
  if (
    canonical(normalizeShortcuts(result.shortcuts, result.keyCodes)) !==
    canonical(result.shortcuts)
  )
    throw new Error(
      "恢复后的操作快捷键与弹奏键冲突，请同时恢复两组或保留其中一组后重新核对",
    );
  const layouts = currentLayouts.map((row) => ({
    ...row,
    layout: { ...row.layout },
  }));
  for (const source of backup.layouts) {
    const policy = policies[source.id] ?? "skip";
    if (policy !== "keep" && policy !== "replace") continue;
    const i = layouts.findIndex((v) => v.name === source.name);
    if (i >= 0) {
      if (policy === "replace") layouts[i] = { ...source, id: layouts[i].id };
    } else {
      const baseId = makeId(source);
      let id = baseId,
        suffix = 1;
      while (layouts.some((row) => row.id === id)) id = baseId + ":" + suffix++;
      layouts.push({ ...source, id });
    }
  }
  if (layouts.length > 24)
    throw new Error("恢复后超过 24 个布局，请减少所选方案");
  const changedFields = (
    Object.keys(result) as (keyof DisplayPreferences)[]
  ).filter((key) => canonical(result[key]) !== canonical(current[key]));
  const addedLayouts = layouts.filter(
    (row) => !currentLayouts.some((old) => old.id === row.id),
  ).length;
  const changedLayouts = layouts.filter((row) =>
    currentLayouts.some(
      (old) => old.id === row.id && canonical(old) !== canonical(row),
    ),
  ).length;
  const changedSettings =
    changedFields.filter((key) => key !== "shortcuts").length +
    shortcutActions.filter(
      (action) => result.shortcuts[action.id] !== current.shortcuts[action.id],
    ).length;
  return {
    preferences: result,
    layouts,
    changedFields,
    changedSettings,
    addedLayouts,
    changedLayouts,
  };
}
