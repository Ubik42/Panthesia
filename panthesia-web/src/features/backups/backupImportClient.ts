import { api } from "../../api";
import type {
  BackupImportReceipt,
  BackupImportRequest,
  BackupImportResult,
} from "../../engine/commands.generated";
export class PendingBackupImport extends Error {}
export class CancelledBackupImport extends Error {}
export function sameBackupRequest(
  left: BackupImportRequest,
  right: BackupImportRequest,
) {
  return (
    left.id === right.id &&
    left.token === right.token &&
    left.policy === right.policy &&
    left.selection.plans === right.selection.plans &&
    left.selection.records === right.selection.records &&
    left.selection.presets === right.selection.presets &&
    left.selection.days === right.selection.days
  );
}
const rank = {
  queued: 0,
  running: 1,
  committing: 2,
  unconfirmed: 3,
  error: 3,
  cancelled: 3,
  done: 4,
};
export function advancesBackupReceipt(
  before: BackupImportReceipt | undefined | null,
  next: BackupImportReceipt,
) {
  return (
    !before ||
    (rank[before.phase] <= rank[next.phase] &&
      (before.phase !== next.phase ||
        before.taskId !== next.taskId ||
        before.stage !== next.stage ||
        before.error !== next.error ||
        before.warning !== next.warning ||
        !!before.result !== !!next.result))
  );
}
export const backupImportMessage = (receipt: BackupImportReceipt) =>
  ({
    queued: "正在等待导入练习资料…",
    running:
      (
        {
          decoding: "正在解包并校验备份…",
          waitingStorage: "正在等待资料保存…",
          merging: "正在核对与合并练习资料…",
        } as Record<string, string>
      )[receipt.stage] || "正在处理练习资料…",
    committing: "正在保存并安装练习资料，请等待结果。",
    done: "练习资料已导入。",
    cancelled: "导入已取消，原有练习资料保留。",
    error: receipt.error || "备份导入未完成。",
    unconfirmed: receipt.error || "原导入结果仍待核对。",
  })[receipt.phase];
export async function awaitBackupImport(
  request: BackupImportRequest,
  options: {
    submit?: boolean;
    signal?: AbortSignal;
    changed: (receipt: BackupImportReceipt) => void;
  },
): Promise<BackupImportResult> {
  const check = () => {
    if (options.signal?.aborted)
      throw new PendingBackupImport(
        "已停止等待，原备份请求保留。可以继续读取导入结果。",
      );
  };
  check();
  const state = await api.state(),
    engineId = state.stateOrder?.engineId;
  check();
  if (!engineId)
    throw new PendingBackupImport("练习室尚未连接，原导入请求保留。");
  let last: BackupImportReceipt | null = null,
    submissionError: unknown,
    admitted = !options.submit;
  const publish = (receipt: BackupImportReceipt | null) => {
    if (!receipt) return;
    if (!sameBackupRequest(receipt.request, request))
      throw new PendingBackupImport(
        "导入回执与原备份范围不一致，请先核对本机资料。",
      );
    if (!advancesBackupReceipt(last, receipt)) return;
    last = receipt;
    options.changed(receipt);
  };
  const submission = options.submit
    ? api
        .prepareBackupImport(request)
        .then((value) => {
          admitted = true;
          publish(value);
        })
        .catch((error) => {
          admitted = true;
          submissionError = error;
        })
    : undefined;
  // The submission keeps its rejection handler even if the caller closes the window.
  const deadline = performance.now() + 360000;
  while (true) {
    if (options.signal?.aborted) {
      if (options.signal.reason === "cancelled")
        throw new CancelledBackupImport("导入已取消，原有资料和备份文件保留。");
      throw new PendingBackupImport(
        "已停止等待，原备份请求保留。可以继续读取导入结果。",
      );
    }
    let receipt: BackupImportReceipt | null;
    try {
      receipt = await api.readBackupImport({ engineId, id: request.id });
      publish(receipt);
    } catch (error) {
      throw new PendingBackupImport(
        `原备份请求保留，状态暂不可读：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const current = last as BackupImportReceipt | null;
    if (current?.phase === "done" && current.result) return current.result;
    if (current?.phase === "cancelled")
      throw new CancelledBackupImport("导入已取消，原有资料和备份文件保留。");
    if (current?.phase === "error")
      throw new Error(current.error || "备份导入失败");
    if (current?.phase === "unconfirmed")
      throw new PendingBackupImport(current.error || "原备份导入结果待核对");
    if (!receipt && admitted) {
      await submission;
      if (submissionError)
        throw new PendingBackupImport(
          `导入尚未确认，请继续读取原请求：${submissionError instanceof Error ? submissionError.message : String(submissionError)}`,
        );
      if (!last)
        throw new PendingBackupImport(
          "原导入记录暂不可读。请先核对本机资料，再决定是否重新准备。",
        );
    }
    if (performance.now() > deadline)
      throw new PendingBackupImport("原备份仍在处理，可以继续读取结果。");
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 300);
      options.signal?.addEventListener("abort", finish, { once: true });
    });
  }
}
