/** A cancelled preparation can be retried. A timed-out commit must be reconciled first. */
export function taskInterruption(failure: unknown): "cancelled" | "pending" | null {
  const message = failure instanceof Error ? failure.message : String(failure);
  if (/后台任务已取消|已取消未提交/.test(message)) return "cancelled";
  if (/导入结果待确认|导入回执|后台任务响应超时|保存仍在进行|正在保存或恢复|尚待恢复|正在导入或恢复|timeout|timed out/i.test(message) ||
      (failure instanceof DOMException && ["TimeoutError", "AbortError"].includes(failure.name)))
    return "pending";
  return null;
}
