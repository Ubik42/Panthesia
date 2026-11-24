import { Volume2, VolumeX } from "lucide-react";
import type { EngineCommand } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./usePlaybackFields";
import "./stemControls.css";

const stemFields = ["stems"] as const;
const NAMES: Record<string, string> = { vocals: "人声", accompaniment: "伴奏", piano: "钢琴", other: "其他" };

/** The song's audio stems in the stage's 音轨 panel: on/off and level per stem. */
export function StemControls({ store, command }: { store: PlaybackStore; command: (command: EngineCommand) => void }) {
  const { stems } = usePlaybackFields(store, stemFields);
  if (!stems) return null;
  return (
    <div className="stem-controls">
      {stems.loading && <p>正在载入…</p>}
      {stems.error && <p role="alert">{stems.error}</p>}
      {stems.confidence !== null && stems.confidence < 0.4 && <p>与演奏对齐度 {Math.round(stems.confidence * 100)}%，可能错位</p>}
      {stems.stems.map((stem) => {
        const name = NAMES[stem.kind] ?? stem.label;
        const on = stem.gain > 0;
        return (
          <div key={stem.kind} className="stem-row" data-off={!on || undefined}>
            <button className="ui-icon-button" aria-label={on ? `${name}静音` : `开启${name}`} title={on ? "静音" : "开启"} onClick={() => command({ type: "stemGain", kind: stem.kind, gain: on ? 0 : 1 })}>
              {on ? <Volume2 /> : <VolumeX />}
            </button>
            <span className="stem-name">{name}</span>
            <input type="range" aria-label={`${name}音量`} min={0} max={150} value={Math.round(stem.gain * 100)} onChange={(event) => command({ type: "stemGain", kind: stem.kind, gain: Number(event.target.value) / 100 })} />
            <output>{Math.round(stem.gain * 100)}%</output>
          </div>
        );
      })}
    </div>
  );
}
