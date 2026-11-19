import type { MetadataDraft } from "../library/metadataTypes";
import { metadataFieldNames } from "../library/metadataFields";
import type { AnnotationDraft } from "../review/annotationDraft";
import type { LearningEditDraft } from "../library/learningDraft";
import { isLearningInputs } from "../library/learningDraft";
import {
  expressionFields,
  isExpressionInputs,
  type ExpressionDraft,
} from "../practice/expressionDraft";

type Drafts = {
  metadata: MetadataDraft;
  annotations: AnnotationDraft;
  learning: LearningEditDraft;
  expressions: ExpressionDraft;
};
export type EditDraftKind = keyof Drafts;
const kinds: EditDraftKind[] = [
  "metadata",
  "annotations",
  "learning",
  "expressions",
];
const storageKey = "neothesia.edit-drafts.v1";
const limit = 2_000_000;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, length = 32768): v is string =>
  typeof v === "string" && v.length <= length;
const nullable = (v: unknown, length = 32768) => v === null || text(v, length);
const numeric = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const numberOrNull = (v: unknown) => v === null || numeric(v);
const cid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{64}$/i.test(v);
export const editDraftValue = (value: unknown): string =>
  JSON.stringify(value, (_key, part) => {
    if (typeof part === "number" && !Number.isFinite(part))
      return { invalidNumber: String(part) };
    return object(part)
      ? Object.fromEntries(
          Object.entries(part).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : part;
  }) ?? "undefined";
function pair(key: string) {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) &&
      value.length === 2 &&
      cid(value[0]) &&
      text(value[1])
      ? (value as [string, string])
      : null;
  } catch {
    return null;
  }
}
function metadata(value: unknown) {
  return (
    object(value) &&
    metadataFieldNames.filter((field) => field !== "tags").every(
      (field) => value[field] === undefined || nullable(value[field]),
    ) &&
    Array.isArray(value.tags) &&
    value.tags.length <= 1000 &&
    value.tags.every((tag) => text(tag, 2048))
  );
}
function annotationText(value: unknown) {
  return (
    object(value) &&
    ["note", "teacher", "next"].every((field) => text(value[field], 8192))
  );
}
function annotation(value: unknown) {
  return (
    value === null ||
    (object(value) &&
      annotationText(value) &&
      numeric(value.updated_at_unix_ms))
  );
}
function header(value: unknown, identity: [string, string]) {
  return (
    object(value) &&
    value.contentId === identity[0] &&
    value.id === identity[1] &&
    text(value.title) &&
    nullable(value.path) &&
    numeric(value.recordedAt) &&
    numberOrNull(value.playingMs) &&
    numeric(value.speed) &&
    text(value.hands, 256) &&
    nullable(value.mode, 256) &&
    annotation(value.annotation) &&
    (value.range === null ||
      (Array.isArray(value.range) &&
        value.range.length === 2 &&
        value.range.every(numeric))) &&
    typeof value.exactPassage === "boolean" &&
    typeof value.restorable === "boolean" &&
    numberOrNull(value.tempo) &&
    (value.coverage === null ||
      (object(value.coverage) &&
        numeric(value.coverage.target) &&
        numeric(value.coverage.judged))) &&
    object(value.score) &&
    [
      "matched_notes",
      "on_time_notes",
      "early_notes",
      "late_notes",
      "wrong_notes",
      "missed_notes",
      "required_notes",
    ].every((field) => numeric((value.score as Record<string, unknown>)[field]))
  );
}
function learning(value: unknown) {
  return (
    object(value) &&
    text(value.stage, 256) &&
    text(value.goal, 32768) &&
    nullable(value.due, 10) &&
    numberOrNull(value.weeklyMinutes) &&
    numberOrNull(value.targetBpm)
  );
}
function learningBase(value: unknown) {
  if (value === null) return true;
  if (
    !object(value) ||
    !learning(value) ||
    !numeric(value.updatedAt) ||
    !text(value.title) ||
    !Array.isArray(value.transitions) ||
    value.transitions.length > 64
  )
    return false;
  return value.transitions.every((row) => {
    if (
      !object(row) ||
      !text(row.stage, 256) ||
      !numeric(row.at) ||
      (row.plan != null && !learning(row.plan))
    )
      return false;
    if (row.evidence == null) return true;
    const e = row.evidence;
    return (
      object(e) &&
      object(e.week) &&
      numeric(e.week.runningMs) &&
      numberOrNull(e.week.targetMinutes) &&
      typeof e.week.met === "boolean" &&
      object(e.wholeSong) &&
      typeof e.wholeSong.targetBpmMet === "boolean" &&
      Array.isArray(e.wholeSong.recent) &&
      e.wholeSong.recent.every(
        (r) =>
          object(r) &&
          text(r.sessionId) &&
          typeof r.meetsTargetBpm === "boolean",
      ) &&
      object(e.routines) &&
      numeric(e.routines.completedCount)
    );
  });
}
function valid(kind: EditDraftKind, key: string, value: unknown) {
  if (!object(value)) return false;
  if (kind === "expressions") {
    const goal = (v: unknown) =>
      v === null ||
      (object(v) &&
        expressionFields.every(
          ({ key }) => v[key] === undefined || numberOrNull(v[key]),
        ));
    return (
      cid(key) &&
      goal(value.base) &&
      goal(value.draft) &&
      (value.inputs === undefined || isExpressionInputs(value.inputs)) &&
      (value.path === undefined || text(value.path)) &&
      (value.title === undefined || text(value.title)) &&
      (value.pending === undefined ||
        (object(value.pending) &&
          ["unconfirmed", "refresh"].includes(String(value.pending.phase)) &&
          goal(value.pending.goal) &&
          (value.pending.engineId === undefined ||
            text(value.pending.engineId, 256)) &&
          (value.pending.expected === undefined ||
            goal(value.pending.expected))))
    );
  }
  if (kind === "metadata")
    return (
      !!pair(key) &&
      metadata(value.base) &&
      metadata(value.draft) &&
      (value.tagsText === undefined || text(value.tagsText)) &&
      (value.batchId === undefined || text(value.batchId, 128)) &&
      (value.submission === undefined || value.submission === "unconfirmed") &&
      (value.source === undefined ||
        value.source === "practice" ||
        value.source === "library") &&
      (value.refresh === undefined ||
        (object(value.refresh) &&
          (value.refresh.warnings === undefined ||
            (Array.isArray(value.refresh.warnings) &&
              value.refresh.warnings.every((w) => text(w))))))
    );
  if (kind === "annotations") {
    const identity = pair(key);
    return (
      !!identity &&
      annotation(value.base) &&
      annotationText(value.draft) &&
      (value.field === undefined ||
        ["note", "teacher", "next"].includes(String(value.field))) &&
      (value.pending === undefined ||
        (object(value.pending) &&
          ["unconfirmed", "refresh"].includes(String(value.pending.phase)) &&
          annotationText(value.pending.value) &&
          annotation(value.pending.expected) &&
          (value.pending.engineId === undefined ||
            text(value.pending.engineId, 256)))) &&
      (value.entry === undefined || header(value.entry, identity))
    );
  }
  return (
    cid(key) &&
    text(value.path) &&
    text(value.title) &&
    learningBase(value.base) &&
    learning(value.draft) &&
    (value.inputs === undefined || isLearningInputs(value.inputs)) &&
    (value.section === undefined ||
      ["plan", "evidence", "history"].includes(String(value.section))) &&
    (value.pending === undefined ||
      (object(value.pending) &&
        ["unconfirmed", "refresh"].includes(String(value.pending.phase)) &&
        (value.pending.engineId === undefined ||
          text(value.pending.engineId, 256)) &&
        (value.pending.value === null || learning(value.pending.value))))
  );
}

interface Persistence {
  getSnapshot: () => { error: string; pending: boolean };
  subscribe: (listener: () => void) => () => void;
  flush: () => void;
}
class EditDraftMap<V> extends Map<string, V> {
  persistence?: Persistence;
  constructor(
    private change: () => void,
    private activity: () => void,
    readonly editing: Map<string, number>,
    readonly working: Set<string>,
  ) {
    super();
  }
  seed(key: string, value: V) {
    super.set(key, value);
  }
  override set(key: string, value: V): this {
    if (
      this.has(key) &&
      editDraftValue(this.get(key)) === editDraftValue(value)
    )
      return this;
    super.set(key, value);
    this.change();
    return this;
  }
  override delete(key: string) {
    const deleted = super.delete(key);
    if (deleted) this.change();
    return deleted;
  }
  override clear() {
    if (this.size) {
      super.clear();
      this.change();
    }
  }
  open(key: string) {
    this.editing.set(key, (this.editing.get(key) ?? 0) + 1);
    this.activity();
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const count = (this.editing.get(key) ?? 1) - 1;
      if (count > 0) this.editing.set(key, count);
      else this.editing.delete(key);
      this.activity();
    };
  }
  busy(key: string, active: boolean) {
    if (this.working.has(key) === active) return;
    if (active) this.working.add(key);
    else this.working.delete(key);
    this.activity();
  }
}
export const openEditDraft = <V>(
  map: Map<string, V> | undefined,
  key: string,
) => (map instanceof EditDraftMap ? map.open(key) : () => {});
export const busyEditDraft = <V>(
  map: Map<string, V> | undefined,
  key: string,
  busy: boolean,
) => {
  if (map instanceof EditDraftMap) map.busy(key, busy);
};
export const editDraftPersistence = <V>(map: Map<string, V> | undefined) =>
  map instanceof EditDraftMap ? map.persistence : undefined;
export const flushEditDraft = <V>(map: Map<string, V> | undefined) =>
  editDraftPersistence(map)?.flush();
export const isEditDraftBusy = <V>(
  map: Map<string, V> | undefined,
  key: string,
) => map instanceof EditDraftMap && map.working.has(key);

export function createEditDraftStore() {
  let raw: string | null = null,
    blocked = false,
    scheduled = false;
  let snapshot = {
    revision: 0,
    count: 0,
    busy: false,
    pending: false,
    error: "",
  };
  const listeners = new Set<() => void>();
  const active = {
    metadata: new Map<string, number>(),
    annotations: new Map<string, number>(),
    learning: new Map<string, number>(),
    expressions: new Map<string, number>(),
  };
  const working = {
    metadata: new Set<string>(),
    annotations: new Set<string>(),
    learning: new Set<string>(),
    expressions: new Set<string>(),
  };
  const publish = () => {
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      count: kinds.reduce((sum, kind) => sum + maps[kind].size, 0),
      busy: kinds.some((kind) => working[kind].size > 0),
    };
    listeners.forEach((listener) => listener());
  };
  const documentValue = () => ({
    version: 2,
    ...Object.fromEntries(
      kinds.map((kind) => [kind, [...maps[kind].entries()]]),
    ),
  });
  const encode = () => {
    for (const kind of kinds) {
      if (maps[kind].size > 2000)
        throw new Error("暂存记录过多，请复制或处理已有输入后重试");
      for (const [key, value] of maps[kind])
        if (!valid(kind, key, value))
          throw new Error(
            "输入暂存格式或来源身份尚未确认，请复制输入后处理这条记录",
          );
    }
    return JSON.stringify(documentValue(), (_key, value) => {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("输入包含未完成的数值，请修正后重试暂存");
      return value;
    });
  };
  const confirmCurrent = () => {
    if (localStorage.getItem(storageKey) !== raw) {
      blocked = true;
      throw new Error("其他窗口更新了草稿，当前输入与磁盘原文分别保留");
    }
  };
  const flush = () => {
    scheduled = false;
    try {
      if (blocked)
        throw new Error("原草稿尚未恢复，当前输入继续保留在本次会话中");
      confirmCurrent();
      const next = encode();
      if (next.length > limit)
        throw new Error("草稿超过暂存容量，请复制或处理已有草稿后重试");
      confirmCurrent();
      if (next !== raw) localStorage.setItem(storageKey, next);
      raw = next;
      snapshot = { ...snapshot, pending: false, error: "" };
    } catch (error) {
      snapshot = {
        ...snapshot,
        pending: false,
        error: `输入暂存失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    publish();
  };
  const change = () => {
    snapshot = { ...snapshot, pending: true };
    publish();
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        if (scheduled) flush();
      });
    }
  };
  const maps = {
    metadata: new EditDraftMap<MetadataDraft>(
      change,
      publish,
      active.metadata,
      working.metadata,
    ),
    annotations: new EditDraftMap<AnnotationDraft>(
      change,
      publish,
      active.annotations,
      working.annotations,
    ),
    learning: new EditDraftMap<LearningEditDraft>(
      change,
      publish,
      active.learning,
      working.learning,
    ),
    expressions: new EditDraftMap<ExpressionDraft>(
      change,
      publish,
      active.expressions,
      working.expressions,
    ),
  };
  try {
    raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      if (raw.length > limit) throw new Error("原草稿超过暂存容量");
      const value: unknown = JSON.parse(raw, (_key, part) => {
        if (typeof part === "number" && !Number.isFinite(part))
          throw new Error("原草稿包含无效数值");
        return part;
      });
      if (!object(value) || (value.version !== 1 && value.version !== 2))
        throw new Error("原草稿版本无法读取");
      if (value.version === 1 && value.expressions === undefined)
        value.expressions = [];
      // Validate the complete document before installing any of its records.
      for (const kind of kinds) {
        const rows = value[kind];
        if (!Array.isArray(rows) || rows.length > 2000)
          throw new Error("原草稿列表无效");
        const seen = new Set<string>();
        for (const row of rows) {
          if (
            !Array.isArray(row) ||
            row.length !== 2 ||
            !text(row[0]) ||
            seen.has(row[0]) ||
            !valid(kind, row[0], row[1])
          )
            throw new Error("原草稿内容或来源身份无效");
          seen.add(row[0]);
        }
      }
      for (const kind of kinds)
        for (const [key, item] of value[kind] as [string, never][])
          maps[kind].seed(key, item);
    }
  } catch (error) {
    blocked = true;
    snapshot = {
      ...snapshot,
      error: `${error instanceof Error ? error.message : String(error)}。原文已保留。`,
    };
  }
  snapshot = {
    ...snapshot,
    count: kinds.reduce((sum, kind) => sum + maps[kind].size, 0),
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  for (const kind of kinds)
    maps[kind].persistence = { getSnapshot: () => snapshot, subscribe, flush };
  return {
    ...maps,
    getSnapshot: () => snapshot,
    subscribe,
    flush,
    retry: flush,
    isOpen: (kind: EditDraftKind, key: string) =>
      active[kind].has(key) || working[kind].has(key),
    original: () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return raw;
      }
    },
    copy: () => editDraftValue(documentValue()),
    recoveries: () => {
      const prefix = `${storageKey}.recovery.`;
      const entries: { key: string; createdAt: number }[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const createdAt = Number(key.slice(prefix.length));
        if (Number.isSafeInteger(createdAt) && createdAt > 0)
          entries.push({ key, createdAt });
      }
      return entries.sort((a, b) => b.createdAt - a.createdAt);
    },
    recovery: (key: string) => {
      if (!key.startsWith(`${storageKey}.recovery.`))
        throw new Error("原文副本来源无法确认。");
      const value = localStorage.getItem(key);
      if (value === null) throw new Error("这份原文副本已无法读取。");
      return value;
    },
    preserveAndSave: () => {
      try {
        const previous = localStorage.getItem(storageKey);
        if (previous !== null) {
          let stamp = Date.now();
          while (
            localStorage.getItem(`${storageKey}.recovery.${stamp}`) !== null
          )
            stamp++;
          localStorage.setItem(`${storageKey}.recovery.${stamp}`, previous);
        }
        raw = previous;
        blocked = false;
        flush();
      } catch (error) {
        snapshot = {
          ...snapshot,
          error: `原文副本保存失败，当前输入与原文已保留：${String(error)}`,
        };
        publish();
      }
    },
  };
}
export type EditDraftStore = ReturnType<typeof createEditDraftStore>;
