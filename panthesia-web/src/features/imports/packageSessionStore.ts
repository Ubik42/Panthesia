import { createPersistentSession } from "../../app/createPersistentSession";
import type {
  ImportedSong,
  MusicReceipt,
  PackagePolicy,
  PackagePreview,
} from "../../engine/commands.generated";
import {
  boundedText,
  readPreparedSong,
  readPreparationReceipt,
} from "./preparationPersistence";
export interface PackageSession {
  summary: PackagePreview | null;
  fileName: string;
  policy: PackagePolicy;
  phase: "preview" | "working" | "review" | "ready" | "error";
  busy: boolean;
  receipt?: MusicReceipt;
  result?: ImportedSong;
  refreshPending: boolean;
  error: string;
  message: string;
  storageError: string;
}
const key = "neothesia.package-workbench.v1";
const initial = (): PackageSession => ({
  summary: null,
  fileName: "",
  policy: "merge",
  phase: "preview",
  busy: false,
  refreshPending: false,
  error: "",
  message: "",
  storageError: "",
});
const count = (value: unknown, max = 2_000_000): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;
const strings = (value: unknown, max = 200): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((item) => boundedText(item, 4096));
function preview(value: unknown): PackagePreview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as PackagePreview;
  if (
    !boundedText(row.token, 64) ||
    !/^[a-f0-9]{64}$/i.test(row.token) ||
    !boundedText(row.contentId, 256) ||
    !row.contentId ||
    !boundedText(row.title, 1024) ||
    !strings(row.scores) ||
    !strings(row.ladders) ||
    !strings(row.passages) ||
    !Array.isArray(row.groups) ||
    row.groups.length > 200 ||
    !row.groups.every((group) => strings(group, 30)) ||
    !row.metadata ||
    !strings(row.metadata.tags) ||
    (row.metadata.notes != null && !boundedText(row.metadata.notes, 65536)) ||
    (row.metadata.composer != null &&
      !boundedText(row.metadata.composer, 4096)) ||
    ![
      row.fingerings,
      row.fingerActions ?? 0,
      row.trackSounds ?? 0,
      row.hands,
    ].every((value) => count(value)) ||
    !count(row.rating, 5) ||
    !Array.isArray(row.papers) ||
    row.papers.length > 1000 ||
    !row.papers.every(
      (paper) =>
        paper &&
        boundedText(paper.name, 4096) &&
        boundedText(paper.format, 32) &&
        count(paper.pages, 10000),
    ) ||
    !Array.isArray(row.trackAppearances ?? []) ||
    (row.trackAppearances ?? []).length > 10000 ||
    !(row.trackAppearances ?? []).every(
      (track) =>
        track &&
        count(track.id) &&
        boundedText(track.name, 4096) &&
        (track.color == null || boundedText(track.color, 128)),
    )
  )
    return null;
  return {
    ...row,
    existing: row.existing === true,
    engineId: boundedText(row.engineId, 128) ? row.engineId : "",
    fileName: boundedText(row.fileName, 1024) ? row.fileName : null,
    metadata: {
      composer: row.metadata.composer ?? null,
      notes: row.metadata.notes ?? null,
      tags: row.metadata.tags,
    },
    fingerActions: row.fingerActions ?? 0,
    trackSounds: row.trackSounds ?? 0,
    trackAppearances: row.trackAppearances ?? [],
    papers: row.papers.map((paper) => ({
      ...paper,
      mappingPoints: count(paper.mappingPoints) ? paper.mappingPoints : 0,
      autoTurn: paper.autoTurn === true,
      annotations: count(paper.annotations) ? paper.annotations : 0,
    })),
    provenance:
      row.provenance && typeof row.provenance === "object"
        ? {
            source: boundedText(row.provenance.source, 4096)
              ? row.provenance.source
              : null,
            license: boundedText(row.provenance.license, 4096)
              ? row.provenance.license
              : null,
            sourceUrl: boundedText(row.provenance.sourceUrl, 8192)
              ? row.provenance.sourceUrl
              : null,
          }
        : null,
  };
}
function restore(saved: string | null): PackageSession {
  const fresh = initial();
  try {
    if (!saved) return fresh;
    if (saved.length > 1_000_000)
      return {
        ...fresh,
        storageError: "曲目包预览记录过大，请重新选择文件；原记录保留。",
      };
    const row = JSON.parse(saved) as Partial<PackageSession>;
    if (!row || typeof row !== "object" || Array.isArray(row))
      return {
        ...fresh,
        storageError: "曲目包工作进度的结构暂时无法读取，原文已保留。",
      };
    const summary = preview(row.summary);
    if (!summary) {
      if (
        row.summary == null &&
        !row.receipt &&
        !row.result &&
        row.phase === "preview"
      )
        return {
          ...fresh,
          policy: ["merge", "keep", "replace"].includes(row.policy ?? "")
            ? row.policy!
            : "merge",
        };
      return {
        ...fresh,
        storageError:
          "曲目包预览或提交记录暂时无法完整读取，原文已保留。可以复制后采用当前输入。",
      };
    }
    const receipt = readPreparationReceipt(row.receipt, "package");
    const savedResult = readPreparedSong(row.result);
    if (
      (row.receipt != null && !receipt) ||
      (row.result != null && !savedResult) ||
      (savedResult && savedResult.contentId !== summary.contentId) ||
      (receipt?.song && receipt.song.contentId !== summary.contentId) ||
      (savedResult &&
        receipt?.song &&
        savedResult.contentId !== receipt.song.contentId)
    )
      return {
        ...fresh,
        summary,
        policy: ["merge", "keep", "replace"].includes(row.policy ?? "")
          ? row.policy!
          : "merge",
        fileName: boundedText(row.fileName, 1024)
          ? row.fileName
          : (summary.fileName ?? "曲目包"),
        storageError:
          "曲目包的预览、回执或结果需要核对，原记录已保留，可复制原文后处理。",
      };
    const known =
      savedResult ??
      (receipt?.phase === "done" ? (receipt.song ?? undefined) : undefined);
    const result = known?.contentId === summary.contentId ? known : undefined;
    const interrupted = ["working", "review"].includes(row.phase ?? "");
    return {
      ...fresh,
      summary,
      receipt,
      result,
      policy: ["merge", "keep", "replace"].includes(row.policy ?? "")
        ? row.policy!
        : "merge",
      fileName: boundedText(row.fileName, 1024)
        ? row.fileName
        : (summary.fileName ?? "曲目包"),
      phase: result ? "ready" : interrupted ? "review" : "preview",
      refreshPending: !!result,
      message: result
        ? "已恢复原导入结果，可以重新读取练习室。"
        : interrupted
          ? "上次导入中断，请继续读取原请求。"
          : "已恢复曲目包预览，导入前可重新读取本机保存情况。",
    };
  } catch {
    return {
      ...fresh,
      storageError:
        "曲目包工作进度读取失败，原文已保留。可以复制原文或保留副本后采用当前输入。",
    };
  }
}
export function createPackageSessionStore() {
  const session = createPersistentSession(restore, {
    key,
    maxCharacters: 1_000_000,
    failureMessage: "曲目包进度暂未保存到本机，请保留当前窗口并重试保存。",
  });
  const { getSnapshot, update } = session;
  return {
    ...session,
    claim() {
      if (getSnapshot().busy) return false;
      update({ busy: true, error: "" });
      return true;
    },
    install(summary: PackagePreview, fileName: string) {
      update({
        summary,
        fileName,
        phase: "preview",
        receipt: undefined,
        result: undefined,
        refreshPending: false,
        error: "",
        message: "曲目包已读取，请核对内容与导入策略。",
      });
    },
  };
}
export type PackageSessionStore = ReturnType<typeof createPackageSessionStore>;
