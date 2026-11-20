import type { DisplayPreferences } from "../../displayPreferences";
import { pitchName } from "../../engine/musicFormatting";
import {
  panKeyboardRange,
  zoomKeyboardRange,
  type KeyboardRange,
  type KeyboardRangeMode,
} from "./keyboardViewport";
import "./keyboardRange.css";

export const keyboardRangeOptions = [
  ["song", "歌曲音域"],
  ["49", "49 键"],
  ["88", "88 键"],
  ["device", "MIDI 键盘"],
  ["custom", "自定义"],
] as const;
export const parseKeyboardRange = (value: string): KeyboardRangeMode =>
  value === "49" ? 49 : value === "88" ? 88 : (value as KeyboardRangeMode);

export function KeyboardRangeControls({
  value,
  range,
  outside,
  change,
}: {
  value: DisplayPreferences;
  range: KeyboardRange;
  outside: number;
  change: (patch: Partial<DisplayPreferences>) => void;
}) {
  const move = (next: KeyboardRange) =>
    change({ range: "custom", keyboardLow: next.low, keyboardHigh: next.high });
  return (
    <div className="keyboard-range-controls" aria-label="瀑布与键盘取景">
      <label>
        取景{" "}
        <select
          aria-label="键盘显示范围"
          value={value.range}
          onChange={(event) =>
            change({ range: parseKeyboardRange(event.target.value) })
          }
        >
          {keyboardRangeOptions.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <output>
        {pitchName(range.low)}–{pitchName(range.high)} ·{" "}
        {range.high - range.low + 1} 键
      </output>
      <div className="keyboard-range-buttons">
        <button
          aria-label="键盘向低音平移"
          title="向低音移动一个八度；Shift + 滚轮平移"
          disabled={range.low === 0}
          onClick={() => move(panKeyboardRange(range, -7))}
        >
          ←
        </button>
        <button
          aria-label="缩小键盘取景"
          title="显示更多琴键；Ctrl + 滚轮缩放"
          disabled={range.low === 0 && range.high === 127}
          onClick={() => move(zoomKeyboardRange(range, -1))}
        >
          −
        </button>
        <button
          aria-label="放大键盘取景"
          title="放大琴键；Ctrl + 滚轮缩放"
          disabled={range.high - range.low <= 12}
          onClick={() => move(zoomKeyboardRange(range, 1))}
        >
          ＋
        </button>
        <button
          aria-label="键盘向高音平移"
          title="向高音移动一个八度；Shift + 滚轮平移"
          disabled={range.high === 127}
          onClick={() => move(panKeyboardRange(range, 7))}
        >
          →
        </button>
      </div>
      {outside > 0 && (
        <button
          className="keyboard-range-outside"
          onClick={() => change({ range: "song" })}
        >
          {outside} 个音符在视窗外 · 适合歌曲
        </button>
      )}
    </div>
  );
}
