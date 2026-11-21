import { useState } from "react";
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
  const [target, setTarget] = useState<"key" | "note">("key");
  const mode = target === "key" ? value.keyLabelMode : value.noteLabelMode;
  const ownOnly =
    target === "key" ? value.keyLabelsOwnOnly : value.noteLabelsOwnOnly;
  return (
    <div
      className="product-label-settings"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="product-label-tabs" role="tablist" aria-label="标签位置">
        {(["key", "note"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={target === t}
            onClick={() => setTarget(t)}
          >
            {t === "key" ? "琴键标签" : "音符标签"}
          </button>
        ))}
      </div>
      <label className="product-label-own">
        <input
          type="checkbox"
          checked={ownOnly}
          onChange={(e) =>
            change(
              target === "key"
                ? { keyLabelsOwnOnly: e.target.checked }
                : { noteLabelsOwnOnly: e.target.checked },
            )
          }
        />
        仅显示自己声部的标签
      </label>
      <div
        className="product-label-modes"
        role="radiogroup"
        aria-label={target === "key" ? "琴键标签内容" : "音符标签内容"}
      >
        {modes
          .filter(([id]) => id !== "legacy" || mode === "legacy")
          .map(([id, name]) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              onClick={() =>
                change(
                  target === "key"
                    ? { keyLabelMode: id }
                    : { noteLabelMode: id },
                )
              }
            >
              <span>{name}</span>
              <small>
                {productLabel(
                  60,
                  target,
                  {
                    ...value,
                    ...(target === "key"
                      ? { keyLabelMode: id, keyLabelsOwnOnly: false }
                      : { noteLabelMode: id, noteLabelsOwnOnly: false }),
                  },
                  { own: true, tonic, minor, fifths, finger: 1 },
                )}
              </small>
            </button>
          ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={value.octave}
          onChange={(e) => change({ octave: e.target.checked })}
        />
        音名附带八度编号
      </label>
      <label>
        字号
        <select
          aria-label="标签字号"
          value={value.fontSize}
          onChange={(e) => change({ fontSize: Number(e.target.value) })}
        >
          {[10, 12, 14, 16].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
