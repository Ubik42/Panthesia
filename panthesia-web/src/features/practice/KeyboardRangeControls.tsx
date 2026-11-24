import type { DisplayPreferences } from "../settings/displayPreferences";
import { pitchName } from "../../engine/musicFormatting";
import {
  panKeyboardViewport,
  zoomKeyboardViewport,
  viewportRange,
  type KeyboardViewport,
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
  viewport,
  outside,
  change,
}: {
  value: DisplayPreferences;
  range: KeyboardRange;
  viewport: KeyboardViewport;
  outside: number;
  change: (patch: Partial<DisplayPreferences>) => void;
}) {
  const move = (next: KeyboardViewport) => {
    const range = viewportRange(next);
    change({
      range: "custom",
      keyboardViewport: next,
      keyboardLow: range.low,
      keyboardHigh: range.high,
    });
  };
  return (
    <>
      <label>
        <span>
          键盘取景 <small>{pitchName(range.low)}–{pitchName(range.high)} · {range.high - range.low + 1} 键</small>
        </span>
        <select aria-label="键盘显示范围" value={value.range} onChange={(event) => change({ range: parseKeyboardRange(event.target.value) })}>
          {keyboardRangeOptions.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-row-actions">
        <button aria-label="键盘向低音平移" title="向低音移动一个八度；Shift + 滚轮平移" disabled={viewport.start <= 0} onClick={() => move(panKeyboardViewport(viewport, -7))}>
          ←
        </button>
        <button aria-label="缩小键盘取景" title="显示更多琴键；Ctrl + 滚轮缩放" disabled={viewport.span >= 75} onClick={() => move(zoomKeyboardViewport(viewport, 1.2))}>
          −
        </button>
        <button aria-label="放大键盘取景" title="放大琴键；Ctrl + 滚轮缩放" disabled={viewport.span <= 8} onClick={() => move(zoomKeyboardViewport(viewport, 1 / 1.2))}>
          ＋
        </button>
        <button aria-label="键盘向高音平移" title="向高音移动一个八度；Shift + 滚轮平移" disabled={viewport.start + viewport.span >= 75} onClick={() => move(panKeyboardViewport(viewport, 7))}>
          →
        </button>
        <button title="Ctrl + 滚轮连续缩放；Shift + 滚轮或 Alt / 中键拖动平移。" onClick={() => change({ range: "song" })}>
          {outside > 0 ? `适合歌曲（${outside} 个音在外）` : "适合歌曲"}
        </button>
      </div>
    </>
  );
}

/** The keyboard viewport on the stage bar: pan, zoom and the range choice in one compact group. */
export function KeyboardRangeInline({ value, range, viewport, change, className }: { value: DisplayPreferences; range: KeyboardRange; viewport: KeyboardViewport; change: (patch: Partial<DisplayPreferences>) => void; className?: string }) {
  const move = (next: KeyboardViewport) => {
    const r = viewportRange(next);
    change({ range: "custom", keyboardViewport: next, keyboardLow: r.low, keyboardHigh: r.high });
  };
  return (
    <span className={["stage-keyrange", className].filter(Boolean).join(" ")} role="group" aria-label="键盘取景" title={`键盘取景 ${pitchName(range.low)}–${pitchName(range.high)} · ${range.high - range.low + 1} 键`}>
      <button className="ui-icon-button" aria-label="键盘向低音平移" title="向低音移动一个八度" disabled={viewport.start <= 0} onClick={() => move(panKeyboardViewport(viewport, -7))}>
        ‹
      </button>
      <button className="ui-icon-button" aria-label="缩小键盘取景" title="显示更多琴键" disabled={viewport.span >= 75} onClick={() => move(zoomKeyboardViewport(viewport, 1.2))}>
        −
      </button>
      <select aria-label="键盘显示范围" value={value.range} onChange={(event) => change({ range: parseKeyboardRange(event.target.value) })}>
        {keyboardRangeOptions.map(([mode, label]) => (
          <option key={mode} value={mode}>
            {mode === "custom" ? `${range.high - range.low + 1} 键` : label}
          </option>
        ))}
      </select>
      <button className="ui-icon-button" aria-label="放大键盘取景" title="放大琴键" disabled={viewport.span <= 8} onClick={() => move(zoomKeyboardViewport(viewport, 1 / 1.2))}>
        +
      </button>
      <button className="ui-icon-button" aria-label="键盘向高音平移" title="向高音移动一个八度" disabled={viewport.start + viewport.span >= 75} onClick={() => move(panKeyboardViewport(viewport, 7))}>
        ›
      </button>
    </span>
  );
}
