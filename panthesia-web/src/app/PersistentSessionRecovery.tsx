import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Clipboard, Copy, RefreshCw } from "lucide-react";
import type {
  PersistentSessionRecovery as RecoveryStore,
  PreservedSessionCopy,
} from "./createPersistentSession";
import "./persistentSessionRecovery.css";

export function PersistentSessionRecovery({
  store,
  error,
  busy,
  label,
  inputLabel = "当前输入",
  adoptedMessage = "原记录已保留为本机副本，当前输入已采用。原提交编号与处理结果继续保留。",
}: {
  store: RecoveryStore;
  error: string;
  busy: boolean;
  label: string;
  inputLabel?: string;
  adoptedMessage?: string;
}) {
  const recovery = useSyncExternalStore(
    store.subscribe,
    store.getRecoverySnapshot,
    store.getRecoverySnapshot,
  );
  const [copies, setCopies] = useState<PreservedSessionCopy[]>([]),
    [text, setText] = useState(""),
    [textTitle, setTextTitle] = useState("");
  const [message, setMessage] = useState(""),
    [failure, setFailure] = useState(""),
    [working, setWorking] = useState(false);
  const alive = useRef(true),
    copying = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const list = () => {
    try {
      setCopies(store.listPreserved());
    } catch (error) {
      setFailure(
        `保留副本列表暂未读取：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  useEffect(() => {
    list();
  }, [store, recovery.version]);
  const copy = async (kind: "current" | "original" | string) => {
    if (copying.current) return;
    copying.current = true;
    setWorking(true);
    setFailure("");
    setMessage("");
    try {
      const value =
        kind === "current"
          ? store.copyInput()
          : kind === "original"
            ? store.originalText()
            : store.preservedText(kind);
      if (value === null)
        throw new Error("这份原文尚未读到，当前输入继续保留。");
      setText(value);
      setTextTitle(kind === "current" ? inputLabel : "保留的原文");
      try {
        await navigator.clipboard.writeText(value);
        if (alive.current)
          setMessage("已复制。下方保留这份说明，可再次选取复制。");
      } catch {
        if (alive.current)
          setMessage("可以在下方选取原文，使用复制快捷键保存。");
      }
    } catch (error) {
      if (alive.current)
        setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      copying.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const adopt = () => {
    setFailure("");
    setMessage("");
    try {
      store.adoptCurrent();
      setMessage(adoptedMessage);
      list();
    } catch (error) {
      setFailure(
        `${inputLabel}尚未采用：${error instanceof Error ? error.message : String(error)}。原记录继续保留。`,
      );
    }
  };
  if (!error && !copies.length && !message && !failure && !textTitle)
    return null;
  return (
    <section
      className="persistent-session-recovery"
      aria-label={`${label}的暂存与保留原文`}
    >
      {error && (
        <div className="persistent-session-problem" role="alert">
          <strong>{label}暂存需要处理</strong>
          <p>{error}</p>
          <div>
            <button
              type="button"
              disabled={busy || working || recovery.protected}
              title={
                recovery.protected
                  ? "原记录受到保护，请先查看原文。"
                  : undefined
              }
              onClick={store.retrySave}
            >
              <RefreshCw size={14} />
              重试暂存
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => void copy("current")}
            >
              <Clipboard size={14} />
              复制{inputLabel}
            </button>
            {recovery.originalAvailable && (
              <button
                type="button"
                disabled={working}
                onClick={() => void copy("original")}
              >
                <Copy size={14} />
                查看并复制原文
              </button>
            )}
            {recovery.protected && (
              <button type="button" disabled={busy || working} onClick={adopt}>
                保留原文副本，采用{inputLabel}
              </button>
            )}
          </div>
          {recovery.protected && (
            <p>
              采用{inputLabel}
              前，会先在本机保留原文副本。空间不足或原记录再次改变时，原记录继续保持原状。
            </p>
          )}
        </div>
      )}
      {message && (
        <p className="persistent-session-message" role="status">
          {message}
        </p>
      )}
      {failure && (
        <p className="persistent-session-failure" role="alert">
          {failure}
        </p>
      )}
      {copies.length > 0 && (
        <details>
          <summary>保留的原文副本 · 最近 {copies.length} 份</summary>
          <ul>
            {copies.map((row) => (
              <li key={row.key}>
                <time dateTime={new Date(row.createdAt).toISOString()}>
                  {new Date(row.createdAt).toLocaleString("zh-CN")}
                </time>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void copy(row.key)}
                >
                  查看并复制
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={list}>
            刷新副本列表
          </button>
        </details>
      )}
      {textTitle && (
        <div className="persistent-session-text">
          <div>
            <strong>{textTitle}</strong>
            <button
              type="button"
              onClick={() => {
                setText("");
                setTextTitle("");
              }}
            >
              收起原文
            </button>
          </div>
          <textarea
            readOnly
            value={text}
            aria-label={textTitle}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </section>
  );
}
