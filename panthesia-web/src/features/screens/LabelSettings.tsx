import type { DisplayPreferences } from "../../displayPreferences";
export function LabelSettings({
  value,
  change,
}: {
  value: DisplayPreferences;
  change: (patch: Partial<DisplayPreferences>) => void;
}) {
  return (
    <div
      className="product-label-settings"
      onClick={(e) => e.stopPropagation()}
    >
      <h3>琴键标签</h3>
      <label>
        显示位置
        <select
          aria-label="琴键标签位置"
          value={value.keyLabels}
          onChange={(e) =>
            change({
              keyLabels: e.target.value as DisplayPreferences["keyLabels"],
            })
          }
        >
          <option value="none">不显示</option>
          <option value="c">仅 C 键</option>
          <option value="white">白键</option>
          <option value="all">所有琴键</option>
        </select>
      </label>
      <h3>音符标签</h3>
      <label>
        标签内容
        <select
          aria-label="音符标签内容"
          value={value.noteLabels}
          onChange={(e) =>
            change({
              noteLabels: e.target.value as DisplayPreferences["noteLabels"],
            })
          }
        >
          <option value="none">不显示</option>
          <option value="auto">优先指法</option>
          <option value="name">音名</option>
          <option value="finger">指法</option>
          <option value="both">指法与音名</option>
        </select>
      </label>
      <h3>音名方式</h3>
      <label>
        记法
        <select
          aria-label="标签记法"
          value={value.notation}
          onChange={(e) =>
            change({
              notation: e.target.value as DisplayPreferences["notation"],
            })
          }
        >
          <option value="pitch">字母音名</option>
          <option value="solfege">首调唱名</option>
          <option value="degree">音级</option>
        </select>
      </label>
      {value.notation !== "pitch" && (
        <label>
          主音
          <select
            aria-label="标签主音"
            value={value.tonic}
            onChange={(e) => change({ tonic: Number(e.target.value) })}
          >
            {[
              "C",
              "C♯",
              "D",
              "E♭",
              "E",
              "F",
              "F♯",
              "G",
              "A♭",
              "A",
              "B♭",
              "B",
            ].map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={value.octave}
          onChange={(e) => change({ octave: e.target.checked })}
        />
        显示八度
      </label>
    </div>
  );
}
