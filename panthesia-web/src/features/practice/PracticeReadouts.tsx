import { clock, type EngineCommand, type LoadedSong } from "../../api";
import {
  displayPitch,
  type DisplayPreferences,
} from "../../displayPreferences";
import { practiceDuration } from "../../practiceTime";
import { usePlaybackFields } from "./PlaybackView";
import type { PlaybackStore } from "./playbackStore";
import {
  activeMeasures,
  handLabel,
  noteResult,
  practiceMode,
  practiceStatus,
  seekableMeasures,
} from "./practicePresentation";
import { usePlaybackSlider } from "./usePlaybackSlider";

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
      {state.mode === "memory" && (
        <div className="recital-caption">
          背谱：目标音符、谱面和指法提示已隐藏
        </div>
      )}
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

const timelineFields = [
  "practiceMs",
  "beat",
  "position",
  "measure",
  "passage",
] as const;
export function PracticeTimeline({
  store,
  song,
  disabled,
  busy,
  seek,
}: {
  store: PlaybackStore;
  song: LoadedSong | null;
  disabled: boolean;
  busy: boolean;
  seek: (measure: number) => Promise<boolean>;
}) {
  const state = usePlaybackFields(store, timelineFields);
  const start = state.passage?.start ?? 0,
    end = state.passage?.end ?? song?.duration ?? 0;
  const unavailable = !song || end <= start || disabled;
  const slider = usePlaybackSlider({
    store,
    value: state.position,
    disabled: unavailable || busy,
    commit: (position) =>
      seek(state.passage ? Math.min(position, end - 0.000001) : position),
  });
  const measures = song?.measures ?? [];
  const marks = measures.filter((m) => m.start >= start && m.start <= end);
  const every = Math.max(1, Math.ceil(marks.length / 80));
  return (
    <div className="practice-timeline time-ruler">
      <div className="time-ruler-labels">
        <span>
          第 {state.measure} 小节{" "}
          <small>第 {Math.floor(state.beat ?? 1)} 拍</small>
        </span>
        <strong>
          {clock(slider.value)} <small>/ {clock(song?.duration ?? 0)}</small>
        </strong>
        <span className="time-ruler-practice">
          已练 {practiceDuration(state.practiceMs ?? 0)}
        </span>
      </div>
      <div className="time-ruler-track">
        <svg
          viewBox="0 0 1000 20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {marks
            .filter((_, i) => i % every === 0)
            .map((m) => {
              const x =
                ((m.start - start) / Math.max(0.01, end - start)) * 1000;
              return (
                <g key={m.number}>
                  <line x1={x} x2={x} y1={0} y2={m.number % 4 === 1 ? 11 : 5} />
                  {m.number % 4 === 1 && (
                    <text x={x + 3} y={19}>
                      {m.number}
                    </text>
                  )}
                </g>
              );
            })}
        </svg>
        <input
          type="range"
          aria-label="曲目时间线"
          aria-valuetext={`${clock(slider.value)}，第 ${state.measure} 小节`}
          min={start}
          max={end || 1}
          step={0.01}
          value={Math.max(start, Math.min(end, slider.value))}
          disabled={unavailable || (busy && !slider.pending)}
          onChange={(e) => slider.stage(Number(e.target.value))}
          onPointerDown={slider.begin}
          onPointerUp={slider.apply}
          onPointerCancel={slider.cancel}
          onBlur={slider.apply}
          onKeyDown={(e) => slider.keyDown(e.key, e.repeat)}
          onKeyUp={(e) => slider.keyUp(e.key)}
        />
      </div>
      <div className="time-ruler-seconds">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{clock(start + (end - start) * f)}</span>
        ))}
      </div>
    </div>
  );
}

const resultFields = [
  "score",
  "saved",
  "summary",
  "status",
  "storage",
  "recording",
  "mode",
] as const;
export function PracticeResults({
  store,
  busy,
  planActive,
  command,
  feedback,
}: {
  store: PlaybackStore;
  busy: boolean;
  planActive: boolean;
  command: (command: EngineCommand) => void;
  feedback: () => void;
}) {
  const state = usePlaybackFields(store, resultFields);
  const { judged, accuracy } = noteResult(state.score);
  const savingRound = state.storage?.operation === "round";
  const saveError = !state.saved && judged > 0 && state.storage?.error;
  const live = ["playing", "countIn"].includes(state.status);
  const rhythmAssessed = ["flow", "recital", "memory"].includes(state.mode);
  const timing =
    state.status === "finished"
      ? state.summary?.timing.median_deviation_ms
      : null;
  return (
    <section className="inspector-section results">
      <div className="practice-result-heading">
        <h2>{state.status === "finished" ? "本轮结果" : "本轮记录"}</h2>
        <span>
          {state.saved
            ? "已保存"
            : savingRound
              ? "保存中"
              : judged
                ? "未保存"
                : "待开始"}
        </span>
      </div>
      <div className="accuracy">
        <strong>{accuracy === null ? "—" : `${accuracy}%`}</strong>
        <span>音符准确率</span>
      </div>
      <dl>
        <div>
          <dt>正确音符</dt>
          <dd>{state.score.matched_notes}</dd>
        </div>
        <div>
          <dt>错音</dt>
          <dd>{state.score.wrong_notes}</dd>
        </div>
        <div>
          <dt>漏音</dt>
          <dd>{state.score.missed_notes}</dd>
        </div>
        {rhythmAssessed && (
          <div className="practice-result-timing">
            <dt>合拍音符</dt>
            <dd>
              {state.score.on_time_notes} / {state.score.matched_notes}
            </dd>
          </div>
        )}
        {rhythmAssessed && timing != null && (
          <div className="practice-result-timing">
            <dt>节奏偏差中位数</dt>
            <dd>{Math.round(timing)} 毫秒</dd>
          </div>
        )}
      </dl>
      {state.mode === "listen" ? (
        <p className="practice-result-note">
          聆听模式用于熟悉曲目。切换到练习模式后记录演奏结果。
        </p>
      ) : (
        !judged && (
          <p className="practice-result-note">
            弹奏后显示正确、错音和漏音记录。
          </p>
        )
      )}
      <div className="practice-result-actions">
        <button
          disabled={
            !judged ||
            state.saved ||
            busy ||
            planActive ||
            state.recording ||
            state.storage?.pending
          }
          onClick={() => command({ type: "save" })}
        >
          {state.saved
            ? "已保存"
            : savingRound
              ? "正在保存…"
              : live
                ? "暂停并保存"
                : "保存结果"}
        </button>
        <button
          disabled={
            busy ||
            state.recording ||
            state.storage?.pending ||
            (!judged && !state.summary)
          }
          title={state.recording ? "停止录音后可查看反馈" : undefined}
          onClick={feedback}
        >
          {["playing", "countIn"].includes(state.status)
            ? "暂停并查看反馈"
            : "逐小节反馈"}
        </button>
      </div>
      {state.saved && <span className="saved-message">结果已保存在本机</span>}
      {saveError && (
        <p className="practice-result-note practice-result-error">
          结果尚未保存，请打开上方的恢复提示处理保存问题。
        </p>
      )}
      {!state.saved && judged > 0 && planActive && (
        <p className="practice-result-note">
          本轮由练习计划或速度阶梯管理，完成后自动保存。
        </p>
      )}
      {state.recording && (
        <p className="practice-result-note">停止录音后可保存结果和查看反馈。</p>
      )}
      {state.mode === "wait" && judged > 0 && (
        <p className="practice-result-note">
          等音模式记录音符表现，节奏不计分。
        </p>
      )}
    </section>
  );
}

/** The result remains reachable when the inspector is closed. */
export function PracticeResultStrip({
  store,
  busy,
  feedback,
  details,
}: {
  store: PlaybackStore;
  busy: boolean;
  feedback: () => void;
  details: () => void;
}) {
  const state = usePlaybackFields(store, resultFields);
  const { judged, accuracy } = noteResult(state.score);
  if (state.status !== "finished" || state.mode === "listen") return null;
  const saving = state.storage?.operation === "round";
  return (
    <section className="practice-result-strip" aria-label="本轮完成">
      <div className="practice-result-strip-copy">
        <strong>本轮完成</strong>
        <span>
          {accuracy === null
            ? "本轮暂无音符评分"
            : `准确率 ${accuracy}% · 错音 ${state.score.wrong_notes} · 漏音 ${state.score.missed_notes}`}
        </span>
      </div>
      <span
        className="practice-result-save"
        role="status"
        data-saved={state.saved || undefined}
      >
        {state.saved
          ? "已保存到本机"
          : saving
            ? "正在保存…"
            : state.storage?.error
              ? "保存待处理"
              : !judged && !state.summary
                ? "暂无可保存结果"
                : "结果未保存"}
      </span>
      <button
        disabled={
          busy ||
          state.recording ||
          state.storage?.pending ||
          (!judged && !state.summary)
        }
        onClick={feedback}
      >
        查看反馈
      </button>
      <button className="practice-result-details" onClick={details}>
        本轮记录
      </button>
    </section>
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
