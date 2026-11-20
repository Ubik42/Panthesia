import { useEffect, useId, useState } from "react";
import type { EngineCommand, LoadedSong } from "../../api";
import { usePlaybackFields } from "./PlaybackView";
import type { PlaybackStore } from "./playbackStore";
import { activeMeasures } from "./practicePresentation";

const loopFields = [
  "passage",
  "repetitions",
  "rounds",
  "loopRestartErrors",
  "loopRestarts",
] as const;

export function PracticeLoopControls({
  store,
  song,
  start,
  end,
  selectStart,
  selectEnd,
  disabled,
  command,
  passages,
}: {
  store: PlaybackStore;
  song: LoadedSong | null;
  start: number;
  end: number;
  selectStart: (measure: number) => void;
  selectEnd: (measure: number) => void;
  disabled: boolean;
  command: (command: EngineCommand) => void;
  passages: () => void;
}) {
  const state = usePlaybackFields(store, loopFields);
  const [first, setFirst] = useState(String(start));
  const [last, setLast] = useState(String(end));
  const helpId = useId();
  useEffect(() => setFirst(String(start)), [start]);
  useEffect(() => setLast(String(end)), [end]);
  const total = song?.measures.length ?? 0;
  const validMeasure = (text: string) =>
    /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= total;
  const valid =
    validMeasure(first) && validMeasure(last) && Number(first) <= Number(last);
  const range = activeMeasures(song, state.passage);
  const requestedStart = song?.measures[Number(first) - 1]?.start;
  const requestedEnd = song
    ? Math.min(
        song.duration,
        song.measures[Number(last) - 1]?.end ?? song.duration,
      )
    : undefined;
  const changed =
    !state.passage ||
    requestedStart !== state.passage.start ||
    requestedEnd !== state.passage.end;
  const apply = () => {
    if (!valid || disabled || !song || !changed) return;
    command({
      type: "measureLoop",
      enabled: true,
      start: Number(first),
      end: Number(last),
    });
  };
  return (
    <section className="inspector-section practice-loop-section">
      <div className="section-heading">
        <h2>分段循环</h2>
        <button
          role="switch"
          aria-label="分段循环"
          aria-checked={Boolean(state.passage)}
          className={`toggle ${state.passage ? "on" : ""}`}
          disabled={disabled || !song || (!state.passage && !valid)}
          onClick={() =>
            state.passage
              ? command({
                  type: "measureLoop",
                  enabled: false,
                  start: range?.first ?? 1,
                  end: range?.last ?? 1,
                })
              : apply()
          }
        >
          <i />
        </button>
      </div>
      <p className="practice-loop-active">
        {state.passage && range
          ? `正在循环第 ${range.first}–${range.last} 小节`
          : "当前练习全曲"}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <fieldset disabled={disabled || !song}>
          <div className="practice-loop-inputs">
            <label>
              起始小节
              <input
                aria-label="循环起始小节"
                aria-describedby={helpId}
                aria-invalid={!validMeasure(first) || undefined}
                type="number"
                step="1"
                min="1"
                max={total || 1}
                value={first}
                onChange={(event) => {
                  const value = event.target.value;
                  setFirst(value);
                  if (validMeasure(value)) selectStart(Number(value));
                }}
              />
            </label>
            <span aria-hidden="true">—</span>
            <label>
              结束小节
              <input
                aria-label="循环结束小节"
                aria-describedby={helpId}
                aria-invalid={
                  !validMeasure(last) ||
                  (validMeasure(first) && Number(first) > Number(last)) ||
                  undefined
                }
                type="number"
                step="1"
                min="1"
                max={total || 1}
                value={last}
                onChange={(event) => {
                  const value = event.target.value;
                  setLast(value);
                  if (validMeasure(value)) selectEnd(Number(value));
                }}
              />
            </label>
          </div>
          <div className="practice-loop-markers">
            <button
              type="button"
              title="使用当前位置作为起点"
              onClick={() => {
                const measure = Math.max(
                  1,
                  Math.min(total, store.getSnapshot().measure),
                );
                selectStart(measure);
                setFirst(String(measure));
              }}
            >
              当前位置设 A
            </button>
            <button
              type="button"
              title="使用当前位置作为终点"
              onClick={() => {
                const measure = Math.max(
                  1,
                  Math.min(total, store.getSnapshot().measure),
                );
                selectEnd(measure);
                setLast(String(measure));
              }}
            >
              当前位置设 B
            </button>
          </div>
          <p
            id={helpId}
            className={`parameter-help ${song && !valid ? "practice-field-error" : ""}`}
          >
            {!song
              ? "选择曲目后设置练习范围。"
              : !valid
                ? `请输入 1–${total} 内的小节编号，起点不能大于终点。`
                : changed
                  ? "应用后按此范围循环。也可以在小节导航中拖选范围。"
                  : "当前范围已生效。"}
          </p>
          <button
            className="apply-loop"
            type="submit"
            disabled={!valid || !changed}
          >
            {state.passage ? "应用新范围" : "开始循环"}
          </button>
          <label className="practice-loop-rounds">
            循环遍数
            <select
              aria-label="循环遍数"
              value={state.rounds}
              onChange={(event) =>
                command({ type: "rounds", count: Number(event.target.value) })
              }
            >
              {[0, 1, 3, 5, 10].map((count) => (
                <option key={count} value={count}>
                  {count ? `${count} 遍` : "不限"}
                </option>
              ))}
            </select>
          </label>
          <label className="practice-loop-rounds">
            错误后自动重开
            <select
              aria-label="循环错误重开阈值"
              value={state.loopRestartErrors}
              onChange={(event) =>
                command({
                  type: "loopRestartErrors",
                  count: Number(event.target.value),
                })
              }
            >
              {![0, 1, 2, 3, 5, 10, 20, 50, 100].includes(
                state.loopRestartErrors,
              ) && (
                <option value={state.loopRestartErrors}>
                  {state.loopRestartErrors} 个错音或漏音
                </option>
              )}
              {[0, 1, 2, 3, 5, 10, 20, 50, 100].map((count) => (
                <option key={count} value={count}>
                  {count ? `${count} 个错音或漏音` : "关闭"}
                </option>
              ))}
            </select>
          </label>
          <p className="parameter-help">
            普通循环达到阈值后保存本轮并从起点重开，不计入完成遍数。日课和速度阶梯使用各自规则。
          </p>
          <button
            type="button"
            className="practice-loop-passages"
            onClick={passages}
          >
            已保存的练习段落
          </button>
        </fieldset>
      </form>
      {state.passage && (
        <span className="loop-progress">
          已完成 {state.repetitions} 遍
          {state.loopRestarts ? ` · 因错误重开 ${state.loopRestarts} 次` : ""}
        </span>
      )}
    </section>
  );
}
