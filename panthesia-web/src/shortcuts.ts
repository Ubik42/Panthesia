export const shortcutActions = [
  { id: "bookmark1", label: "定位第 1 个书签", key: "Alt+Digit1" },
  { id: "bookmark2", label: "定位第 2 个书签", key: "Alt+Digit2" },
  { id: "bookmark3", label: "定位第 3 个书签", key: "Alt+Digit3" },
  { id: "bookmark4", label: "定位第 4 个书签", key: "Alt+Digit4" },
  { id: "bookmark5", label: "定位第 5 个书签", key: "Alt+Digit5" },
  { id: "bookmark6", label: "定位第 6 个书签", key: "Alt+Digit6" },
  { id: "bookmark7", label: "定位第 7 个书签", key: "Alt+Digit7" },
  { id: "bookmark8", label: "定位第 8 个书签", key: "Alt+Digit8" },
  { id: "bookmark9", label: "定位第 9 个书签", key: "Alt+Digit9" },
  { id: "playPause", label: "播放 / 暂停", key: "Space" },
  { id: "restart", label: "从头开始", key: "Ctrl+Home" },
  { id: "previousMeasure", label: "上一小节", key: "Alt+ArrowLeft" },
  { id: "nextMeasure", label: "下一小节", key: "Alt+ArrowRight" },
  { id: "slower", label: "速度降低 5%", key: "Ctrl+Minus" },
  { id: "faster", label: "速度提高 5%", key: "Ctrl+Equal" },
  { id: "metronome", label: "开关节拍器", key: "Ctrl+KeyM" },
  { id: "view", label: "切换键盘 / 乐谱 / 纸谱", key: "Alt+KeyV" },
  { id: "library", label: "显示 / 隐藏曲库", key: "Alt+KeyB" },
  { id: "inspector", label: "显示 / 隐藏练习参数", key: "Alt+KeyI" },
  { id: "display", label: "打开界面与按键", key: "Ctrl+Comma" },
  { id: "history", label: "打开练习历史", key: "Alt+KeyH" },
  { id: "passages", label: "打开练习段落", key: "Alt+KeyP" },
  { id: "libraryManager", label: "打开曲库管理", key: "Alt+KeyL" },
  { id: "loop", label: "开关分段循环", key: "Alt+KeyC" },
  { id: "zoomIn", label: "放大界面", key: "Alt+Shift+Equal" },
  { id: "zoomOut", label: "缩小界面", key: "Alt+Shift+Minus" },
  { id: "zoomReset", label: "恢复 100% 缩放", key: "Alt+Shift+Digit0" },
  { id: "silence", label: "暂停并停止发声", key: null },
  { id: "commands", label: "查找应用操作", key: "Ctrl+KeyK" },
] as const;
export type ShortcutAction = (typeof shortcutActions)[number]["id"];
export type Shortcuts = Record<ShortcutAction, string | null>;
export const shortcutDefaults = Object.fromEntries(
  shortcutActions.map((a) => [a.id, a.key]),
) as Shortcuts;
const codePattern =
  /^(Key[A-Z]|Digit[0-9]|F[1-46-9]|F10|Space|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Comma|Period|Semicolon|Minus|Equal|BracketLeft|BracketRight)$/;
export function shortcutError(
  chord: string,
  pianoKeys: string[],
): string | null {
  const parts = chord.split("+"),
    code = parts.at(-1)!,
    mods = parts.slice(0, -1);
  if (
    !codePattern.test(code) ||
    mods.some((m) => !["Ctrl", "Alt", "Shift"].includes(m)) ||
    new Set(mods).size !== mods.length ||
    [...mods]
      .sort(
        (a, b) =>
          ["Ctrl", "Alt", "Shift"].indexOf(a) -
          ["Ctrl", "Alt", "Shift"].indexOf(b),
      )
      .join("+") !== mods.join("+")
  )
    return "请选择字母、数字、方向键、空格或可用功能键，可搭配 Ctrl、Alt、Shift。";
  if (
    (mods.includes("Alt") && ["F4", "Space"].includes(code)) ||
    (mods.includes("Ctrl") &&
      ["KeyL", "KeyR", "KeyT", "KeyW", "KeyN", "KeyP"].includes(code))
  )
    return "这个组合保留给窗口或浏览器，请选择其他按键。";
  if (!mods.length && pianoKeys.includes(code))
    return "这个键已用于电脑键盘弹奏，请加组合键或更换按键。";
  return null;
}
export function eventShortcut(e: KeyboardEvent) {
  if (e.metaKey || e.isComposing) return null;
  return [
    e.ctrlKey ? "Ctrl" : null,
    e.altKey ? "Alt" : null,
    e.shiftKey ? "Shift" : null,
    e.code,
  ]
    .filter(Boolean)
    .join("+");
}
export function shortcutLabel(chord: string | null) {
  if (!chord) return "未分配";
  return chord
    .split("+")
    .map(
      (v) =>
        ({
          Space: "空格",
          ArrowLeft: "←",
          ArrowRight: "→",
          ArrowUp: "↑",
          ArrowDown: "↓",
          Comma: ",",
          Period: ".",
          Semicolon: ";",
          Minus: "−",
          Equal: "=",
          BracketLeft: "[",
          BracketRight: "]",
        })[v] ?? v.replace(/^(Key|Digit)/, ""),
    )
    .join(" + ");
}
export function normalizeShortcuts(raw: unknown, keys: string[]): Shortcuts {
  const result = { ...shortcutDefaults },
    used = new Set<string>();
  // Existing assignments keep priority when a newer version introduces defaults.
  const explicit = (id: ShortcutAction) =>
    !!raw &&
    typeof raw === "object" &&
    Object.prototype.hasOwnProperty.call(raw, id);
  const ordered = [
    ...shortcutActions.filter((action) => explicit(action.id)),
    ...shortcutActions.filter((action) => !explicit(action.id)),
  ];
  for (const a of ordered) {
    const v = explicit(a.id) ? (raw as Record<string, unknown>)[a.id] : a.key;
    const chord =
      typeof v === "string" && !shortcutError(v, keys) && !used.has(v)
        ? v
        : null;
    result[a.id] = chord;
    if (chord) used.add(chord);
  }
  return result;
}
