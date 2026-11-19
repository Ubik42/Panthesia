import type { ImportedSong, MusicReceipt } from "./musicImportClient";
import { boundedText, readPreparedSong } from "./preparationPersistence";

export interface ImportSource {
  name: string;
  size: number;
  lastModified: number;
  sha256?: string;
}
export interface ImportItem {
  id: string;
  source: ImportSource;
  file?: File;
  state: "pending" | "working" | "done" | "error" | "review";
  message: string;
  song?: ImportedSong;
  receipt?: MusicReceipt;
}
export const importNeedsFile = (item: ImportItem) => {
  if (item.file || item.song) return false;
  const receipt = item.receipt;
  if (!receipt) return true;
  return !(
    ["queued", "running", "committing", "done"].includes(receipt.phase) ||
    (receipt.phase === "uploading" && receipt.received >= receipt.size) ||
    (receipt.catalogOnly && receipt.phase === "unconfirmed" && receipt.song)
  );
};
export interface ImportQueueState {
  items: ImportItem[];
  bpm: number;
  bpmInput: string;
  busy: boolean;
  stopping: boolean;
  error: string;
  storageError: string;
  refreshPending: boolean;
  refreshScope: "catalog" | "session" | null;
  refreshVersion: number;
  filter: "all" | "remaining" | "review" | "done";
  query: string;
  page: number;
}
export const importable = (file: Pick<File, "name">) =>
  /\.(mid|midi|musicxml|xml|mxl)$/i.test(file.name);
export const importSource = (file: File): ImportSource => ({
  name: file.name,
  size: file.size,
  lastModified: file.lastModified,
});
export const freshImportQueue = (): ImportQueueState => ({
  items: [],
  bpm: 120,
  bpmInput: "120",
  busy: false,
  stopping: false,
  error: "",
  storageError: "",
  refreshPending: false,
  refreshScope: null,
  refreshVersion: 0,
  filter: "all",
  query: "",
  page: 0,
});
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function readSource(value: unknown): ImportSource {
  if (!value || typeof value !== "object") throw new Error();
  const row = value as ImportSource;
  if (
    !boundedText(row.name, 1024) ||
    !row.name.trim() ||
    row.name.includes("\0") ||
    !importable(row) ||
    !nonnegative(row.size) ||
    row.size > 32_000_000 ||
    !nonnegative(row.lastModified) ||
    (row.sha256 !== undefined &&
      (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)))
  )
    throw new Error();
  return {
    name: row.name,
    size: row.size,
    lastModified: row.lastModified,
    sha256: row.sha256,
  };
}
function readReceipt(
  value: unknown,
  source: ImportSource,
): MusicReceipt | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error();
  const row = value as MusicReceipt;
  const kind = /\.(mid|midi)$/i.test(source.name) ? "midi" : "score";
  if (
    !boundedText(row.id, 256) ||
    !row.id ||
    !boundedText(row.engineId, 128) ||
    !row.engineId ||
    row.name !== source.name ||
    row.size !== source.size ||
    row.kind !== kind ||
    !nonnegative(row.received) ||
    row.received > row.size ||
    ![
      "uploading",
      "queued",
      "running",
      "committing",
      "done",
      "error",
      "cancelled",
      "unconfirmed",
    ].includes(row.phase) ||
    (row.taskId != null && !boundedText(row.taskId, 256)) ||
    (row.error != null && !boundedText(row.error, 65536)) ||
    (row.catalogOnly != null && typeof row.catalogOnly !== "boolean")
  )
    throw new Error();
  const song = readPreparedSong(row.song);
  if (
    (row.song != null && !song) ||
    (row.phase === "done" && !song) ||
    (song && song.catalogOnly !== (row.catalogOnly === true))
  )
    throw new Error();
  return {
    id: row.id,
    engineId: row.engineId,
    name: row.name,
    size: row.size,
    received: row.received,
    kind,
    catalogOnly: row.catalogOnly === true,
    phase: row.phase,
    taskId: row.taskId ?? null,
    song: song ?? null,
    error: row.error ?? null,
    cancellable:
      ["uploading", "queued", "running"].includes(row.phase) &&
      row.cancellable === true,
  };
}
export function restoreImportQueue(raw: string | null): ImportQueueState {
  const initial = freshImportQueue();
  if (!raw) return initial;
  try {
    if (raw.length > 2_000_000) throw new Error();
    const value = JSON.parse(raw) as ImportQueueState;
    if (
      !value ||
      !Array.isArray(value.items) ||
      value.items.length > 500 ||
      !Number.isInteger(value.bpm) ||
      value.bpm < 20 ||
      value.bpm > 400 ||
      !boundedText(value.query, 4096) ||
      !nonnegative(value.page) ||
      (value.bpmInput !== undefined && !boundedText(value.bpmInput, 32))
    )
      throw new Error();
    const items = value.items.map((row): ImportItem => {
      if (
        !row ||
        !boundedText(row.id, 128) ||
        !row.id ||
        !boundedText(row.message, 65536) ||
        !["pending", "working", "done", "error", "review"].includes(row.state)
      )
        throw new Error();
      const source = readSource(row.source),
        receipt = readReceipt(row.receipt, source);
      const savedSong = readPreparedSong(row.song);
      const song =
        savedSong ??
        (receipt?.phase === "done" ? (receipt.song ?? undefined) : undefined);
      if (
        (row.song !== undefined && !savedSong) ||
        (row.state === "done" && !song) ||
        (song &&
          receipt &&
          (receipt.phase !== "done" ||
            song.catalogOnly !== receipt.catalogOnly)) ||
        (song &&
          receipt?.song &&
          (song.contentId !== receipt.song.contentId ||
            song.sourcePath !== receipt.song.sourcePath))
      )
        throw new Error();
      const state = song
        ? "done"
        : receipt && !["cancelled", "error"].includes(receipt.phase)
          ? "review"
          : row.state === "working"
            ? "pending"
            : row.state;
      return {
        id: row.id,
        source,
        receipt,
        song,
        state,
        message: song
          ? "已恢复导入结果，可打开练习"
          : receipt
            ? "已恢复原导入请求，可读取进度或补选原文件"
            : "请补选原文件后继续导入",
      };
    });
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error();
    return {
      ...initial,
      items,
      bpm: value.bpm,
      bpmInput: value.bpmInput ?? String(value.bpm),
      query: value.query,
      page: value.page,
      filter: ["all", "remaining", "review", "done"].includes(value.filter)
        ? value.filter
        : "all",
      refreshScope:
        value.refreshScope === "session" ||
        items.some((item) => item.song && !item.song.catalogOnly)
          ? "session"
          : "catalog",
      refreshVersion: nonnegative(value.refreshVersion)
        ? value.refreshVersion
        : 0,
      refreshPending:
        value.refreshPending === true ||
        items.some((item) => item.state === "done"),
    };
  } catch {
    return {
      ...initial,
      storageError: "导入队列记录暂时无法完整读取，原文已保留。",
    };
  }
}
export async function importFileDigest(file: File) {
  if (!file.size || file.size > 32_000_000)
    throw new Error("文件为空或超过 32 MB。");
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
