import {
  learningStages,
  type LearningDraft,
  type SongLearning,
} from "../../songLearning";

export interface LearningEditDraft {
  path: string;
  title: string;
  base: SongLearning | null;
  draft: LearningDraft;
  inputs?: LearningInputs;
  section?: LearningSection;
  pending?: {
    phase: "unconfirmed" | "refresh";
    value: LearningDraft | null;
    engineId?: string;
  };
}
export type LearningSection = "plan" | "evidence" | "history";
export interface LearningInputs {
  stage: string;
  goal: string;
  due: string;
  weeklyMinutes: string;
  targetBpm: string;
}
export const learningInputs = (
  value: LearningDraft | SongLearning | null,
): LearningInputs => {
  const plan = value ?? defaultLearning();
  return {
    stage: plan.stage,
    goal: plan.goal,
    due: plan.due ?? "",
    weeklyMinutes: plan.weeklyMinutes == null ? "" : String(plan.weeklyMinutes),
    targetBpm: plan.targetBpm == null ? "" : String(plan.targetBpm),
  };
};
export const isLearningInputs = (value: unknown): value is LearningInputs =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  ["stage", "goal", "due", "weeklyMinutes", "targetBpm"].every(
    (key) =>
      typeof (value as Record<string, unknown>)[key] === "string" &&
      (value as Record<string, string>)[key].length <=
        (key === "goal" ? 8192 : 256),
  );
export function parseLearningInputs(input: LearningInputs): {
  value: LearningDraft;
  error: string;
} {
  const numeric = (text: string) =>
    text.trim() === "" ? null : /^\d+$/.test(text.trim()) ? Number(text) : NaN;
  const minutes = numeric(input.weeklyMinutes),
    bpm = numeric(input.targetBpm);
  const value: LearningDraft = {
    stage: input.stage,
    goal: input.goal,
    due: input.due || null,
    weeklyMinutes: Number.isFinite(minutes) ? minutes : null,
    targetBpm: Number.isFinite(bpm) ? bpm : null,
  };
  const error = Number.isNaN(minutes)
    ? "每周计划时长需要填写整数分钟，留空表示未设置。"
    : Number.isNaN(bpm)
      ? "目标速度需要填写整数 BPM，留空表示未设置。"
      : learningInputError(value);
  return { value, error };
}
export const learningValue = (
  value: SongLearning | LearningDraft | null,
): LearningDraft | null =>
  value
    ? {
        stage: value.stage,
        goal: value.goal,
        due: value.due,
        weeklyMinutes: value.weeklyMinutes,
        targetBpm: value.targetBpm,
      }
    : null;
export const defaultLearning = (): LearningDraft => ({
  stage: "planned",
  goal: "",
  due: null,
  weeklyMinutes: null,
  targetBpm: null,
});

export function learningInputError(value: LearningDraft): string {
  if (!Object.hasOwn(learningStages, value.stage))
    return "请选择有效的学习阶段。";
  if (Array.from(value.goal).length > 2000) return "学习目标最多填写 2000 字。";
  if (value.due !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.due)) return "请选择有效的目标日期。";
    const [year, month, day] = value.due.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      year < 2000 ||
      year > 2200 ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    )
      return "目标日期应为 2000 年至 2200 年之间的有效日期。";
  }
  if (
    value.weeklyMinutes !== null &&
    (!Number.isInteger(value.weeklyMinutes) ||
      value.weeklyMinutes < 1 ||
      value.weeklyMinutes > 10080)
  )
    return "每周计划时长应为 1 至 10080 的整数分钟。";
  if (
    value.targetBpm !== null &&
    (!Number.isInteger(value.targetBpm) ||
      value.targetBpm < 20 ||
      value.targetBpm > 300)
  )
    return "目标速度应为 20 至 300 的整数 BPM。";
  return "";
}
