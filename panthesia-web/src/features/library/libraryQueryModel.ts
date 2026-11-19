import { parseSongSearch, matchesSongSearch } from "./songSearch";
import type { CollectionSong, SongRow } from "../../engine/sessionTypes";
import type { Metadata } from "./metadataTypes";
export type { Metadata } from "./metadataTypes";
export type Entry = {
  path: string;
  contentId: string | null;
  metadata: Metadata;
  groups: string[];
  rating: number;
  hasScore: boolean;
  notationCount?: number;
  paperCount?: number;
  paperNames?: string[];
  scoreName: string | null;
  notes: number;
  duration: number;
  tracks: number;
  measures: number;
  meter: string;
  available: boolean;
  error: string | null;
  size: number;
};
export const key = (p: string) => p.replaceAll("\\", "/").toLowerCase();
export const fields = [
  "all",
  "title",
  "composer",
  "arranger",
  "artist",
  "collection",
  "tags",
  "difficulty",
  "notes",
  "path",
  "source",
] as const;
export type Field = (typeof fields)[number];
export type View = {
  query: string;
  field: Field;
  filter: string;
  sort: string;
  direction: "asc" | "desc";
  minRating: number;
  minDuration: string;
  maxDuration: string;
  practice: string;
  learning: string;
};
export const defaults: View = {
  query: "",
  field: "all",
  filter: "all",
  sort: "title",
  direction: "asc",
  minRating: 0,
  minDuration: "",
  maxDuration: "",
  practice: "all",
  learning: "all",
};
/** Scalar ordering survives restoring a view through a different object serializer. */
export const libraryViewKey = (view: View) => [
  view.query,
  view.field,
  view.filter,
  view.sort,
  view.direction,
  view.minRating,
  view.minDuration,
  view.maxDuration,
  view.practice,
  view.learning,
];
export const terms = parseSongSearch;
export function matches(
  r: SongRow,
  e: Entry | undefined,
  field: Field,
  tokens: ReturnType<typeof terms>,
) {
  const m = e?.metadata,
    f = {
      title: m?.title ?? r.title,
      composer: m?.composer ?? r.composer,
      arranger: m?.arranger ?? r.arranger ?? "",
      artist: m?.artist ?? "",
      collection: m?.collection ?? "",
      tags: (m?.tags ?? r.tags ?? []).join(" "),
      difficulty: m?.difficulty ?? r.difficulty ?? "",
      notes: m?.notes ?? "",
      path: r.path,
      source: `${r.source} ${r.category}`,
    };
  return matchesSongSearch(f, tokens, field);
}
export function compare(
  a: SongRow,
  b: SongRow,
  x: Entry | undefined,
  y: Entry | undefined,
  h: CollectionSong | undefined,
  j: CollectionSong | undefined,
  sort: string,
  direction: "asc" | "desc",
) {
  const value = (
    r: SongRow,
    e: Entry | undefined,
    c: CollectionSong | undefined,
  ): string | number | null => {
    switch (sort) {
      case "composer":
        return e?.metadata.composer ?? r.composer;
      case "difficulty":
        return e?.metadata.difficulty ?? r.difficulty ?? null;
      case "rating":
        return e?.rating ?? r.rating ?? 0;
      case "duration":
        return e?.contentId ? e.duration : null;
      case "measures":
        return e?.contentId ? e.measures : null;
      case "notes":
        return e?.contentId ? e.notes : null;
      case "lastUsed":
        return c?.lastPracticed || null;
      case "sessions":
        return c?.sessions ?? 0;
      case "path":
        return r.path;
      default:
        return e?.metadata.title ?? r.title;
    }
  };
  const left = value(a, x, h),
    right = value(b, y, j);
  if (left == null || right == null) {
    if (left !== right) return left == null ? 1 : -1;
  } else {
    const n =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "zh", { numeric: true });
    if (n) return direction === "asc" ? n : -n;
  }
  return (
    (x?.metadata.title ?? a.title).localeCompare(
      y?.metadata.title ?? b.title,
      "zh",
      { numeric: true },
    ) || key(a.path).localeCompare(key(b.path))
  );
}
