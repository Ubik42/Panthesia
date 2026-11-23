import type { LoadedSong } from "../../api";
import type { Variant } from "../../engine/commands.generated";

const names = ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"];

/** The practice version of the song: transposition and the grid its notes are quantized to.
 * Shown in the "转调与量化" dialog; changes apply at once and are saved with the song. */
export function PracticeVariantPanel({ song, disabled, apply }: { song: LoadedSong; disabled: boolean; apply: (value: Variant) => Promise<unknown> }) {
  const info = song.practiceVariant;
  if (!info) return null;
  const v = { transpose: 0, quantize: 0, durations: true, tonic: null, minor: null, ...info.settings };
  const change = (patch: Partial<Variant>) => void apply({ ...v, ...patch });
  const target = (info.tonic + v.transpose + 120) % 12;
  const cShift =
    Array.from({ length: 49 }, (_, i) => i - 24)
      .filter((n) => (info.tonic + n + 120) % 12 === 0)
      .sort((a, b) => {
        const penalty = (n: number) => ((info.minPitch ?? 60) + n < 21 || (info.maxPitch ?? 60) + n > 108 ? 100 : 0) + Math.abs(n);
        return penalty(a) - penalty(b);
      })[0] ?? 0;
  const outside = (info.minPitch ?? 60) + v.transpose < 21 || (info.maxPitch ?? 60) + v.transpose > 108;
  const keySource = info.keySource === "estimate" ? "估计" : info.keySource === "midi" ? "MIDI 标记" : info.keySource === "score" ? "原谱标记" : "手动";
  return (
    <>
      <p className="variant-now">
        现在练的是 <strong>{names[target]} {info.minor ? "小调" : "大调"}</strong> · {v.transpose ? `${v.transpose > 0 ? "+" : ""}${v.transpose} 半音` : "原调"} · {v.quantize ? `1/${v.quantize} 量化` : "原始时值"}
      </p>
      <fieldset disabled={disabled}>
        <legend>练习音高</legend>
        <div className="ui-row">
          <span>转调</span>
          <span className="settings-row-actions">
            <button aria-label="降低一个八度" disabled={v.transpose < -12} onClick={() => change({ transpose: v.transpose - 12 })}>
              −12
            </button>
            <button aria-label="降低一个半音" disabled={v.transpose <= -24} onClick={() => change({ transpose: v.transpose - 1 })}>
              −1
            </button>
            <input
              aria-label="转调半音"
              type="number"
              min={-24}
              max={24}
              value={v.transpose}
              style={{ width: 72 }}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isInteger(value) && value >= -24 && value <= 24) change({ transpose: value });
              }}
            />
            <button aria-label="升高一个半音" disabled={v.transpose >= 24} onClick={() => change({ transpose: v.transpose + 1 })}>
              +1
            </button>
            <button aria-label="升高一个八度" disabled={v.transpose > 12} onClick={() => change({ transpose: v.transpose + 12 })}>
              +12
            </button>
          </span>
        </div>
        <div className="ui-row">
          <span>
            原曲调性 <small>（{keySource}，可修改）</small>
          </span>
          <span className="settings-row-actions">
            <select aria-label="原曲主音" value={info.tonic} onChange={(e) => change({ tonic: Number(e.target.value) })}>
              {names.map((n, i) => (
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </select>
            <select aria-label="原曲调式" value={info.minor ? "minor" : "major"} onChange={(e) => change({ minor: e.target.value === "minor" })}>
              <option value="major">大调</option>
              <option value="minor">小调</option>
            </select>
          </span>
        </div>
        <div className="settings-row-actions">
          <button onClick={() => change({ transpose: cShift })}>移到 C {info.minor ? "小调" : "大调"}</button>
          <button onClick={() => change({ transpose: 0 })} disabled={!v.transpose}>
            回到原调
          </button>
        </div>
        {outside && <p role="alert">转调后部分音符超出 88 键钢琴音域，请缩小转调幅度。</p>}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>练习网格</legend>
        <label>
          <span>量化</span>
          <select aria-label="练习量化" value={v.quantize} onChange={(e) => change({ quantize: Number(e.target.value) })}>
            <option value={0}>原始时值（演奏原样）</option>
            <option value={8}>八分音符 · 1/8</option>
            <option value={16}>十六分音符 · 1/16</option>
            <option value={32}>三十二分音符 · 1/32</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={v.durations} onChange={(e) => change({ durations: e.target.checked })} />
          同时量化时值
        </label>
        <p className="parameter-help">演奏型 MIDI 默认按 1/16 量化；选“原始时值”后会一直记住。量化保留速度变化与踏板时序。</p>
      </fieldset>
      {info.active && info.sourceHasScore && <p className="parameter-help">量化练习谱按当前网格重新记谱，可在谱面选项中切换查看原谱。</p>}
    </>
  );
}
