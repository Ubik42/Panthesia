import { createPersistentSession } from "../../lib/createPersistentSession";
import type { PaperPracticeRequest } from "../../engine/commands.generated";

export interface PaperPracticeForm {
  name: string;
  notes: string;
  start: string;
  end: string;
  speed: string;
  rounds: string;
}
export interface PaperPracticeReceipt {
  id: string;
  existing: boolean;
  changed?: boolean;
}
interface State {
  version: 1;
  contentId: string;
  book: string;
  measure: number;
  form: PaperPracticeForm | null;
  pending: PaperPracticeRequest | null;
  saved: PaperPracticeReceipt | null;
  busy: boolean;
  storageError: string;
}
const slots = new Map<string, ReturnType<typeof createSession>>();
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const integer = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
function validForm(value: unknown): value is PaperPracticeForm | null {
  return (
    value === null ||
    (object(value) &&
      text(value.name, 160) &&
      text(value.notes, 8192) &&
      [value.start, value.end, value.speed, value.rounds].every((entry) =>
        text(entry, 32),
      ))
  );
}
function validRequest(
  value: unknown,
  contentId: string,
  book: string,
  measure: number,
): value is PaperPracticeRequest | null {
  return (
    value === null ||
    (object(value) &&
      value.contentId === contentId &&
      value.book === book &&
      value.measure === measure &&
      typeof value.proof === "string" &&
      /^[a-f\d]{64}$/i.test(value.proof) &&
      text(value.name, 160) &&
      text(value.notes, 8192) &&
      integer(value.start, 1, measure) &&
      integer(value.end, measure, 1_000_000) &&
      integer(value.rounds, 1, 99) &&
      typeof value.speed === "number" &&
      Number.isFinite(value.speed) &&
      value.speed >= 0.25 &&
      value.speed <= 2 &&
      (value.confirmOnly === undefined || value.confirmOnly === false))
  );
}
function createSession(contentId: string, book: string, measure: number) {
  const session = createPersistentSession<State>(
    (raw) => {
      const initial: State = {
        version: 1,
        contentId,
        book,
        measure,
        form: null,
        pending: null,
        saved: null,
        busy: false,
        storageError: "",
      };
      if (raw === null) return initial;
      try {
        if (raw.length > 65536)
          throw new Error("练习段草稿超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (!object(value))
          throw new Error("练习段草稿格式无法读取，原文已保留。");
        if (
          value.version === undefined &&
          text(value.name, 160) &&
          text(value.notes, 8192) &&
          [value.start, value.end, value.speed, value.rounds].every(
            (entry) => typeof entry === "number" && Number.isFinite(entry),
          )
        ) {
          // Retain the original per-passage key and migrate its numeric form without changing the passage.
          return {
            ...initial,
            form: {
              name: value.name,
              notes: value.notes,
              start: String(value.start),
              end: String(value.end),
              speed: String(Math.round((value.speed as number) * 10000) / 100),
              rounds: String(value.rounds),
            },
          };
        }
        if (
          value.version !== 1 ||
          value.contentId !== contentId ||
          value.book !== book ||
          value.measure !== measure ||
          !validForm(value.form) ||
          !validRequest(value.pending, contentId, book, measure) ||
          (value.saved !== null &&
            (!object(value.saved) ||
              typeof value.saved.id !== "string" ||
              !/^paper-practice-[a-f\d]{64}$/i.test(value.saved.id) ||
              typeof value.saved.existing !== "boolean" ||
              (value.saved.changed !== undefined &&
                typeof value.saved.changed !== "boolean")))
        )
          throw new Error("练习段草稿或保存回执格式无法读取，原文已保留。");
        if (value.pending !== null && value.saved !== null)
          throw new Error("练习段保存状态需要核对，原文已保留。");
        return {
          ...initial,
          form: value.form,
          pending: value.pending,
          saved: value.saved as PaperPracticeReceipt | null,
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia-paper-practice-draft:${contentId}:${book}:${measure}`,
      maxCharacters: 65536,
      failureMessage: "练习段草稿尚未暂存，请保留当前窗口或复制输入。",
    },
  );
  let subscribers = 0;
  return {
    ...session,
    subscribe(listener: () => void) {
      subscribers++;
      const release = session.subscribe(listener);
      return () => {
        subscribers--;
        release();
      };
    },
    unused: () =>
      !subscribers &&
      !session.getSnapshot().busy &&
      !session.getSnapshot().pending &&
      !session.getSnapshot().storageError,
  };
}
export function paperPracticeDraftSession(
  contentId: string,
  book: string,
  measure: number,
) {
  const key = JSON.stringify([contentId, book, measure]);
  let session = slots.get(key);
  if (!session) {
    for (const [oldKey, old] of slots) {
      if (slots.size < 128) break;
      if (old.unused()) slots.delete(oldKey);
    }
    session = createSession(contentId, book, measure);
    slots.set(key, session);
  }
  return session;
}
export function pendingPaperPracticeDrafts() {
  for (const session of slots.values()) {
    const state = session.getSnapshot();
    if (state.storageError) return state.storageError;
  }
  return null;
}
export function flushPaperPracticeDrafts() {
  for (const session of slots.values()) {
    const state = session.getSnapshot();
    if (state.form || state.pending || state.saved || state.storageError)
      session.retrySave();
  }
}
