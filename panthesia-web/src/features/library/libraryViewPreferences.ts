import { defaults, fields, type View } from "./libraryQueryModel";

export const storage = "neothesia-library-view-v1";
export function readView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(storage) ?? "null");
    if (!v || typeof v !== "object") return { ...defaults };
    return {
      query: typeof v.query === "string" ? v.query.slice(0, 4096) : "",
      field: fields.includes(v.field) ? v.field : "all",
      filter: [
        "all",
        "score",
        "missing",
        "duplicates",
        "unindexed",
        "errors",
      ].includes(v.filter)
        ? v.filter
        : "all",
      sort: [
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
      ].includes(v.sort)
        ? v.sort
        : "title",
      direction: v.direction === "desc" ? "desc" : "asc",
      minRating:
        Number.isInteger(v.minRating) && v.minRating >= 0 && v.minRating <= 5
          ? v.minRating
          : 0,
      minDuration:
        typeof v.minDuration === "string" &&
        /^(\d+(\.\d+)?)?$/.test(v.minDuration)
          ? v.minDuration
          : "",
      maxDuration:
        typeof v.maxDuration === "string" &&
        /^(\d+(\.\d+)?)?$/.test(v.maxDuration)
          ? v.maxDuration
          : "",
      learning: [
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
      ].includes(v.learning)
        ? v.learning
        : "all",
      practice: ["all", "played", "unplayed", "favorite", "review"].includes(
        v.practice,
      )
        ? v.practice
        : "all",
    };
  } catch {
    return { ...defaults };
  }
}
