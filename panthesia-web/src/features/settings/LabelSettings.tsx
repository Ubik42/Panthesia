import {
  productLabel,
  type LabelMode,
  type DisplayPreferences,
} from "./displayPreferences";

const modes: [LabelMode, string][] = [
  ["none", "不显示"],
  ["octaves", "八度编号"],
  ["finger", "指法数字"],
  ["mapping", "电脑键盘映射"],
  ["english", "字母音名"],
  ["degree", "音阶级数"],
  ["fixed", "固定唱名"],
  ["movable", "首调唱名"],
  ["simple", "简单音名（白键）"],
  ["legacy", "沿用已有标签设置"],
];

type LabelContext = { tonic?: number; minor?: boolean; fifths?: number };

/** One label choice (keys or falling notes), each option with its example for middle C. With
 * `compact` it has no row name (the stage bar: the name is in the tooltip). */
export function LabelSelect({
  target,
  value,
  change,
  context = {},
  compact = false,
  className,
}: {
  target: "key" | "note";
  value: DisplayPreferences;
  change: (patch: Partial<DisplayPreferences>) => void;
  context?: LabelContext;
  compact?: boolean;
  className?: string;
}) {
  const mode = target === "key" ? value.keyLabelMode : value.noteLabelMode;
  const name = target === "key" ? "琴键标签" : "音符标签";
  const select = (
    <select
      aria-label={`${name}内容`}
      title={compact ? name : undefined}
      className={compact ? className : undefined}
      value={mode}
      onChange={(e) => {
        const id = e.target.value as LabelMode;
        change(target === "key" ? { keyLabelMode: id } : { noteLabelMode: id });
      }}
    >
      {modes
        .filter(([id]) => id !== "legacy" || mode === "legacy")
        .map(([id, label]) => {
          const example = productLabel(
            60,
            target,
            { ...value, ...(target === "key" ? { keyLabelMode: id, keyLabelsOwnOnly: false } : { noteLabelMode: id, noteLabelsOwnOnly: false }) },
            { own: true, tonic: context.tonic, minor: context.minor ?? false, fifths: context.fifths, finger: 1 },
          );
          return (
            <option key={id} value={id}>
              {compact ? `${target === "key" ? "键" : "音"} · ${label}` : example && id !== "none" ? `${label} · ${example}` : label}
            </option>
          );
        })}
    </select>
  );
  if (compact) return select;
  return (
    <label className={className}>
      <span>{name}</span>
      {select}
    </label>
  );
}

/** What the keys and the falling notes are labelled with: one row per place, an example of each
 * choice for middle C in the list. Used on the settings page and in the stage's label panel.
 * `selectsClass` marks the two choices (the stage shows them only when the bar has no room). */
export function LabelSettings({
  value,
  change,
  tonic,
  minor = false,
  fifths,
  selectsClass,
}: {
  value: DisplayPreferences;
  change: (patch: Partial<DisplayPreferences>) => void;
  tonic?: number;
  minor?: boolean;
  fifths?: number;
  selectsClass?: string;
}) {
  const context = { tonic, minor, fifths };
  return (
    <div className="label-settings" onClick={(e) => e.stopPropagation()}>
      <LabelSelect target="key" value={value} change={change} context={context} className={selectsClass} />
      <LabelSelect target="note" value={value} change={change} context={context} className={selectsClass} />
      <label>
        <input
          type="checkbox"
          checked={value.keyLabelsOwnOnly && value.noteLabelsOwnOnly}
          onChange={(e) => change({ keyLabelsOwnOnly: e.target.checked, noteLabelsOwnOnly: e.target.checked })}
        />
        只给自己弹的声部显示标签
      </label>
      <label>
        <input type="checkbox" checked={value.octave} onChange={(e) => change({ octave: e.target.checked })} />
        音名附带八度编号
      </label>
      <label>
        <span>字号</span>
        <select aria-label="标签字号" value={value.fontSize} onChange={(e) => change({ fontSize: Number(e.target.value) })}>
          {[10, 12, 14, 16].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
