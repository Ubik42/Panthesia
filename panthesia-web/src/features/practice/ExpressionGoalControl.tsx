import { useEffect, useRef, useState } from "react";
import {
  expressionFields,
  expressionInputs,
  parseExpressionInputs,
  type ExpressionInputs,
} from "./expressionDraft";
import type {
  ExpressionGoal,
  NoteVelocityEvidence,
  NotePedalEvidence,
} from "../../engine/commands.generated";
export type {
  ExpressionGoal,
  NoteVelocityEvidence,
  NotePedalEvidence,
} from "../../engine/commands.generated";
export function notePedalEvidenceText(value?: NotePedalEvidence | null) {
  if (!value) return "";
  return `踏板状态可对照 ${value.pairedStateNotes} / ${value.referenceNotes} 音 · 不一致 ${value.mismatchCount} 音${value.unknownStateNotes ? ` · 状态未知 ${value.unknownStateNotes} 音` : ""}`;
}
export function noteVelocityEvidenceText(value?: NoteVelocityEvidence | null) {
  if (!value) return "";
  return `确切配对 ${value.matchedNotes} / ${value.referenceNotes} 音 · 最大力度差 ${value.maxAbsDifference ?? "无证据"}`;
}
export function expressionGoalText(goal?: ExpressionGoal | null) {
  if (!goal) return "";
  return [
    goal.velocityDifference != null
      ? `力度平均差 ≤ ${goal.velocityDifference}`
      : "",
    goal.noteVelocityDifference != null
      ? `逐音力度差 ≤ ${goal.noteVelocityDifference}`
      : "",
    goal.notePedalMismatchCount != null
      ? `逐音踏板不一致 ≤ ${goal.notePedalMismatchCount} 音`
      : "",
    goal.contourPercent != null ? `起伏一致率 ≥ ${goal.contourPercent}%` : "",
    goal.pedalOffsetMs != null ? `踏板偏移 ≤ ${goal.pedalOffsetMs} ms` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function ExpressionGoalControl({
  value,
  disabled,
  change,
  wait = false,
  labelPrefix = "计划项目",
  inputs,
  changeInputs,
}: {
  value?: ExpressionGoal | null;
  disabled: boolean;
  wait?: boolean;
  labelPrefix?: string;
  change: (value: ExpressionGoal | null) => void;
  inputs?: ExpressionInputs;
  changeInputs?: (inputs: ExpressionInputs) => void;
}) {
  const [local, setLocal] = useState(() => expressionInputs(value));
  const current = inputs ?? local;
  const emitted = useRef<ExpressionGoal | null | undefined>(value);
  useEffect(() => {
    if (!inputs && value !== emitted.current) setLocal(expressionInputs(value));
  }, [value, inputs]);
  const update = (key: keyof ExpressionGoal, raw: string | null) => {
    const next = { ...current, [key]: raw };
    if (changeInputs) {
      changeInputs(next);
      return;
    }
    setLocal(next);
    const parsed = parseExpressionInputs(next);
    const projection = parsed.error
      ? ({ ...parsed.value, [key]: NaN } as ExpressionGoal)
      : parsed.value;
    emitted.current = projection;
    change(projection);
  };
  return (
    <fieldset className="expression-goal-control" disabled={disabled}>
      <legend>力度与踏板要求（可选）</legend>
      {expressionFields.map((row) => (
        <div key={row.key}>
          <label>
            <input
              type="checkbox"
              aria-label={`${labelPrefix}要求${row.label}`}
              disabled={
                wait && row.key === "pedalOffsetMs" && current[row.key] === null
              }
              checked={current[row.key] !== null}
              onChange={(event) =>
                update(
                  row.key,
                  event.target.checked ? String(row.initial) : null,
                )
              }
            />
            {row.label}
          </label>
          {current[row.key] !== null && (
            <label className="expression-threshold">
              {row.key === "contourPercent" ? "至少" : "最多"}
              <input
                type="text"
                inputMode="numeric"
                maxLength={16}
                aria-label={`${labelPrefix}${row.label}`}
                aria-invalid={
                  !!parseExpressionInputs({
                    ...expressionInputs(null),
                    [row.key]: current[row.key],
                  }).error
                }
                value={current[row.key] ?? ""}
                onChange={(event) => update(row.key, event.target.value)}
              />
              {row.unit}
            </label>
          )}
          <small>{row.hint}</small>
        </div>
      ))}
      <p className="parameter-help">
        对照参考
        MIDI；键盘力度曲线会影响绝对差值，也可只选起伏方向。逐音力度和踏板状态按计分器确切配对音核对。踏板状态缺少明确控制事件时无法判断。踏板时机适用于连续演奏；参考范围或本轮数据不足时无法达标，踏板波动还需不超过
        120 ms。
      </p>
    </fieldset>
  );
}
