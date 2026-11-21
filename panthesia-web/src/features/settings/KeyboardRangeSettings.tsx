import type { DisplayPreferences } from "./displayPreferences";
import { pitchName } from "../../engine/musicFormatting";
import {
  keyboardRangeOptions,
  parseKeyboardRange,
} from "../practice/KeyboardRangeControls";

const pitches = Array.from({ length: 128 }, (_, n) => n);
export function KeyboardRangeSettings({
  value,
  change,
  input,
}: {
  value: DisplayPreferences;
  change: (patch: Partial<DisplayPreferences>) => void;
  input: string | null;
}) {
  const device = value.range === "device";
  const saved = input ? value.keyboardDeviceRanges[input] : undefined;
  const limits = device
    ? (saved ?? { low: 21, high: 108 })
    : { low: value.keyboardLow, high: value.keyboardHigh };
  const set = (low: number, high: number) => {
    if (device) {
      if (input)
        change({
          keyboardDeviceRanges: {
            ...value.keyboardDeviceRanges,
            [input]: { low, high },
          },
        });
    } else change({ keyboardViewport: null, keyboardLow: low, keyboardHigh: high });
  };
  return (
    <fieldset className="keyboard-range-settings">
      <legend>瀑布与键盘取景</legend>
      <label>
        显示范围
        <select
          aria-label="屏幕键盘范围"
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
      {value.range === "song" && (
        <p>
          按当前演奏音符取景，随换歌、转调和声部变化更新；至少显示两个八度。
        </p>
      )}
      {(device || value.range === "custom") && (
        <>
          {device && (
            <p>
              {input
                ? `当前 MIDI 输入：${input}${saved ? " · 已保存音域" : " · 尚未设置，暂显示 88 键"}`
                : "连接 MIDI 键盘后，可为这台设备保存音域。"}
            </p>
          )}
          <div className="keyboard-range-limits">
            <label>
              最低音
              <select
                aria-label={device ? "MIDI 键盘最低音" : "取景最低音"}
                disabled={device && !input}
                value={limits.low}
                onChange={(event) =>
                  set(Number(event.target.value), limits.high)
                }
              >
                {pitches
                  .filter((n) => n <= limits.high - 11)
                  .map((n) => (
                    <option key={n} value={n}>
                      {pitchName(n)} · {n}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              最高音
              <select
                aria-label={device ? "MIDI 键盘最高音" : "取景最高音"}
                disabled={device && !input}
                value={limits.high}
                onChange={(event) =>
                  set(limits.low, Number(event.target.value))
                }
              >
                {pitches
                  .filter((n) => n >= limits.low + 11)
                  .map((n) => (
                    <option key={n} value={n}>
                      {pitchName(n)} · {n}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="keyboard-range-presets">
            {[
              [36, 60, "25 键"],
              [36, 84, "49 键"],
              [36, 96, "61 键"],
              [28, 103, "76 键"],
              [21, 108, "88 键"],
            ].map(([low, high, label]) => (
              <button
                type="button"
                key={label}
                disabled={device && !input}
                onClick={() => set(Number(low), Number(high))}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            {device
              ? "设备音域用于显示和范围提示。演奏音高、伴奏和评分继续使用歌曲的练习条件。"
              : "取景只改变画面。Ctrl + 滚轮连续缩放；Shift + 滚轮或 Alt / 中键拖动平移。瀑布区域支持双指水平缩放、垂直调整前方范围。"}
          </p>
        </>
      )}
    </fieldset>
  );
}
