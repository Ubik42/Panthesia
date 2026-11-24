import { createPersistentSession } from "../../lib/createPersistentSession";

export interface ScoreVersionRow {
  id: string;
  name: string;
  path: string;
  active: boolean;
  available: boolean;
  fingerprint?: string;
}
export interface ScoreNameDraft {
  base: string;
  value: string;
  path: string;
}
export type ScoreManagerSection = "versions" | "import" | "paper";
interface State {
  version: 1;
  contentId: string;
  names: Record<string, ScoreNameDraft>;
  labels: Record<string, string>;
  section: ScoreManagerSection;
  query: string;
  filter: "all" | "available" | "missing" | "drafts";
  page: number;
  selected: string | null;
  busy: boolean;
  storageError: string;
}
const slots = new Map<string, ReturnType<typeof createSession>>();
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
function validNames(value: unknown): value is Record<string, ScoreNameDraft> {
  return (
    object(value) &&
    Object.keys(value).length <= 256 &&
    Object.entries(value).every(
      ([key, row]) =>
        key.length > 0 &&
        key.length <= 512 &&
        object(row) &&
        text(row.base, 240) &&
        text(row.value, 240) &&
        text(row.path, 65536),
    )
  );
}
function createSession(contentId: string) {
  const session = createPersistentSession<State>(
    (raw) => {
      const initial: State = {
        version: 1,
        contentId,
        names: {},
        labels: {},
        section: "versions",
        query: "",
        filter: "all",
        page: 0,
        selected: null,
        busy: false,
        storageError: "",
      };
      if (raw === null) return initial;
      try {
        if (raw.length > 1_000_000)
          throw new Error("谱面管理输入超过读取容量，原文已保留。");
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          value.contentId !== contentId ||
          !validNames(value.names) ||
          (value.labels !== undefined &&
            (!object(value.labels) ||
              Object.keys(value.labels).length > 1000 ||
              !Object.entries(value.labels).every(
                ([key, value]) =>
                  /^[a-f\d]{64}$/i.test(key) && text(value, 240),
              ))) ||
          !["versions", "import", "paper"].includes(String(value.section)) ||
          !text(value.query, 1024) ||
          !["all", "available", "missing", "drafts"].includes(
            String(value.filter),
          ) ||
          typeof value.page !== "number" ||
          !Number.isSafeInteger(value.page) ||
          value.page < 0 ||
          value.page > 100 ||
          (value.selected !== null && !text(value.selected, 512))
        )
          throw new Error("谱面管理输入格式无法读取，原文已保留。");
        return {
          ...initial,
          names: value.names,
          labels: (value.labels as Record<string, string>) ?? {},
          section: value.section as State["section"],
          query: value.query,
          filter: value.filter as State["filter"],
          page: value.page,
          selected: value.selected as string | null,
        };
      } catch (error) {
        return {
          ...initial,
          storageError: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      key: `panthesia.score-manager.v1:${contentId}`,
      maxCharacters: 1_000_000,
      failureMessage: "谱面名称与浏览位置尚未暂存，请保留窗口或复制输入。",
    },
  );
  let subscribers = 0;
  const clear = (id: string, expected?: ScoreNameDraft) => {
    const state = session.getSnapshot();
    if (
      !state.names[id] ||
      (expected && JSON.stringify(expected) !== JSON.stringify(state.names[id]))
    )
      return;
    const names = { ...state.names };
    delete names[id];
    session.update({ names });
  };
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
      !Object.keys(session.getSnapshot().names).length &&
      !session.getSnapshot().storageError,
    editName(row: ScoreVersionRow, value: string) {
      if (value === row.name) {
        clear(row.id);
        return;
      }
      const state = session.getSnapshot(),
        original = state.names[row.id];
      if (!original && Object.keys(state.names).length >= 256)
        throw new Error("已保留多份名称输入，请先处理未匹配到版本的输入。");
      session.update({
        names: {
          ...state.names,
          [row.id]: {
            base: original?.base ?? row.name,
            path: original?.path ?? row.path,
            value,
          },
        },
      });
    },
    clearName: clear,
    setLabel(key: string, value: string) {
      const state = session.getSnapshot();
      if (!/^[a-f\d]{64}$/i.test(key) || !text(value, 240))
        throw new Error("版本名称输入无效。");
      if (!(key in state.labels) && Object.keys(state.labels).length >= 1000)
        throw new Error(
          "已保留多份版本名称输入，请先在旧文件预览中恢复部分文件名。",
        );
      session.update({ labels: { ...state.labels, [key]: value } });
    },
    clearLabel(key: string) {
      const labels = { ...session.getSnapshot().labels };
      delete labels[key];
      session.update({ labels });
    },
    acceptCurrentBase(row: ScoreVersionRow) {
      const state = session.getSnapshot(),
        draft = state.names[row.id];
      if (draft)
        session.update({
          names: {
            ...state.names,
            [row.id]: { ...draft, base: row.name, path: row.path },
          },
        });
    },
    observe(rows: ScoreVersionRow[]) {
      for (const row of rows) {
        const draft = session.getSnapshot().names[row.id];
        if (draft?.value === row.name && draft.path === row.path)
          clear(row.id, draft);
      }
    },
    browse(
      change: Partial<
        Pick<State, "section" | "query" | "filter" | "page" | "selected">
      >,
    ) {
      const current = session.getSnapshot();
      if (
        Object.entries(change).every(
          ([key, value]) => current[key as keyof State] === value,
        )
      )
        return;
      session.update(change);
    },
  };
}
export function scoreManagerDraftSession(contentId: string) {
  let session = slots.get(contentId);
  if (!session) {
    for (const [key, old] of slots) {
      if (slots.size < 128) break;
      if (old.unused()) slots.delete(key);
    }
    session = createSession(contentId);
    slots.set(contentId, session);
  }
  return session;
}
export function pendingScoreManagerDrafts() {
  for (const slot of slots.values()) {
    const issue = slot.getSnapshot().storageError;
    if (issue) return issue;
  }
  return null;
}
export function flushScoreManagerDrafts() {
  for (const slot of slots.values()) slot.retrySave();
}
export type ScoreManagerDraftSession = ReturnType<
  typeof scoreManagerDraftSession
>;
