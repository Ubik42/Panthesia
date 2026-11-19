import {
  HandSpanProfileValues,
  type HandSpanProfile,
  type PlanResult,
  type Proposal,
} from "../../engine/commands.generated";
import type { LoadedSong, Note } from "../../api";

export type FingeringResult = PlanResult & { proposals: Proposal[] };
export type FingeringSection = "setup" | "plans" | "acceptance";
export type FingeringReceipt = "saved" | "undone" | "saving" | "undoing";
export interface FingeringForm {
  track: number;
  hand: "left" | "right";
  profile: HandSpanProfile;
  scope: "note" | "range";
  first: number;
  last: number;
  firstText?: string;
  lastText?: string;
  keepSaved: boolean;
  practiceRate: number;
  additionalTracks: number[];
}
export interface FingeringDraft {
  key: string;
  contentId: string;
  title: string;
  path: string;
  source: string;
  origin: { track: number; index: number } | null;
  start: number;
  end: number;
  form: FingeringForm;
  values: Record<string, number>;
  pins: Record<string, number>;
  selection: { track: number; index: number }[] | null;
  receipt: FingeringReceipt | null;
  section: FingeringSection;
  page: number;
  planIndex: number;
  preview: number;
  updatedAt: number;
}
export const fingeringSource = (song: LoadedSong) =>
  JSON.stringify([
    song.engineId ?? null,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision ?? 0,
  ]);
export const fingeringDraftKey = (
  contentId: string,
  note: Pick<Note, "track" | "index"> | null,
  start: number,
  end: number,
) =>
  JSON.stringify([
    contentId,
    note?.track ?? null,
    note?.index ?? null,
    start,
    end,
  ]);
export const fingeringDraftId = (row: FingeringDraft) =>
  JSON.stringify([
    row.key,
    row.source,
    row.form.track,
    row.form.hand,
    row.form.profile,
    row.form.scope,
    row.form.first,
    row.form.last,
    row.form.keepSaved,
    row.form.practiceRate,
    [...row.form.additionalTracks].sort((a, b) => a - b),
  ]);
const storageKey = "neothesia.fingering-workbench.v1";
const limit = 2_000_000;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 32768): value is string =>
  typeof value === "string" && value.length <= max;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const pins = (value: unknown) =>
  object(value) &&
  Object.keys(value).length <= 20000 &&
  Object.entries(value).every(
    ([key, finger]) =>
      /^\d+:\d+$/.test(key) &&
      Number.isInteger(finger) &&
      Number(finger) >= 1 &&
      Number(finger) <= 5,
  );
function valid(value: unknown): value is FingeringDraft {
  if (!object(value) || !object(value.form)) return false;
  const form = value.form;
  return (
    text(value.key, 512) &&
    text(value.contentId, 256) &&
    text(value.title) &&
    text(value.path) &&
    text(value.source, 1024) &&
    (value.origin === null ||
      (object(value.origin) &&
        integer(value.origin.track) &&
        integer(value.origin.index))) &&
    [
      value.start,
      value.end,
      form.track,
      form.first,
      form.last,
      value.page,
      value.planIndex,
      value.preview,
    ].every(integer) &&
    ["left", "right"].includes(String(form.hand)) &&
    HandSpanProfileValues.some((profile) => profile === form.profile) &&
    ["note", "range"].includes(String(form.scope)) &&
    typeof form.keepSaved === "boolean" &&
    (form.firstText === undefined || text(form.firstText, 16)) &&
    (form.lastText === undefined || text(form.lastText, 16)) &&
    typeof form.practiceRate === "number" &&
    Number.isFinite(form.practiceRate) &&
    form.practiceRate >= 0.25 &&
    form.practiceRate <= 2 &&
    Array.isArray(form.additionalTracks) &&
    form.additionalTracks.length <= 256 &&
    form.additionalTracks.every(integer) &&
    pins(value.values) &&
    pins(value.pins) &&
    (value.selection === null ||
      (Array.isArray(value.selection) &&
        value.selection.length <= 20000 &&
        value.selection.every(
          (note) => object(note) && integer(note.track) && integer(note.index),
        ))) &&
    [null, "saved", "undone", "saving", "undoing"].includes(
      value.receipt as null | string,
    ) &&
    ["setup", "plans", "acceptance"].includes(String(value.section)) &&
    integer(value.updatedAt) &&
    value.key ===
      fingeringDraftKey(
        value.contentId,
        value.origin as FingeringDraft["origin"],
        Number(value.start),
        Number(value.end),
      )
  );
}

/** Small inputs persist; generated proposals remain an optional bounded session cache. */
export function createFingeringWorkbenchStore() {
  let raw: string | null = null,
    blocked = false,
    error = "";
  const rows = new Map<string, FingeringDraft>();
  const cache = new Map<string, { source: string; result: FingeringResult }>();
  const listeners = new Set<() => void>();
  let snapshot: { rows: readonly FingeringDraft[]; error: string } = {
    rows: [],
    error: "",
  };
  const publish = () => {
    snapshot = {
      rows: [...rows.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
      error,
    };
    for (const listener of [...listeners]) listener();
  };
  try {
    raw = localStorage.getItem(storageKey);
    if (raw) {
      if (raw.length > limit)
        throw new Error("指法输入超过暂存容量，原文继续保留。");
      const saved: unknown = JSON.parse(raw);
      if (
        !object(saved) ||
        saved.version !== 1 ||
        !Array.isArray(saved.rows) ||
        saved.rows.length > 128 ||
        !saved.rows.every(valid)
      )
        throw new Error("指法输入格式无法读取，原文继续保留。");
      for (const row of saved.rows) {
        const id = fingeringDraftId(row);
        if (rows.has(id))
          throw new Error("指法输入包含重复记录，原文继续保留。");
        rows.set(id, row);
      }
    }
  } catch (failure) {
    blocked = true;
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const save = () => {
    try {
      if (blocked)
        throw new Error("旧输入需要核对，当前修改保留在本次运行中。");
      if (localStorage.getItem(storageKey) !== raw) {
        blocked = true;
        throw new Error("另一窗口已更新指法输入，当前修改与原文继续保留。");
      }
      const next = JSON.stringify({ version: 1, rows: [...rows.values()] });
      if (rows.size > 128 || next.length > limit)
        throw new Error("指法输入已到暂存容量，请复制或移除已处理的输入。");
      if (next !== raw) localStorage.setItem(storageKey, next);
      raw = next;
      error = "";
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    publish();
  };
  publish();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (key: string) =>
      [...rows.values()]
        .filter((row) => row.key === key)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0],
    cached: (row: FingeringDraft, source: string) => {
      const entry = cache.get(fingeringDraftId(row));
      return entry?.source === source ? entry.result : undefined;
    },
    remember(row: FingeringDraft, result: FingeringResult | null) {
      if (!valid(row)) {
        error = "当前指法输入含有未完成数值，请修正后暂存，或复制当前输入。";
        publish();
        return;
      }
      const id = fingeringDraftId(row);
      if (result && !row.receipt) {
        cache.delete(id);
        cache.set(id, { source: row.source, result });
        while (cache.size > 8) cache.delete(cache.keys().next().value!);
      } else cache.delete(id);
      const previous = rows.get(id);
      if (
        previous &&
        JSON.stringify({ ...previous, updatedAt: 0 }) ===
          JSON.stringify({ ...row, updatedAt: 0 })
      )
        return;
      if (
        !result &&
        !row.receipt &&
        row.selection === null &&
        !Object.keys(row.pins).length
      ) {
        for (const [oldId, old] of rows)
          if (
            oldId !== id &&
            old.key === row.key &&
            old.source === row.source &&
            !old.receipt &&
            old.selection === null &&
            !Object.keys(old.pins).length &&
            !cache.has(oldId)
          )
            rows.delete(oldId);
      }
      rows.set(id, row);
      save();
    },
    remove(key: string) {
      cache.delete(key);
      if (rows.delete(key)) save();
    },
    retry: save,
    original: () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return raw;
      }
    },
    preserveAndSave() {
      try {
        const original = localStorage.getItem(storageKey);
        if (original)
          localStorage.setItem(
            `${storageKey}.preserved.${Date.now()}.${crypto.randomUUID()}`,
            original,
          );
        raw = original;
        blocked = false;
        save();
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
        publish();
      }
    },
  };
}
export type FingeringWorkbenchStore = ReturnType<
  typeof createFingeringWorkbenchStore
>;
