import { createPersistentSession } from "../../app/createPersistentSession";
import {
  boundedText as text,
  readPreparedSong as song,
  readPreparationReceipt,
} from "../imports/preparationPersistence";
import type {
  ImportedSong,
  MusicReceipt,
} from "../../engine/commands.generated";
import {
  defaultExercise,
  type ExerciseDraft,
} from "./exerciseGenerationClient";

export interface ExerciseSession {
  spec: ExerciseDraft;
  presetName: string;
  phase: "editing" | "working" | "review" | "ready" | "error";
  busy: boolean;
  receipt?: MusicReceipt;
  result?: ImportedSong;
  error: string;
  message: string;
  dirty: boolean;
  refreshPending: boolean;
  storageError: string;
}
const key = "neothesia.exercise-draft.v1";
const initial = (): ExerciseSession => ({
  spec: defaultExercise(),
  presetName: "",
  phase: "editing",
  busy: false,
  error: "",
  message: "",
  dirty: false,
  refreshPending: false,
  storageError: "",
});
function restore(saved: string | null): ExerciseSession {
  const fresh = initial();
  try {
    if (!saved) return fresh;
    if (saved.length > 100000)
      return {
        ...fresh,
        storageError: "技术练习草稿过大，已使用默认参数；原草稿保留。",
      };
    const row = JSON.parse(saved) as Partial<ExerciseSession>;
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !row.spec ||
      typeof row.spec !== "object" ||
      Array.isArray(row.spec)
    )
      return {
        ...fresh,
        storageError:
          "技术练习草稿的结构暂时无法读取，原文已保留。可以复制后采用当前输入。",
      };
    const spec = { ...defaultExercise(), ...row.spec };
    if (
      ![spec.tonic, spec.octaves, spec.repetitions, spec.tempo_bpm].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      !["Major", "Minor"].includes(spec.tonality) ||
      !["Natural", "Harmonic", "Melodic"].includes(spec.minor_form) ||
      !["Scale", "Arpeggio", "PrimaryChords"].includes(spec.pattern) ||
      !["Ascending", "Descending", "UpAndDown"].includes(spec.direction) ||
      !["Both", "Right", "Left"].includes(spec.hands)
    )
      return {
        ...fresh,
        storageError: "保存的技术练习参数无效，已使用默认参数；原草稿保留。",
      };
    const previous = readPreparationReceipt(row.receipt, "exercise");
    const savedResult = song(row.result);
    if (
      (row.receipt != null && !previous) ||
      (row.result != null && !savedResult) ||
      (savedResult &&
        previous?.song &&
        savedResult.contentId !== previous.song.contentId)
    )
      return {
        ...fresh,
        spec,
        presetName: text(row.presetName, 80) ? row.presetName : "",
        storageError:
          "技术练习的参数、回执或结果需要核对，原记录已保留，可复制原文后处理。",
      };
    const result =
      savedResult ??
      (previous?.phase === "done" ? (previous.song ?? undefined) : undefined);
    const interrupted =
      ["working", "review"].includes(row.phase ?? "") ||
      (previous &&
        [
          "uploading",
          "queued",
          "running",
          "committing",
          "unconfirmed",
        ].includes(previous.phase));
    return {
      ...fresh,
      spec,
      presetName: text(row.presetName, 80) ? row.presetName : "",
      dirty: row.dirty === true,
      phase: result ? "ready" : interrupted ? "review" : "editing",
      result,
      receipt: previous,
      refreshPending: !!result,
      message: result
        ? "已恢复生成结果，可以打开原练习。"
        : interrupted
          ? "上次生成中断，请继续读取原请求；原参数保留。"
          : "已恢复上次的练习参数。",
    };
  } catch {
    return {
      ...fresh,
      storageError: "技术练习草稿读取失败，本次参数仍可正常编辑。",
    };
  }
}
export function createExerciseSessionStore() {
  const session = createPersistentSession(restore, {
    key,
    maxCharacters: 100000,
    failureMessage:
      "练习参数暂未保存到本机。请保留当前窗口，稍后重试保存草稿。",
  });
  const { getSnapshot, update } = session;
  return {
    ...session,
    claim() {
      if (getSnapshot().busy) return false;
      update({ busy: true, error: "" });
      return true;
    },
    edit(spec: ExerciseDraft, presetName = getSnapshot().presetName) {
      const state = getSnapshot();
      if (state.busy || state.phase === "review" || state.phase === "ready")
        return;
      update({
        spec,
        presetName,
        dirty: true,
        phase: "editing",
        receipt: undefined,
        result: undefined,
        message: "",
        error: "",
      });
    },
    useAgain() {
      const state = getSnapshot();
      if (state.busy || state.phase === "review") return;
      update({
        phase: "editing",
        receipt: undefined,
        result: undefined,
        dirty: true,
        message: "保留当前参数，可以继续调整。",
        error: "",
        refreshPending: false,
      });
    },
  };
}
export type ExerciseSessionStore = ReturnType<
  typeof createExerciseSessionStore
>;
