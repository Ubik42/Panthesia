import { clock, type EngineCommand, type LoadedSong } from "../../api";
import {
  displayPitch,
  type DisplayPreferences,
} from "../settings/displayPreferences";
import { usePlaybackFields } from "./usePlaybackFields";
import type { PlaybackStore } from "./playbackStore";
import {
  activeMeasures,
  handLabel,
  practiceMode,
  practiceStatus,
  seekableMeasures,
} from "./practicePresentation";

const stageFields = [
  "status",
  "recording",
  "recordDuration",
  "countRemaining",
  "wait",
  "required",
  "mode",
  "measure",
  "beat",
  "passage",
  "repetitions",
] as const;
export function PracticeStageReadout({
  store,
  connected,
  song,
  display,
}: {
  store: PlaybackStore;
  connected: boolean;
  song: LoadedSong | null;
  display: DisplayPreferences;
}) {
  const state = usePlaybackFields(store, stageFields);
  const status = practiceStatus(state, connected);
  const duration =
    connected && state.recording
      ? clock(state.recordDuration)
      : connected && state.status === "countIn"
        ? Math.ceil(state.countRemaining)
        : null;
  return (
    <div className="practice-stage-readouts">
      <div
        className="stage-status"
        data-state={state.recording ? "recording" : state.status}
      >
        <span
          className={`transport-dot ${connected && ["playing", "countIn"].includes(state.status) ? "playing" : ""}`}
        />
        <span className="stage-status-label">{status}</span>
        {duration !== null && (
          <span className="stage-duration">{duration}</span>
        )}
        {song && (
          <span className="stage-position">
            第 {state.measure} 小节 · 第 {Math.floor(state.beat)} 拍
          </span>
        )}
        {state.passage && (
          <span className="stage-loop">
            {state.status === "finished"
              ? `已完成 ${state.repetitions} 遍`
              : `第 ${state.repetitions + 1} 遍`}
          </span>
        )}
      </div>
      {connected &&
        state.status === "playing" &&
        state.mode === "wait" &&
        state.required.length > 0 && (
          <div className="required-notes">
            <span>请弹</span>
            <strong>
              {state.required
                .map((pitch) => displayPitch(pitch, display))
                .join(" + ")}
            </strong>
          </div>
        )}
    </div>
  );
}

const contextFields = [
  "mode",
  "hands",
  "passage",
  "countIn",
  "metronome",
  "status",
  "recording",
  "wait",
  "required",
] as const;
export function PracticeSetupSummary({
  store,
  song,
  connected,
  display,
  showRequired,
  open,
}: {
  store: PlaybackStore;
  song: LoadedSong | null;
  connected: boolean;
  display: DisplayPreferences;
  showRequired: boolean;
  open: () => void;
}) {
  const state = usePlaybackFields(store, contextFields);
  if (!song) return null;
  const range = activeMeasures(song, state.passage);
  return (
    <button
      className="practice-setup-summary"
      title="查看和调整本轮练习参数"
      onClick={open}
    >
      <strong>{practiceMode(state.mode)?.label ?? "练习"}</strong>
      <span>{handLabel(state.hands)}</span>
      <span>
        {state.passage && range
          ? `循环 ${range.first}–${range.last} 小节`
          : "全曲"}
      </span>
      {showRequired &&
        connected &&
        state.status === "playing" &&
        state.mode === "wait" &&
        state.required.length > 0 && (
          <span className="practice-setup-required">
            请弹{" "}
            {state.required
              .map((pitch) => displayPitch(pitch, display))
              .join(" + ")}
          </span>
        )}
      <span className="practice-setup-extra">
        {state.countIn ? `${state.countIn} 小节预备拍` : "无预备拍"}
      </span>
      {state.metronome && (
        <span className="practice-setup-extra">节拍器开启</span>
      )}
      <span className="practice-setup-state">
        {practiceStatus(state, connected)}
      </span>
      <span className="practice-setup-edit">调整参数</span>
    </button>
  );
}

const meterFields = ["bpm", "speed", "measure"] as const;
export function PracticeMeter({
  store,
  song,
}: {
  store: PlaybackStore;
  song: LoadedSong | null;
}) {
  const state = usePlaybackFields(store, meterFields);
  const measure = song?.measures[state.measure - 1];
  return (
    <div className="tempo-readout">
      {Math.round(state.bpm * state.speed)}{" "}
      <small>
        BPM · {measure?.numerator ?? 4}/{measure?.denominator ?? 4}
      </small>
    </div>
  );
}
const pedalFields = ["pedal"] as const;
export function PracticePedal({ store }: { store: PlaybackStore }) {
  const { pedal } = usePlaybackFields(store, pedalFields);
  return <span>{pedal >= 64 ? "延音踏板踩下" : ""}</span>;
}
const recordFields = ["recording", "recordDuration"] as const;
export function RecordingLabel({ store }: { store: PlaybackStore }) {
  const state = usePlaybackFields(store, recordFields);
  return state.recording
    ? `停止录音 ${clock(state.recordDuration)}`
    : "录制演奏";
}
