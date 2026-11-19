import { createPersistentSession } from "../../app/createPersistentSession";
import type {
  PageAnchor,
  NoteAnchor,
  PageRegion,
} from "../../engine/commands.generated";

export interface PaperLocationDraft {
  id: string;
  kind: "measure" | "note";
  grid: string;
  scoreRevision: number;
  measure: number;
  assetId: string;
  page: number;
  region: PageRegion;
  note: { track: number; index: number; pitch: number; tick: number } | null;
  expected: PageAnchor | NoteAnchor | null;
  updatedAt: number;
}
export interface PaperLocationForm {
  anchorText: string;
  noteText: string;
  noteKey: string;
  mappingOpen: boolean;
  noteOpen: boolean;
  toolsOpen?: boolean;
}
interface Stored {
  version: 1;
  contentId: string;
  book: string;
  drafts: PaperLocationDraft[];
  form: PaperLocationForm | null;
}
interface Snapshot extends Stored {
  busy: boolean;
  storageError: string;
  restored: boolean;
}
const slots = new Map<string, ReturnType<typeof createSession>>();
const maxSize = 768_000,
  maxDrafts = 128;
export function samePaperRegion(
  left: PageRegion | null | undefined,
  right: PageRegion | null | undefined,
) {
  return !left || !right
    ? !left && !right
    : ["x", "y", "width", "height"].every(
        (key) =>
          Math.abs(
            left[key as keyof PageRegion] - right[key as keyof PageRegion],
          ) < 1e-6,
      );
}
export function samePaperAnchor(
  left: PageAnchor | NoteAnchor | null | undefined,
  right: PageAnchor | NoteAnchor | null | undefined,
) {
  if (!left || !right) return !left && !right;
  if (
    left.measure !== right.measure ||
    left.page !== right.page ||
    !samePaperRegion(left.region, right.region)
  )
    return false;
  if ("track" in left || "track" in right)
    return (
      "track" in left &&
      "track" in right &&
      left.track === right.track &&
      left.index === right.index &&
      left.pitch === right.pitch &&
      left.grid === right.grid &&
      left.assetId === right.assetId
    );
  return true;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit;
function validRegion(value: unknown): value is PageRegion {
  return (
    object(value) &&
    [value.x, value.y, value.width, value.height].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) &&
    (value.x as number) >= 0 &&
    (value.y as number) >= 0 &&
    (value.width as number) >= 0.002 &&
    (value.height as number) >= 0.002 &&
    (value.x as number) + (value.width as number) <= 1.000001 &&
    (value.y as number) + (value.height as number) <= 1.000001
  );
}
function validAnchor(value: unknown, kind: "measure" | "note") {
  if (value === null) return true;
  if (
    !object(value) ||
    !integer(value.measure, 1, 1_000_000) ||
    !integer(value.page, 1, 5000)
  )
    return false;
  if (kind === "measure")
    return value.region === undefined || validRegion(value.region);
  return (
    text(value.grid, 160) &&
    text(value.assetId, 512) &&
    integer(value.track, 0, 1_000_000) &&
    integer(value.index, 0, Number.MAX_SAFE_INTEGER) &&
    integer(value.pitch, 0, 127) &&
    validRegion(value.region)
  );
}
function validDraft(value: unknown): value is PaperLocationDraft {
  if (
    !object(value) ||
    !text(value.id, 2048) ||
    (value.kind !== "measure" && value.kind !== "note") ||
    !text(value.grid, 160) ||
    !integer(value.scoreRevision, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(value.measure, 1, 1_000_000) ||
    !text(value.assetId, 512) ||
    !integer(value.page, 1, 5000) ||
    !validRegion(value.region) ||
    !integer(value.updatedAt, 0, Number.MAX_SAFE_INTEGER) ||
    !validAnchor(value.expected, value.kind)
  )
    return false;
  return value.kind === "measure"
    ? value.note === null
    : object(value.note) &&
        integer(value.note.track, 0, 1_000_000) &&
        integer(value.note.index, 0, Number.MAX_SAFE_INTEGER) &&
        integer(value.note.pitch, 0, 127) &&
        integer(value.note.tick, 0, Number.MAX_SAFE_INTEGER);
}
function validForm(value: unknown): value is PaperLocationForm | null {
  return (
    value === null ||
    (object(value) &&
      typeof value.anchorText === "string" &&
      value.anchorText.length <= 32 &&
      typeof value.noteText === "string" &&
      value.noteText.length <= 32 &&
      typeof value.noteKey === "string" &&
      value.noteKey.length <= 128 &&
      typeof value.mappingOpen === "boolean" &&
      typeof value.noteOpen === "boolean" &&
      (value.toolsOpen === undefined || typeof value.toolsOpen === "boolean"))
  );
}
export function paperLocationDraftId(
  draft: Omit<PaperLocationDraft, "id" | "updatedAt" | "region" | "expected">,
) {
  return JSON.stringify([
    draft.kind,
    draft.grid,
    draft.scoreRevision,
    draft.measure,
    draft.assetId,
    draft.page,
    draft.note,
  ]);
}
function createSession(contentId: string, book: string) {
  const session = createPersistentSession<Snapshot>(
    (raw) => {
      const initial: Snapshot = {
        version: 1,
        contentId,
        book,
        drafts: [],
        form: null,
        busy: false,
        storageError: "",
        restored: false,
      };
      if (raw === null) return initial;
      try {
        if (raw.length > maxSize)
          throw new Error("位置草稿超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          value.contentId !== contentId ||
          value.book !== book ||
          !Array.isArray(value.drafts) ||
          value.drafts.length > maxDrafts ||
          !value.drafts.every(validDraft) ||
          new Set(value.drafts.map((draft) => draft.id)).size !==
            value.drafts.length ||
          !validForm(value.form)
        )
          throw new Error("位置草稿格式无法读取，原文已保留。");
        return {
          ...initial,
          drafts: value.drafts,
          form: value.form,
          restored: value.drafts.length > 0,
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia.paper-locations.v1:${JSON.stringify([contentId, book])}`,
      maxCharacters: maxSize,
      failureMessage: "位置草稿尚未暂存，请保留当前窗口或复制输入。",
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
      !session.getSnapshot().drafts.length &&
      !session.getSnapshot().storageError,
    put(draft: PaperLocationDraft) {
      if (!validDraft(draft)) return false;
      const state = session.getSnapshot();
      if (
        !state.drafts.some((row) => row.id === draft.id) &&
        state.drafts.length >= maxDrafts
      )
        return false;
      session.update({
        drafts: [
          structuredClone(draft),
          ...state.drafts.filter((row) => row.id !== draft.id),
        ],
      });
      return true;
    },
    remove(id: string, expected?: PaperLocationDraft) {
      const state = session.getSnapshot(),
        row = state.drafts.find((draft) => draft.id === id);
      // A late save cannot discard a newer frame selected for the same note.
      if (
        !row ||
        (expected && JSON.stringify(row) !== JSON.stringify(expected))
      )
        return;
      session.update({
        drafts: state.drafts.filter((draft) => draft.id !== id),
      });
    },
    replace(expected: PaperLocationDraft, next: PaperLocationDraft) {
      const state = session.getSnapshot();
      if (
        !validDraft(next) ||
        state.drafts.some(
          (draft) => draft.id === next.id && draft.id !== expected.id,
        ) ||
        !state.drafts.some(
          (draft) =>
            draft.id === expected.id &&
            JSON.stringify(draft) === JSON.stringify(expected),
        )
      )
        return false;
      session.update({
        drafts: [
          structuredClone(next),
          ...state.drafts.filter((draft) => draft.id !== expected.id),
        ],
      });
      return true;
    },
    setForm(form: PaperLocationForm) {
      if (
        validForm(form) &&
        JSON.stringify(form) !== JSON.stringify(session.getSnapshot().form)
      )
        session.update({ form });
    },
    flush: session.retrySave,
    pending: () => session.getSnapshot().storageError || null,
  };
}
export function paperLocationSession(contentId: string, book: string) {
  const key = JSON.stringify([contentId, book]);
  let session = slots.get(key);
  if (!session) {
    for (const [oldKey, old] of slots) {
      if (slots.size < 128) break;
      if (old.unused()) slots.delete(oldKey);
    }
    session = createSession(contentId, book);
    slots.set(key, session);
  }
  return session;
}
export function flushPaperLocationDrafts() {
  for (const session of slots.values()) {
    const state = session.getSnapshot();
    if (state.form || state.drafts.length || state.storageError)
      session.flush();
  }
}
export function pendingPaperLocationDrafts() {
  for (const session of slots.values()) {
    const issue = session.pending();
    if (issue) return issue;
  }
  return null;
}
export type PaperLocationSession = ReturnType<typeof paperLocationSession>;
