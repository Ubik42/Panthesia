import { productLabel, type DisplayPreferences, type LabelMode } from "./displayPreferences";
import "./labelPicker.css";

const MODES: [LabelMode, string][] = [
  ["none", "不显示"],
  ["english", "字母音名"],
  ["fixed", "固定唱名"],
  ["movable", "首调唱名"],
  ["degree", "音阶级数"],
  ["finger", "指法"],
  ["octaves", "八度编号"],
  ["simple", "白键音名"],
  ["mapping", "键盘映射"],
];

type Context = { tonic?: number; minor?: boolean; fifths?: number };

/** The stage's label panel: what the keys and the falling notes show, as chips with the label
 * of middle C, and the label options. */
export function LabelPicker({ value, change, context = {} }: { value: DisplayPreferences; change: (patch: Partial<DisplayPreferences>) => void; context?: Context }) {
  return (
    <div className="label-picker">
      <Row target="key" name="琴键" value={value} change={change} context={context} />
      <Row target="note" name="音符" value={value} change={change} context={context} />
      <div className="label-picker-options">
        <label>
          <input type="checkbox" checked={value.keyLabelsOwnOnly && value.noteLabelsOwnOnly} onChange={(e) => change({ keyLabelsOwnOnly: e.target.checked, noteLabelsOwnOnly: e.target.checked })} />
          只标自己弹的声部
        </label>
        <label>
          <input type="checkbox" checked={value.octave} onChange={(e) => change({ octave: e.target.checked })} />
          音名带八度
        </label>
        <span className="ui-segmented label-picker-size" role="group" aria-label="标签字号">
          {[10, 12, 14, 16].map((n) => (
            <button key={n} type="button" aria-pressed={value.fontSize === n} title={`字号 ${n}`} onClick={() => change({ fontSize: n })}>
              {n}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

function Row({ target, name, value, change, context }: { target: "key" | "note"; name: string; value: DisplayPreferences; change: (patch: Partial<DisplayPreferences>) => void; context: Context }) {
  const mode = target === "key" ? value.keyLabelMode : value.noteLabelMode;
  return (
    <div className="label-picker-row" role="radiogroup" aria-label={`${name}标签`}>
      <span className="label-picker-name">{name}</span>
      <div className="label-picker-chips">
        {MODES.map(([id, label]) => {
          const example =
            id === "none"
              ? ""
              : productLabel(
                  60,
                  target,
                  { ...value, ...(target === "key" ? { keyLabelMode: id, keyLabelsOwnOnly: false } : { noteLabelMode: id, noteLabelsOwnOnly: false }) },
                  { own: true, tonic: context.tonic, minor: context.minor ?? false, fifths: context.fifths, finger: 1 },
                );
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className="label-picker-chip"
              title={example ? `${label}：中央 C 显示“${example}”` : label}
              onClick={() => change(target === "key" ? { keyLabelMode: id } : { noteLabelMode: id })}
            >
              <span>{label}</span>
              {example && <small>{example}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
