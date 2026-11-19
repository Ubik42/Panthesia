import { useId, useLayoutEffect, useRef, useState } from "react";
import type { EngineCommand, LoadedSong, Snapshot } from "../../api";
import {
  activeMeasures,
  measureBeatLength,
  secondsAtTick,
} from "./practicePresentation";

type Position = Pick<Snapshot, "measure" | "beat" | "passage">;

/** A navigation draft stops following playback as soon as the user edits it. */
export function PracticePositionJump({
  song,
  state,
  disabled,
  command,
}: {
  song: LoadedSong;
  state: Position;
  disabled: boolean;
  command: (command: EngineCommand) => void;
}) {
  const [draft, setDraft] = useState<{ measure: string; beat: string } | null>(
    null,
  );
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (disabled || !returnFocus.current) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (
      !document.hasFocus() ||
      !target.isConnected ||
      target.closest("[hidden], [inert]") ||
      target.matches(":disabled")
    )
      return;
    const active = document.activeElement;
    if (!active || active === document.body || form.current?.contains(active))
      target.focus({ preventScroll: true });
  });
  const value = draft ?? {
    measure: String(state.measure),
    beat: String(Math.round(state.beat * 1000) / 1000),
  };
  const measure = Number(value.measure),
    beat = Number(value.beat);
  const range = activeMeasures(song, state.passage);
  const bar = Number.isInteger(measure)
    ? song.measures[measure - 1]
    : undefined;
  const validMeasure =
    !!bar && !!range && measure >= range.first && measure <= range.last;
  const beatLimit = bar
    ? 1 + (bar.endTick - bar.startTick) / measureBeatLength(song, bar)
    : 1;
  const validBeat =
    value.beat.trim() !== "" &&
    Number.isFinite(beat) &&
    beat >= 1 &&
    beat < beatLimit;
  const position =
    bar && validBeat
      ? secondsAtTick(
          song,
          Math.round(bar.startTick + (beat - 1) * measureBeatLength(song, bar)),
        )
      : null;
  const inPassage =
    !state.passage ||
    (position !== null &&
      position >= state.passage.start &&
      position < state.passage.end);
  const valid = validMeasure && validBeat && inPassage;
  return (
    <details className="practice-jump-details">
      <summary>定位到小节与拍</summary>
      <form
        ref={form}
        className="practice-jump-form"
        noValidate
        onFocusCapture={(event) => {
          if (!draft && event.target instanceof HTMLInputElement)
            setDraft(value);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !valid) return;
          returnFocus.current =
            document.activeElement instanceof HTMLElement &&
            form.current?.contains(document.activeElement)
              ? document.activeElement
              : null;
          command({ type: "seekBeat", measure, beat });
        }}
      >
        <label>
          小节
          <input
            type="number"
            aria-label="跳转小节"
            min={range?.first ?? 1}
            max={range?.last ?? song.measures.length}
            step="1"
            value={value.measure}
            disabled={disabled}
            aria-invalid={!validMeasure || undefined}
            aria-describedby={id}
            onChange={(event) =>
              setDraft({ ...value, measure: event.target.value })
            }
          />
        </label>
        <label>
          拍
          <input
            type="number"
            aria-label="跳转拍位"
            min="1"
            step="any"
            value={value.beat}
            disabled={disabled}
            aria-invalid={!validBeat || !inPassage || undefined}
            aria-describedby={id}
            onChange={(event) =>
              setDraft({ ...value, beat: event.target.value })
            }
          />
        </label>
        <button type="submit" disabled={disabled || !valid}>
          定位
        </button>
        <button type="button" disabled={!draft} onClick={() => setDraft(null)}>
          跟随当前位置
        </button>
        <p
          id={id}
          className={valid ? "parameter-help" : "practice-field-error"}
        >
          {!validMeasure
            ? `请输入当前练习范围内的小节编号${range ? `（${range.first}–${range.last}）` : ""}。`
            : !validBeat
              ? `此小节的拍位须大于等于 1，且小于 ${Number(beatLimit.toFixed(3))}。`
              : !inPassage
                ? "此拍位位于当前选段之外，请选择选段内的拍位，或先关闭分段循环。"
                : `第 ${measure} 小节 · ${bar!.numerator}/${bar!.denominator}${bar!.partial ? " · 弱起或短小节" : ""}。拍位可输入小数。`}
        </p>
      </form>
    </details>
  );
}
