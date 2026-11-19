import type {
  ImportedSong,
  MusicReceipt,
} from "../../engine/commands.generated";
export const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
export function readPreparedSong(value: unknown): ImportedSong | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (
    !boundedText(row.contentId, 256) ||
    !row.contentId ||
    !boundedText(row.title, 16384) ||
    !boundedText(row.sourcePath, 32768) ||
    (row.catalogOnly != null && typeof row.catalogOnly !== "boolean") ||
    (row.importWarnings != null &&
      (!Array.isArray(row.importWarnings) ||
        row.importWarnings.length > 1000 ||
        !row.importWarnings.every((value) => boundedText(value, 65536))))
  )
    return undefined;
  return {
    contentId: row.contentId,
    title: row.title,
    sourcePath: row.sourcePath,
    importWarnings: (row.importWarnings as string[] | undefined) ?? [],
    catalogOnly: row.catalogOnly === true,
  };
}
export function readPreparationReceipt(
  value: unknown,
  kind: "exercise" | "package",
): MusicReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (
    !boundedText(row.id, 256) ||
    !row.id ||
    !boundedText(row.engineId, 128) ||
    !row.engineId ||
    row.kind !== kind ||
    (row.catalogOnly !== undefined && row.catalogOnly !== false) ||
    !boundedText(row.phase, 32) ||
    ![
      "uploading",
      "queued",
      "running",
      "committing",
      "done",
      "cancelled",
      "error",
      "unconfirmed",
    ].includes(row.phase)
  )
    return undefined;
  const prepared = readPreparedSong(row.song);
  if (
    (row.song != null && !prepared) ||
    prepared?.catalogOnly ||
    (row.phase === "done" && !prepared)
  )
    return undefined;
  return {
    id: row.id,
    engineId: row.engineId,
    name: kind === "exercise" ? "技术练习" : "曲目包",
    kind,
    phase: row.phase as MusicReceipt["phase"],
    size: 0,
    received: 0,
    taskId: boundedText(row.taskId, 256) ? row.taskId : null,
    error: boundedText(row.error, 4096) ? row.error : null,
    song: prepared ?? null,
    catalogOnly: false,
    cancellable: ["uploading", "queued", "running"].includes(row.phase),
  };
}
