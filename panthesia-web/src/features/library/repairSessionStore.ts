import type {
  RelinkItem,
  LibraryRepairResult,
} from "../../engine/commands.generated";
export type RepairItem = RelinkItem;
export type RepairResult = LibraryRepairResult;
export interface RepairSession {
  selected: Record<string, RepairItem>;
  unconfirmed: Record<string, RepairItem>;
  results: RepairResult[];
  refreshPending: boolean;
  storageError: string;
}
const storageKey = "neothesia.library-repairs.v1";
export const repairIdentity = (item: Pick<RepairItem, "contentId" | "from">) =>
  JSON.stringify([
    item.contentId,
    item.from.replaceAll("\\", "/").toLowerCase(),
  ]);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const item = (value: unknown): value is RepairItem =>
  object(value) &&
  typeof value.contentId === "string" &&
  /^[a-f\d]{64}$/i.test(value.contentId) &&
  [value.from, value.to].every(
    (path) =>
      typeof path === "string" && path.length > 0 && path.length <= 32768,
  );
const rows = (value: unknown): value is Record<string, RepairItem> =>
  object(value) &&
  Object.entries(value).length <= 100 &&
  Object.entries(value).every(
    ([key, row]) => item(row) && repairIdentity(row) === key,
  );
export const isRepairResult = (value: unknown): value is RepairResult =>
  item(value) &&
  object(value) &&
  typeof value.ok === "boolean" &&
  (value.error === undefined || typeof value.error === "string") &&
  (value.warnings === undefined ||
    (Array.isArray(value.warnings) &&
      value.warnings.every((warning) => typeof warning === "string")));

export function createRepairSessionStore() {
  let state: RepairSession = {
    selected: {},
    unconfirmed: {},
    results: [],
    refreshPending: false,
    storageError: "",
  };
  let raw: string | null = null,
    blocked = false;
  const listeners = new Set<() => void>();
  try {
    raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      if (raw.length > 2_000_000)
        throw new Error("上次文件关联输入超过暂存容量");
      const value: unknown = JSON.parse(raw);
      if (
        !object(value) ||
        value.version !== 1 ||
        !rows(value.selected) ||
        !rows(value.unconfirmed) ||
        !Array.isArray(value.results) ||
        value.results.length > 100 ||
        !value.results.every(isRepairResult) ||
        typeof value.refreshPending !== "boolean"
      )
        throw new Error("上次文件关联输入无法读取");
      state = {
        ...state,
        selected: value.selected,
        unconfirmed: value.unconfirmed,
        results: value.results,
        refreshPending: value.refreshPending,
      };
    }
  } catch (e) {
    blocked = true;
    state.storageError = `${String(e)}，原记录已保留。当前输入可复制保存。`;
  }
  const update = (patch: Partial<Omit<RepairSession, "storageError">>) => {
    state = { ...state, ...patch };
    try {
      if (blocked || localStorage.getItem(storageKey) !== raw) {
        blocked = true;
        throw new Error("其他窗口或原暂存记录需要处理");
      }
      if (
        !rows(state.selected) ||
        !rows(state.unconfirmed) ||
        state.results.length > 100 ||
        !state.results.every(isRepairResult)
      )
        throw new Error("关联输入超过容量或格式无效");
      const next = JSON.stringify({
        version: 1,
        selected: state.selected,
        unconfirmed: state.unconfirmed,
        results: state.results,
        refreshPending: state.refreshPending,
      });
      if (next.length > 2_000_000) throw new Error("关联输入超过暂存容量");
      localStorage.setItem(storageKey, next);
      raw = next;
      state = { ...state, storageError: "" };
    } catch (e) {
      state = {
        ...state,
        storageError: `关联输入暂存失败：${String(e)}。当前输入和原记录已保留，可复制保存。`,
      };
    }
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    originalText: () => {
      try {
        return localStorage.getItem(storageKey) ?? "";
      } catch {
        return raw ?? "";
      }
    },
  };
}
export type RepairSessionStore = ReturnType<typeof createRepairSessionStore>;
