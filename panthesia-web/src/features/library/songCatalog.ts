import type { SongRow, CollectionSong } from "../../api";
import type { CatalogPerformance } from "../../engine/commands.generated";
import { pathKey as libraryPath } from "../../engine/pathIdentity";

export interface BrowserPerformance {
  id: string;
  contentId?: string;
  label: string;
  locations: SongRow[];
  notationCount: number;
  record?: CollectionSong;
}
export interface BrowserSong {
  id: string;
  title: string;
  composer: string;
  performances: BrowserPerformance[];
  lastUsed: number;
  lastPracticed: number;
  practiceCount: number;
  completeVersions: number;
  practiceStage: "new" | "practiced" | "whole";
}
export type CatalogIndex = ReadonlyMap<string, CatalogPerformance>;
export const songKey = (row: SongRow, index: CatalogIndex) =>
  (row.contentId && index.get(row.contentId)?.workId) ||
  `performance:${row.contentId || libraryPath(row.path)}`;
export function groupSongs(
  rows: readonly SongRow[],
  index: CatalogIndex,
  record?: (row: SongRow) => CollectionSong | undefined,
): BrowserSong[] {
  const songs = new Map<string, BrowserSong>(),
    performances = new Map<string, BrowserPerformance>();
  const locations = new Set<string>();
  for (const row of rows) {
    const identity = row.contentId ? index.get(row.contentId) : undefined;
    const key = songKey(row, index);
    let song = songs.get(key);
    if (!song) {
      song = {
        id: key,
        title:
          identity?.title && identity.title !== "未命名作品"
            ? identity.title
            : row.title,
        composer: identity?.composer || row.composer,
        performances: [],
        lastUsed: 0,
        lastPracticed: 0,
        practiceCount: 0,
        completeVersions: 0,
        practiceStage: "new",
      };
      songs.set(key, song);
    }
    song.lastUsed = Math.max(song.lastUsed, record?.(row)?.lastUsed ?? 0);
    const performanceId = row.contentId || libraryPath(row.path);
    let performance = performances.get(performanceId);
    if (!performance) {
      performance = {
        id: performanceId,
        contentId: row.contentId ?? undefined,
        label:
          identity?.label && identity.label !== "未命名作品"
            ? identity.label
            : row.title,
        locations: [],
        notationCount: identity?.notationCount ?? 0,
        record: record?.(row),
      };
      performances.set(performanceId, performance);
      song.performances.push(performance);
    }
    const locationKey = `${performanceId}\n${libraryPath(row.path)}`;
    if (!locations.has(locationKey)) {
      locations.add(locationKey);
      performance.locations.push(row);
    }
  }
  for (const song of songs.values()) {
    for (const performance of song.performances) {
      const history = performance.record;
      song.lastPracticed = Math.max(
        song.lastPracticed,
        history?.lastPracticed ?? 0,
      );
      song.practiceCount += history?.sessions ?? 0;
      song.completeVersions += history?.practice?.whole ? 1 : 0;
    }
  }
  for (const song of songs.values()) {
    song.practiceStage =
      song.completeVersions > 0
        ? "whole"
        : song.lastPracticed > 0
          ? "practiced"
          : "new";
  }
  return [...songs.values()];
}
export function songLocation(song: BrowserSong, preferred: string): SongRow {
  const path = libraryPath(preferred);
  for (const performance of song.performances) {
    const exact = performance.locations.find(
      (row) => libraryPath(row.path) === path,
    );
    if (exact) return exact;
  }
  const recent = [...song.performances].sort(
    (a, b) => (b.record?.lastPracticed ?? 0) - (a.record?.lastPracticed ?? 0),
  );
  return recent[0].locations[0];
}
