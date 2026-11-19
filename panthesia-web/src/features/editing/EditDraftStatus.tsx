import { useSyncExternalStore } from "react";
import { editDraftPersistence } from "./editDraftStore";
import "./editDrafts.css";
const empty = { error: "", pending: false };
const subscribe = () => () => {};
const getEmpty = () => empty;
export function EditDraftStatus<V>({
  drafts,
  visible,
  phase = "draft",
}: {
  drafts?: Map<string, V>;
  visible: boolean;
  phase?: "draft" | "saved" | "unconfirmed";
}) {
  const persistence = editDraftPersistence(drafts);
  const state = useSyncExternalStore(
    persistence?.subscribe ?? subscribe,
    persistence?.getSnapshot ?? getEmpty,
    getEmpty,
  );
  if (!persistence || !visible) return null;
  return (
    <p
      className={
        state.error ? "edit-draft-local-error" : "edit-draft-local-status"
      }
      role={state.error ? "alert" : "status"}
    >
      {state.error
        ? `${state.error}。可从顶部“未提交输入”复制和处理原文。`
        : state.pending
          ? "正在暂存输入…"
          : phase === "saved"
            ? "保存回执已在本机暂存，关闭后可以继续刷新。"
            : phase === "unconfirmed"
              ? "原输入与提交条件已在本机暂存，可继续核对提交结果。"
              : "未提交输入已在本机暂存，关闭后可以继续编辑。"}
    </p>
  );
}
