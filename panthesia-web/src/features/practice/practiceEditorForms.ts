import type { LadderPreset, SpeedLadderPlan } from "../../api";
import type {
  ExpressionGoal,
  PassagePreset,
} from "../../engine/commands.generated";
import type { EditorForm } from "./practiceEditorStore";

export const integerInput = (text: string | undefined) =>
  text && /^\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : NaN;
export const passageForm = (row: PassagePreset): EditorForm => ({
  name: row.name,
  first: String(row.start),
  last: String(row.end),
  notes: row.notes,
});
export const newPassageForm = (start: number, end: number): EditorForm => ({
  name: "",
  first: String(start),
  last: String(end),
  notes: "",
});
export const newLadderForm = (
  start: number,
  end: number,
  speed: number,
): EditorForm => ({
  name: "",
  first: String(start),
  last: String(end),
  startPercent: String(Math.max(25, Math.min(100, Math.round(speed * 100)))),
  targetPercent: "100",
  stepPercent: "5",
  passesRequired: "2",
  accuracyPercent: "90",
  onTimeEnabled: "no",
  onTimePercent: "80",
  failuresBeforeStepBack: "0",
  attemptLimit: "50",
  expression: "null",
});
export const ladderPlan = (form: EditorForm): SpeedLadderPlan => ({
  startPercent: integerInput(form.startPercent),
  targetPercent: integerInput(form.targetPercent),
  stepPercent: integerInput(form.stepPercent),
  passesRequired: integerInput(form.passesRequired),
  accuracyPercent: integerInput(form.accuracyPercent),
  onTimePercent:
    form.onTimeEnabled === "yes" ? integerInput(form.onTimePercent) : null,
  failuresBeforeStepBack: integerInput(form.failuresBeforeStepBack),
  attemptLimit: integerInput(form.attemptLimit),
});
export const validMeasureRange = (first: number, last: number, total: number) =>
  Number.isInteger(first) &&
  Number.isInteger(last) &&
  first >= 1 &&
  first <= last &&
  last <= total;

export const ladderSpeeds = (plan: SpeedLadderPlan) => {
  if (
    ![plan.startPercent, plan.targetPercent, plan.stepPercent].every(
      Number.isFinite,
    ) ||
    plan.stepPercent < 1 ||
    plan.startPercent > plan.targetPercent
  )
    return [];
  const speeds = [plan.startPercent];
  while (speeds[speeds.length - 1] < plan.targetPercent && speeds.length < 200)
    speeds.push(
      Math.min(
        plan.targetPercent,
        speeds[speeds.length - 1] + plan.stepPercent,
      ),
    );
  return speeds;
};
export const ladderForm = (row: LadderPreset): EditorForm => ({
  name: row.name,
  first: String(row.start),
  last: String(row.end),
  startPercent: String(row.plan.startPercent),
  targetPercent: String(row.plan.targetPercent),
  stepPercent: String(row.plan.stepPercent),
  passesRequired: String(row.plan.passesRequired),
  accuracyPercent: String(row.plan.accuracyPercent),
  onTimeEnabled: row.plan.onTimePercent === null ? "no" : "yes",
  onTimePercent:
    row.plan.onTimePercent === null ? "80" : String(row.plan.onTimePercent),
  failuresBeforeStepBack: String(row.plan.failuresBeforeStepBack),
  attemptLimit: String(row.plan.attemptLimit),
  expression: JSON.stringify(row.expression ?? null),
});
export function readLadderExpression(raw: string): {
  value: ExpressionGoal | null;
  valid: boolean;
} {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null) return { value: null, valid: true };
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { value: null, valid: false };
    const bounds: Record<string, [number, number]> = {
      velocityDifference: [1, 64],
      noteVelocityDifference: [1, 64],
      notePedalMismatchCount: [0, 8],
      contourPercent: [50, 100],
      pedalOffsetMs: [10, 500],
    };
    const valid =
      Object.values(value).some((entry) => entry !== null) &&
      Object.entries(value).every(
        ([key, entry]) =>
          Object.hasOwn(bounds, key) &&
          (entry === null ||
            (typeof entry === "number" &&
              Number.isInteger(entry) &&
              entry >= bounds[key][0] &&
              entry <= bounds[key][1])),
      );
    return { value: valid ? (value as ExpressionGoal) : null, valid };
  } catch {
    return { value: null, valid: false };
  }
}
export function ladderInputProblem(
  form: EditorForm,
  plan: SpeedLadderPlan,
  first: number,
  last: number,
  total: number,
  mode: string,
  expression: ReturnType<typeof readLadderExpression>,
) {
  const within = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  if (!form.name.trim()) return "请输入方案名称。";
  if (Array.from(form.name).length > 80) return "名称最多 80 个字符。";
  if (!within(first, 1, total) || !within(last, first, total))
    return "请输入完整起止小节，范围需在当前曲目内。";
  if (
    !within(plan.startPercent, 25, 200) ||
    !within(plan.targetPercent, plan.startPercent, 200)
  )
    return "起始与目标速度需在 25%–200%，目标应大于或等于起始速度。";
  if (!within(plan.stepPercent, 1, 50)) return "每级增加 1–50 个百分点。";
  if (!within(plan.passesRequired, 1, 10)) return "连续达标轮数需为 1–10。";
  if (!within(plan.accuracyPercent, 50, 100))
    return "正确率门槛需为 50%–100%。";
  if (!within(plan.attemptLimit, 1, 500)) return "本次轮数上限需为 1–500。";
  if (!within(plan.failuresBeforeStepBack, 0, 10))
    return "回退条件需为 0–10 轮。";
  if (plan.onTimePercent !== null && !within(plan.onTimePercent, 50, 100))
    return "准时率门槛需为 50%–100%。";
  if (!["wait", "flow"].includes(mode))
    return "请在主界面选择等音或连续模式后保存阶梯。";
  if (plan.onTimePercent !== null && mode !== "flow")
    return "等音模式下请关闭准时率要求。";
  if (!expression.valid) return "力度或踏板输入无法读取，请重新选择专项要求。";
  if (mode === "wait" && expression.value?.pedalOffsetMs != null)
    return "等音模式下请关闭踏板时机要求。";
  return "";
}
