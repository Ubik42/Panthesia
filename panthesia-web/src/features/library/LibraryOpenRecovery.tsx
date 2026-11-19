import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock3, RefreshCw } from "lucide-react";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { BrowsePagination } from "../../app/BrowsePagination";
import { libraryOpenLabel, libraryOpenProgress } from "./libraryOpenStore";
import type { useLibraryOpening } from "./useLibraryOpening";
import "./libraryOpenRecovery.css";

const phases: Record<string, string> = {
  unknown: "待核对",
  queued: "已排队",
  running: "正在打开",
  committing: "正在安装练习",
  done: "可以接续",
  released: "已结束",
  cancelled: "已取消",
  error: "打开未完成",
  unconfirmed: "结果待核对",
};
export function LibraryOpenRecovery({
  opening,
  engineId,
  focusRequest,
  label = "曲目打开进度",
}: {
  opening: ReturnType<typeof useLibraryOpening>;
  engineId?: string;
  label?: string;
  focusRequest?: { requestId: string; id: string } | null;
}) {
  const { state, store } = opening;
  const [requestedPage, setPage] = useState(0),
    [original, setOriginal] = useState("");
  const entries = [...state.entries]
    .reverse()
    .filter(
      (entry) => entry.disposition !== "presented" || entry.releasePending,
    );
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(entries.length / 5) - 1),
  );
  const pendingId = entries.find((entry) => entry.disposition === "pending")
    ?.request.id;
  const [expanded, setExpanded] = useState(!!pendingId);
  const panel = useRef<HTMLElement>(null),
    appliedFocus = useRef("");
  useEffect(() => {
    if (pendingId) setExpanded(true);
  }, [pendingId]);
  useEffect(() => {
    if (!focusRequest || appliedFocus.current === focusRequest.requestId)
      return;
    const index = entries.findIndex(
      (entry) => entry.request.id === focusRequest.id,
    );
    if (index < 0) return;
    if (!expanded) {
      setExpanded(true);
      return;
    }
    const target = Math.floor(index / 5);
    if (page !== target) {
      setPage(target);
      return;
    }
    const item = panel.current?.querySelector<HTMLElement>(
      `[data-library-open="${focusRequest.id}"]`,
    );
    if (item) {
      item.focus();
      appliedFocus.current = focusRequest.requestId;
    }
  }, [focusRequest?.requestId, state.entries, page, expanded]);
  if (
    !entries.length &&
    !state.storageError &&
    !opening.error &&
    !opening.submitting
  )
    return null;
  return (
    <section ref={panel} className="library-open-recovery" aria-label={label}>
      <button
        className="library-open-recovery-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Clock3 size={17} />
        <strong>{label}</strong>
        <span>
          {entries.length
            ? `${entries.length} 项保留`
            : opening.submitting
              ? "正在准备打开请求"
              : "等待处理"}
        </span>
      </button>
      {opening.error && (
        <p role="alert">
          {opening.error} <button onClick={opening.clearError}>收起提示</button>
        </p>
      )}
      <div hidden={!expanded}>
        <ul>
          {entries.slice(page * 5, page * 5 + 5).map((intent) => {
            const id = intent.request.id,
              receipt = state.receipts[id],
              phase = receipt?.phase ?? intent.lastPhase;
            const working = state.working.includes(id),
              sameEngine = intent.request.engineId === engineId;
            const ended =
              (!sameEngine && receipt === null) ||
              [
                "done",
                "released",
                "cancelled",
                "error",
                "unconfirmed",
              ].includes(phase);
            return (
              <li key={id} tabIndex={-1} data-library-open={id}>
                <div>
                  <strong>{intent.title || "原曲目"}</strong>
                  <span>
                    {libraryOpenLabel(intent.request.source)} · {phases[phase]}
                    {!sameEngine ? " · 来自上次连接" : ""}
                  </span>
                </div>
                <p>
                  {state.errors[id] ||
                    intent.error ||
                    receipt?.warning ||
                    libraryOpenProgress(phase, receipt?.stage)}
                </p>
                <div className="library-open-recovery-actions">
                  {intent.disposition !== "presented" && (
                    <button
                      disabled={!engineId || working}
                      onClick={() => void opening.resume(id)}
                    >
                      <ArrowUpRight size={14} />
                      {phase === "done" ? "接续打开结果" : "读取并接续"}
                    </button>
                  )}
                  {phase === "unknown" && sameEngine && !receipt && (
                    <button
                      disabled={working}
                      onClick={() => void opening.resume(id, true)}
                    >
                      <RefreshCw size={14} />
                      重试原请求
                    </button>
                  )}
                  {(!sameEngine || ended) &&
                    intent.disposition !== "presented" && (
                      <button
                        disabled={!engineId || working || opening.submitting}
                        onClick={() => void opening.reopen(id)}
                      >
                        按原选择重新打开
                      </button>
                    )}
                  {(receipt?.cancellable ||
                    (phase === "unknown" && !receipt)) &&
                    sameEngine && (
                      <button onClick={() => void opening.cancel(id)}>
                        取消打开
                      </button>
                    )}
                  {intent.disposition === "pending" && (
                    <button
                      onClick={() => {
                        opening.keep(id);
                        setExpanded(false);
                      }}
                    >
                      保留进度，继续浏览
                    </button>
                  )}
                  {ended && !working && (
                    <button onClick={() => store.forget(id)}>
                      结束这次操作
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const value = JSON.stringify(intent, null, 2);
                      setOriginal(value);
                      void navigator.clipboard.writeText(value).catch(() => {});
                    }}
                  >
                    复制记录
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {entries.length > 5 && (
          <BrowsePagination
            page={page}
            total={entries.length}
            pageSize={5}
            disabled={false}
            label="打开进度"
            unit="项"
            change={setPage}
          />
        )}
        {original && (
          <details open>
            <summary>操作记录原文</summary>
            <textarea
              readOnly
              rows={5}
              value={original}
              aria-label="曲目打开记录原文"
            />
          </details>
        )}
      </div>
      <PersistentSessionRecovery
        store={store}
        error={state.storageError}
        busy={opening.submitting}
        label="曲目打开进度"
      />
    </section>
  );
}
