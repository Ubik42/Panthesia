import { api, type LoadedSong } from "../../api";
import type { ExerciseSpec } from "../../engine/commands.generated";

/** The generated exercise as it was opened. */
export interface ExerciseResult {
  contentId: string;
  title: string;
  importWarnings: string[];
}

export type ExerciseDraft = Required<ExerciseSpec>;
export const defaultExercise = (): ExerciseDraft => ({
  tonic: 0,
  tonality: "Major",
  minor_form: "Natural",
  pattern: "Scale",
  direction: "UpAndDown",
  hands: "Both",
  octaves: 1,
  repetitions: 1,
  tempo_bpm: 60,
});
export function exerciseValidation(spec: ExerciseSpec): string | null {
  if (
    !["Major", "Minor"].includes(spec.tonality) ||
    !["Natural", "Harmonic", "Melodic"].includes(
      spec.minor_form ?? "Natural",
    ) ||
    !["Scale", "Arpeggio", "PrimaryChords"].includes(spec.pattern) ||
    !["Ascending", "Descending", "UpAndDown"].includes(spec.direction) ||
    !["Both", "Right", "Left"].includes(spec.hands)
  )
    return "练习类型或声部参数无效，请重新选择。";
  if (!Number.isInteger(spec.tonic) || spec.tonic < 0 || spec.tonic > 11)
    return "请选择 C 到 B 范围内的主音。";
  if (!Number.isInteger(spec.octaves) || spec.octaves < 1 || spec.octaves > 3)
    return "练习八度应为 1 到 3。";
  if (
    (spec.minor_form ?? "Natural") !== "Natural" &&
    (spec.tonality !== "Minor" || spec.pattern !== "Scale")
  )
    return "和声、旋律小调适用于小调音阶；其他练习请选择自然形式。";
  if (
    !Number.isInteger(spec.repetitions ?? 1) ||
    (spec.repetitions ?? 1) < 1 ||
    (spec.repetitions ?? 1) > 8
  )
    return "重复次数应为 1 到 8。";
  if (
    !Number.isInteger(spec.tempo_bpm) ||
    spec.tempo_bpm < 20 ||
    spec.tempo_bpm > 240
  )
    return "速度应为 20 到 240 BPM。";
  return null;
}
/** Generate and open the exercise. */
export async function generateExercise(spec: ExerciseSpec): Promise<{ result: ExerciseResult; engineId?: string }> {
  const invalid = exerciseValidation(spec);
  if (invalid) throw new Error(invalid);
  const before = await api.state();
  const song = await api.command<LoadedSong>({ type: "generate", spec });
  return {
    result: { contentId: song.contentId, title: song.title, importWarnings: [] },
    engineId: before.stateOrder?.engineId,
  };
}

/** A compact musical preview derived from the selected values, with no playback or storage side effects. */
export function exerciseDescription(spec: ExerciseSpec) {
  const tonic =
    ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][
      spec.tonic
    ] ?? "—";
  const tonality =
    spec.tonality === "Major"
      ? "大调"
      : { Natural: "自然小调", Harmonic: "和声小调", Melodic: "旋律小调" }[
          spec.minor_form ?? "Natural"
        ];
  const pattern = {
    Scale: "音阶",
    Arpeggio: "琶音",
    PrimaryChords: "主三和弦",
  }[spec.pattern];
  const hands = { Both: "双手", Right: "右手", Left: "左手" }[spec.hands];
  const direction = {
    Ascending: "上行",
    Descending: "下行",
    UpAndDown: "上行与下行",
  }[spec.direction];
  return {
    title: `${tonic}${tonality} · ${pattern}`,
    detail: `${hands} · ${spec.octaves} 个八度 · ${direction}`,
    rhythm: `${spec.tempo_bpm} BPM · 重复 ${spec.repetitions ?? 1} 次`,
  };
}
