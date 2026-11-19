import {
  isExpressionInputs,
  type ExpressionInputs,
} from "../practice/expressionDraft";
import type { RoutineGoal, RoutineSchedule } from "./routineTypes";
import {
  isRoutineGoalInputs,
  type RoutineGoalInputs,
} from "./routineGoalInputs";

export interface RoutineDraftContext {
  routineId: string | null;
  day: string | null;
}
export interface RoutineMetaDraft extends RoutineDraftContext {
  name: string;
  notes: string;
  base: string;
  revision: string | null;
  requestId: string | null;
  copyRequest: string | null;
  updatedAt: number;
}
export interface RoutineItemDraft extends RoutineDraftContext {
  token: string;
  itemId: string | null;
  title: string;
  notes: string;
  source: string;
  sourceContentId: string | null;
  goal: RoutineGoal;
  goalInput?: RoutineGoalInputs;
  expressionInput?: ExpressionInputs;
  base: string;
  revision: string | null;
  skipReason: string;
  updatedAt: number;
}
export interface RoutineBrowse {
  planQuery?: string;
  planPage?: number;
  pane?: import("../../app/useBrowsePane").BrowsePane;
  detailSection?: RoutineDetailSection;
  day: string;
  template: boolean;
  selected: string | null;
  itemId: string | null;
  itemToken: string | null;
  search: string;
}
export type RoutineDetailSection = "items" | "metadata" | "sources";
export interface RoutinePending extends RoutineDraftContext {
  kind: "list" | "open";
  label: string;
  itemId: string | null;
  title: string;
  confirmed: boolean;
}
export interface RoutineScheduleDraft extends RoutineDraftContext {
  title: string;
  value: RoutineSchedule;
  base: string;
  revision: string | null;
  exceptionDay: string;
  touched: boolean;
  updatedAt: number;
}
export interface RoutineWorkbench {
  busy: boolean;
  browse: RoutineBrowse | null;
  metadata: Record<string, RoutineMetaDraft>;
  items: Record<string, RoutineItemDraft>;
  pending: Record<string, RoutinePending>;
  schedules: Record<string, RoutineScheduleDraft>;
  storageError: string;
}
export const routineContextKey = (context: RoutineDraftContext) =>
  JSON.stringify([context.routineId, context.day]);
export const routineItemKey = (context: RoutineDraftContext, token: string) =>
  JSON.stringify([context.routineId, context.day, token]);
export const routineValue = (value: unknown): string =>
  JSON.stringify(value, (_key, part) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(
          Object.entries(part).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : part,
  );
const key = "neothesia.routine-workbench.v1";
const text = (value: unknown, length: number): value is string =>
  typeof value === "string" && value.length <= length;
const nullable = (value: unknown, length = 256): value is string | null =>
  value === null || text(value, length);
const context = (value: Record<string, unknown>) =>
  nullable(value.routineId) && nullable(value.day, 10);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function goal(value: unknown): value is RoutineGoal {
  if (
    !record(value) ||
    !["passes", "accuracy", "attemptLimit"].every(
      (field) =>
        typeof value[field] === "number" && Number.isFinite(value[field]),
    )
  )
    return false;
  if (
    typeof value.consecutive !== "boolean" ||
    !(
      value.onTime == null ||
      (typeof value.onTime === "number" && Number.isFinite(value.onTime))
    )
  )
    return false;
  return (
    value.expression == null ||
    (record(value.expression) &&
      Object.values(value.expression).every(
        (part) =>
          part === null || (typeof part === "number" && Number.isFinite(part)),
      ))
  );
}
function read(raw: string | null): RoutineWorkbench {
  const fresh: RoutineWorkbench = {
    busy: false,
    browse: null,
    metadata: {},
    items: {},
    pending: {},
    schedules: {},
    storageError: "",
  };
  if (!raw) return fresh;
  if (raw.length > 2_000_000) throw new Error("计划草稿超过暂存容量，原文保留");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !record(value.metadata) || !record(value.items))
    throw new Error("计划草稿格式无效，原文保留");
  if (
    value.browse !== null &&
    (!record(value.browse) ||
      !text(value.browse.day, 10) ||
      typeof value.browse.template !== "boolean" ||
      !nullable(value.browse.selected) ||
      !nullable(value.browse.itemId) ||
      !nullable(value.browse.itemToken) ||
      !(value.browse.planQuery == null || text(value.browse.planQuery, 4096)) ||
      !(
        value.browse.planPage == null ||
        (Number.isSafeInteger(value.browse.planPage) &&
          Number(value.browse.planPage) >= 0 &&
          Number(value.browse.planPage) <= 10000)
      ) ||
      !(
        value.browse.pane == null ||
        ["list", "detail"].includes(String(value.browse.pane))
      ) ||
      !(
        value.browse.detailSection == null ||
        ["items", "metadata", "sources"].includes(
          String(value.browse.detailSection),
        )
      ) ||
      !text(value.browse.search, 4096))
  )
    throw new Error("计划浏览位置无效，原文保留");
  for (const [id, row] of Object.entries(value.metadata)) {
    if (
      !record(row) ||
      !context(row) ||
      !text(row.name, 320) ||
      !text(row.notes, 32000) ||
      !text(row.base, 64000) ||
      !nullable(row.revision, 64) ||
      !nullable(row.requestId) ||
      !nullable(row.copyRequest) ||
      typeof row.updatedAt !== "number" ||
      id !== routineContextKey(row as unknown as RoutineDraftContext)
    )
      throw new Error("计划信息草稿无效，原文保留");
  }
  for (const [id, row] of Object.entries(value.items)) {
    if (
      !record(row) ||
      !context(row) ||
      !text(row.token, 256) ||
      !nullable(row.itemId) ||
      !text(row.title, 320) ||
      !text(row.notes, 32000) ||
      !text(row.source, 512) ||
      !nullable(row.sourceContentId) ||
      !goal(row.goal) ||
      !(row.goalInput == null || isRoutineGoalInputs(row.goalInput)) ||
      !(
        row.expressionInput == null || isExpressionInputs(row.expressionInput)
      ) ||
      !text(row.base, 512000) ||
      !nullable(row.revision, 64) ||
      !text(row.skipReason, 32000) ||
      typeof row.updatedAt !== "number" ||
      id !== routineItemKey(row as unknown as RoutineDraftContext, row.token)
    )
      throw new Error("练习项目草稿无效，原文保留");
  }
  const pending = value.pending ?? {};
  if (!record(pending)) throw new Error("计划回执无效，原文保留");
  for (const [id, row] of Object.entries(pending)) {
    if (
      !record(row) ||
      !context(row) ||
      !["list", "open"].includes(String(row.kind)) ||
      !text(row.label, 320) ||
      !nullable(row.itemId) ||
      !text(row.title, 320) ||
      typeof row.confirmed !== "boolean" ||
      id !== routineContextKey(row as unknown as RoutineDraftContext)
    )
      throw new Error("计划回执无效，原文保留");
  }
  const schedules = value.schedules ?? {};
  if (!record(schedules)) throw new Error("周期安排草稿无效，原文保留");
  for (const [id, row] of Object.entries(schedules)) {
    if (
      !record(row) ||
      !context(row) ||
      row.day !== null ||
      !text(row.title, 320) ||
      !record(row.value) ||
      typeof row.value.enabled !== "boolean" ||
      !Array.isArray(row.value.weekdays) ||
      !row.value.weekdays.every(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6,
      ) ||
      !text(row.value.start, 10) ||
      !nullable(row.value.end, 10) ||
      ![row.value.skipDates ?? [], row.value.extraDates ?? []].every(
        (dates) =>
          Array.isArray(dates) &&
          dates.length <= 366 &&
          dates.every((day) => text(day, 10)),
      ) ||
      !text(row.base, 64000) ||
      !nullable(row.revision, 64) ||
      !text(row.exceptionDay, 10) ||
      typeof row.touched !== "boolean" ||
      typeof row.updatedAt !== "number" ||
      id !== routineContextKey(row as unknown as RoutineDraftContext)
    )
      throw new Error("周期安排草稿无效，原文保留");
  }
  return {
    busy: false,
    browse: value.browse as RoutineBrowse | null,
    metadata: value.metadata as unknown as RoutineWorkbench["metadata"],
    items: value.items as unknown as RoutineWorkbench["items"],
    pending: pending as unknown as RoutineWorkbench["pending"],
    schedules: schedules as unknown as RoutineWorkbench["schedules"],
    storageError: "",
  };
}

export function createRoutineWorkbenchStore() {
  let raw: string | null = null;
  let state: RoutineWorkbench;
  let blocked = false;
  try {
    raw = localStorage.getItem(key);
    state = read(raw);
  } catch (error) {
    blocked = true;
    state = {
      busy: false,
      browse: null,
      metadata: {},
      items: {},
      pending: {},
      schedules: {},
      storageError: String(error),
    };
  }
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const save = () => {
    try {
      if (blocked) throw new Error("旧草稿尚未恢复，当前输入保留在本次会话中");
      if (localStorage.getItem(key) !== raw) {
        blocked = true;
        throw new Error("其他窗口更新了草稿，当前输入与磁盘原文均已保留");
      }
      const { storageError: _error, busy: _busy, ...value } = state;
      const next = JSON.stringify(value, (_key, part) => {
        if (typeof part === "number" && !Number.isFinite(part))
          throw new Error("草稿包含未完成的数值，输入已保留，请修正数值后重试");
        return part;
      });
      if (next.length > 2_000_000)
        throw new Error("计划草稿超过暂存容量，请复制或移除已处理的草稿");
      if (next !== raw) localStorage.setItem(key, next);
      raw = next;
      state = { ...state, storageError: "" };
    } catch (error) {
      state = {
        ...state,
        storageError: `暂存失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    notify();
  };
  return {
    getSnapshot: () => state,
    setBusy(busy: boolean) {
      state = { ...state, busy };
      notify();
    },
    pending(value: RoutinePending) {
      state = {
        ...state,
        pending: { ...state.pending, [routineContextKey(value)]: value },
      };
      save();
    },
    clearPending(id: string) {
      if (!(id in state.pending)) return;
      const pending = { ...state.pending };
      delete pending[id];
      state = { ...state, pending };
      save();
    },
    schedule(value: RoutineScheduleDraft) {
      const id = routineContextKey(value);
      const old = state.schedules[id];
      if (
        old &&
        JSON.stringify({ ...old, updatedAt: 0 }) ===
          JSON.stringify({ ...value, updatedAt: 0 })
      )
        return;
      state = { ...state, schedules: { ...state.schedules, [id]: value } };
      save();
    },
    removeSchedule(id: string) {
      if (!(id in state.schedules)) return;
      const schedules = { ...state.schedules };
      delete schedules[id];
      state = { ...state, schedules };
      save();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    original: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return raw;
      }
    },
    remember(browse: RoutineBrowse) {
      if (JSON.stringify(state.browse) === JSON.stringify(browse)) return;
      state = { ...state, browse };
      save();
    },
    metadata(value: RoutineMetaDraft) {
      const id = routineContextKey(value);
      const old = state.metadata[id];
      if (
        old &&
        JSON.stringify({ ...old, updatedAt: 0 }) ===
          JSON.stringify({ ...value, updatedAt: 0 })
      )
        return;
      state = { ...state, metadata: { ...state.metadata, [id]: value } };
      save();
    },
    item(value: RoutineItemDraft) {
      const id = routineItemKey(value, value.token);
      const old = state.items[id];
      if (
        old &&
        JSON.stringify({ ...old, updatedAt: 0 }) ===
          JSON.stringify({ ...value, updatedAt: 0 })
      )
        return;
      state = { ...state, items: { ...state.items, [id]: value } };
      save();
    },
    removeMetadata(id: string) {
      if (!(id in state.metadata)) return;
      const metadata = { ...state.metadata };
      delete metadata[id];
      state = { ...state, metadata };
      save();
    },
    removeItem(id: string) {
      if (!(id in state.items)) return;
      const items = { ...state.items };
      delete items[id];
      state = { ...state, items };
      save();
    },
    retrySave: save,
    preserveAndSave() {
      try {
        const previous = localStorage.getItem(key);
        if (previous)
          localStorage.setItem(`${key}.recovery.${Date.now()}`, previous);
        raw = previous;
        blocked = false;
        save();
      } catch {
        state = {
          ...state,
          storageError:
            "旧草稿副本保存失败，当前输入与原文保留。可先复制两份内容。",
        };
        notify();
      }
    },
  };
}
export type RoutineWorkbenchStore = ReturnType<
  typeof createRoutineWorkbenchStore
>;
