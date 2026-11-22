import type { EngineCommand } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./usePlaybackFields";
import "./stemControls.css";

const stemFields = ["stems"] as const;

/** Vocals and accompaniment of the song (its manifest's stem files): on/off and level. */
export function StemControls({ store, command }: { store: PlaybackStore; command: (command: EngineCommand) => void }) {
  const { stems } = usePlaybackFields(store, stemFields);
  if (!stems) return null;
  return (
    <div className="stem-controls" role="group" aria-label="伴奏音轨">
      <strong>伴奏音轨</strong>
      {stems.loading && <p>正在读取并对齐伴奏…</p>}
      {stems.error && <p role="alert">{stems.error}</p>}
      {stems.confidence !== null && stems.confidence < 0.4 && (
        <p>伴奏与演奏的起音只对上 {Math.round(stems.confidence * 100)}%，可能不是同一版本，播放时会错位。</p>
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
      {!stems.loading && !stems.error && <small>在聆听与跟弹模式中随演奏播放，变速时保持音高。</small>}
    </div>
  );
}
