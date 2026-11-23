import {
  productLabel,
  type LabelMode,
  type DisplayPreferences,
} from "../settings/displayPreferences";

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

/** What the keys and the falling notes are labelled with: one row per place, an example of each
 * choice for middle C in the list. Used on the settings page and in the stage's label panel. */
export function LabelSettings({
  value,
  change,
  tonic,
  minor = false,
  fifths,
}: {
  value: DisplayPreferences;
  change: (patch: Partial<DisplayPreferences>) => void;
  tonic?: number;
  minor?: boolean;
  fifths?: number;
}) {
  const choice = (target: "key" | "note") => {
    const mode = target === "key" ? value.keyLabelMode : value.noteLabelMode;
    return (
      <label>
        <span>{target === "key" ? "琴键标签" : "音符标签"}</span>
        <select
          aria-label={target === "key" ? "琴键标签内容" : "音符标签内容"}
          value={mode}
          onChange={(e) => {
            const id = e.target.value as LabelMode;
            change(target === "key" ? { keyLabelMode: id } : { noteLabelMode: id });
          }}
        >
          {modes
            .filter(([id]) => id !== "legacy" || mode === "legacy")
            .map(([id, name]) => {
              const example = productLabel(
                60,
                target,
                { ...value, ...(target === "key" ? { keyLabelMode: id, keyLabelsOwnOnly: false } : { noteLabelMode: id, noteLabelsOwnOnly: false }) },
                { own: true, tonic, minor, fifths, finger: 1 },
              );
              return (
                <option key={id} value={id}>
                  {example && id !== "none" ? `${name} · ${example}` : name}
                </option>
              );
            })}
        </select>
      </label>
    );
  };
  return (
    <div className="label-settings" onClick={(e) => e.stopPropagation()}>
      {choice("key")}
      {choice("note")}
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
