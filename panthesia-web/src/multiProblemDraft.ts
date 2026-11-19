import { registerCloseParticipant } from "./app/closePreparation";
export type DraftSource = { contentId: string; id: string; slot: number; revision?: string };

const prefix = "neothesia-multi-plan-draft:";
const unit = 1_000_000;
type SavedChoice = [string, string, number];

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

// A failed browser write must not discard a draft when its source scope changes.
// Raw unreadable values remain untouched until the user explicitly replaces them.
const sessionDrafts = new Map<string, string>();
const protectedDrafts = new Map<string, string>();
const inspected = new Set<string>();
const unwritten = new Set<string>();
registerCloseParticipant("multi-problem-drafts", { label: "复习编排草稿", pending: () => unwritten.size ? "有复习编排尚未暂存，原选择与输入只保留在当前运行中，可返回重试或复制。" : null });
const read = (key: string): Record<string, unknown> | null => {
  const current = sessionDrafts.get(key);
  if (current !== undefined) return object(JSON.parse(current));
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
    inspected.add(key);
  } catch { return null; }
  if (raw === null) return null;
  try {
    const value = object(JSON.parse(raw));
    if (!value) throw new Error("invalid draft");
    return value;
  } catch {
    protectedDrafts.set(key, raw);
    return null;
  }
};
export const originalMultiProblemDraft = (key: string): string | null =>
  protectedDrafts.get(key) ?? null;

export function writeMultiProblemDraft(key: string, payload: string, replace = false) {
  unwritten.add(key);
  // Cache first. Even a storage failure retains the exact source identities,
  // choices and edits for a later remount in the same application session.
  sessionDrafts.set(key, payload);
  if (!inspected.has(key)) {
    const raw = localStorage.getItem(key);
    inspected.add(key);
    if (raw !== null) protectedDrafts.set(key, raw);
  }
  if (protectedDrafts.has(key) && !replace)
    throw new Error("旧草稿尚未载入，原始内容已保留。可复制原文，或明确使用当前编排替换。");
  localStorage.setItem(key, payload);
  protectedDrafts.delete(key);
  unwritten.delete(key);
}

export const draftScopeFor = (sources: DraftSource[]): string =>
  JSON.stringify(sources.map(({ contentId, id }) => [contentId, id]));

export const draftKeyFor = (scope: string): string => `${prefix}${scope}`;

export const choicesForStorage = (chosen: number[], sources: DraftSource[]): SavedChoice[] =>
  chosen.flatMap((value) => {
    const slot = Math.floor(value / unit);
    const reference = value - slot * unit;
    const source = sources.find((item) => item.slot === slot);
    return source && Number.isSafeInteger(reference) && reference >= 0 && reference < unit
      ? [[source.contentId, source.id, reference] as SavedChoice]
      : [];
  });

const currentChoices = (saved: unknown, sources: DraftSource[]): number[] =>
  Array.isArray(saved)
    ? saved.flatMap((value): number[] => {
      if (!Array.isArray(value) || value.length !== 3) return [];
      const [contentId, id, reference] = value;
      const source = sources.find((item) => item.contentId === contentId && item.id === id);
      const combined = source ? source.slot * unit + reference : NaN;
      return source && Number.isSafeInteger(reference) && reference >= 0 && reference < unit && Number.isSafeInteger(combined)
        ? [combined]
        : [];
    })
    : [];

const oldChoices = (saved: unknown, oldSources: unknown, sources: DraftSource[]): number[] => {
  if (!Array.isArray(saved) || !Array.isArray(oldSources)) return [];
  return saved.flatMap((value): number[] => {
    if (!Number.isSafeInteger(value) || value < 0) return [];
    const oldSlot = Math.floor(value / unit);
    const sourceRow = oldSources.find((item) =>
      Array.isArray(item) && item.length === 3 && item[2] === oldSlot);
    if (!sourceRow) return [];
    const source = sources.find((item) => item.contentId === sourceRow[0] && item.id === sourceRow[1]);
    const combined = source ? source.slot * unit + value % unit : NaN;
    return Number.isSafeInteger(combined) ? [combined] : [];
  });
};

export const readMultiProblemDraft = (sources: DraftSource[]): Record<string, unknown> => {
  const scope = draftScopeFor(sources);
  const saved = read(draftKeyFor(scope));
  if (saved) return { ...saved, chosen: currentChoices(saved.chosenRefs, sources) };

  let fallback: Record<string, unknown> | null = null;
  let fallbackSources: unknown = null;
  let exactSlots = false;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let rows: unknown;
      try { rows = JSON.parse(key.slice(prefix.length)); } catch { continue; }
      if (!Array.isArray(rows) || rows.length !== sources.length ||
        !rows.every((row, position) => Array.isArray(row) && row.length === 3 &&
          row[0] === sources[position].contentId && row[1] === sources[position].id)) continue;
      const candidate = read(key);
      if (!candidate) continue;
      const isExact = rows.every((row, position) => row[2] === sources[position].slot);
      if (!fallback || (isExact && !exactSlots) || (!exactSlots && isExact === exactSlots &&
        (Array.isArray(candidate.chosen) ? candidate.chosen.length : 0) >
        (Array.isArray(fallback.chosen) ? fallback.chosen.length : 0))) {
        fallback = candidate;
        fallbackSources = rows;
        exactSlots = isExact;
      }
    }
  } catch {
    // A malformed old key does not invalidate a correctly saved draft.
  }
  return fallback
    ? { ...fallback, chosen: oldChoices(fallback.chosen, fallbackSources, sources) }
    : {};
};
