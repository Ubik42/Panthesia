import { createPersistentSession } from "../../lib/createPersistentSession";
import { api, type LoadedSong, type PracticeEditCommand } from "../../api";
import { practiceScopeKey } from "./practiceEditorStore";
import { activitySignal } from "../activity/activitySignal";
export type HandChoice = "LeftHand" | "RightHand" | "Other" | "Inherit";
export interface HandAnchor {
  pitch: number;
  start: number;
}
export interface HandDraft {
  track: number;
  first: number;
  last: number;
  source: string;
  values: Record<number, HandChoice>;
  accepted: number[];
  touched: number[];
  anchors: Record<number, HandAnchor>;
  page: number;
  query: string;
  filter: "all" | "selected" | "manual" | "changes" | "review";
  generation: string | null;
}
export interface HandSubmission extends HandAnchor {
  index: number;
  choice: HandChoice;
}
interface Receipt {
  kind: "save" | "undo" | "span";
  phase: "sending" | "acknowledged" | "uncertain";
  context: string | null;
  track: number;
  rows: HandSubmission[];
  beforeUndo?: string;
  span?: { side: "left" | "right"; profile: string | null };
}
interface State {
  version: 1;
  contentId: string;
  title: string;
  path: string;
  track: number;
  first: string;
  last: string;
  reference: number;
  drafts: Record<string, HandDraft>;
  receipt: Receipt | null;
  busy: boolean;
  storageError: string;
  notice: string;
}
const slots = new Map<string, ReturnType<typeof createSession>>();
const choices: HandChoice[] = ["LeftHand", "RightHand", "Other", "Inherit"];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string =>
  typeof value === "string" && value.length <= max;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const indices = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length <= 8192 &&
  value.every(integer) &&
  new Set(value).size === value.length;
const anchor = (value: unknown): value is HandAnchor =>
  object(value) &&
  integer(value.pitch) &&
  value.pitch <= 127 &&
  typeof value.start === "number" &&
  Number.isFinite(value.start) &&
  value.start >= 0;
const validDraft = (value: unknown): value is HandDraft =>
  object(value) &&
  integer(value.track) &&
  integer(value.first) &&
  value.first >= 1 &&
  integer(value.last) &&
  value.last >= value.first &&
  text(value.source) &&
  (value.generation === null || text(value.generation, 2048)) &&
  object(value.values) &&
  Object.entries(value.values).length <= 8192 &&
  Object.entries(value.values).every(
    ([key, value]) =>
      /^\d+$/.test(key) && choices.includes(value as HandChoice),
  ) &&
  indices(value.accepted) &&
  value.accepted.length <= 4096 &&
  indices(value.touched) &&
  object(value.anchors) &&
  Object.entries(value.anchors).length <= 8192 &&
  Object.entries(value.anchors).every(
    ([key, value]) => /^\d+$/.test(key) && anchor(value),
  ) &&
  integer(value.page) &&
  value.page <= 50000 &&
  text(value.query, 1024) &&
  ["all", "selected", "manual", "changes", "review"].includes(
    String(value.filter),
  );
function validReceipt(value: unknown): value is Receipt {
  if (
    !object(value) ||
    !["save", "undo", "span"].includes(String(value.kind)) ||
    !["sending", "acknowledged", "uncertain"].includes(String(value.phase)) ||
    (value.context !== null && !text(value.context)) ||
    !integer(value.track) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 4096
  )
    return false;
  if (
    !value.rows.every(
      (row) =>
        object(row) &&
        anchor(row) &&
        integer(row.index) &&
        choices.includes(row.choice as HandChoice),
    ) ||
    new Set(value.rows.map((row) => row.index)).size !== value.rows.length
  )
    return false;
  if (value.kind === "save")
    return typeof value.context === "string" && value.rows.length > 0;
  if (value.kind === "undo")
    return (
      value.rows.length === 0 &&
      typeof value.beforeUndo === "string" &&
      /^[a-f\d]{64}$/i.test(value.beforeUndo)
    );
  return (
    value.rows.length === 0 &&
    object(value.span) &&
    ["left", "right"].includes(String(value.span.side)) &&
    (value.span.profile === null ||
      ["Compact", "Standard", "Large"].includes(String(value.span.profile)))
  );
}
export const handDraftKey = (track: number, first: number, last: number) =>
  JSON.stringify([track, first, last]);
export const emptyHandDraft = (
  song: LoadedSong,
  track: number,
  first: number,
  last: number,
): HandDraft => ({
  track,
  first,
  last,
  source: practiceScopeKey(song),
  values: {},
  accepted: [],
  touched: [],
  anchors: {},
  page: 0,
  query: "",
  filter: "all",
  generation: null,
});
export const handHasInput = (state: State) =>
  Object.values(state.drafts).some(
    (draft) => draft.accepted.length || Object.keys(draft.values).length,
  );
function createSession(song: LoadedSong, start: number, end: number) {
  const session = createPersistentSession<State>(
    (raw) => {
      const initial: State = {
        version: 1,
        contentId: song.contentId,
        title: song.title,
        path: song.sourcePath,
        track: song.tracks[0]?.id ?? 0,
        first: String(start),
        last: String(end),
        reference: 60,
        drafts: {},
        receipt: null,
        busy: false,
        storageError: "",
        notice: "",
      };
      if (raw === null) return initial;
      try {
        if (raw.length > 4_000_000)
          throw new Error("分手输入超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          value.contentId !== song.contentId ||
          !text(value.title, 1024) ||
          !text(value.path, 65536) ||
          !integer(value.track) ||
          !text(value.first) ||
          !text(value.last) ||
          !integer(value.reference) ||
          value.reference > 127 ||
          !object(value.drafts) ||
          Object.keys(value.drafts).length > 16 ||
          !Object.entries(value.drafts).every(
            ([key, row]) =>
              validDraft(row) &&
              key === handDraftKey(row.track, row.first, row.last),
          ) ||
          (value.receipt !== null && !validReceipt(value.receipt))
        )
          throw new Error("分手输入格式无法读取，原文已保留。");
        const receipt = value.receipt as Receipt | null;
        return {
          ...initial,
          track: value.track,
          first: value.first,
          last: value.last,
          reference: value.reference,
          drafts: value.drafts as Record<string, HandDraft>,
          receipt: receipt
            ? {
                ...receipt,
                phase:
                  receipt.phase === "sending" ? "uncertain" : receipt.phase,
              }
            : null,
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia.hand-editor.v1:${song.contentId}`,
      maxCharacters: 4_000_000,
      failureMessage: "分手输入尚未暂存，请复制输入或保留窗口。",
    },
  );
  let subscribers = 0;
  const stopActivity = session.subscribe(activitySignal.changed);
  const check = () => {
    const state = session.getSnapshot();
    if (state.busy || state.receipt)
      throw new Error("请先核对上一次分手操作结果。");
  };
  return {
    ...session,
    dispose: stopActivity,
    unused: () =>
      !subscribers &&
      !session.getSnapshot().busy &&
      !session.getSnapshot().storageError &&
      !session.getSnapshot().receipt,
    subscribe(listener: () => void) {
      subscribers++;
      const stop = session.subscribe(listener);
      return () => {
        subscribers--;
        stop();
      };
    },
    edit(key: string, draft: HandDraft) {
      check();
      const state = session.getSnapshot();
      const drafts = { ...state.drafts };
      if (!drafts[key] && Object.keys(drafts).length >= 16) {
        const clean = Object.entries(drafts).find(
          ([, draft]) =>
            !draft.accepted.length &&
            !draft.touched.length &&
            !Object.keys(draft.values).length,
        );
        if (!clean)
          throw new Error("本曲已保留 16 份选段输入，请先保存或清除一份。");
        delete drafts[clean[0]];
      }
      if (!validDraft(draft))
        throw new Error(
          "每份草稿最多保留 8192 个输入，单次最多保存 4096 个所选音符，请分批处理。",
        );
      session.update({ drafts: { ...drafts, [key]: draft }, notice: "" });
    },
    select(draft: HandDraft) {
      check();
      session.update({
        track: draft.track,
        first: String(draft.first),
        last: String(draft.last),
      });
    },
    clear(key: string) {
      check();
      const drafts = { ...session.getSnapshot().drafts };
      delete drafts[key];
      session.update({
        drafts,
        notice: "这份选段输入已清除，已保存的分手继续保留。",
      });
    },
    resolve(current: LoadedSong, clearContext = false) {
      const state = session.getSnapshot();
      if (current.contentId !== song.contentId || state.busy)
        throw new Error("当前分手资料仍在交接。");
      const drafts = { ...state.drafts };
      if (clearContext && state.receipt?.context)
        delete drafts[state.receipt.context];
      session.update({
        drafts,
        receipt: null,
        title: current.title,
        path: current.sourcePath,
        notice: "已读取当前分手资料，原请求核对已结束。",
      });
    },
    async commit(
      current: LoadedSong,
      command: Extract<
        PracticeEditCommand,
        { type: "applyHands" | "undoHandsFor" | "handSpanFor" }
      >,
      receipt: Omit<Receipt, "phase">,
      revision?: string,
    ) {
      check();
      if (current.contentId !== song.contentId)
        throw new Error("请在原曲目中继续编辑。");
      const expectedKind =
        command.type === "applyHands"
          ? "save"
          : command.type === "undoHandsFor"
            ? "undo"
            : "span";
      if (
        receipt.kind !== expectedKind ||
        !validReceipt({ ...receipt, phase: "sending" })
      )
        throw new Error("分手操作与当前提交内容不一致，请重新核对输入。");
      session.update({ receipt: { ...receipt, phase: "sending" }, busy: true });
      if (session.getSnapshot().storageError) {
        session.update({ receipt: null, busy: false });
        throw new Error("分手提交内容尚未暂存，请先处理暂存问题。");
      }
      try {
        await api.editPractice(current, command, revision);
        session.update({ receipt: { ...receipt, phase: "acknowledged" } });
      } catch (error) {
        session.update({ receipt: { ...receipt, phase: "uncertain" } });
        throw error;
      } finally {
        session.update({ busy: false });
      }
    },
  };
}
export function getHandEditor(song: LoadedSong, start: number, end: number) {
  let slot = slots.get(song.contentId);
  if (!slot) {
    if (slots.size >= 16)
      for (const [key, candidate] of slots)
        if (candidate.unused()) {
          candidate.dispose();
          slots.delete(key);
          break;
        }
    slot = createSession(song, start, end);
    slots.set(song.contentId, slot);
    activitySignal.changed();
  }
  return slot;
}
export const handEditorSessions = () =>
  [...slots.entries()].map(([key, store]) => ({
    key,
    store,
    state: store.getSnapshot(),
  }));
export const flushHandEditors = () => {
  for (const slot of slots.values()) slot.retrySave();
};
export const pendingHandEditors = () => {
  for (const slot of slots.values()) {
    const state = slot.getSnapshot();
    if (state.busy) return "分手资料仍在保存，请等待结束。";
    if (state.storageError && (handHasInput(state) || state.receipt))
      return state.storageError;
  }
  return null;
};
