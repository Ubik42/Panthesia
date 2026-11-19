import type { SongRow } from "../../api";
import type { SongWorkspaceTarget } from "../../app/songWorkspaceVisit";

const pathKey = (path: string | null) =>
  (path ?? "").replaceAll("\\", "/").toLowerCase();

/** Equal content in another file remains a separate library location. */
export function isCurrentPracticeRow(
  row: SongRow,
  contentId: string | null | undefined,
  current: SongWorkspaceTarget | null | undefined,
) {
  if (!current || contentId !== current.contentId) return false;
  return (
    pathKey(row.path) === pathKey(current.path) ||
    (row.path === `exercise:${current.contentId}` &&
      current.path === "内置技术练习")
  );
}
