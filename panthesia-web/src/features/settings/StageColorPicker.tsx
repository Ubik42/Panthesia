import "./stageColorPicker.css";

/** Common stage backgrounds; any colour can be picked beside them. */
const SWATCHES: [string, string][] = [
  ["#ffffff", "白色"],
  ["#f4f1ea", "米白"],
  ["#e9eef5", "浅灰蓝"],
  ["#1d2230", "深灰"],
  ["#0a111e", "夜蓝"],
];

/** The waterfall background colour: swatches and a colour wheel. */
export function StageColorPicker({ value, change }: { value: string; change: (color: string) => void }) {
  return (
    <span className="stage-color-picker" role="group" aria-label="舞台背景色">
      {SWATCHES.map(([color, name]) => (
        <button
          key={color}
          type="button"
          className="stage-color-swatch"
          style={{ background: color }}
          title={name}
          aria-label={name}
          aria-pressed={value.toLowerCase() === color}
          onClick={() => change(color)}
        />
      ))}
      <input type="color" aria-label="自选背景色" title="自选颜色" value={value} onChange={(e) => change(e.target.value)} />
    </span>
  );
}
