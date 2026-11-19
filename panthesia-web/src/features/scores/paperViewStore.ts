import { api } from "../../api";
import type {
  View,
  PaperViewState,
  PaperViewSaved,
  EngineCommand,
} from "../../engine/commands.generated";

interface Attempt {
  view: View;
  base: View;
}
export interface PaperReadingTicket {
  change: number;
  read: number;
}
interface Stored {
  version: 1;
  contentId: string;
  book: string;
  view: View;
  base: View;
  attempt?: Attempt;
}
export interface PaperViewSessionState {
  view: View;
  base: View;
  dirty: boolean;
  saving: boolean;
  error: string;
  storageError: string;
  conflict: View | null;
  savedVersion: number;
  restored: boolean;
}
const same = (a: View, b: View) =>
  a.page === b.page &&
  a.zoom === b.zoom &&
  a.fit === b.fit &&
  a.rotation === b.rotation;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const validPaperView = (value: unknown): value is View =>
  object(value) &&
  Number.isInteger(value.page) &&
  Number(value.page) >= 1 &&
  Number(value.page) <= 5000 &&
  Number.isInteger(value.zoom) &&
  Number(value.zoom) >= 25 &&
  Number(value.zoom) <= 300 &&
  typeof value.fit === "boolean" &&
  [0, 90, 180, 270].includes(Number(value.rotation)) &&
  typeof value.rotation === "number";
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const slots = new Map<string, PaperViewSession>();
const limit = 8192;

function create(contentId: string, book: string, initial: View) {
  const key = `panthesia.paper-view.v1:${JSON.stringify([contentId, book])}`;
  let raw: string | null = null,
    attempt: Attempt | undefined;
  let sourceEngine: string | undefined,
    bindingGeneration = 0;
  let state: PaperViewSessionState = {
    view: initial,
    base: initial,
    dirty: false,
    saving: false,
    error: "",
    storageError: "",
    conflict: null,
    savedVersion: 0,
    restored: false,
  };
  const listeners = new Set<() => void>();
  let readSequence = 0,
    changeSequence = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const decode = (text: string): Stored => {
    if (text.length > limit)
      throw new Error("阅读位置暂存超过容量限制，原文已保留");
    const value: unknown = JSON.parse(text);
    if (
      !object(value) ||
      value.version !== 1 ||
      value.contentId !== contentId ||
      value.book !== book ||
      !validPaperView(value.view) ||
      !validPaperView(value.base) ||
      (value.attempt !== undefined &&
        (!object(value.attempt) ||
          !validPaperView(value.attempt.view) ||
          !validPaperView(value.attempt.base)))
    ) {
      throw new Error("阅读位置暂存格式无法读取，原文已保留");
    }
    return value as unknown as Stored;
  };
  try {
    raw = localStorage.getItem(key);
    if (raw !== null) {
      const saved = decode(raw);
      attempt = saved.attempt;
      const dirty = !same(saved.view, saved.base) || !!attempt;
      if (dirty)
        state = {
          ...state,
          view: saved.view,
          base: saved.base,
          dirty: true,
          restored: true,
        };
    }
  } catch (error) {
    state = { ...state, storageError: message(error) };
  }
  // A failed decode or a change in another window never authorizes replacing its original text.
  let blocked = !!state.storageError;
  const persist = () => {
    try {
      if (blocked)
        throw new Error(state.storageError || "阅读位置暂存尚待处理");
      if (localStorage.getItem(key) !== raw) {
        blocked = true;
        throw new Error(
          "另一窗口已修改阅读位置暂存。当前输入已保留，可复制后重新打开谱页。",
        );
      }
      const next =
        state.dirty || attempt
          ? JSON.stringify({
              version: 1,
              contentId,
              book,
              view: state.view,
              base: state.base,
              attempt,
            } satisfies Stored)
          : null;
      if (next !== raw) {
        if (next === null) localStorage.removeItem(key);
        else {
          if (next.length > limit) throw new Error("阅读位置超过暂存容量");
          localStorage.setItem(key, next);
        }
        raw = next;
      }
      state = { ...state, storageError: "" };
    } catch (error) {
      state = { ...state, storageError: message(error) };
    }
  };
  const validate = (value: unknown): PaperViewState => {
    if (
      !object(value) ||
      value.contentId !== contentId ||
      value.book !== book ||
      !validPaperView(value.view) ||
      !["pdf", "images"].includes(String(value.format)) ||
      !Number.isInteger(value.imagePages) ||
      Number(value.imagePages) < 0 ||
      Number(value.imagePages) > 80
    )
      throw new Error("阅读位置回复与当前谱面不一致，请核对原结果");
    return value as unknown as PaperViewState;
  };
  const normalized = (view: View, remote: PaperViewState): View =>
    remote.format === "images"
      ? { ...view, page: Math.max(1, Math.min(view.page, remote.imagePages)) }
      : view;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const run = async () => {
    clearTimeout(timer);
    if (state.saving || state.conflict || (!state.dirty && !attempt)) return;
    state = { ...state, saving: true, error: "" };
    notify();
    const engineId = sourceEngine,
      generation = bindingGeneration;
    const command = async <T>(request: EngineCommand) => {
      const result = await api.commandForEngine<T>(engineId, request);
      if (generation !== bindingGeneration)
        throw new Error(
          "连接已更新，请核对当前阅读位置后重试。原位置与保存请求继续保留。",
        );
      return result;
    };
    try {
      if (attempt) {
        const remote = validate(
          await command<PaperViewState>({
            type: "readPaperView",
            content_id: contentId,
            book,
          }),
        );
        if (
          !same(remote.view, normalized(attempt.view, remote)) &&
          !same(remote.view, attempt.base)
        ) {
          state = {
            ...state,
            conflict: remote.view,
            error: "谱页阅读位置已被其他操作改变，请选择要保留的位置。",
          };
          return;
        }
        changeSequence++;
        state = { ...state, base: remote.view };
        attempt = undefined;
        state = { ...state, dirty: !same(state.view, state.base) };
        persist();
      }
      // A newer page chosen while saving remains pending and uses the acknowledged base.
      if (state.dirty) {
        const submitted: Attempt = { view: state.view, base: state.base };
        attempt = submitted;
        persist();
        const result = await command<PaperViewSaved>({
          type: "savePaperView",
          content_id: contentId,
          book,
          view: submitted.view,
          expected: submitted.base,
        });
        if (!object(result) || typeof result.saved !== "boolean")
          throw new Error("阅读位置保存回复不完整，请核对原结果");
        const remote = validate(result.state);
        if (!result.saved) {
          state = {
            ...state,
            conflict: remote.view,
            error: "谱页阅读位置已改变，当前阅读位置仍保留。",
          };
          return;
        }
        if (!same(remote.view, normalized(submitted.view, remote)))
          throw new Error("保存结果与提交的阅读位置不一致，请核对原结果");
        attempt = undefined;
        changeSequence++;
        state = {
          ...state,
          base: remote.view,
          view: same(state.view, submitted.view) ? remote.view : state.view,
          savedVersion: state.savedVersion + 1,
        };
        state = { ...state, dirty: !same(state.view, state.base) };
        persist();
      }
    } catch (error) {
      state = { ...state, error: message(error) };
    } finally {
      state = { ...state, saving: false };
      if (!state.dirty && !attempt && !state.error && !state.conflict)
        state = { ...state, restored: false };
      persist();
      notify();
      if (state.dirty && !state.error && !state.conflict && !attempt) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void save();
        }, 450);
      }
    }
  };
  const save = () => {
    if (!active)
      active = run().finally(() => {
        active = undefined;
      });
    return active;
  };
  return {
    contentId,
    book,
    bindEngine(engineId: string | undefined) {
      if (sourceEngine !== engineId) {
        sourceEngine = engineId;
        bindingGeneration++;
      }
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setView: (next: View) => {
      if (!validPaperView(next) || same(next, state.view)) return;
      changeSequence++;
      state = {
        ...state,
        view: next,
        dirty: !same(next, state.base) || !!attempt,
      };
      persist();
      notify();
      clearTimeout(timer);
      timer = setTimeout(() => {
        void save();
      }, 450);
    },
    retry: save,
    settle: async () => {
      await save();
      while (state.dirty && !state.error && !state.conflict) await save();
    },
    beginRead: (): PaperReadingTicket => ({
      change: changeSequence,
      read: ++readSequence,
    }),
    observeSaved: (saved: View, ticket: PaperReadingTicket | undefined) => {
      if (
        !ticket ||
        ticket.change !== changeSequence ||
        ticket.read !== readSequence ||
        !validPaperView(saved) ||
        state.saving ||
        attempt ||
        state.dirty ||
        state.conflict ||
        same(saved, state.base)
      )
        return;
      state = { ...state, base: saved, view: saved };
      notify();
    },
    acceptPageChange: (saved: View) => {
      if (!validPaperView(saved) || state.saving) return;
      attempt = undefined;
      changeSequence++;
      state = {
        ...state,
        base: saved,
        view: { ...state.view, page: saved.page },
        conflict: null,
        error: "",
        restored: false,
        savedVersion: state.savedVersion + 1,
      };
      state = { ...state, dirty: !same(state.view, state.base) };
      persist();
      notify();
      if (state.dirty) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void save();
        }, 450);
      }
    },
    keepCurrent: () => {
      if (state.saving || !state.conflict) return;
      attempt = undefined;
      changeSequence++;
      state = { ...state, base: state.conflict, conflict: null, error: "" };
      state = { ...state, dirty: !same(state.view, state.base) };
      persist();
      notify();
      void save();
    },
    adoptSaved: () => {
      if (state.saving || !state.conflict) return;
      attempt = undefined;
      changeSequence++;
      state = {
        ...state,
        base: state.conflict,
        view: state.conflict,
        conflict: null,
        dirty: false,
        error: "",
        restored: false,
      };
      persist();
      notify();
    },
    retryLocal: () => {
      persist();
      notify();
    },
    rebuildLocal: async () => {
      try {
        const original = localStorage.getItem(key);
        if (original !== null) await navigator.clipboard.writeText(original);
        if (localStorage.getItem(key) !== original)
          throw new Error("暂存再次改变，请重新复制原文后重建");
        raw = original;
        blocked = false;
        persist();
      } catch (error) {
        state = { ...state, storageError: message(error) };
      }
      notify();
    },
    copy: () =>
      JSON.stringify(
        {
          version: 1,
          contentId,
          book,
          view: state.view,
          base: state.base,
          attempt,
        },
        null,
        2,
      ),
    original: () => {
      try {
        return localStorage.getItem(key) ?? "";
      } catch {
        return raw ?? "";
      }
    },
    unused: () =>
      listeners.size === 0 &&
      !state.dirty &&
      !state.saving &&
      !state.storageError,
  };
}
export type PaperViewSession = ReturnType<typeof create>;
export function paperViewSession(
  contentId: string,
  book: string,
  initial: View,
): PaperViewSession {
  const key = JSON.stringify([contentId, book]);
  let slot = slots.get(key);
  if (!slot) {
    for (const [oldKey, old] of slots) {
      if (slots.size < 128) break;
      if (old.unused()) slots.delete(oldKey);
    }
    slot = create(contentId, book, initial);
    slots.set(key, slot);
  }
  return slot;
}
export const hasUnstoredPaperViews = () =>
  [...slots.values()].some(
    (slot) => !!slot.getSnapshot().storageError && slot.getSnapshot().dirty,
  );
export function flushPaperViewDrafts() {
  for (const slot of slots.values())
    if (slot.getSnapshot().dirty) slot.retryLocal();
}
export const settlePaperView = (contentId: string, book: string) =>
  slots.get(JSON.stringify([contentId, book]))?.settle();
export const acceptPaperPageChange = (
  contentId: string,
  book: string,
  view: View,
) => slots.get(JSON.stringify([contentId, book]))?.acceptPageChange(view);
export function capturePaperViewReads(
  contentId: string,
): Map<string, PaperReadingTicket> {
  return new Map(
    [...slots.values()]
      .filter((slot) => slot.contentId === contentId)
      .map((slot) => [slot.book, slot.beginRead()]),
  );
}
