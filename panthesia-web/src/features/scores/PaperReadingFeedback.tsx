import { useState } from "react";
import type { PaperViewSession, PaperViewSessionState } from "./paperViewStore";

export function PaperReadingFeedback({
  session,
  state,
}: {
  session: PaperViewSession;
  state: PaperViewSessionState;
}) {
  const [notice, setNotice] = useState("");
  if (
    !(state.restored && state.dirty) &&
    !state.error &&
    !state.storageError &&
    !notice
  )
    return null;
  const copy = async (original = false) => {
    try {
      await navigator.clipboard.writeText(
        original ? session.original() : session.copy(),
      );
      setNotice(original ? "已复制原暂存。" : "已复制当前阅读位置。");
    } catch {
      setNotice("复制未完成，请允许复制后重试。");
    }
  };
  return (
    <div className="paper-reading-feedback" role="status" aria-live="polite">
      <span>
        {state.saving
          ? "正在保存阅读位置…"
          : state.error ||
            (state.dirty ? "已恢复上次阅读位置，可继续保存。" : "")}
      </span>
      {state.storageError && (
        <span className="paper-reading-error">{state.storageError}</span>
      )}
      <div className="paper-reading-actions">
        {state.conflict ? (
          <>
            <button
              type="button"
              disabled={state.saving}
              onClick={session.adoptSaved}
            >
              采用已保存位置
            </button>
            <button
              type="button"
              disabled={state.saving}
              onClick={session.keepCurrent}
            >
              保留当前阅读位置
            </button>
          </>
        ) : (
          state.dirty && (
            <button
              type="button"
              disabled={state.saving}
              onClick={() => void session.retry()}
            >
              核对并保存位置
            </button>
          )
        )}
        {(state.error || state.storageError) && (
          <button type="button" onClick={() => void copy()}>
            复制当前位置
          </button>
        )}
        {state.storageError && (
          <>
            <button type="button" onClick={() => void copy(true)}>
              复制原暂存
            </button>
            <button type="button" onClick={session.retryLocal}>
              重试本机暂存
            </button>
            <button type="button" onClick={() => void session.rebuildLocal()}>
              复制原文并重建暂存
            </button>
          </>
        )}
        {notice && (
          <>
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")}>
              收起提示
            </button>
          </>
        )}
      </div>
    </div>
  );
}
