import { PersistentSessionRecovery } from "../../ui/legacy/PersistentSessionRecovery";
import { useState } from "react";
import { X, Music2, RotateCcw, Save, RefreshCw } from "lucide-react";
import { TaskActivity } from "../../engine/TaskActivity";
import { SavedEditNotice } from "../../engine/SavedEditNotice";
import { useExerciseCatalog } from "./useExerciseCatalog";
import {
  exerciseDescription,
  exerciseValidation,
  type ExerciseDraft,
} from "./exerciseGenerationClient";
import {
  createExerciseSessionStore,
  type ExerciseSessionStore,
} from "./exerciseSessionStore";
import {
  useExercisePreparation,
  type ExercisePreparationActions,
} from "./useExercisePreparation";
import "./exerciseDialog.css";

const tones = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
function TonicKeyboard({ tonic }: { tonic: number }) {
  const whites = [0, 2, 4, 5, 7, 9, 11];
  const blacks = [
    [1, 28],
    [3, 68],
    [6, 148],
    [8, 188],
    [10, 228],
  ];
  return (
    <svg
      className="exercise-tonic-keyboard"
      viewBox="0 0 280 94"
      role="img"
      aria-label={`主音 ${tones[tonic] ?? "未选择"} 在键盘上的位置`}
    >
      {whites.map((pitch, index) => (
        <g key={pitch}>
          <rect
            className={pitch === tonic ? "selected-white" : "white-key"}
            x={index * 40 + 1}
            y={1}
            width={38}
            height={90}
            rx={4}
          />
          <text x={index * 40 + 20} y={78}>
            {tones[pitch]}
          </text>
        </g>
      ))}
      {blacks.map(([pitch, x]) => (
        <rect
          key={pitch}
          className={pitch === tonic ? "selected-black" : "black-key"}
          x={x}
          y={0}
          width={24}
          height={56}
          rx={3}
        />
      ))}
    </svg>
  );
}
export function ExerciseDialog({
  close,
  session,
  runPreparation,
  refreshGenerated,
}: ExercisePreparationActions & {
  close: () => void;
  session?: ExerciseSessionStore;
}) {
  const [local] = useState(() => session ?? createExerciseSessionStore());
  const store = session ?? local;
  const preparation = useExercisePreparation(store, {
    runPreparation,
    refreshGenerated,
  });
  const catalog = useExerciseCatalog();
  const {
    spec,
    presetName,
    busy,
    phase,
    receipt,
    result,
    error,
    message,
    storageError,
    locked,
  } = preparation;
  const description = exerciseDescription(spec);
  const unavailable = busy || catalog.busy;
  const invalid = exerciseValidation(spec);
  const edit = (next: ExerciseDraft) => {
    if (next.tonality !== "Minor" || next.pattern !== "Scale")
      next = { ...next, minor_form: "Natural" };
    store.edit(next);
  };
  const field = <Key extends keyof ExerciseDraft>(
    key: Key,
    label: string,
    options: [ExerciseDraft[Key], string][],
  ) => (
    <label key={key}>
      {label}
      <select
        aria-label={label}
        value={spec[key]}
        disabled={locked || catalog.busy}
        onChange={(event) => {
          const selected = options.find(
            ([value]) => String(value) === event.target.value,
          );
          if (selected) edit({ ...spec, [key]: selected[0] });
        }}
      >
        {options.map(([value, label]) => (
          <option key={String(value)} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const primaryLabel = busy
    ? result
      ? "正在读取练习室…"
      : "正在准备练习…"
    : result
      ? "打开已生成练习"
      : phase === "review"
        ? "继续读取原请求"
        : phase === "error"
          ? "重试生成并打开"
          : "生成并打开";
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!unavailable) close();
      }}
    >
      <section
        className="settings-dialog exercise-dialog exercise-workbench"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-heading">
          <div className="exercise-heading">
            <Music2 size={22} />
            <div>
              <h2 id="exercise-title">技术练习</h2>
              <p>选择练习内容，保留参数，随时继续</p>
            </div>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={unavailable}
            aria-label="关闭技术练习"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div className="exercise-workbench-body">
          <section className="exercise-preview" aria-label="本次技术练习">
            <span className="exercise-preview-label">本次练习</span>
            <h3>{result?.title || description.title}</h3>
            <p>{description.detail}</p>
            <TonicKeyboard tonic={spec.tonic} />
            <div className="exercise-rhythm">
              <span>
                {spec.tempo_bpm}
                <small>BPM</small>
              </span>
              <span>
                {spec.octaves}
                <small>个八度</small>
              </span>
              <span>
                {spec.repetitions}
                <small>次重复</small>
              </span>
            </div>
            <p className="exercise-preview-help">
              经校对的音阶和琶音指法随音符显示。其他组合保留音符与分手，不附加未经校对的指法。
            </p>
            <div
              className={`exercise-result-status ${phase === "review" ? "needs-review" : ""}`}
              role="status"
            >
              <strong>
                {phase === "working"
                  ? "正在准备"
                  : phase === "review"
                    ? "结果待确认"
                    : phase === "ready"
                      ? "练习已生成"
                      : phase === "error"
                        ? "可调整后重试"
                        : "参数已就绪"}
              </strong>
              <span>
                {message ||
                  "生成后进入练习。关闭窗口或重启应用后，可以继续使用这些参数。"}
              </span>
            </div>
          </section>
          <div className="exercise-parameters">
            <fieldset className="exercise-parameter-group">
              <legend>调性与内容</legend>
              <div className="exercise-grid">
                {field(
                  "tonic",
                  "主音",
                  tones.map((tone, index) => [index, tone]),
                )}
                {field("tonality", "调式", [
                  ["Major", "大调"],
                  ["Minor", "小调"],
                ])}
                {field("pattern", "练习类型", [
                  ["Scale", "音阶"],
                  ["Arpeggio", "琶音"],
                  ["PrimaryChords", "主三和弦"],
                ])}
                {spec.tonality === "Minor" && spec.pattern === "Scale" ? (
                  field("minor_form", "小调形式", [
                    ["Natural", "自然小调"],
                    ["Harmonic", "和声小调"],
                    ["Melodic", "旋律小调"],
                  ])
                ) : (
                  <p className="exercise-field-help">
                    小调音阶可选择自然、和声或旋律形式。
                  </p>
                )}
              </div>
            </fieldset>
            <fieldset className="exercise-parameter-group">
              <legend>演奏方式</legend>
              <div className="exercise-grid">
                {field("hands", "生成练习声部", [
                  ["Both", "双手"],
                  ["Right", "右手"],
                  ["Left", "左手"],
                ])}
                {field("direction", "练习方向", [
                  ["Ascending", "上行"],
                  ["Descending", "下行"],
                  ["UpAndDown", "上行与下行"],
                ])}
                {field(
                  "octaves",
                  "练习八度",
                  [1, 2, 3].map((value) => [value, `${value} 个八度`]),
                )}
                <label>
                  重复次数
                  <input
                    aria-label="练习重复次数"
                    type="number"
                    min={1}
                    max={8}
                    value={spec.repetitions}
                    disabled={locked || catalog.busy}
                    onChange={(event) =>
                      edit({ ...spec, repetitions: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  速度（BPM）
                  <input
                    aria-label="生成练习速度"
                    type="number"
                    min={20}
                    max={240}
                    value={spec.tempo_bpm}
                    disabled={locked || catalog.busy}
                    onChange={(event) =>
                      edit({ ...spec, tempo_bpm: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            </fieldset>
          </div>
        </div>
        <section
          className="exercise-saved-presets"
          aria-label="常用技术练习方案"
        >
          <div className="exercise-section-heading">
            <h3>常用方案</h3>
            <span>
              {catalog.reading
                ? "正在读取…"
                : `${catalog.presets.length} 个已保存方案`}
            </span>
          </div>
          <div className="exercise-presets">
            <label>
              选择方案
              <select
                aria-label="常用技术练习方案"
                disabled={locked || catalog.busy || catalog.reading}
                value=""
                onChange={(event) => {
                  const preset = catalog.presets.find(
                    (preset) => preset.id === event.target.value,
                  );
                  if (preset) store.edit(preset.spec, preset.name);
                }}
              >
                <option value="">选择已保存的方案</option>
                {catalog.presets.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              方案名称
              <input
                aria-label="技术练习方案名称"
                placeholder="例如：每天两八度音阶"
                value={presetName}
                disabled={unavailable}
                maxLength={80}
                onChange={(event) =>
                  store.update({ presetName: event.target.value, dirty: true })
                }
              />
            </label>
            <button
              disabled={
                unavailable ||
                !catalog.writable ||
                !presetName.trim() ||
                !!invalid
              }
              onClick={() => void catalog.save(presetName, spec)}
            >
              <Save size={15} />
              保存方案
            </button>
          </div>
          <SavedEditNotice
            message={catalog.pendingRefresh}
            busy={catalog.busy || catalog.reading}
            refresh={() => void catalog.refresh()}
          />
          {catalog.notice && <p role="status">{catalog.notice}</p>}
          {catalog.error && (
            <div className="dialog-error" role="alert">
              <p>{catalog.error}</p>
              <button
                disabled={catalog.busy || catalog.reading}
                onClick={() => void catalog.refresh()}
              >
                <RefreshCw size={14} />
                重新读取方案列表
              </button>
            </div>
          )}
          {catalog.presets.length > 0 && (
            <details className="preset-management">
              <summary>管理已保存方案</summary>
              {catalog.presets.map((preset) => (
                <div key={preset.id}>
                  <span>{preset.name}</span>
                  <button
                    disabled={locked || catalog.busy}
                    onClick={() => store.edit(preset.spec, preset.name)}
                  >
                    使用
                  </button>
                  <button
                    disabled={unavailable || !catalog.writable}
                    onClick={() => void catalog.remove(preset.id)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </details>
          )}
        </section>
        <TaskActivity label={["读取技术练习方案", "保存技术练习方案"]} />
        <TaskActivity
          label="生成技术练习与恢复资料"
          taskId={receipt?.taskId ?? "no-current-exercise"}
          cancelLabel="取消当前生成"
        />
        <PersistentSessionRecovery store={store} error={storageError} busy={busy} label="技术练习草稿" />
        {invalid && !locked && (
          <p className="dialog-error" role="alert">
            {invalid}
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {!!result?.importWarnings.length && (
          <div className="exercise-storage-error" role="status">
            <ul>
              {result.importWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <footer className="exercise-actions">
          <span>
            {phase === "review"
              ? "恢复时沿用原请求，保留已有生成结果。"
              : phase === "ready"
                ? "打开原结果，可以继续练习或调整参数。"
                : "当前参数自动保存在本机。"}
          </span>
          <div>
            {result && (
              <button disabled={unavailable} onClick={() => store.useAgain()}>
                <RotateCcw size={15} />
                沿用参数继续编辑
              </button>
            )}
            {phase === "review" && (
              <button
                disabled={unavailable || preparation.cancelling}
                onClick={() => void preparation.requeue()}
              >
                已核对结果，重新生成
              </button>
            )}
            {receipt?.cancellable && (
              <button
                disabled={preparation.cancelling}
                onClick={() => void preparation.cancel()}
              >
                {preparation.cancelling ? "正在取消…" : "取消当前生成"}
              </button>
            )}
            <button
              className="primary-button exercise-primary"
              disabled={
                unavailable ||
                preparation.cancelling ||
                (!!invalid && !result) ||
                (phase === "review" && !receipt)
              }
              onClick={() => void preparation.start()}
            >
              {primaryLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
