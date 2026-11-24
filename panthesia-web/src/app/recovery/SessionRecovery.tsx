import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CheckCircle2,
  ChevronRight,
  Clipboard,
  FolderOpen,
  LifeBuoy,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import { Dialog } from "../../ui/Dialog";
import { api } from "../../api";
import {
  recoveryActionLabels,
  type RecoveryAction,
  type RecoveryIssue,
} from "./sessionRecoveryModel";
import type { SessionRecoveryStore } from "./sessionRecoveryStore";
import "./sessionRecovery.css";

export type RecoveryActor = (
  issue: RecoveryIssue,
  action: RecoveryAction,
  signal?: AbortSignal,
) => Promise<void>;
const severityLabel = {
  blocking: "待恢复",
  attention: "需处理",
  info: "当前状态",
};
export function SessionRecoveryButton({
  store,
  expanded,
  open,
}: {
  store: SessionRecoveryStore;
  expanded: boolean;
  open: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <button
      type="button"
      className={`session-recovery-button ${state.problems ? "has-problems" : ""}`}
      disabled={state.closing}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={`恢复与问题${state.problems ? `，${state.problems} 项需处理` : ""}`}
      title={
        state.problems
          ? "查看连接、保存与资料读取问题"
          : "查看练习室状态与恢复入口"
      }
      onClick={open}
    >
      <LifeBuoy size={17} />
      <span>恢复与问题</span>
      {state.problems > 0 && (
        <b aria-hidden="true">{state.problems > 99 ? "99+" : state.problems}</b>
      )}
    </button>
  );
}
export function SessionRecoveryDialog({
  store,
  act,
  close,
}: {
  store: SessionRecoveryStore;
  act: RecoveryActor;
  close: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"problems" | "all">(() =>
      !state.problems && state.issues.length ? "all" : "problems",
    ),
    [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState(""),
    [copyError, setCopyError] = useState(""),
    [showDiagnostics, setShowDiagnostics] = useState(false),
    [diagnostics, setDiagnostics] = useState("");
  const navigation = useRef<AbortController | null>(null);
  const opening = state.operations.some(
    (operation) =>
      operation.action === "openWork" || operation.action === "openRecording",
  );
  const alive = useRef(true),
    search = useRef<HTMLInputElement | null>(null),
    copyLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      navigation.current?.abort();
    };
  }, []);
  const rows = useMemo(() => {
    const words = query
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return state.issues.filter((row) => {
      if (filter === "problems" && row.severity === "info") return false;
      if (!words.length) return true;
      const text =
        `${row.title} ${row.detail} ${row.guidance} ${row.actions.map((action) => recoveryActionLabels[action]).join(" ")}`
          .normalize("NFKC")
          .toLocaleLowerCase("zh-CN");
      return words.every((word) => text.includes(word));
    });
  }, [state.issues, query, filter]);
  const invoke = (issue: RecoveryIssue, action: RecoveryAction) => {
    const navigating = action === "openWork" || action === "openRecording";
    if (navigating && navigation.current && !navigation.current.signal.aborted)
      return;
    const controller = navigating ? new AbortController() : undefined;
    if (controller) {
      navigation.current?.abort();
      navigation.current = controller;
    }
    void act(issue, action, controller?.signal)
      .catch(() => {})
      .finally(() => {
        if (controller && navigation.current === controller)
          navigation.current = null;
      });
  };

  const copy = async (issue?: RecoveryIssue) => {
    if (copyLock.current) return;
    copyLock.current = true;
    setCopying(true);
    setCopyMessage("");
    setCopyError("");
    const value = issue
      ? `${issue.title}\n\n${issue.detail}\n\n${issue.guidance}`
      : store.diagnostics();
    try {
      await navigator.clipboard.writeText(value);
      if (alive.current)
        setCopyMessage(
          issue ? "已复制这项问题的说明。" : "已复制当前问题、曲目与设备说明。",
        );
    } catch (failure) {
      if (alive.current) {
        setCopyError(
          `复制尚未完成：${failure instanceof Error ? failure.message : String(failure)}。可以在下方选取说明并复制。`,
        );
        setDiagnostics(value);
        setShowDiagnostics(true);
      }
    } finally {
      copyLock.current = false;
      if (alive.current) setCopying(false);
    }
  };
  const inspect = () => {
    setDiagnostics(store.diagnostics());
    setShowDiagnostics(true);
  };
  return (
    <Dialog
      title="恢复与问题"
      subtitle="练习室 · 状态与接续"
      close={close}
      closeLabel="关闭恢复与问题"
      closeDisabled={opening}
      wide
      className="session-recovery-dialog"
      footer={
        <>
          <span className="session-recovery-footnote">完整说明包含当前曲目、设备和本机文件路径。</span>
          <button type="button" className="ui-button" onClick={inspect}>
            查看说明
          </button>
          <button
            type="button"
            className="ui-button"
            disabled={copying}
            onClick={() => void copy()}
          >
            <Clipboard size={14} />
            复制完整说明
          </button>
        </>
      }
    >
        <p id="session-recovery-intro" className="session-recovery-intro">
          {state.problems
            ? `${state.problems} 项需要处理${state.blocking ? `，其中 ${state.blocking} 项影响继续练习` : ""}。`
            : "当前没有需要处理的问题。"}
          每项保留具体原因和对应的下一步操作。
        </p>
        <div className="session-recovery-tools">
          <label>
            <Search size={16} />
            <input
              ref={search}
              type="search"
              maxLength={512}
              data-dialog-initial-focus
              aria-label="查找恢复问题"
              disabled={opening}
              placeholder="查找连接、保存或设备"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="清除查找"
                disabled={opening}
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <div className="ui-segmented" role="group" aria-label="筛选练习室状态">
            <button
              type="button"
              aria-pressed={filter === "problems"}
              disabled={opening}
              onClick={() => setFilter("problems")}
            >
              需处理 <b>{state.problems}</b>
            </button>
            <button
              type="button"
              aria-pressed={filter === "all"}
              disabled={opening}
              onClick={() => setFilter("all")}
            >
              全部状态 <b>{state.issues.length}</b>
            </button>
          </div>
        </div>
        {state.operations.length > 0 && (
          <div className="session-recovery-working" role="status">
            <LoaderCircle size={16} className="session-recovery-spin" />
            <span>
              {state.operations.map((operation) => operation.label).join("、")}
              正在处理。关闭本窗口后，原操作继续接收结果。
            </span>
          </div>
        )}
        {state.outcome && (
          <div
            className={`session-recovery-outcome ${state.outcome.ok ? "is-success" : "is-error"}`}
            role={state.outcome.ok ? "status" : "alert"}
          >
            <div>
              <strong>
                {state.outcome.engineId &&
                state.engineId &&
                state.outcome.engineId !== state.engineId
                  ? "上次连接 · "
                  : ""}
                {recoveryActionLabels[state.outcome.action]}
              </strong>
              <p>{state.outcome.detail}</p>
            </div>
            <button
              type="button"
              className="ui-icon-button"
              aria-label="收起上次处理结果"
              onClick={store.clearOutcome}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {copyMessage && (
          <p className="session-recovery-copy-notice" role="status">
            {copyMessage}
          </p>
        )}
        {copyError && (
          <p className="session-recovery-copy-error" role="alert">
            {copyError}
          </p>
        )}
        <div className="session-recovery-results">
          {rows.length ? (
            <ul>
              {rows.map((issue) => {
                const operation = state.operations.find(
                  (row) => row.issueId === issue.id,
                );
                return (
                  <li
                    key={issue.id}
                    className={`session-recovery-row severity-${issue.severity}`}
                  >
                    <div className="session-recovery-row-top">
                      <span>{severityLabel[issue.severity]}</span>
                      <h3>{issue.title}</h3>
                      {issue.firstAt && (
                        <time dateTime={new Date(issue.firstAt).toISOString()}>
                          {new Date(issue.firstAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          起
                        </time>
                      )}
                      {issue.occurrences && issue.occurrences > 1 ? (
                        <small>已连续出现 {issue.occurrences} 次</small>
                      ) : null}
                    </div>
                    <div className="session-recovery-cause">
                      {issue.detail.length > 400 ? (
                        <details>
                          <summary>
                            {issue.detail.slice(0, 240)}… 展开原说明
                          </summary>
                          <pre>{issue.detail}</pre>
                        </details>
                      ) : (
                        issue.detail
                      )}
                    </div>
                    <p className="session-recovery-guidance">
                      {issue.guidance}
                    </p>
                    <div className="session-recovery-actions">
                      {issue.actions
                        .filter(
                          (action) => action !== "dataFolder" || api.desktop,
                        )
                        .map((action, index) => (
                          <button
                            key={action}
                            type="button"
                            className={index === 0 ? "ui-button ui-button--primary" : "ui-button"}
                            disabled={
                              opening ||
                              !!operation ||
                              !!state.availability[issue.id]?.[action]
                            }
                            title={state.availability[issue.id]?.[action]}
                            onClick={() => invoke(issue, action)}
                          >
                            {operation?.action === action ? (
                              <LoaderCircle
                                size={14}
                                className="session-recovery-spin"
                              />
                            ) : action === "dataFolder" ? (
                              <FolderOpen size={14} />
                            ) : null}
                            {recoveryActionLabels[action]}
                            {index === 0 && !operation && (
                              <ChevronRight size={14} />
                            )}
                          </button>
                        ))}
                      <button
                        type="button"
                        className="copy"
                        disabled={copying}
                        onClick={() => void copy(issue)}
                      >
                        <Clipboard size={14} />
                        复制这项说明
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="session-recovery-empty">
              <CheckCircle2 size={32} />
              <strong>
                {query ? "没有找到匹配的问题" : "当前没有待处理的问题"}
              </strong>
              <p>
                {query
                  ? "可以换一个文件、设备或状态词。"
                  : state.issues.length
                    ? "正在进行的准备与保存可在全部状态中查看。"
                    : "需要接续的导入、谱面与导出可从工作进度查看。"}
              </p>
              {state.issues.length > 0 && filter !== "all" && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  查看全部状态
                </button>
              )}
            </div>
          )}
          {state.recent.length > 0 && (
            <details className="session-recovery-recent">
              <summary>
                本次打开软件的处理记录 · {state.recent.length} 项
              </summary>
              <ol>
                {[...state.recent].reverse().map((result) => (
                  <li key={result.id}>
                    <div>
                      <strong>{recoveryActionLabels[result.action]}</strong>
                      <time
                        dateTime={new Date(result.finishedAt).toISOString()}
                      >
                        {new Date(result.finishedAt).toLocaleTimeString(
                          "zh-CN",
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          },
                        )}
                      </time>
                      <span>
                        {result.engineId &&
                        state.engineId &&
                        result.engineId !== state.engineId
                          ? "上次连接 · "
                          : ""}
                        {result.ok ? "已返回结果" : "待继续"}
                      </span>
                    </div>
                    <p>{result.detail}</p>
                  </li>
                ))}
              </ol>
            </details>
          )}
          {showDiagnostics && (
            <section
              className="session-recovery-diagnostics"
              aria-label="可复制的问题说明"
            >
              <div>
                <h3>问题与设备说明</h3>
                <button type="button" onClick={() => setShowDiagnostics(false)}>
                  收起
                </button>
              </div>
              <textarea
                aria-label="问题与设备说明，可选取复制"
                value={diagnostics}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                spellCheck={false}
              />
              <button type="button" onClick={inspect}>
                更新这份说明
              </button>
            </section>
          )}
        </div>
    </Dialog>
  );
}
