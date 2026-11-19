import { importFileDigest, importNeedsFile } from "./importQueueModel";
import type { ImportQueueStore } from "./importQueueStore";

export interface AttachedSources {
  attached: number;
  skipped: number;
  issues: string[];
}
/** Bulk reselection matches stored content identities, without submitting an import. */
export async function attachImportSources(
  store: ImportQueueStore,
  files: readonly File[],
  signal?: AbortSignal,
): Promise<AttachedSources> {
  const result: AttachedSources = { attached: 0, skipped: 0, issues: [] };
  if (!store.claim()) throw new Error("当前队列仍在处理，请暂停后补选原文件。");
  try {
    for (const file of files) {
      if (signal?.aborted) break;
      const candidates = store
        .getSnapshot()
        .items.filter(
          (item) =>
            importNeedsFile(item) &&
            item.source.name === file.name &&
            item.source.size === file.size,
        );
      if (!candidates.length) {
        result.skipped++;
        continue;
      }
      try {
        const sha256 = await importFileDigest(file);
        if (signal?.aborted) break;
        const verified = candidates.filter(
          (item) => item.source.sha256 === sha256,
        );
        const candidate =
          verified.length === 1
            ? verified[0]
            : candidates.length === 1 && !candidates[0].source.sha256
              ? candidates[0]
              : undefined;
        if (!candidate)
          throw new Error(
            verified.length > 1 ||
              candidates.some((item) => !item.source.sha256)
              ? "有多份同名队列记录，请在对应项目中补选。"
              : "内容与原文件不同，请保留原记录并重新选择。",
          );
        if (
          candidate.receipt &&
          !candidate.source.sha256 &&
          !["error", "cancelled"].includes(candidate.receipt.phase)
        )
          throw new Error(
            "原请求缺少内容指纹，请先读取结果，或取消后重新排队。",
          );
        store.patch(candidate.id, {
          file,
          source: { ...candidate.source, sha256 },
          message: "原文件内容已核对，可以继续",
        });
        result.attached++;
        if (store.getSnapshot().storageError)
          throw new Error("本机暂存需要处理，已核对的文件继续保留。");
      } catch (failure) {
        result.issues.push(
          `${file.name}：${failure instanceof Error ? failure.message : String(failure)}`,
        );
        if (store.getSnapshot().storageError) break;
      }
    }
  } finally {
    store.update({ busy: false });
  }
  return result;
}
