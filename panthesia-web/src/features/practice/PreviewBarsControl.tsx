import { previewBarsLabel } from "./keyboardViewport";
export function PreviewBarsControl({
  value,
  change,
  label = "前方",
  ariaLabel = "瀑布前方预览小节数",
}: {
  value: number;
  change: (value: number) => void;
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="waterfall-density-control">
      {label}
      <input
        type="range"
        min={0.5}
        max={16}
        step={0.25}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => change(Number(event.target.value))}
      />
      <output>{previewBarsLabel(value)}</output>
    </label>
  );
}
