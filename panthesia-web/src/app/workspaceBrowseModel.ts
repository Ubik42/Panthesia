import type {
  LibraryBrowse,
  LibraryVisitReturn,
} from "../features/library/libraryBrowse";
import { fields, key as libraryPathKey, type View } from "../features/library/libraryQueryModel";
import {
  practiceLibraryDefaults,
  type PracticeLibraryBrowse,
} from "../features/practice/practiceLibraryModel";
import type { SongWorkspaceTarget } from "./songWorkspaceVisit";

type LibraryCursor = Omit<LibraryBrowse, "editing" | "visitReturn"> & {
  visitReturn?: Omit<LibraryVisitReturn, "editing"> | null;
};
export interface WorkspaceBrowseState {
  version: 1;
  busy: boolean;
  storageError: string;
  issues: Record<"library" | "practice" | "navigation", string>;
  returnWorkspace: "library" | "review" | null;
  library: LibraryCursor | null;
  practice: PracticeLibraryBrowse;
  practiceScroll: { key: string; top: number } | null;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("浏览位置结构无法读取");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 4096): string => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("浏览位置文字无效");
  return value;
};
const number = (value: unknown, max = 1_000_000_000): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  )
    throw new Error("浏览位置数值无效");
  return value;
};
const timestamp = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Math.abs(value) > 8_640_000_000_000_000
  )
    throw new Error("浏览日期无效");
  return value;
};
const integer = (value: unknown, max?: number) => {
  const next = number(value, max);
  if (!Number.isSafeInteger(next)) throw new Error("浏览页码无效");
  return next;
};
const bool = (value: unknown, fallback = false): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("浏览开关无效");
  return value;
};
const optionalText = (value: unknown, max = 32768) =>
  value == null ? undefined : text(value, max);
const choice = <const T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback?: T,
): T => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new Error("浏览选项无法读取");
  return value as T;
};
const identity = (value: unknown) => {
  const next = text(value, 256);
  if (!next) throw new Error("浏览来源编号缺失");
  return next;
};
const workspace = (value: unknown) =>
  value == null
    ? undefined
    : choice(value, ["library", "practice", "review"] as const);
const pane = (value: unknown) =>
  value == null ? undefined : choice(value, ["list", "detail"] as const);
function song(value: unknown): SongWorkspaceTarget | null {
  if (value == null) return null;
  const row = object(value);
  return {
    contentId: identity(row.contentId),
    title: text(row.title, 16384),
    path: row.path == null ? null : text(row.path, 32768),
  };
}
function view(value: unknown): View {
  const row = object(value);
  return {
    query: text(row.query),
    field: choice(row.field, fields),
    filter: choice(row.filter, [
      "all",
      "score",
      "missing",
      "duplicates",
      "unindexed",
      "errors",
    ]),
    sort: choice(row.sort, [
      "title",
      "composer",
      "difficulty",
      "rating",
      "duration",
      "lastUsed",
      "sessions",
      "measures",
      "notes",
      "path",
      "learningStage",
      "learningDue",
    ]),
    direction: choice(row.direction, ["asc", "desc"]),
    minRating: integer(row.minRating, 5),
    minDuration: text(row.minDuration, 64),
    maxDuration: text(row.maxDuration, 64),
    practice: choice(row.practice, [
      "all",
      "played",
      "unplayed",
      "favorite",
      "review",
    ]),
    learning: choice(row.learning, [
      "all",
      "untracked",
      "planned",
      "learning",
      "polishing",
      "maintaining",
      "mastered",
      "paused",
      "overdue",
      "today",
    ]),
  };
}
function libraryBase(value: unknown, requireSelection = false): LibraryCursor {
  const row = object(value);
  const selected = requireSelection ? row.selected : (row.selected ?? []);
  if (!Array.isArray(selected) || selected.length > 5000)
    throw new Error("已选曲目过多，浏览位置暂未保存");
  const review =
    row.selectionReview == null ? undefined : object(row.selectionReview);
  return {
    view: view(row.view),
    page: integer(row.page),
    group: text(row.group, 1024),
    recordings: bool(row.recordings),
    active: row.active == null ? null : libraryPathKey(text(row.active, 32768)),
    selected: [
      ...new Set(selected.map((value) => libraryPathKey(text(value, 32768)))),
    ],
    selectionOnly: bool(row.selectionOnly),
    advancedOpen: bool(row.advancedOpen),
    top: number(row.top),
    topKey: optionalText(row.topKey),
    detailTop: row.detailTop == null ? undefined : number(row.detailTop),
    detailTopKey: optionalText(row.detailTopKey),
    pane: pane(row.pane),
    detailSection: choice(
      row.detailSection,
      ["overview", "scores", "files"],
      "overview",
    ),
    groupsOpen: bool(row.groupsOpen),
    filtersOpen: bool(row.filtersOpen),
    batchOpen: bool(row.batchOpen),
    song: song(row.song),
    visitFrom: workspace(row.visitFrom),
    transient: bool(row.transient),
    selectionReview: review
      ? {
          query: text(review.query),
          page: integer(review.page),
          expanded: bool(review.expanded),
          top: number(review.top),
          topKey: optionalText(review.topKey),
        }
      : undefined,
  };
}
export function packLibraryBrowse(value: LibraryBrowse): LibraryCursor {
  return readLibraryCursor(value);
}
function readLibraryCursor(value: unknown): LibraryCursor {
  const row = object(value);
  const cursor = libraryBase(row, true);
  if (row.visitReturn != null) {
    const visit = object(row.visitReturn);
    const {
      selected: _selected,
      selectionReview: _selectionReview,
      ...previous
    } = libraryBase(visit);
    cursor.visitReturn = {
      ...previous,
      query: text(visit.query),
      selectionOnly: previous.selectionOnly ?? false,
      transient: previous.transient ?? false,
      advancedOpen: previous.advancedOpen ?? false,
      focus:
        visit.focus == null
          ? undefined
          : choice(visit.focus, ["missing", "review"]),
    };
  }
  return cursor;
}
export function readPracticeBrowse(value: unknown): PracticeLibraryBrowse {
  const row = object(value);
  return {
    tab: choice(row.tab, ["all", "favorites", "recent", "queue"]),
    query: text(row.query),
    source: text(row.source, 32768),
    page: integer(row.page),
    focusedKey: row.focusedKey == null ? null : text(row.focusedKey, 32768),
  };
}
export const freshWorkspaceBrowse = (): WorkspaceBrowseState => ({
  version: 1,
  busy: false,
  storageError: "",
  issues: { library: "", practice: "", navigation: "" },
  returnWorkspace: null,
  library: null,
  practice: practiceLibraryDefaults(),
  practiceScroll: null,
});
/** Restore independent locations while preserving the complete original on any failure. */
export function restoreWorkspaceBrowse(
  raw: string | null,
): WorkspaceBrowseState {
  const state = freshWorkspaceBrowse();
  if (!raw) return state;
  try {
    if (raw.length > 1_000_000) throw new Error();
    const row = object(JSON.parse(raw));
    if (
      row.version !== 1 ||
      Object.keys(row).some(
        (key) =>
          ![
            "version",
            "issues",
            "returnWorkspace",
            "library",
            "history",
            "practice",
            "practiceScroll",
          ].includes(key),
      )
    )
      throw new Error();
    const failed: string[] = [];
    const restore = (label: string, read: () => void) => {
      try {
        read();
      } catch {
        failed.push(label);
      }
    };
    restore("暂存说明", () => {
      const issues = row.issues == null ? {} : object(row.issues);
      state.issues = {
        library: issues.library == null ? "" : text(issues.library),
        practice: issues.practice == null ? "" : text(issues.practice),
        navigation: issues.navigation == null ? "" : text(issues.navigation),
      };
    });
    restore("曲库", () => {
      if (row.library == null) return;
      const library = object(row.library);
      if (
        "editing" in library ||
        (library.visitReturn && "editing" in object(library.visitReturn))
      )
        throw new Error();
      state.library = readLibraryCursor(library);
    });
    restore("练习选曲", () => {
      state.practice = readPracticeBrowse(row.practice);
    });
    restore("选曲列表位置", () => {
      if (row.practiceScroll == null) return;
      const scroll = object(row.practiceScroll);
      state.practiceScroll = {
        key: text(scroll.key, 32768),
        top: number(scroll.top),
      };
    });
    restore("快捷返回", () => {
      state.returnWorkspace =
        row.returnWorkspace == null
          ? null
          : choice(row.returnWorkspace, ["library"]);
    });
    if (failed.length)
      state.storageError = `${failed.join("、")}的浏览位置暂时无法读取。其他位置已恢复，原记录已保留。`;
    return state;
  } catch {
    return {
      ...state,
      storageError: "上次的浏览位置暂时无法读取，原记录已保留。",
    };
  }
}
