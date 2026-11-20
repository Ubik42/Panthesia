import {
  normalizeDisplayPreferences,
  type DisplayPreferences,
} from "../../displayPreferences";
export const layoutKeys = [
  "uiScale",
  "practiceFocus", "practiceView", "practiceSplitAxis", "practiceSplitRatio",
  "libraryOpen",
  "inspector",
  "libraryWidth",
  "inspectorWidth",
  "keyboardHeight",
  "paperPreviewHeight",
] as const;
export type Layout = Pick<DisplayPreferences, (typeof layoutKeys)[number]>;
export interface SavedLayout {
  id: string;
  name: string;
  layout: Layout;
}
export const layoutStorage = "neothesia-layouts-v1";
export const extractLayout = (value: Layout): Layout =>
  Object.fromEntries(layoutKeys.map((key) => [key, value[key]])) as Layout;
export const canonicalSetting = (value: unknown): string => {
  if (Array.isArray(value))
    return "[" + value.map(canonicalSetting).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonicalSetting((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "undefined";
};
export const settingsObject = (
  value: unknown,
): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function decodeLayouts(raw: string | null): SavedLayout[] {
  if (raw === null) return [];
  if (raw.length > 500_000)
    throw new Error("保存的布局超过读取容量，原文已保留。");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("本机布局记录格式无法读取，原文已保留。");
  }
  if (!Array.isArray(value) || value.length > 24)
    throw new Error("保存的布局格式或数量无法读取，原文已保留。");
  const ids = new Set<string>(),
    names = new Set<string>();
  return value.map((row) => {
    if (
      !settingsObject(row) ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 100 ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      Array.from(row.name).length > 40 ||
      names.has(row.name) ||
      !settingsObject(row.layout)
    )
      throw new Error("布局名称或编号无法读取，原文已保留。");
    const layout = extractLayout(normalizeDisplayPreferences(row.layout));
    for (const key of layoutKeys)
      if (
        row.layout[key] !== undefined &&
        canonicalSetting(row.layout[key]) !== canonicalSetting(layout[key])
      )
        throw new Error("布局中有当前版本无法采用的尺寸或开关，原文已保留。");
    ids.add(row.id);
    names.add(row.name);
    return { id: row.id, name: row.name, layout };
  });
}
