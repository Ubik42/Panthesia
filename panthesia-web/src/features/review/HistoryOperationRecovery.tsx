import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  Clipboard,
  Clock3,
  History,
  RefreshCw,
} from "lucide-react";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { BrowsePagination } from "../../app/BrowsePagination";
import { historyIntentLabel } from "./historyOperationStore";
import type { HistoryIntent } from "./historyOperationStore";
import type { useHistoryActions } from "./useHistoryActions";
import "./historyOperationRecovery.css";

const destination = {
  practice: "当前练习",
  review: "谱面批阅",
  score: "乐谱定位",
  paper: "纸谱定位",
  finger: "指法编辑",
};
const phaseName: Record<string, string> = {
  unknown: "待核对",
  queued: "已排队",
  running: "正在准备",
  committing: "正在保存",
  done: "已准备",
  released: "已结束",
  cancelled: "已取消",
  error: "准备未完成",
  unconfirmed: "结果待核对",
};
export function HistoryOperationRecovery({
  actions,
  contentId,
  historyId,
}: {
  actions: ReturnType<typeof useHistoryActions>;
  contentId?: string;
  historyId?: string;
}) {
  const store = actions.operationStore;
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const kept = [...state.entries]
    .reverse()
    .filter(
      (entry) =>
        entry.disposition === "kept" &&
        entry.request.operation.source.contentId === contentId &&
        entry.request.operation.source.id === historyId,
    );
  const [copied, setCopied] = useState(""),
    [original, setOriginal] = useState("");
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(kept.length / 8) - 1),
  );
  const copyEpoch = useRef(0);
  useEffect(() => {
    copyEpoch.current++;
    setCopied("");
    setOriginal("");
    setPage(0);
    return () => {
      copyEpoch.current++;
    };
  }, [contentId, historyId]);
  const copy = async (intent: HistoryIntent) => {
    const epoch = ++copyEpoch.current;
    const value = JSON.stringify(intent, null, 2);
    setOriginal(value);
    try {
      await navigator.clipboard.writeText(value);
      if (copyEpoch.current === epoch)
        setCopied("已复制这次操作，下方保留原文。");
    } catch {
      if (copyEpoch.current === epoch) setCopied("可在下方选取原文并复制。");
    }
  };
  return (
    <div className="history-operation-recovery">
      {actions.pendingLabel && (
        <section
          className="history-operation-current"
          aria-label="待接续的历史操作"
          aria-busy={actions.busy}
        >
          <div className="history-operation-heading">
            <History size={18} />
            <div>
              <strong>{actions.pendingHeadline}</strong>
              {actions.pendingPreviousEngine && (
                <span className="history-operation-badge">来自上次连接</span>
              )}
            </div>
          </div>
          <p role="status">{actions.pendingDescription}</p>
          {actions.pendingWarning && (
            <p className="history-operation-warning" role="alert">
              {actions.pendingWarning}
            </p>
          )}
          <div className="history-operation-actions">
            {actions.pendingNotice !== "conditions" && (
              <button
                className="history-operation-primary"
                disabled={actions.retryDisabled}
                onClick={() => void actions.retryPrepared()}
              >
                <RefreshCw size={14} />
                {actions.pendingRetryLabel}
              </button>
            )}
            {actions.canEnter && (
              <button
                disabled={actions.retryDisabled}
                onClick={() => void actions.retryPrepared(true)}
              >
                {actions.pendingEnterLabel}
              </button>
            )}
            {actions.canRetryOriginal && (
              <button
                disabled={actions.retryDisabled}
                onClick={() => void actions.retryOriginal()}
              >
                重试这次准备
              </button>
            )}
            {actions.canCancel && (
              <button
                disabled={actions.cancelDisabled}
                onClick={() => void actions.cancelPrepared()}
              >
                取消这次准备
              </button>
            )}
            <button
              disabled={actions.dismissDisabled}
              onClick={actions.dismissPrepared}
            >
              保留进度，继续浏览
            </button>
            {actions.canForget && (
              <button
                disabled={actions.dismissDisabled}
                onClick={actions.forgetPrepared}
              >
                结束这次操作
              </button>
            )}
          </div>
        </section>
      )}
      {kept.length > 0 && (
        <details className="history-operation-kept">
          <summary>
            <Clock3 size={15} />
            保留的历史操作 <span>{kept.length}</span>
          </summary>
          <ul>
            {kept.slice(page * 8, page * 8 + 8).map((intent) => {
              const receipt = state.receipts[intent.request.id];
              const phase = receipt?.phase ?? intent.lastPhase;
              return (
                <li key={intent.request.id}>
                  <div className="history-operation-item-title">
                    <strong>{historyIntentLabel(intent)}</strong>
                    <span className="history-operation-badge">
                      {phaseName[phase] ?? "待核对"}
                    </span>
                  </div>
                  <p>
                    {destination[intent.destination]} ·{" "}
                    {new Date(intent.request.createdAtMs).toLocaleString(
                      "zh-CN",
                    )}
                    {intent.request.measure
                      ? ` · 第 ${intent.request.measure} 小节`
                      : ""}
                  </p>
                  <div className="history-operation-actions">
                    <button
                      disabled={actions.busy || actions.dismissDisabled}
                      onClick={() =>
                        void actions.resumeIntent(intent.request.id)
                      }
                    >
                      <ArrowUpRight size={14} />
                      接续这次操作
                    </button>
                    <button onClick={() => void copy(intent)}>
                      <Clipboard size={14} />
                      复制记录
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {kept.length > 8 && (
            <BrowsePagination
              page={page}
              total={kept.length}
              pageSize={8}
              label="保留操作"
              unit="项"
              disabled={actions.busy}
              change={setPage}
            />
          )}
        </details>
      )}
      {original && (
        <details className="history-operation-original" open>
          <summary>{copied || "操作记录原文"}</summary>
          <textarea
            readOnly
            rows={6}
            value={original}
            aria-label="历史操作记录原文"
          />
        </details>
      )}
      <PersistentSessionRecovery
        store={store}
        error={state.storageError}
        busy={actions.busy}
        label="历史操作进度"
      />
    </div>
  );
}
