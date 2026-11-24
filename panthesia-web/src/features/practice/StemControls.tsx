import type { EngineCommand } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./usePlaybackFields";
import "./stemControls.css";

const stemFields = ["stems"] as const;

/** The song's audio stems (vocals, accompaniment, the separated piano): on/off and level, in
 * the stage's 音轨 panel. They play along in listen and follow modes. */
export function StemControls({ store, command }: { store: PlaybackStore; command: (command: EngineCommand) => void }) {
  const { stems } = usePlaybackFields(store, stemFields);
  if (!stems) return null;
  return (
    <section className="stem-controls" aria-label="音轨">
      <h3>音轨</h3>
      {stems.loading && <p>正在读取并对齐音轨…</p>}
      {stems.error && <p role="alert">{stems.error}</p>}
      {stems.confidence !== null && stems.confidence < 0.4 && (
        <p>音轨与演奏的起音只对上 {Math.round(stems.confidence * 100)}%，可能不是同一版本，播放时会错位。</p>
      )}
      {stems.stems.map((stem) => (
        <label key={stem.kind}>
          <input
            type="checkbox"
            checked={stem.gain > 0}
            onChange={(event) => command({ type: "stemGain", kind: stem.kind, gain: event.target.checked ? 1 : 0 })}
          />
          <span>{stem.label}</span>
          <input
            type="range"
            aria-label={`${stem.label}音量`}
            min={0}
            max={150}
            value={Math.round(stem.gain * 100)}
            onChange={(event) => command({ type: "stemGain", kind: stem.kind, gain: Number(event.target.value) / 100 })}
          />
        </label>
      ))}
      {!stems.loading && !stems.error && <small>连续播放时随演奏一起放，变速时保持音高；钢琴分轨与乐器重复，默认关闭。</small>}
    </section>
  );
}
