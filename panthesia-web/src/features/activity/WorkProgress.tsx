import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Search,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  WorkEntry,
  WorkPhase,
  WorkProgressStore,
} from "./workProgressStore";
import "./workProgress.css";

const phaseLabel: Record<WorkPhase, string> = {
  running: "进行中",
  attention: "需处理",
  waiting: "待继续",
  completed: "已完成",
};
const PhaseIcon = ({ phase }: { phase: WorkPhase }) =>
  phase === "running" ? (
    <LoaderCircle size={16} className="work-progress-spin" />
  ) : phase === "attention" ? (
    <CircleAlert size={16} />
  ) : phase === "completed" ? (
    <CheckCircle2 size={16} />
  ) : (
    <Clock3 size={16} />
  );
export function WorkProgressButton({
  store,
  disabled,
  expanded,
  open,
}: {
  store: WorkProgressStore;
  disabled: boolean;
  expanded: boolean;
  open: () => void;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <button
      type="button"
      className={`work-progress-button ${snapshot.attention ? "needs-attention" : ""}`}
      disabled={disabled}
      aria-label={`工作进度${snapshot.pending ? `，${snapshot.pending} 项待处理` : ""}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={
        snapshot.attention
          ? `${snapshot.attention} 项需要处理，打开查看全部工作`
          : snapshot.running
            ? `${snapshot.running} 项正在处理`
            : "导入、备份、谱面与导出的工作进度"
      }
      onClick={open}
    >
      <Activity size={17} />
      <span>工作进度</span>
      {snapshot.pending > 0 && (
        <b aria-hidden="true">
          {snapshot.pending > 99 ? "99+" : snapshot.pending}
        </b>
      )}
    </button>
  );
}
export interface WorkOpenResult {
  ok: boolean;
  error?: string;
}
export function WorkProgressDialog({
  store,
  close,
  open,
}: {
  store: WorkProgressStore;
  close: () => void;
  open: (entry: WorkEntry, signal: AbortSignal) => Promise<WorkOpenResult>;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [filter, setFilter] = useState<
    "active" | "attention" | "running" | "waiting" | "completed" | "all"
  >("active");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null),
    [actions, setActions] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true),
    intent = useRef<AbortController | null>(null),
    busy = useRef(false),
    running = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      intent.current?.abort();
    };
  }, []);
  const rows = useMemo(() => {
    const words = query
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return snapshot.rows.filter((row) => {
      if (
        filter !== "all" &&
        !(filter === "active" && row.phase !== "completed") &&
        row.phase !== filter
      )
        return false;
      if (!words.length) return true;
      const text =
        `${row.title} ${row.subject} ${row.detail} ${row.keywords ?? ""} ${row.source?.path ?? ""} ${phaseLabel[row.phase]}`
          .normalize("NFKC")
          .toLocaleLowerCase("zh-CN");
      return words.every((word) => text.includes(word));
    });
  }, [snapshot, query, filter]);
  const visit = async (entry: WorkEntry) => {
    if (busy.current) return;
    busy.current = true;
    setOpening(entry.id);
    setError("");
    setNotice("");
    const controller = new AbortController();
    intent.current = controller;
    try {
      const result = await open(entry, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      if (result.ok) close();
      else setError(result.error || "暂时无法打开来源窗口，原任务继续保留。");
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy.current = false;
      if (intent.current === controller) intent.current = null;
      if (alive.current) setOpening(null);
    }
  };
  const readNow = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice("");
    try {
      await store.readNow();
    } catch (failure) {
      if (alive.current)
        setError(
          `进度暂未更新：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      if (alive.current) setRefreshing(false);
    }
  };
  const restoreFocus = () => {
    requestAnimationFrame(() => {
      if (
        alive.current &&
        (document.activeElement === document.body ||
          !document.activeElement?.isConnected)
      )
        search.current?.focus({ preventScroll: true });
    });
  };
  const stop = async (entry: WorkEntry) => {
    if (!entry.cancel || running.current.has(entry.id)) return;
    running.current.add(entry.id);
    setActions(new Set(running.current));
    setError("");
    setNotice("");
    try {
      await entry.cancel();
      if (alive.current)
        setNotice("停止请求已处理，请查看任务状态。已保留的结果可继续使用。");
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current.delete(entry.id);
      if (alive.current) {
        setActions(new Set(running.current));
        restoreFocus();
      }
    }
  };
  const copyInput = async (entry: WorkEntry) => {
    if (!entry.copy || running.current.has(entry.id)) return;
    running.current.add(entry.id);
    setActions(new Set(running.current));
    setError("");
    setNotice("");
    try {
      await navigator.clipboard.writeText(entry.copy());
      if (alive.current)
        setNotice(
          entry.target === "devices"
            ? "已复制设备任务诊断。"
            : "已复制原输入与来源信息。",
        );
    } catch (failure) {
      if (alive.current)
        setError(
          `复制尚未完成：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      running.current.delete(entry.id);
      if (alive.current) {
        setActions(new Set(running.current));
        restoreFocus();
      }
    }
  };
  const label = (entry: WorkEntry) =>
    entry.stale && entry.restoreScoreKey
      ? "取回初稿"
      : {
          scores: "查看谱面",
          score: "返回原谱",
          media: "查看导出",
          exercise: "查看练习",
          drafts: "查看草稿",
          devices: "查看设备",
          passage: "继续编辑段落",
          hands: "继续逐音分手",
          meter: "继续小节网格",
          "interface-settings": "打开界面与按键",
        }[entry.target];
  return (
    <div
      className="modal-backdrop work-progress-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !opening) close();
      }}
    >
      <section
        className="work-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-progress-title"
        aria-describedby="work-progress-description"
      >
        <header className="work-progress-heading">
          <div>
            <span className="work-progress-eyebrow">练习室 · 当前工作</span>
            <h2 id="work-progress-title">工作进度</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            data-dialog-close
            aria-label="关闭工作进度"
            disabled={!!opening}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <p id="work-progress-description" className="work-progress-description">
          {snapshot.pending
            ? `${snapshot.running} 项进行中，${snapshot.attention} 项需处理，${snapshot.waiting} 项待继续。`
            : "当前没有待处理的工作。"}
          关闭此窗口后，已开始的任务继续处理。
        </p>
        <div className="work-progress-tools">
          <label>
            <Search size={16} />
            <input
              ref={search}
              type="search"
              maxLength={512}
              disabled={!!opening}
              data-dialog-initial-focus
              aria-label="查找工作进度"
              placeholder="查找曲目、文件或工作"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="清除查找"
                disabled={!!opening}
                onClick={() => {
                  setQuery("");
                  search.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="work-progress-refresh"
            disabled={refreshing || !!opening || !snapshot.connected}
            onClick={() => void readNow()}
            title="重新读取已提交的任务；原文件与提交条件继续保留"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "work-progress-spin" : undefined}
            />
            {refreshing ? "读取中…" : "更新进度"}
          </button>
          <div
            className="work-progress-filters"
            role="group"
            aria-label="按工作状态筛选"
          >
            {(
              [
                ["active", "待处理", snapshot.pending],
                ["attention", "需处理", snapshot.attention],
                ["running", "进行中", snapshot.running],
                ["waiting", "待继续", snapshot.waiting],
                ["completed", "已完成", snapshot.completed],
                ["all", "全部", snapshot.rows.length],
              ] as const
            ).map(([value, text, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                disabled={!!opening}
                onClick={() => setFilter(value)}
              >
                {text}
                <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
        {opening && (
          <p className="work-progress-notice" role="status">
            正在打开来源工作台，原任务与输入继续保留…
          </p>
        )}
        {error && (
          <p className="work-progress-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="work-progress-notice" role="status">
            {notice}
          </p>
        )}
        <div className="work-progress-results" aria-busy={!!opening}>
          <p className="work-progress-result-count" role="status">
            {query
              ? `找到 ${rows.length} 项工作`
              : `显示 ${rows.length} 项工作`}
          </p>
          {rows.length ? (
            <ul>
              {rows.map((entry) => (
                <li
                  key={entry.id}
                  className={`work-progress-row phase-${entry.phase}`}
                >
                  <div className="work-progress-phase">
                    <PhaseIcon phase={entry.phase} />
                    <span>
                      {entry.stale ? "上次连接" : phaseLabel[entry.phase]}
                    </span>
                  </div>
                  <div className="work-progress-copy">
                    <div className="work-progress-row-heading">
                      <h3>{entry.title}</h3>
                      <span>{entry.subject}</span>
                    </div>
                    {entry.detail.length > 240 ? (
                      <details>
                        <summary>
                          {entry.detail.slice(0, 180)}… <span>展开说明</span>
                        </summary>
                        <p>{entry.detail}</p>
                      </details>
                    ) : (
                      <p>{entry.detail}</p>
                    )}
                  </div>
                  <div className="work-progress-row-actions">
                    <button
                      type="button"
                      disabled={!!opening || actions.has(entry.id)}
                      onClick={() => void visit(entry)}
                    >
                      {opening === entry.id ? (
                        <>
                          <LoaderCircle
                            size={14}
                            className="work-progress-spin"
                          />
                          正在打开
                        </>
                      ) : (
                        <>
                          {label(entry)}
                          <ArrowUpRight size={14} />
                        </>
                      )}
                    </button>
                    {entry.copy && (
                      <button
                        type="button"
                        className="work-progress-copy-input"
                        disabled={!!opening || actions.has(entry.id)}
                        onClick={() => void copyInput(entry)}
                      >
                        {entry.target === "devices" ? "复制诊断" : "复制输入"}
                      </button>
                    )}
                    {entry.cancel && (
                      <button
                        type="button"
                        className="work-progress-stop"
                        disabled={!!opening || actions.has(entry.id)}
                        onClick={() => void stop(entry)}
                      >
                        {actions.has(entry.id) ? "正在停止…" : "停止任务"}
                      </button>
                    )}
                    {entry.dismissible && (
                      <button
                        type="button"
                        disabled={!!opening || actions.has(entry.id)}
                        onClick={() => {
                          store.dismiss(entry);
                          restoreFocus();
                        }}
                      >
                        已知晓
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="work-progress-empty">
              <CheckCircle2 size={30} />
              <strong>
                {query
                  ? "没有找到匹配的工作"
                  : filter === "completed"
                    ? "暂无已完成记录"
                    : filter === "active"
                      ? "当前工作都已处理"
                      : "暂无这类工作"}
              </strong>
              <p>
                {query
                  ? "可以换一个曲目名、文件名或状态词。"
                  : "导入、谱面、设备连接、备份及导出开始后，可从这里查看和继续。"}
              </p>
              {filter !== "all" && snapshot.rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  查看全部工作
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="work-progress-footer">
          <span>查看工作会保留原请求；完成记录可暂时收起。</span>
          <button
            type="button"
            disabled={!snapshot.completed || !!opening}
            onClick={() => {
              store.hideCompleted();
              restoreFocus();
            }}
          >
            收起已完成
          </button>
        </footer>
      </section>
    </div>
  );
}
