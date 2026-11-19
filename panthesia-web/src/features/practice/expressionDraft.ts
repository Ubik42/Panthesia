import type { ExpressionGoal } from "../../engine/commands.generated";
export interface ExpressionDraft {
  base: ExpressionGoal | null;
  draft: ExpressionGoal | null;
  path?: string;
  title?: string;
  inputs?: ExpressionInputs;
  pending?: {
    phase: "unconfirmed" | "refresh";
    goal: ExpressionGoal | null;
    expected?: ExpressionGoal | null;
    engineId?: string;
  };
}
// This map must cover every wire field so a new requirement receives a merge policy.
const fieldInfo = {
  velocityDifference: {
    label: "力度平均差",
    unit: " / 127",
    min: 1,
    max: 64,
    initial: 12,
    hint: "至少 4 个匹配音符",
  },
  noteVelocityDifference: {
    label: "逐音力度差",
    unit: " / 127",
    min: 1,
    max: 64,
    initial: 20,
    hint: "至少 4 个确切配对音；漏音或无逐音记录不能达标",
  },
  notePedalMismatchCount: {
    label: "逐音踏板不一致音数",
    unit: " 音",
    min: 0,
    max: 8,
    initial: 0,
    hint: "起音前需有明确踏板状态；至少 4 个确切配对音，漏音或状态未知不能达标",
  },
  contourPercent: {
    label: "力度起伏一致率",
    unit: "%",
    min: 50,
    max: 100,
    initial: 80,
    hint: "至少 6 段参考变化",
  },
  pedalOffsetMs: {
    label: "踏板时机偏移",
    unit: " ms",
    min: 10,
    max: 500,
    initial: 80,
    hint: "至少 4 次踏板转换且全部对应",
  },
} satisfies Record<
  keyof ExpressionGoal,
  {
    label: string;
    unit: string;
    min: number;
    max: number;
    initial: number;
    hint: string;
  }
>;
export const expressionFields = (
  Object.keys(fieldInfo) as (keyof typeof fieldInfo)[]
).map((key) => ({ key, ...fieldInfo[key] }));
export type ExpressionInputs = Record<keyof ExpressionGoal, string | null>;
export const expressionInputs = (
  goal: ExpressionGoal | null | undefined,
): ExpressionInputs =>
  Object.fromEntries(
    expressionFields.map(({ key }) => [
      key,
      goal?.[key] == null ? null : String(goal[key]),
    ]),
  ) as ExpressionInputs;
export const isExpressionInputs = (value: unknown): value is ExpressionInputs =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  expressionFields.every(({ key }) => {
    const field = (value as Record<string, unknown>)[key];
    return field === null || (typeof field === "string" && field.length <= 32);
  });
export function parseExpressionInputs(inputs: ExpressionInputs): {
  value: ExpressionGoal | null;
  error: string;
} {
  let error = "";
  const values = expressionFields.map(({ key, label, min, max, initial }) => {
    const raw = inputs[key];
    if (raw === null) return [key, null];
    const value = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    const valid = Number.isInteger(value) && value >= min && value <= max;
    if (!valid) error ||= `${label}需要填写 ${min} 至 ${max} 的整数。`;
    return [key, valid ? value : initial];
  });
  return {
    value: values.every(([, value]) => value === null)
      ? null
      : (Object.fromEntries(values) as ExpressionGoal),
    error,
  };
}
export const expressionKey = (goal: ExpressionGoal | null) =>
  JSON.stringify(
    goal === null
      ? null
      : Object.fromEntries(
          expressionFields.map(({ key }) => {
            const value = goal[key] ?? null;
            return [
              key,
              typeof value === "number" && !Number.isFinite(value)
                ? { invalidNumber: String(value) }
                : value,
            ];
          }),
        ),
  );
export const sameExpressionGoal = (
  left: ExpressionGoal | null,
  right: ExpressionGoal | null,
) => expressionKey(left) === expressionKey(right);
export function expressionInputError(goal: ExpressionGoal | null): string {
  if (goal === null) return "";
  if (expressionFields.every(({ key }) => goal[key] == null))
    return "请选择力度或踏板要求，或清除全部目标。";
  for (const { key, label, unit, min, max } of expressionFields) {
    const value = goal[key];
    if (value == null) continue;
    if (!Number.isInteger(value) || value < min || value > max)
      return `${label}应填写 ${min} 至 ${max} 的整数${unit.trim() === "/ 127" ? "" : unit}。`;
  }
  return "";
}
export function expressionMerge(
  base: ExpressionGoal | null,
  draft: ExpressionGoal,
  latest: ExpressionGoal,
) {
  return expressionFields.map((field) => {
    const oldValue = base?.[field.key] ?? null,
      local = draft[field.key] ?? null,
      remote = latest[field.key] ?? null;
    return {
      ...field,
      base: oldValue,
      draft: local,
      latest: remote,
      changed: local !== oldValue || remote !== oldValue,
      conflict: local !== oldValue && remote !== oldValue && local !== remote,
      merged: local === oldValue ? remote : local,
    };
  });
}
