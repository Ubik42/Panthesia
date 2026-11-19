import type { CollectionSong, SongRow } from "../../api";
import type { LibraryOpenLocation } from "../library/libraryOpen";

export type PracticeLibraryTab = "all" | "favorites" | "recent" | "queue";
export interface PracticeLibraryBrowse {
  tab: PracticeLibraryTab;
  query: string;
  source: string;
  page: number;
  focusedKey: string | null;
}
export const practiceLibraryDefaults = (): PracticeLibraryBrowse => ({
  tab: "all",
  query: "",
  source: "",
  page: 0,
  focusedKey: null,
});
export const practicePathKey = (path: string | null | undefined) =>
  (path ?? "").replaceAll("\\", "/").toLowerCase();
export function practiceCollectionByPath(
  collection: readonly CollectionSong[],
) {
  const records = new Map<string, CollectionSong>();
  const used = (record: CollectionSong) =>
    Math.max(record.lastUsed, record.lastPracticed ?? 0);
  for (const record of collection) {
    const path =
      record.path || (record.generated ? `exercise:${record.contentId}` : null);
    if (!path) continue;
    const key = practicePathKey(path),
      previous = records.get(key);
    // A replaced MIDI can leave several historical identities at one path.
    // Prefer the available identity, then the most recently used record.
    if (
      !previous ||
      (record.available && !previous.available) ||
      (record.available === previous.available && used(record) > used(previous))
    )
      records.set(key, record);
  }
  return records;
}
export interface PracticeLibraryItem {
  key: string;
  row: SongRow;
  record?: CollectionSong;
  contentId?: string;
  title: string;
  subtitle: string;
  location: LibraryOpenLocation;
  search: string;
}
const searchText = (row: SongRow, title: string) =>
  `${title} ${row.title} ${row.composer} ${row.source} ${row.category} ${(row.tags ?? []).join(" ")} ${row.difficulty ?? ""}`.toLocaleLowerCase();
export function collectionSongRow(record: CollectionSong): SongRow {
  return {
    id: `recent/${record.contentId}`,
    title: record.title,
    composer: record.generated ? "技术练习" : "本地导入",
    source: record.generated ? "技术练习" : "本地导入",
    category: "",
    license: "请确认文件使用权限",
    sourceUrl: "",
    path:
      record.path || (record.generated ? `exercise:${record.contentId}` : ""),
    contentId: record.contentId,
  };
}
export function practiceLibraryIndex(
  rows: readonly SongRow[],
  collection: readonly CollectionSong[],
) {
  const byContent = new Map(
    collection.map((record) => [record.contentId, record]),
  );
  const byPath = practiceCollectionByPath(collection);
  const items: PracticeLibraryItem[] = [];
  const locations = new Set<string>();
  for (const row of rows) {
    const key = practicePathKey(row.path);
    if (locations.has(key)) continue;
    locations.add(key);
    const record = row.contentId
      ? byContent.get(row.contentId)
      : byPath.get(key);
    items.push({
      key,
      row,
      record,
      contentId: row.contentId ?? record?.contentId,
      title: record?.title || row.title,
      subtitle: row.composer || row.source || "本地曲目",
      location: "selected",
      search: searchText(row, record?.title || row.title),
    });
  }
  const byItemPath = new Map(items.map((item) => [item.key, item]));
  const byItemContent = new Map<string, PracticeLibraryItem>();
  for (const item of items)
    if (item.contentId && !byItemContent.has(item.contentId))
      byItemContent.set(item.contentId, item);
  const recents = collection.map((record) => {
    const preferred = byItemPath.get(practicePathKey(record.path));
    const chosen =
      preferred?.contentId === record.contentId
        ? preferred
        : byItemContent.get(record.contentId);
    const row = chosen?.row ?? collectionSongRow(record);
    return {
      key: record.contentId,
      row,
      record,
      contentId: record.contentId,
      title: record.title || row.title,
      subtitle: chosen?.subtitle || row.composer,
      location: "recent" as const,
      search: searchText(row, record.title || row.title),
    };
  });
  return { items, recents };
}
export type PracticeLibraryIndex = ReturnType<typeof practiceLibraryIndex>;
export function practiceLibraryView(
  index: PracticeLibraryIndex,
  browse: PracticeLibraryBrowse,
) {
  const used = (item: PracticeLibraryItem) =>
    !!(item.record?.lastUsed || item.record?.lastPracticed);
  const pool =
    browse.tab === "all"
      ? index.items
      : index.recents.filter((item) =>
          browse.tab === "favorites"
            ? item.record?.favorite
            : browse.tab === "queue"
              ? item.record?.queuePosition != null
              : used(item),
        );
  const counts = {
    all: index.items.length,
    favorites: index.recents.filter((item) => item.record?.favorite).length,
    recent: index.recents.filter(used).length,
    queue: index.recents.filter((item) => item.record?.queuePosition != null)
      .length,
  };
  const sources = [
    ...new Set(pool.map((item) => item.row.source).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const tokens = browse.query
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const items = pool.filter(
    (item) =>
      (!browse.source || item.row.source === browse.source) &&
      tokens.every((token) => item.search.includes(token)),
  );
  if (browse.tab === "queue")
    items.sort(
      (a, b) => (a.record?.queuePosition ?? 0) - (b.record?.queuePosition ?? 0),
    );
  if (browse.tab === "recent")
    items.sort(
      (a, b) =>
        Math.max(b.record?.lastUsed ?? 0, b.record?.lastPracticed ?? 0) -
        Math.max(a.record?.lastUsed ?? 0, a.record?.lastPracticed ?? 0),
    );
  return { items, sources, counts, total: pool.length };
}
export function isPracticeLibraryCurrent(
  item: PracticeLibraryItem,
  current:
    | { contentId: string; path?: string | null; generated?: boolean }
    | null
    | undefined,
) {
  if (!current) return false;
  if (item.location === "recent") return item.contentId === current.contentId;
  return (
    item.contentId === current.contentId &&
    (practicePathKey(item.row.path) === practicePathKey(current.path) ||
      (current.generated && item.row.path === `exercise:${current.contentId}`))
  );
}
