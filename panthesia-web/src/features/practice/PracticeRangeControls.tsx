import { memo, useState } from "react";
import type { PracticeRangeController } from "./usePracticeRange";
import "./practiceRange.css";
export function rangeTime(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value * 100) / 100;
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${(rounded - minutes * 60).toFixed(2).padStart(5, "0")}`;
}
export const PracticeRangeControls=memo(function PracticeRangeControls({
  range,
  disabled,
  active,
  loop,
  toggle,
}: {
  range: PracticeRangeController;
  disabled: boolean;
  active: boolean;
  loop: (start: number, end: number, enabled: boolean) => Promise<boolean>;
  toggle: () => void;
}) {
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const apply = async (clear = false) => {
    if (working || disabled || !range.matches()) return;
    setWorking(true);
    setError("");
    try {
      if (clear) {
        if (active && !(await loop(0, 0, false)))
          throw Error("循环尚未关闭，请稍后重试。");
        range.reset();
      } else if (range.range) {
        const ok = await loop(range.range.start, range.range.end, true);
        if (!ok) throw Error("循环尚未设置，请稍后重试。");
        range.reset();
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setWorking(false);
    }
  };
  const locked = disabled || working;
  return (
    <div
      className="practice-range-controls"
      role="group"
      aria-label="A/B 练习范围"
    >
      <button
        disabled={locked}
        aria-label="设置循环起点 A"
        title="把当前演奏位置设为起点"
        onClick={() => range.mark("a")}
      >
        <b>A</b> {rangeTime(range.markers.a)}
      </button>
      <button
        disabled={locked}
        aria-label="设置循环终点 B"
        title="把当前演奏位置设为终点"
        onClick={() => range.mark("b")}
      >
        <b>B</b> {rangeTime(range.markers.b)}
      </button>
      <button
        disabled={locked}
        aria-label="选择音符练习范围"
        aria-pressed={range.picking}
        onClick={toggle}
      >
        {range.picking ? "取消选音" : "选音符"}
      </button>
      <button disabled={locked || !range.range} onClick={() => void apply()}>
        循环选段
      </button>
      {(active || range.dirty&&!range.picking) && (
        <button disabled={locked} onClick={() => void apply(true)}>
          {active ? "退出循环" : "清除选段"}
        </button>
      )}
      {range.picking && (
        <span className="practice-range-hint" role="status">
          {range.hasAnchor
            ? "点选终点音符，可切换谱面与瀑布"
            : "点选起点音符，可在谱面或瀑布选择"}
        </span>
      )}
      {!range.picking &&
        range.dirty &&
        !range.range &&
        range.markers.a !== null &&
        range.markers.b !== null && (
          <span role="status">B 须晚于 A 至少 0.1 秒</span>
        )}
      {error && (
        <span className="practice-range-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
