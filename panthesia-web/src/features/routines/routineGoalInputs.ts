import type { RoutineGoal } from "./routineTypes";

export const routineGoalFields = {
  passes: {
    label: "达标次数",
    accessible: "计划项目达标次数",
    min: 1,
    max: 100,
  },
  accuracy: {
    label: "正确率至少 %",
    accessible: "计划项目正确率",
    min: 50,
    max: 100,
  },
  attemptLimit: {
    label: "本次轮数上限",
    accessible: "计划项目轮数上限",
    min: 1,
    max: 500,
  },
  onTime: {
    label: "准时率至少 %",
    accessible: "计划项目准时率",
    min: 50,
    max: 100,
  },
} as const;
export type RoutineGoalField = keyof typeof routineGoalFields;
export type RoutineGoalInputs = Record<RoutineGoalField, string>;
export function isRoutineGoalInputs(
  value: unknown,
): value is RoutineGoalInputs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(routineGoalFields).every(
    (field) => typeof fields[field] === "string" && fields[field].length <= 16,
  );
}
export const routineGoalInputs = (goal: RoutineGoal): RoutineGoalInputs => ({
  passes: String(goal.passes),
  accuracy: String(goal.accuracy),
  attemptLimit: String(goal.attemptLimit),
  onTime: String(goal.onTime ?? 80),
});
export function readRoutineGoalInput(
  field: RoutineGoalField,
  text: string,
): number | null {
  const value = /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  const limits = routineGoalFields[field];
  return Number.isInteger(value) && value >= limits.min && value <= limits.max
    ? value
    : null;
}
export function routineGoalInputErrors(
  input: RoutineGoalInputs,
  timed: boolean,
) {
  return (Object.keys(routineGoalFields) as RoutineGoalField[])
    .filter(
      (field) =>
        (field !== "onTime" || timed) &&
        readRoutineGoalInput(field, input[field]) === null,
    )
    .map(
      (field) =>
        `${routineGoalFields[field].label}需为 ${routineGoalFields[field].min} 到 ${routineGoalFields[field].max} 之间的整数。`,
    );
}
export const hasRoutineGoalInputDraft = (
  goal: RoutineGoal,
  input: RoutineGoalInputs,
) => {
  const formatted = routineGoalInputs(goal);
  return (Object.keys(formatted) as RoutineGoalField[]).some(
    (field) =>
      (field !== "onTime" || goal.onTime != null) &&
      input[field] !== formatted[field],
  );
};
