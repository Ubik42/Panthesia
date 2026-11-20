import { api } from "../../api";
import { getHistoryOperations } from "../review/historyOperationStore";
import { requireHistorySource } from "../review/historySource";
import type { HistoryDetail } from "../review/historyTypes";

/** Reuse the history operation journal for condition restoration and restart recovery. */
export async function prepareLibraryPractice(
  input: { engineId: string; contentId: string; id: string; title: string },
  canAdmit: () => boolean,
) {
  const detail = await api.commandForEngine<HistoryDetail>(input.engineId, {
    type: "readHistoryDetail",
    content_id: input.contentId,
    id: input.id,
  });
  if (!canAdmit()) throw new Error("当前选曲或连接已变化，请重新恢复练习。");
  const source = requireHistorySource(detail.source, input.contentId, input.id);
  const operations = getHistoryOperations();
  const intent = await operations.create(
    input.engineId,
    source,
    { kind: "open", restore: true },
    "practice",
    input.title,
    undefined,
    canAdmit,
  );
  const receipt = await operations.follow(intent.request.id, input.engineId);
  if (receipt?.phase !== "done" || !receipt.result)
    throw new Error(receipt?.error || "恢复任务已保留，可从工作进度接续。");
  if (receipt.result.restoreWarning)
    throw new Error(receipt.result.restoreWarning);
  return { intent, prepared: receipt.result.historyPrepared };
}
