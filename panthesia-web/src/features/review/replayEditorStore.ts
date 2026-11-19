import { api } from "../../api";
import { createPersistentSession } from "../../app/createPersistentSession";
import { activitySignal } from "../activity/activitySignal";
import type { ReplayClip } from "./historyTypes";
import type { ReplayClipRead as ReplayClipRows } from "../../engine/commands.generated";
import {
  clipHistorySource,
  requireHistorySource,
  validHistorySource,
  historyFailure,
  HistorySourceError,
  type HistorySource,
  type HistorySourceIssue,
} from "./historySource";

export interface ReplayRangeInput {
  measure: string;
  occurrence: string;
  start: string;
  end: string;
}
export interface ClipInput {
  id: string | null;
  name: string;
  notes: string;
  base: ReplayClip | null;
  revision: string | null;
}
interface ClipReceipt {
  source?: HistorySource;
  phase: "sending" | "uncertain" | "acknowledged";
  engineId: string;
  requestId: string;
  expected: string;
  action: "save" | "delete";
  clipId: string;
  value: { name: string; notes: string; start: number; end: number } | null;
  editingId: string | null;
}
interface ClipDraftSnapshot {
  draft: ClipInput;
  range: ReplayRangeInput;
  rangeSource?: HistorySource | null;
}
export interface ReplayReviewView {
  measure: number;
  before: number;
  after: number;
  gradeFilter: string;
  expressionFilter: string;
  velocityThreshold: number | null;
  thresholdDraft: string | null;
  referencePage: number;
  wrongPage: number;
  practiceDestination: "practice" | "score" | "paper" | "finger";
}
export interface ReplayEditorState {
  version: 1;
  contentId: string;
  historyId: string;
  title: string;
  view: ReplayReviewView;
  range: ReplayRangeInput;
  rangeSource: HistorySource | null;
  initialized: boolean;
  inputTouched: boolean;
  source: "actual" | "reference";
  rate: number;
  rangeOpen: boolean;
  clipsOpen: boolean;
  search: string;
  page: number;
  draft: ClipInput;
  drafts: Record<string, ClipDraftSnapshot>;
  undo: ClipDraftSnapshot | null;
  receipt: ClipReceipt | null;
  lastReceipt: ClipReceipt | null;
  legacyOriginal: string | null;
  legacyError: string;
  busy: boolean;
  storageError: string;
  notice: string;
}
const prefix = "neothesia.replay-editor.v1:";
const slots = new Map<string, ReturnType<typeof createEditor>>();
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, length = 512): v is string =>
  typeof v === "string" && v.length <= length;
const utf8 = new TextEncoder();
const wireText = (v: unknown, bytes: number): v is string =>
  text(v, bytes) && utf8.encode(v).length <= bytes;
const revision = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const nullableId = (v: unknown) => v === null || text(v, 160);
const oneOf = <T extends string | number>(
  value: unknown,
  options: readonly T[],
): value is T => options.some((option) => option === value);
const validRange = (v: unknown): v is ReplayRangeInput =>
  object(v) &&
  [v.measure, v.occurrence, v.start, v.end].every((n) => text(n, 128));
const validClip = (v: unknown): v is ReplayClip =>
  object(v) &&
  wireText(v.id, 160) &&
  wireText(v.name, 320) &&
  wireText(v.notes, 8192) &&
  number(v.start) &&
  number(v.end) &&
  v.end - v.start >= 0.1 &&
  number(v.updatedAtUnixMs) &&
  (v.performanceRevision === undefined || revision(v.performanceRevision));
const validDraft = (v: unknown): v is ClipInput =>
  object(v) &&
  nullableId(v.id) &&
  text(v.name, 320) &&
  text(v.notes, 8192) &&
  (v.base === null || validClip(v.base)) &&
  (v.revision === null || revision(v.revision));
const validClipSnapshot = (value: unknown): value is ClipDraftSnapshot =>
  object(value) &&
  validDraft(value.draft) &&
  validRange(value.range) &&
  (value.rangeSource == null || validHistorySource(value.rangeSource));
const validReceipt = (v: unknown): v is ClipReceipt =>
  object(v) &&
  (v.source === undefined || validHistorySource(v.source)) &&
  oneOf(v.phase, ["sending", "uncertain", "acknowledged"]) &&
  text(v.engineId, 160) &&
  text(v.requestId, 128) &&
  revision(v.expected) &&
  oneOf(v.action, ["save", "delete"]) &&
  text(v.clipId, 160) &&
  nullableId(v.editingId) &&
  (v.action === "delete"
    ? v.value === null
    : object(v.value) &&
      text(v.value.name, 320) &&
      text(v.value.notes, 8192) &&
      number(v.value.start) &&
      number(v.value.end) &&
      v.value.end - v.value.start >= 0.1);
const validView = (v: unknown): v is ReplayReviewView =>
  object(v) &&
  [v.measure, v.referencePage, v.wrongPage].every(
    (value) =>
      Number.isSafeInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= 100000,
  ) &&
  [v.before, v.after].every((value) => oneOf(value, [0, 1, 2, 4, 8])) &&
  oneOf(v.gradeFilter, [
    "all",
    "problems",
    "missed",
    "early",
    "late",
    "onTime",
    "pending",
  ]) &&
  oneOf(v.expressionFilter, ["all", "velocity", "pedal"]) &&
  (v.velocityThreshold === null ||
    (Number.isSafeInteger(v.velocityThreshold) &&
      Number(v.velocityThreshold) >= 1 &&
      Number(v.velocityThreshold) <= 128)) &&
  (v.thresholdDraft === null || text(v.thresholdDraft, 128)) &&
  oneOf(v.practiceDestination, ["practice", "score", "paper", "finger"]);
export const clipInputError = (draft: Pick<ClipInput, "name" | "notes">) =>
  !draft.name.trim()
    ? "请输入片段名称。"
    : !wireText(draft.name.trim(), 320)
      ? "片段名称过长，请缩短后保存。"
      : /[\u0000-\u001f\u007f-\u009f]/.test(draft.name)
        ? "片段名称含有控制字符，请修改后保存。"
        : !wireText(draft.notes, 8192)
          ? "片段备注过长，请缩短后保存。"
          : "";
export const emptyClipInput = (): ClipInput => ({
  id: null,
  name: "",
  notes: "",
  base: null,
  revision: null,
});
export const hasCurrentClipInput = (state: ReplayEditorState) =>
  !!(state.draft.id || state.draft.name || state.draft.notes);
export const hasClipInput = (state: ReplayEditorState) =>
  hasCurrentClipInput(state) ||
  !!state.receipt ||
  Object.keys(state.drafts).length > 0;
export function replayRange(input: ReplayRangeInput, duration: number) {
  const decimal = (raw: string) =>
    /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) ? Number(raw) : NaN;
  const start = decimal(input.start),
    requestedEnd = decimal(input.end),
    end = duration > 0 ? Math.min(requestedEnd, duration) : requestedEnd;
  const error =
    !Number.isFinite(duration) || duration <= 0
      ? "请先读取这次演奏的完整时长。"
      : !Number.isFinite(start) || !Number.isFinite(end)
        ? "请输入起点和终点秒数。"
        : start < 0 || requestedEnd > duration + 0.001
          ? `范围应位于 0 到 ${duration.toFixed(3)} 秒之间。`
          : end - start < 0.1
            ? "片段长度至少为 0.1 秒。"
            : "";
  return { start, end, error };
}
export const clipValue = (
  clip: Pick<ReplayClip, "name" | "notes" | "start" | "end"> | null | undefined,
) =>
  clip
    ? JSON.stringify([clip.name.trim(), clip.notes, clip.start, clip.end])
    : "null";
const keyFor = (contentId: string, historyId: string) =>
  `${prefix}${encodeURIComponent(contentId)}:${encodeURIComponent(historyId)}`;
function stashCurrent(
  state: ReplayEditorState,
  drafts: ReplayEditorState["drafts"],
) {
  if (!hasCurrentClipInput(state)) return;
  let key = JSON.stringify(state.draft.id);
  if (state.draft.id === null && drafts[key])
    key = `null:${crypto.randomUUID()}`;
  drafts[key] = {
    draft: state.draft,
    range: state.range,
    rangeSource: state.rangeSource,
  };
}
function createEditor(contentId: string, historyId: string) {
  const initial: ReplayEditorState = {
    version: 1,
    contentId,
    historyId,
    title: "",
    view: {
      measure: 0,
      before: 1,
      after: 1,
      gradeFilter: "all",
      expressionFilter: "all",
      velocityThreshold: null,
      thresholdDraft: null,
      referencePage: 0,
      wrongPage: 0,
      practiceDestination: "practice",
    },
    range: { measure: "1", occurrence: "1", start: "0", end: "0" },
    rangeSource: null,
    initialized: false,
    inputTouched: false,
    source: "actual",
    rate: 0.5,
    rangeOpen: false,
    clipsOpen: false,
    search: "",
    page: 0,
    draft: emptyClipInput(),
    drafts: {},
    undo: null,
    receipt: null,
    lastReceipt: null,
    legacyOriginal: null,
    legacyError: "",
    busy: false,
    storageError: "",
    notice: "",
  };
  const session = createPersistentSession<ReplayEditorState>(
    (raw) => {
      if (raw !== null) {
        try {
          if (raw.length > 3000000) throw new Error();
          const value: unknown = JSON.parse(raw);
          if (
            object(value) &&
            value.rangeSource != null &&
            !validHistorySource(value.rangeSource)
          )
            throw new Error();
          if (
            object(value) &&
            value.view !== undefined &&
            !validView(value.view)
          )
            throw new Error();
          if (
            object(value) &&
            value.inputTouched !== undefined &&
            typeof value.inputTouched !== "boolean"
          )
            throw new Error();
          if (
            object(value) &&
            value.drafts !== undefined &&
            (!object(value.drafts) ||
              Object.keys(value.drafts).length > 256 ||
              Object.entries(value.drafts).some(
                ([key, row]) =>
                  !validClipSnapshot(row) ||
                  (key !== JSON.stringify(row.draft.id) &&
                    !(
                      row.draft.id === null && /^null:[a-f0-9-]{36}$/.test(key)
                    )),
              ))
          )
            throw new Error();
          if (
            !object(value) ||
            value.version !== 1 ||
            value.contentId !== contentId ||
            value.historyId !== historyId ||
            !text(value.title, 4096) ||
            !validRange(value.range) ||
            typeof value.initialized !== "boolean" ||
            !oneOf(value.source, ["actual", "reference"]) ||
            !oneOf(value.rate, [0.25, 0.5, 0.75, 1]) ||
            ![value.rangeOpen, value.clipsOpen].every(
              (v) => typeof v === "boolean",
            ) ||
            !text(value.search, 2000) ||
            !Number.isSafeInteger(value.page) ||
            Number(value.page) < 0 ||
            Number(value.page) > 50000 ||
            !validDraft(value.draft) ||
            (value.receipt !== null && !validReceipt(value.receipt)) ||
            (value.lastReceipt !== undefined &&
              value.lastReceipt !== null &&
              !validReceipt(value.lastReceipt)) ||
            (value.undo !== null && !validClipSnapshot(value.undo)) ||
            (value.legacyOriginal !== null &&
              !text(value.legacyOriginal, 100000)) ||
            !text(value.legacyError, 2000)
          )
            throw new Error();
          const saved = value as unknown as ReplayEditorState;
          return {
            ...initial,
            ...saved,
            view: saved.view ?? initial.view,
            rangeSource: saved.rangeSource ?? null,
            inputTouched: saved.inputTouched ?? false,
            drafts: saved.drafts ?? {},
            lastReceipt: saved.lastReceipt ?? null,
            busy: false,
            storageError: "",
            notice: "",
            receipt: saved.receipt
              ? {
                  ...saved.receipt,
                  phase:
                    saved.receipt.phase === "sending"
                      ? "uncertain"
                      : saved.receipt.phase,
                }
              : null,
          };
        } catch {
          return {
            ...initial,
            storageError: "原回放工作进度无法读取，原文已保留。",
          };
        }
      }
      // Read the old window draft once. Its original key remains untouched for older app versions.
      try {
        const old = sessionStorage.getItem(
          `replay-clip-draft:${contentId}:${historyId}`,
        );
        if (old === null) return initial;
        const value: unknown = JSON.parse(old);
        if (
          !object(value) ||
          !nullableId(value.id ?? null) ||
          !text(value.name ?? "", 80) ||
          !text(value.notes ?? "", 2000) ||
          (value.baseRevision != null && !revision(value.baseRevision)) ||
          ((value.start !== undefined || value.end !== undefined) &&
            (!number(value.start) ||
              !number(value.end) ||
              value.end - value.start < 0.1))
        )
          throw new Error();
        return {
          ...initial,
          draft: {
            id: (value.id as string | null) ?? null,
            name: String(value.name ?? ""),
            notes: String(value.notes ?? ""),
            base: null,
            revision: (value.baseRevision as string | null) ?? null,
          },
          range:
            number(value.start) && number(value.end)
              ? {
                  ...initial.range,
                  start: String(value.start),
                  end: String(value.end),
                }
              : initial.range,
          initialized: number(value.start),
          clipsOpen: true,
        };
      } catch {
        let original: string | null = null;
        try {
          original = sessionStorage.getItem(
            `replay-clip-draft:${contentId}:${historyId}`,
          );
        } catch {}
        return {
          ...initial,
          legacyOriginal: original,
          legacyError: "旧窗口草稿尚未读取，原文继续保留，可复制后重新整理。",
        };
      }
    },
    {
      key: keyFor(contentId, historyId),
      maxCharacters: 3000000,
      failureMessage: "回放输入尚未暂存，可复制输入或保留当前窗口。",
    },
  );
  // Read results are transient; the receipt and every user input are retained before invocation.
  let runtime = {
    sourceIssue: null as HistorySourceIssue | null,
    rows: null as ReplayClipRows | null,
    engineId: undefined as string | undefined,
    reading: false,
    error: "",
    operation: null as "save" | "delete" | "read" | null,
  };
  let snapshot = { ...session.getSnapshot(), ...runtime };
  const reviewProjection = () => {
    const state = session.getSnapshot();
    return {
      source: state.source,
      rate: state.rate,
      view: state.view,
      rangeOpen: state.rangeOpen,
      clipsOpen: state.clipsOpen,
      hasDraft: hasClipInput(state) || !!state.storageError,
    };
  };
  let reviewSnapshot = reviewProjection();
  let preferences = { source: snapshot.source, rate: snapshot.rate };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = { ...session.getSnapshot(), ...runtime };
    const next = reviewProjection();
    if (
      (Object.keys(next) as (keyof typeof next)[]).some(
        (key) => next[key] !== reviewSnapshot[key],
      )
    )
      reviewSnapshot = next;
    if (
      preferences.source !== snapshot.source ||
      preferences.rate !== snapshot.rate
    )
      preferences = { source: snapshot.source, rate: snapshot.rate };
    for (const listener of [...listeners]) listener();
    activitySignal.changed();
  };
  session.subscribe(publish);
  const updateRuntime = (change: Partial<typeof runtime>) => {
    runtime = { ...runtime, ...change };
    publish();
  };
  let activeJob = false;
  let readSequence = 0;
  const bindEngine = async (engineId?: string) => {
    const origin =
      engineId ?? runtime.engineId ?? (await api.state()).stateOrder?.engineId;
    if (!origin) throw new Error("练习室连接尚未准备好，请稍后重新读取。");
    if (runtime.engineId !== origin)
      updateRuntime({ engineId: origin, rows: null });
    return origin;
  };
  const read = async (origin: string) => {
    const sequence = ++readSequence;
    updateRuntime({ reading: true });
    try {
      const rows = await api.commandForEngine<ReplayClipRows>(origin, {
        type: "readHistoryReplayClips",
        content_id: contentId,
        id: historyId,
      });
      if (
        rows?.contentId !== contentId ||
        rows.id !== historyId ||
        !revision(rows.revision) ||
        typeof rows.writeSettled !== "boolean" ||
        !Array.isArray(rows.clips) ||
        !rows.clips.every(validClip)
      )
        throw new Error("收藏片段读取结果不完整，请重新读取。");
      requireHistorySource(rows.source, contentId, historyId);
      if (runtime.engineId === origin && sequence === readSequence)
        updateRuntime({ rows });
      return rows;
    } finally {
      if (sequence === readSequence) updateRuntime({ reading: false });
    }
  };
  const matchesReceipt = (receipt: ClipReceipt, rows: ReplayClipRows) => {
    const row = rows.clips.find((clip) => clip.id === receipt.clipId);
    return receipt.action === "delete"
      ? !row
      : !!row &&
          clipValue(row) === clipValue(receipt.value) &&
          (!receipt.source?.performanceRevision ||
            row.performanceRevision === receipt.source.performanceRevision);
  };
  const finish = (
    receipt: ClipReceipt,
    rows: ReplayClipRows,
    origin: string,
  ) => {
    if (
      !rows.writeSettled ||
      receipt.engineId !== origin ||
      (receipt.phase !== "acknowledged" && !matchesReceipt(receipt, rows))
    )
      return false;
    if (session.getSnapshot().receipt?.requestId !== receipt.requestId)
      return false;
    const current = session.getSnapshot();
    session.update({
      receipt: null,
      lastReceipt: receipt,
      draft:
        receipt.action === "save" || current.draft.id === receipt.clipId
          ? emptyClipInput()
          : current.draft,
      undo: null,
      notice: !matchesReceipt(receipt, rows)
        ? "原提交已完成，收藏列表随后有更新。原提交内容保留在上次保存详情中。"
        : receipt.action === "save"
          ? `已保存「${receipt.value!.name.trim()}」。`
          : "收藏片段已删除。",
    });
    return true;
  };
  const job = async (
    operation: "save" | "delete" | "read",
    action: () => Promise<void>,
  ) => {
    if (activeJob) return;
    activeJob = true;
    updateRuntime({ error: "", sourceIssue: null, operation });
    session.update({ busy: true, notice: "" });
    try {
      await action();
    } catch (failure) {
      const error = historyFailure(failure);
      updateRuntime({
        error: error.message,
        sourceIssue: error instanceof HistorySourceError ? error.issue : null,
      });
    } finally {
      activeJob = false;
      updateRuntime({ operation: null });
      session.update({ busy: false });
    }
  };
  const send = async (receipt: ClipReceipt) => {
    session.update({ receipt: { ...receipt, phase: "sending" } });
    try {
      const scope = {
        content_id: contentId,
        id: historyId,
        expected: receipt.expected,
      };
      const rows =
        receipt.action === "save"
          ? await api.commandForEngine<ReplayClipRows>(receipt.engineId, {
              type: "saveHistoryReplayClip",
              ...scope,
              clip_id: receipt.editingId,
              request_id: receipt.requestId,
              source: receipt.source,
              ...receipt.value!,
            })
          : await api.commandForEngine<ReplayClipRows>(receipt.engineId, {
              type: "deleteHistoryReplayClip",
              ...scope,
              clip_id: receipt.clipId,
            });
      if (
        !rows ||
        !revision(rows.revision) ||
        !Array.isArray(rows.clips) ||
        !rows.clips.every(validClip) ||
        !matchesReceipt(receipt, rows)
      )
        throw new Error("收藏保存回复尚未确认，请读取原结果。");
      receipt = { ...receipt, phase: "acknowledged" };
      session.update({ receipt });
    } catch (failure) {
      session.update({ receipt: { ...receipt, phase: "uncertain" } });
      try {
        if (finish(receipt, await read(receipt.engineId), receipt.engineId))
          return;
      } catch {}
      throw failure;
    }
    const rows = await read(receipt.engineId);
    if (!finish(receipt, rows, receipt.engineId))
      session.update({
        notice: "保存回复已收到，相关资料仍在写入，可稍后核对结果。",
      });
  };
  return {
    ...session,
    getSnapshot: () => snapshot,
    getReviewSnapshot: () => reviewSnapshot,
    getPreferences: () => preferences,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change: Partial<ReplayEditorState>) {
      const touched = ["range", "source", "rate", "search", "page"].some(
        (key) => Object.hasOwn(change, key),
      );
      session.update({ ...(touched ? { inputTouched: true } : {}), ...change });
    },
    review(change: Partial<ReplayReviewView>) {
      const view = session.getSnapshot().view;
      const filterChanged = (
        [
          "measure",
          "gradeFilter",
          "expressionFilter",
          "velocityThreshold",
        ] as const
      ).some((key) => change[key] !== undefined && change[key] !== view[key]);
      session.update({
        inputTouched: true,
        view: {
          ...view,
          ...(filterChanged ? { referencePage: 0, wrongPage: 0 } : {}),
          ...change,
        },
      });
    },
    bind(engineId?: string) {
      if (engineId && engineId !== runtime.engineId && !activeJob) {
        readSequence++;
        updateRuntime({ engineId, rows: null, reading: false, error: "" });
      }
    },
    changeDraft(draft: ClipInput) {
      if (!activeJob && !session.getSnapshot().receipt)
        session.update({ draft, notice: "", undo: null, inputTouched: true });
    },
    initialize(measure: number, duration: number, source?: HistorySource) {
      const state = session.getSnapshot();
      if (!state.initialized && duration > 0)
        session.update({
          initialized: true,
          rangeSource: source ?? null,
          range: {
            measure: String(measure),
            occurrence: "1",
            start: "0",
            end: String(duration),
          },
        });
    },
    pick(start: number, end: number, source?: HistorySource) {
      if (!activeJob && !session.getSnapshot().receipt)
        session.update({
          inputTouched: true,
          rangeSource: source ?? session.getSnapshot().rangeSource,
          range: {
            ...session.getSnapshot().range,
            start: String(start),
            end: String(end),
          },
          initialized: true,
          notice: "",
        });
    },
    beginEdit(clip: ReplayClip, refresh = false, source?: HistorySource) {
      if (activeJob || session.getSnapshot().receipt || !runtime.rows) return;
      const state = session.getSnapshot(),
        drafts = { ...state.drafts };
      if (state.draft.id === clip.id && !refresh) return;
      const saved = refresh ? undefined : drafts[JSON.stringify(clip.id)];
      if (state.draft.id !== clip.id) stashCurrent(state, drafts);
      delete drafts[JSON.stringify(clip.id)];
      session.update({
        drafts,
        rangeSource: saved
          ? (saved.rangeSource ?? null)
          : (clipHistorySource(clip, source) ?? null),
        draft: saved?.draft ?? {
          id: clip.id,
          name: clip.name,
          notes: clip.notes,
          base: clip,
          revision: runtime.rows.revision,
        },
        range: saved?.range ?? {
          ...session.getSnapshot().range,
          start: String(clip.start),
          end: String(clip.end),
        },
        initialized: true,
        clipsOpen: true,
        undo: null,
        notice: "",
      });
    },
    newDraft() {
      const state = session.getSnapshot();
      if (activeJob || state.receipt) return;
      const drafts = { ...state.drafts },
        saved = drafts["null"];
      if (state.draft.id === null && !saved) return;
      stashCurrent(state, drafts);
      delete drafts["null"];
      session.update({
        drafts,
        draft:
          saved?.draft ??
          (state.draft.id === null ? state.draft : emptyClipInput()),
        range: saved?.range ?? state.range,
        rangeSource: saved ? (saved.rangeSource ?? null) : state.rangeSource,
        undo: null,
        notice: "原输入已保留，可以继续收藏另一个范围。",
      });
    },
    restoreDraft(key: string) {
      const state = session.getSnapshot(),
        saved = state.drafts[key];
      if (activeJob || state.receipt || !saved) return;
      const drafts = { ...state.drafts };
      stashCurrent(state, drafts);
      delete drafts[key];
      session.update({
        drafts,
        ...saved,
        rangeSource: saved.rangeSource ?? null,
        undo: null,
        notice: "已恢复这份片段输入。",
      });
    },
    clearDraft() {
      const state = session.getSnapshot();
      if (activeJob || state.receipt) return;
      session.update({
        undo: hasCurrentClipInput(state)
          ? {
              draft: state.draft,
              range: state.range,
              rangeSource: state.rangeSource,
            }
          : state.undo,
        draft: emptyClipInput(),
        notice: "草稿已清除，可撤销。",
      });
    },
    undoClear() {
      const state = session.getSnapshot();
      if (
        !activeJob &&
        !state.receipt &&
        state.undo &&
        !hasCurrentClipInput(state)
      )
        session.update({
          ...state.undo,
          rangeSource: state.undo.rangeSource ?? null,
          undo: null,
          notice: "已恢复清除前的草稿和范围。",
        });
    },
    rebase(asNew = false) {
      const state = session.getSnapshot(),
        rows = runtime.rows;
      if (activeJob || !rows?.writeSettled) return;
      const clip = rows.clips.find((row) => row.id === state.draft.id);
      session.update({
        receipt: null,
        draft: {
          ...state.draft,
          id: asNew ? null : state.draft.id,
          base: asNew ? null : (clip ?? null),
          revision: rows.revision,
        },
        notice: "输入已保留，可核对范围后保存。",
      });
    },
    adoptRangeSource(source: HistorySource) {
      if (activeJob || session.getSnapshot().receipt) return;
      session.update({
        rangeSource: requireHistorySource(source, contentId, historyId, true),
        inputTouched: true,
        notice: "起止秒数已保留，并采用当前演奏版本。",
      });
      updateRuntime({ error: "", sourceIssue: null });
    },
    merge(
      draft: Pick<ClipInput, "name" | "notes">,
      range: Pick<ReplayRangeInput, "start" | "end">,
      proof: string,
    ) {
      const state = session.getSnapshot(),
        rows = runtime.rows;
      if (activeJob || state.receipt || !rows?.writeSettled) return;
      const current = rows.clips.find((clip) => clip.id === state.draft.id);
      if (
        !current ||
        JSON.stringify([
          current.id,
          current.name,
          current.notes,
          current.start,
          current.end,
        ]) !== proof
      ) {
        updateRuntime({ error: "已保存内容再次更新，请重新核对合并选择。" });
        return;
      }
      session.update({
        draft: {
          ...state.draft,
          ...draft,
          base: current,
          revision: rows.revision,
        },
        range: { ...state.range, ...range },
        notice: "合并结果已保留，可继续调整后保存。",
      });
    },
    reload: (engineId?: string) =>
      job("read", async () => {
        const origin = await bindEngine(engineId),
          rows = await read(origin),
          receipt = session.getSnapshot().receipt;
        if (receipt && !finish(receipt, rows, origin))
          session.update({
            notice:
              receipt.engineId !== origin
                ? "原提交来自上次连接，当前结果已读取，可保留输入继续编辑。"
                : !rows.writeSettled
                  ? "相关资料仍在写入，稍后可再次核对。"
                  : "当前结果与原提交不同，可核对后继续编辑或重试原提交。",
          });
      }),
    save: (duration: number, engineId?: string, source?: HistorySource) =>
      job("save", async () => {
        const state = session.getSnapshot();
        if (state.receipt) throw new Error("请先核对原提交结果。");
        const range = replayRange(state.range, duration);
        if (range.error) throw new Error(range.error);
        const inputError = clipInputError(state.draft);
        if (inputError) throw new Error(inputError);
        const captured = source
          ? requireHistorySource(source, contentId, historyId, true)
          : undefined;
        if (captured && !state.rangeSource?.performanceRevision)
          throw new HistorySourceError(
            "这份范围尚未记录演奏版本，请核对秒数并采用当前演奏版本。",
            "sourceMissing",
          );
        if (
          captured &&
          state.rangeSource &&
          (state.rangeSource.contentId !== captured.contentId ||
            state.rangeSource.id !== captured.id ||
            (state.rangeSource.performanceRevision &&
              state.rangeSource.performanceRevision !==
                captured.performanceRevision))
        )
          throw new HistorySourceError(
            "这份范围来自此前的演奏资料，请核对秒数后采用当前演奏版本。",
            "performanceChanged",
          );
        const origin = await bindEngine(engineId),
          rows = await read(origin);
        if (!rows.writeSettled)
          throw new Error("相关资料正在写入，输入继续保留。");
        const current = rows.clips.find((clip) => clip.id === state.draft.id);
        if (
          state.draft.id &&
          (!current ||
            (state.draft.base
              ? clipValue(current) !== clipValue(state.draft.base)
              : state.draft.revision !== rows.revision))
        )
          throw new Error("这个收藏已有更新，请先核对新旧内容。");
        const requestId = crypto.randomUUID();
        await send({
          source: captured,
          phase: "sending",
          engineId: origin,
          requestId,
          expected: rows.revision,
          action: "save",
          clipId: state.draft.id ?? `clip-${requestId}`,
          editingId: state.draft.id,
          value: {
            name: state.draft.name,
            notes: state.draft.notes,
            start: range.start,
            end: range.end,
          },
        });
      }),
    remove: (clip: ReplayClip, engineId?: string) =>
      job("delete", async () => {
        if (session.getSnapshot().receipt)
          throw new Error("请先核对原提交结果。");
        const origin = await bindEngine(engineId),
          rows = await read(origin);
        if (!rows.writeSettled)
          throw new Error("相关资料正在写入，请稍后再删除。");
        const current = rows.clips.find((row) => row.id === clip.id);
        if (!current) {
          session.update({ notice: "这个收藏已从列表移除。" });
          return;
        }
        if (clipValue(current) !== clipValue(clip))
          throw new Error("这个收藏已有更新，请核对后再删除。");
        await send({
          phase: "sending",
          engineId: origin,
          requestId: crypto.randomUUID(),
          expected: rows.revision,
          action: "delete",
          clipId: clip.id,
          editingId: clip.id,
          value: null,
        });
      }),
    retry: (engineId?: string) =>
      job("save", async () => {
        const receipt = session.getSnapshot().receipt;
        if (!receipt) return;
        const origin = await bindEngine(engineId),
          rows = await read(origin);
        if (finish(receipt, rows, origin)) return;
        if (origin !== receipt.engineId)
          throw new Error("原请求来自上次连接，请核对当前结果后继续编辑。");
        if (!rows.writeSettled)
          throw new Error("原写入仍在处理，稍后可核对结果。");
        if (rows.revision !== receipt.expected)
          throw new Error("收藏列表已有更新，请保留输入继续编辑。");
        await send(receipt);
      }),
  };
}
export function getReplayEditor(contentId: string, historyId: string) {
  const key = keyFor(contentId, historyId);
  let slot = slots.get(key);
  if (!slot) {
    slot = createEditor(contentId, historyId);
    slots.set(key, slot);
    activitySignal.changed();
  }
  return slot;
}
let discovered = false;
export const replayEditors = () => {
  if (!discovered) {
    discovered = true;
    try {
      // Identity comes from the key, so even a malformed payload can expose its recovery UI.
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) {
        const pair = key.slice(prefix.length).split(":");
        if (pair.length !== 2) continue;
        try {
          const raw = localStorage.getItem(key);
          if (raw !== null && raw.length <= 3000000) {
            try {
              const value: unknown = JSON.parse(raw);
              // Reading preferences alone need no global task row or live draft subscription.
              if (
                object(value) &&
                value.version === 1 &&
                object(value.draft) &&
                value.draft.id === null &&
                value.draft.name === "" &&
                value.draft.notes === "" &&
                !value.receipt &&
                object(value.drafts) &&
                !Object.keys(value.drafts).length
              )
                continue;
            } catch {
              /* Invalid input exposes the ordinary original-text recovery panel. */
            }
          }
          const contentId = decodeURIComponent(pair[0]),
            historyId = decodeURIComponent(pair[1]);
          if (
            contentId &&
            historyId &&
            contentId.length <= 160 &&
            historyId.length <= 512 &&
            keyFor(contentId, historyId) === key
          )
            getReplayEditor(contentId, historyId);
        } catch {
          /* An unknown key stays available in browser storage. */
        }
      }
    } catch {
      discovered = false;
    }
  }
  return [...slots.values()];
};
export function pendingReplayEditors() {
  const states = replayEditors().map((store) => store.getSnapshot());
  return states.some((state) => state.busy && state.operation !== "read")
    ? "回放片段仍在保存，请等待原请求结束。"
    : states.some(
          (state) =>
            state.storageError && (hasClipInput(state) || state.inputTouched),
        )
      ? "回放输入尚未暂存，可返回重试或复制。"
      : null;
}
export function flushReplayEditors() {
  for (const store of slots.values()) store.retrySave();
}
export type ReplayEditor = ReturnType<typeof getReplayEditor>;
