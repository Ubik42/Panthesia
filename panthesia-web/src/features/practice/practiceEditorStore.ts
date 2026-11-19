import { createPersistentSession } from "../../app/createPersistentSession";
import {
  api,
  type PracticeEditCommand,
  type PracticeEditScope,
} from "../../api";
import { activitySignal } from "../activity/activitySignal";

export type EditorForm = Record<string, string>;
export type PracticeEditorKind = "passage" | "ladder";
type CatalogMutation = Extract<
  PracticeEditCommand,
  {
    type:
      | "savePassage"
      | "updatePassageDetails"
      | "removePassage"
      | "saveLadder"
      | "updateLadderName"
      | "removeLadder";
  }
>;
export interface PracticeDraft {
  key: string;
  id: string | null;
  requestId: string;
  form: EditorForm;
  original: EditorForm;
  base: string | null;
  scope: string;
}
interface Receipt {
  key: string;
  draft: string;
  target: string;
  operation: "save" | "remove";
  phase: "sending" | "acknowledged" | "uncertain";
  message: string;
  revision?: string;
  keepInput?: boolean;
}
interface State {
  version: 1;
  kind: PracticeEditorKind;
  contentId: string;
  drafts: PracticeDraft[];
  discarded: PracticeDraft[];
  selected: string | null;
  query: string;
  filter:
    "all" | "drafts" | "needsReview" | "progress" | "completed" | "unstarted";
  sort: "source" | "name" | "range";
  page: number;
  receipt: Receipt | null;
  notice: string;
  title: string;
  path: string;
  engineId: string | null;
  busy: boolean;
  storageError: string;
}
export const practiceScopeKey = (source: PracticeEditScope) =>
  JSON.stringify([
    source.engineId ?? null,
    source.scoreRevision,
    source.annotationRevision ?? 0,
  ]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 8192): value is string =>
  typeof value === "string" && value.length <= max;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const validForm = (value: unknown): value is EditorForm =>
  object(value) &&
  Object.keys(value).length <= 24 &&
  Object.entries(value).every(
    ([key, value]) => text(key, 80) && text(value, 16384),
  );
const validDraft = (value: unknown): value is PracticeDraft =>
  object(value) &&
  uuid(value.key) &&
  uuid(value.requestId) &&
  (value.id === null || text(value.id, 512)) &&
  validForm(value.form) &&
  validForm(value.original) &&
  (value.base === null || text(value.base, 65536)) &&
  text(value.scope, 512);
const validReceipt = (value: unknown): value is Receipt =>
  object(value) &&
  uuid(value.key) &&
  uuid(value.draft) &&
  text(value.target, 512) &&
  ["save", "remove"].includes(String(value.operation)) &&
  ["sending", "acknowledged", "uncertain"].includes(String(value.phase)) &&
  text(value.message, 512) &&
  (value.keepInput === undefined || typeof value.keepInput === "boolean") &&
  (value.revision === undefined ||
    (typeof value.revision === "string" &&
      /^[a-f\d]{64}$/i.test(value.revision)));
export const practiceDraftDirty = (draft: PracticeDraft) =>
  (!draft.id && !!draft.form.name.trim()) ||
  JSON.stringify(draft.form) !== JSON.stringify(draft.original);
const slots = new Map<string, ReturnType<typeof createSession>>();

function createSession(kind: PracticeEditorKind, contentId: string) {
  const session = createPersistentSession<State>(
    (raw) => {
      const initial: State = {
        version: 1,
        kind,
        contentId,
        title: "",
        path: "",
        engineId: null,
        drafts: [],
        discarded: [],
        selected: null,
        query: "",
        filter: "all",
        sort: "source",
        page: 0,
        receipt: null,
        notice: "",
        busy: false,
        storageError: "",
      };
      if (raw === null) return initial;
      try {
        if (raw.length > 1_500_000)
          throw new Error("练习输入超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          value.kind !== kind ||
          value.contentId !== contentId ||
          !Array.isArray(value.drafts) ||
          value.drafts.length > 24 ||
          !value.drafts.every(validDraft) ||
          new Set(value.drafts.map((row) => row.key)).size !==
            value.drafts.length ||
          (value.selected !== null && !uuid(value.selected)) ||
          !text(value.query, 1024) ||
          !Number.isSafeInteger(value.page) ||
          Number(value.page) < 0 ||
          Number(value.page) > 100 ||
          (value.receipt !== null && !validReceipt(value.receipt))
        )
          throw new Error("练习输入格式无法读取，原文已保留。");
        if (
          value.receipt &&
          !value.drafts.some(
            (row) => row.key === (value.receipt as Receipt).draft,
          )
        )
          throw new Error("保存记录缺少对应草稿，原文已保留。");
        if (
          value.selected !== null &&
          !value.drafts.some((row) => row.key === value.selected)
        )
          throw new Error("当前草稿位置无法读取，原文已保留。");
        if (
          !Array.isArray(value.discarded) ||
          value.discarded.length > 8 ||
          !value.discarded.every(validDraft)
        )
          throw new Error("已删除输入的恢复记录无法读取，原文已保留。");
        if (
          !text(value.title, 1024) ||
          !text(value.path, 65536) ||
          (value.engineId !== null && !text(value.engineId, 512))
        )
          throw new Error("草稿来源记录无法读取，原文已保留。");
        if (
          ![
            "all",
            "drafts",
            "needsReview",
            "progress",
            "completed",
            "unstarted",
          ].includes(String(value.filter)) ||
          !["source", "name", "range"].includes(String(value.sort))
        )
          throw new Error("列表浏览位置无法读取，原文已保留。");
        const keys =
          kind === "passage"
            ? ["name", "first", "last", "notes"]
            : [
                "name",
                "first",
                "last",
                "startPercent",
                "targetPercent",
                "stepPercent",
                "passesRequired",
                "accuracyPercent",
                "onTimeEnabled",
                "onTimePercent",
                "failuresBeforeStepBack",
                "attemptLimit",
                "expression",
              ];
        if (
          ![...value.drafts, ...value.discarded].every((row) =>
            [row.form, row.original].every(
              (form) =>
                Object.keys(form).length === keys.length &&
                keys.every((key) => typeof form[key] === "string"),
            ),
          )
        )
          throw new Error("草稿字段不完整，原文已保留。");
        if (
          kind === "ladder" &&
          ![...value.drafts, ...value.discarded].every((row) =>
            [row.form, row.original].every((form) =>
              ["yes", "no"].includes(form.onTimeEnabled),
            ),
          )
        )
          throw new Error("准时率开关记录无法读取，原文已保留。");
        return {
          ...initial,
          title: value.title,
          path: value.path,
          engineId: value.engineId as string | null,
          drafts: value.drafts,
          discarded: value.discarded,
          selected: value.selected as string | null,
          query: value.query,
          filter: value.filter as State["filter"],
          sort: value.sort as State["sort"],
          page: Number(value.page),
          receipt: value.receipt
            ? {
                ...value.receipt,
                phase:
                  value.receipt.phase === "sending"
                    ? "uncertain"
                    : value.receipt.phase,
              }
            : null,
          notice: text(value.notice, 1024) ? value.notice : "",
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia.practice-editor.v1:${kind}:${contentId}`,
      maxCharacters: 1_500_000,
      failureMessage: "练习输入尚未暂存，请复制输入或保留窗口。",
    },
  );
  let subscribers = 0;
  let revision = 0;
  const releaseActivity = session.subscribe(() => {
    revision++;
    activitySignal.changed();
  });
  const draft = () =>
    session
      .getSnapshot()
      .drafts.find((row) => row.key === session.getSnapshot().selected);
  const replace = (row: PracticeDraft) =>
    session.update({
      drafts: session
        .getSnapshot()
        .drafts.map((item) => (item.key === row.key ? row : item)),
    });
  const unlocked = () => {
    const state = session.getSnapshot();
    if (state.busy || state.receipt)
      throw new Error("请先核对上一次保存结果。");
  };
  return {
    ...session,
    dispose: releaseActivity,
    revision: () => revision,
    rememberSource(info: {
      title: string;
      sourcePath: string;
      engineId?: string | null;
    }) {
      const state = session.getSnapshot();
      if (
        state.title !== info.title ||
        state.path !== info.sourcePath ||
        state.engineId !== (info.engineId ?? null)
      )
        session.update({
          title: info.title,
          path: info.sourcePath,
          engineId: info.engineId ?? null,
        });
    },
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
      !session.getSnapshot().storageError &&
      !session.getSnapshot().receipt,
    current: draft,
    refreshClean<Row extends { id: string }>(
      rows: Row[],
      source: PracticeEditScope,
      form: (row: Row) => EditorForm,
    ) {
      const state = session.getSnapshot();
      if (state.receipt || state.busy || source.contentId !== contentId) return;
      let changed = false;
      const drafts = state.drafts.map((item) => {
        if (!item.id || practiceDraftDirty(item)) return item;
        const row = rows.find((row) => row.id === item.id);
        if (!row) return item;
        const base = JSON.stringify(row),
          scope = practiceScopeKey(source);
        if (base === item.base && scope === item.scope) return item;
        changed = true;
        const next = form(row);
        return { ...item, base, scope, form: next, original: next };
      });
      if (changed) session.update({ drafts });
    },
    open(form: EditorForm, source: PracticeEditScope, row?: { id: string }) {
      unlocked();
      if (source.contentId !== contentId || !validForm(form))
        throw new Error("这份输入的来源无法核对，请重新打开对应曲目。");
      const state = session.getSnapshot(),
        previous = row && state.drafts.find((item) => item.id === row.id);
      if (previous) {
        session.update({ selected: previous.key, notice: "已续接这份输入。" });
        return;
      }
      let drafts = state.drafts;
      if (drafts.length >= 24) {
        const clean = drafts.find(
          (item) => item.key !== state.selected && !practiceDraftDirty(item),
        );
        if (!clean)
          throw new Error("本曲已暂存 24 份输入，请先保存或删除一份草稿。");
        drafts = drafts.filter((item) => item.key !== clean.key);
      }
      const next: PracticeDraft = {
        key: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        id: row?.id ?? null,
        form,
        original: form,
        base: row ? JSON.stringify(row) : null,
        scope: practiceScopeKey(source),
      };
      session.update({
        drafts: [...drafts, next],
        selected: next.key,
        notice: "",
      });
    },
    select(key: string) {
      unlocked();
      if (session.getSnapshot().drafts.some((row) => row.key === key))
        session.update({ selected: key, notice: "" });
    },
    duplicate(source: PracticeEditScope) {
      unlocked();
      const current = draft();
      if (!current) return;
      if (
        source.contentId !== contentId ||
        current.scope !== practiceScopeKey(source)
      )
        throw new Error("请先核对原草稿的曲目与范围，再制作副本。");
      const state = session.getSnapshot();
      if (state.drafts.length >= 24)
        throw new Error("请先保存或删除一份草稿，再制作副本。");
      const form = {
        ...current.form,
        name:
          Array.from(current.form.name.trim()).slice(0, 76).join("") + " 副本",
      };
      const next: PracticeDraft = {
        key: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        id: null,
        base: null,
        scope: practiceScopeKey(source),
        form,
        original: form,
      };
      session.update({
        drafts: [...state.drafts, next],
        selected: next.key,
        notice: "已创建独立草稿。保存时采用主界面的当前练习设置。",
      });
    },
    patch(value: EditorForm) {
      unlocked();
      const current = draft();
      if (
        current &&
        Object.entries(value).some(
          ([key, value]) =>
            !Object.hasOwn(current.form, key) || !text(value, 16384),
        )
      )
        throw new Error("练习输入字段或长度无效，请保留原输入。");
      if (current) replace({ ...current, form: { ...current.form, ...value } });
    },
    rebase(
      source: PracticeEditScope,
      row?: { id: string },
      form?: EditorForm,
      original?: EditorForm,
    ) {
      unlocked();
      const current = draft();
      if (!current) return;
      replace({
        ...current,
        id: row?.id ?? null,
        requestId: row || !current.id ? current.requestId : crypto.randomUUID(),
        base: row ? JSON.stringify(row) : null,
        scope: practiceScopeKey(source),
        form: form ?? current.form,
        original: original ?? form ?? current.original,
      });
      session.update({
        notice: form
          ? "已采用保存的资料。"
          : "当前输入已保留，请核对范围与设置后保存。",
      });
    },
    forget(key: string) {
      unlocked();
      const state = session.getSnapshot(),
        target = state.drafts.find((row) => row.key === key);
      if (!target) return;
      const drafts = state.drafts.filter((row) => row.key !== key);
      session.update({
        drafts,
        discarded: [...state.discarded, target].slice(-8),
        selected:
          state.selected === key
            ? (drafts.at(-1)?.key ?? null)
            : state.selected,
        notice: "暂存输入已删除。最近 8 份可以恢复，已保存方案继续保留。",
      });
    },
    restore() {
      unlocked();
      const state = session.getSnapshot(),
        target = state.discarded.at(-1);
      if (!target) return;
      if (state.drafts.length >= 24)
        throw new Error("请先保存或删除一份草稿，再恢复输入。");
      const duplicate = state.drafts.some(
        (row) =>
          row.requestId === target.requestId ||
          (target.id && row.id === target.id),
      );
      const next = {
        ...target,
        key: crypto.randomUUID(),
        ...(duplicate
          ? { id: null, base: null, requestId: crypto.randomUUID() }
          : {}),
      };
      session.update({
        drafts: [...state.drafts, next],
        discarded: state.discarded.slice(0, -1),
        selected: next.key,
        notice: duplicate
          ? "相同方案已有输入，这份恢复为独立新草稿。"
          : "已恢复最近删除的输入，请核对保存版本。",
      });
    },
    async commit<T>(
      source: PracticeEditScope,
      command: CatalogMutation,
      revision: string | undefined,
      operation: Receipt["operation"],
      message: string,
      keepInput = false,
    ): Promise<T> {
      unlocked();
      const current = draft();
      if (!current) throw new Error("请先选择或新建草稿。");
      if (!revision) throw new Error("请先读取练习资料。");
      if (
        command.id !== current.id ||
        source.contentId !== contentId ||
        current.scope !== practiceScopeKey(source)
      )
        throw new Error("当前草稿来源已改变，请核对后重新保存。");
      const removing =
        command.type === "removePassage" || command.type === "removeLadder";
      if (
        removing !== (operation === "remove") ||
        (kind === "ladder") !==
          (command.type === "saveLadder" ||
            command.type === "updateLadderName" ||
            command.type === "removeLadder")
      )
        throw new Error("当前草稿与保存操作不匹配。");
      const target = current.id ?? `editor-${current.requestId}`;
      const receipt: Receipt = {
        key: crypto.randomUUID(),
        draft: current.key,
        target,
        operation,
        phase: "sending",
        message,
        keepInput,
      };
      session.update({ busy: true, receipt, notice: "" });
      if (session.getSnapshot().storageError) {
        session.update({ busy: false, receipt: null });
        throw new Error("保存编号尚未暂存，请先处理输入暂存问题。");
      }
      try {
        const result = await api.editPractice<
          T & { id?: string; existing?: boolean; catalogRevision?: string }
        >(source, command, revision, current.requestId);
        session.update({
          receipt: {
            ...receipt,
            target: result.id ?? target,
            revision: result.catalogRevision,
            phase: result.existing ? "uncertain" : "acknowledged",
          },
          notice: result.existing
            ? "已找到同一保存编号，请读取并核对保存版本。"
            : message,
        });
        return result;
      } catch (error) {
        session.update({
          receipt: { ...receipt, phase: "uncertain" },
          notice: "保存回复未确认，请重新读取结果。",
        });
        throw error;
      } finally {
        session.update({ busy: false });
      }
    },
    reconcile<Row extends { id: string }>(
      rows: Row[],
      settled: boolean,
      source: PracticeEditScope,
      form: (row: Row) => EditorForm,
      revision: string | undefined,
      explicit = false,
      keepInput = false,
    ) {
      const state = session.getSnapshot(),
        receipt = state.receipt;
      if (!receipt || state.busy || receipt.phase === "sending") return false;
      if (explicit && !settled) return false;
      const row = rows.find((row) => row.id === receipt.target);
      if (!explicit && receipt.phase !== "acknowledged") return false;
      if (!explicit && receipt.revision !== revision) return false;
      if (receipt.operation === "save" && !row) {
        if (!explicit || !settled) return false;
      }
      if (receipt.operation === "remove" && row) {
        if (!explicit || !settled) return false;
      }
      if (!row && !settled) return false;
      const current = state.drafts.find((item) => item.key === receipt.draft);
      const preserveInput = keepInput || (!explicit && receipt.keepInput);
      const drafts = state.drafts.map((item) =>
        item.key !== receipt.draft
          ? item
          : {
              ...item,
              id: row?.id ?? null,
              requestId:
                !row && receipt.operation === "remove"
                  ? crypto.randomUUID()
                  : item.requestId,
              base: row ? JSON.stringify(row) : null,
              scope: practiceScopeKey(source),
              form:
                row && !preserveInput
                  ? form(row)
                  : row && !explicit && receipt.keepInput
                    ? {
                        ...item.form,
                        name: form(row).name,
                        ...(kind === "passage"
                          ? { notes: form(row).notes }
                          : {}),
                      }
                    : item.form,
              original: row ? form(row) : item.original,
            },
      );
      session.update({
        drafts,
        receipt: null,
        selected: current?.key ?? state.selected,
        notice: row
          ? preserveInput
            ? "保存结果已核对，其他输入继续保留。"
            : "已读取保存版本。"
          : receipt.operation === "remove"
            ? "已核对移除结果，输入继续保留为新草稿。"
            : "当前列表未发现保存结果，输入继续保留。",
      });
      return true;
    },
  };
}
export function getPracticeEditor(kind: PracticeEditorKind, contentId: string) {
  const key = `${kind}:${contentId}`;
  let slot = slots.get(key);
  if (!slot) {
    if (slots.size >= 24)
      for (const [id, value] of slots) {
        if (value.unused()) {
          value.dispose();
          slots.delete(id);
          break;
        }
      }
    slot = createSession(kind, contentId);
    slots.set(key, slot);
    activitySignal.changed();
  }
  return slot;
}
export const flushPracticeEditorDrafts = () => {
  for (const slot of slots.values()) slot.retrySave();
};
export const pendingPracticeEditorDrafts = () => {
  for (const slot of slots.values()) {
    const state = slot.getSnapshot();
    if (state.busy) return "练习资料仍在保存，请等待当前请求完成。";
    if (state.storageError && (state.drafts.length || state.receipt))
      return state.storageError;
  }
  return null;
};
export type PracticeEditorStore = ReturnType<typeof getPracticeEditor>;
export const practiceEditorSessions = () =>
  [...slots.entries()].map(([key, store]) => ({
    key,
    store,
    state: store.getSnapshot(),
  }));
