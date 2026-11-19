export type ReviewSource = {
  contentId: string;
  id: string;
  title: string;
  recordedAt: number;
  slot: number;
};
const storageKey = "neothesia-review-sources";
let inspected = false;
let protectedRaw: string | null = null;
export const originalReviewSources = () => protectedRaw;
export function readReviewSources(): ReviewSource[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
    inspected = true;
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) throw new Error("invalid source list");
    const restored: ReviewSource[] = [],
      seen = new Set<string>();
    let incomplete = false;
    for (const value of saved) {
      if (!value || typeof value !== "object") {
        incomplete = true;
        continue;
      }
      const source = value as Partial<ReviewSource>;
      if (
        typeof source.contentId !== "string" ||
        !/^[a-f0-9]{64}$/.test(source.contentId) ||
        typeof source.id !== "string" ||
        !source.id ||
        typeof source.title !== "string" ||
        typeof source.recordedAt !== "number" ||
        !Number.isFinite(source.recordedAt)
      ) {
        incomplete = true;
        continue;
      }
      const identity = JSON.stringify([source.contentId, source.id]);
      if (seen.has(identity)) continue;
      if (restored.length === 20) {
        incomplete = true;
        continue;
      }
      seen.add(identity);
      restored.push({
        contentId: source.contentId,
        id: source.id,
        title: source.title,
        recordedAt: source.recordedAt,
        slot: restored.length,
      });
    }
    if (incomplete) protectedRaw = raw;
    return restored;
  } catch {
    protectedRaw = raw;
    return [];
  }
}
export function writeReviewSources(sources: ReviewSource[], replace = false) {
  if (!inspected) {
    const raw = localStorage.getItem(storageKey);
    inspected = true;
    if (raw !== null) protectedRaw = raw;
  }
  if (protectedRaw !== null && !replace)
    throw new Error(
      "旧来源列表未完整读取，原文已保留。当前列表保留在本次会话中。",
    );
  localStorage.setItem(storageKey, JSON.stringify(sources));
  protectedRaw = null;
}
