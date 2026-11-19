import { useRef, useState } from "react";
import { api, type PracticeEditCommand, type PracticeEditScope } from "../api";

// A durable edit and a refreshed view are separate outcomes. Keep the acknowledgement
// until refresh succeeds, so a failed read never repeats a write or an undo operation.
export function usePracticeEdits(
  scope: PracticeEditScope,
  changed: () => Promise<void>,
  catalogRevision?: string,
) {
  const [pendingRefresh, setPendingRefresh] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const working = useRef(false);
  const refresh = async () => {
    if (!pending.current) return;
    const message = pending.current;
    try {
      await changed();
      pending.current = null;
      setPendingRefresh(null);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${message}，但界面刷新失败：${detail}。请重试刷新。`);
    }
  };
  const commit = async <T = { ok: boolean }>(
    command: PracticeEditCommand,
    message = "练习标注已保存",
    acknowledged?: (value: T) => void,
  ): Promise<T> => {
    if (working.current) throw new Error("正在保存练习资料，请等待完成");
    if (pending.current) throw new Error(`${pending.current}，请先刷新界面。`);
    working.current = true;
    try {
      const result = await api.editPractice<T>(scope, command, catalogRevision);
      pending.current = message;
      setPendingRefresh(message);
      acknowledged?.(result);
      await refresh();
      return result;
    } finally {
      working.current = false;
    }
  };
  return { commit, refresh, pendingRefresh };
}
