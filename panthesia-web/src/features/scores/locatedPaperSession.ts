import { activitySignal } from "../activity/activitySignal";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { registerCloseParticipant } from "../../app/closePreparation";
import type { LocatedPaperSaved } from "../../engine/commands.generated";

export interface LocatedPaperSource { contentId: string; title?: string; engineId?: string | null; path?: string }
interface State {
  name: string;
  excluded: ReadonlySet<string>;
  dirty: boolean;
  busy: boolean;
  committing: boolean;
  preparedPages: number;
  progress: string;
  error: string;
  storageError: string;
  saved: LocatedPaperSaved | null;
}
interface Stored { version: 1; contentId: string; fingerprint: string; name: string; excluded: string[] }
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
let serial = 0;
function createSession(contentId: string, fingerprint: string, initialName: string) {
  const key = `panthesia-located-paper-draft:${JSON.stringify([contentId, fingerprint])}`;
  let raw: string | null = null, protectedRaw = false;
  let operationInfo: LocatedPaperSource | null = null;
  let sourceInfo: LocatedPaperSource = { contentId, title: initialName };
  let state: State = { name: Array.from(initialName).slice(0, 80).join(""), excluded: new Set(), dirty: false, busy: false, committing: false, preparedPages: 0, progress: "", error: "", storageError: "", saved: null };
  try {
    raw = localStorage.getItem(key);
    if (raw !== null) {
      if (raw.length > 2_000_000) throw new Error("draft too large");
      const value = JSON.parse(raw) as Stored;
      if (!value || value.version !== 1 || value.contentId !== contentId || value.fingerprint !== fingerprint
        || typeof value.name !== "string" || value.name.length > 320 || !Array.isArray(value.excluded)
        || value.excluded.length > 100000 || value.excluded.some((id) => typeof id !== "string" || !/^\d{1,10}:\d{1,10}$/.test(id))) throw new Error("invalid draft");
      state = { ...state, name: value.name, excluded: new Set(value.excluded), dirty: true };
    }
  } catch {
    protectedRaw = true;
    state = { ...state, storageError: "原可定位谱草稿暂时无法完整读取，原文已保留。" };
  }
  let sources: string[] = [], images: Blob[] = [], bytes = 0;
  let controller: AbortController | null = null;
  let boundSource = "", operationSource = "", savedSource = "";
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const listener of [...listeners]) listener(); activitySignal.changed(); };
  const documentValue = (): Stored => ({ version: 1, contentId, fingerprint, name: state.name, excluded: [...state.excluded].sort() });
  const persist = () => {
    if (!state.dirty || state.saved) return;
    try {
      if (protectedRaw) throw new Error("原草稿仍被保留，请复制原文后再采用当前输入。");
      if (localStorage.getItem(key) !== raw) { protectedRaw = true; throw new Error("另一窗口已改变可定位谱草稿，当前输入和原文分别保留。"); }
      const next = JSON.stringify(documentValue());
      if (next.length > 2_000_000) throw new Error("可定位谱草稿超过暂存容量，请复制输入后保存。");
      if (next !== raw) localStorage.setItem(key, next);
      raw = next; publish({ storageError: "" });
    } catch (error) { publish({ storageError: text(error) }); }
  };
  const unregisterClose = registerCloseParticipant(`located-paper-${++serial}`, {
    label: "可定位纸谱", prepare: persist,
    pending: () => state.busy ? "谱页制作或保存仍在处理，可返回查看结果。"
      : state.dirty && state.storageError ? state.storageError
      : images.length && !state.saved ? "已生成的谱页图片尚未采用，关闭后需要重新制作。名称和已暂存选择会保留。" : null,
  });
  return {
    getSnapshot: (): State => state,
    getSource: () => state.busy && operationInfo ? operationInfo : sourceInfo,
    getFingerprint: () => fingerprint,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: publish,
    bindSource: (source: string, info?: Omit<LocatedPaperSource, "contentId">) => {
      if (info && (sourceInfo.title !== info.title || sourceInfo.path !== info.path || sourceInfo.engineId !== info.engineId)) {
        sourceInfo = { contentId, ...info }; activitySignal.changed();
      }
      if (boundSource === source) return;
      boundSource = source;
      if (state.saved && savedSource !== source) publish({ saved: null, progress: "原条件的谱页继续保留，当前条件可以制作新版本。", error: "" });
    },
    canForget: () => !listeners.size && !state.busy && !images.length && !sources.length && (!state.dirty || !state.storageError),
    dispose: unregisterClose,
    memory: () => bytes + sources.reduce((sum, source) => sum + source.length * 2, 0),
    releaseImages: () => {
      if (state.busy) return;
      sources = []; images = []; bytes = 0;
      publish({ preparedPages: 0, progress: "前次临时图片已释放，名称和音符选择保留。可以重新制作。" });
    },
    setName: (name: string) => { if (state.busy || state.saved) return; publish({ name, dirty: true }); persist(); },
    setExcluded: (change: (current: ReadonlySet<string>) => Set<string>) => {
      if (state.busy || state.saved) return;
      publish({ excluded: change(state.excluded), dirty: true }); persist();
    },
    claim: (source: string): AbortController | null => {
      if (state.busy) return null;
      if ([...sessions.values()].some((slot) => slot.getSnapshot().busy)) {
        publish({ error: "另一份可定位谱仍在制作或保存，请等待原任务结束后继续。" });
        return null;
      }
      boundSource = source; operationSource = source; operationInfo = { ...sourceInfo };
      controller = new AbortController();
      publish({ busy: true, committing: false, error: "", progress: "正在核对曲目与原谱…" });
      return controller;
    },
    release: (owned: AbortController) => {
      if (controller !== owned) return;
      controller = null; operationInfo = null; publish({ busy: false, committing: false });
      trimImages(JSON.stringify([contentId, fingerprint]));
    },
    cancel: () => { if (!state.committing && controller) { controller.abort("cancelled"); publish({ progress: "正在停止制作，当前输入和已生成图片保留…" }); } },
    beginPages: (input: string[]) => {
      if (sources.length !== input.length || sources.some((source, index) => source !== input[index])) { sources = input.slice(); images = []; bytes = 0; publish({ preparedPages: 0 }); }
    },
    image: (index: number) => images[index],
    retainImage: (index: number, image: Blob) => {
      if (index !== images.length) throw new Error("谱页生成次序已改变，请重新开始制作。");
      if (bytes + image.size > 48_000_000) throw new Error("这份谱的图片数据超过 48 MB，请降低谱页分辨率或分段生成。");
      images.push(image); bytes += image.size; publish({ preparedPages: images.length });
      trimImages(JSON.stringify([contentId, fingerprint]));
    },
    saved: (result: LocatedPaperSaved) => {
      const current = boundSource === operationSource;
      savedSource = operationSource;
      try { if (current && !protectedRaw && localStorage.getItem(key) === raw) { localStorage.removeItem(key); raw = null; } } catch {}
      sources = []; images = []; bytes = 0;
      publish({ saved: current ? result : null, dirty: current ? false : state.dirty, preparedPages: 0, storageError: current ? "" : state.storageError, error: "", progress: !current ? "原条件的可定位谱已保存。当前曲目条件已改变，可继续制作新版本。" : result.alreadySaved ? "已核对原保存结果，谱页和逐音位置继续保留。" : "已保存，可从纸谱管理查看和定位音符。" });
    },
    startAnother: () => { if (!state.busy) publish({ saved: null, progress: "可以修改名称或音符选择后制作新版本。", error: "" }); },
    copy: () => JSON.stringify(documentValue(), null, 2),
    preserveAndSave: async () => {
      if (state.busy) return;
      try {
        const original = localStorage.getItem(key);
        if (original !== null) await navigator.clipboard.writeText(original);
        if (localStorage.getItem(key) !== original) throw new Error("原草稿再次改变，请重新核对。");
        raw = original; protectedRaw = false; publish({ dirty: true }); persist();
      } catch (error) { publish({ storageError: text(error) }); }
    },
  };
}
const sessions = new Map<string, ReturnType<typeof createSession>>();
function trimImages(current: string) {
  let used = [...sessions.values()].reduce((sum, session) => sum + session.memory(), 0);
  if (used <= 96_000_000) return;
  for (const [key, session] of sessions) {
    if (key === current || session.getSnapshot().busy || !session.memory()) continue;
    used -= session.memory(); session.releaseImages();
    if (used <= 96_000_000) break;
  }
}
export function useLocatedPaperSession(contentId: string, fingerprint: string, initialName: string, sourceKey: string, info?: Omit<LocatedPaperSource, "contentId">) {
  const session = useMemo(() => {
    const key = JSON.stringify([contentId, fingerprint]);
    let value = sessions.get(key);
    if (!value) {
      while (sessions.size >= 16) {
        const oldest = [...sessions].find(([, candidate]) => candidate.canForget());
        if (!oldest) break;
        oldest[1].dispose(); sessions.delete(oldest[0]);
      }
      value = createSession(contentId, fingerprint, initialName);
    }
    sessions.delete(key); sessions.set(key, value);
    return value;
  }, [contentId, fingerprint]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { session.bindSource(sourceKey, info); }, [session, sourceKey, info?.engineId, info?.title, info?.path]);
  return { ...state, session };
}

export const locatedPaperSessions = () => [...sessions].map(([key, session]) => ({ key, session, source: session.getSource(), sourceFingerprint: session.getFingerprint(), state: session.getSnapshot() }));
