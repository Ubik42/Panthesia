import type { CollectionSong, EngineCommand, SongRow } from "../../api";

export type LibraryOpenLocation = "recent" | "selected";
type OpenCommand = Extract<
  EngineCommand,
  { type: "load" | "loadIndexed" | "openRecent" }
>;

/** A library location names an exact file; a recent item can use its known copies. */
export function libraryOpenCommand(
  row: SongRow,
  expectedContentId: string | undefined,
  location: LibraryOpenLocation,
  recent?: Pick<CollectionSong, "contentId" | "generated">,
): OpenCommand {
  const exerciseId = row.path.startsWith("exercise:")
    ? row.path.slice(9)
    : null;
  if (exerciseId && expectedContentId && exerciseId !== expectedContentId)
    throw new Error("技术练习的内容标识与所选条目不一致，请重新读取曲库。");
  if (
    exerciseId ||
    (recent?.generated &&
      (location === "recent" || row.path === "内置技术练习"))
  ) {
    const contentId = expectedContentId ?? exerciseId ?? recent?.contentId;
    if (!contentId) throw new Error("技术练习的来源尚未读齐，请重新读取曲库。");
    return { type: "openRecent", content_id: contentId };
  }
  if (location === "recent" && recent)
    return { type: "openRecent", content_id: recent.contentId };
  return expectedContentId
    ? {
        type: "loadIndexed",
        path: row.path,
        title: row.title,
        content_id: expectedContentId,
      }
    : { type: "load", path: row.path, title: row.title };
}
