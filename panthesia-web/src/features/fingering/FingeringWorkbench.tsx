import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BrowsePagination } from "../../ui/legacy/BrowsePagination";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import {
  fingeringDraftId,
  type FingeringDraft,
  type FingeringWorkbenchStore,
} from "./fingeringWorkbenchStore";
import "./fingeringWorkbench.css";

export function FingeringWorkbenchButton({
  store,
  disabled,
  open,
}: {
  store: FingeringWorkbenchStore;
  disabled: boolean;
  open: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  if (!state.rows.length && !state.error) return null;
  return (
    <button
      disabled={disabled}
      onClick={open}
      aria-haspopup="dialog"
      className="fingering-workbench-button"
    >
      指法工作台 {state.rows.length || ""}
      {state.error && <span>暂存需处理</span>}
    </button>
  );
}

export function FingeringWorkbench({
  store,
  close,
  resume,
}: {
  store: FingeringWorkbenchStore;
  close: () => void;
  resume: (row: FingeringDraft) => Promise<boolean>;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const working = useRef(false);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return state.rows.filter(
      (row) =>
        !needle ||
        `${row.title} ${row.path}`.toLocaleLowerCase().includes(needle),
    );
  }, [state.rows, query]);
  const pageSize = 12;
  const current = Math.max(
    0,
    Math.min(page, Math.ceil(rows.length / pageSize) - 1),
  );
  const open = async (row: FingeringDraft) => {
    if (working.current) return;
    working.current = true;
    setBusy(fingeringDraftId(row));
    setError("");
    try {
      if (!(await resume(row)))
        setError("曲目尚未打开。可从曲库重新定位文件后，再继续这份输入。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      setBusy(null);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!working.current) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fingering-workbench-title"
        className="settings-dialog fingering-workbench"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="fingering-workbench-title">指法工作台</h2>
          <button
            autoFocus
            disabled={!!busy}
            onClick={close}
            aria-label="关闭指法工作台"
          >
            关闭
          </button>
        </div>
        <p className="parameter-help">
          这里保留推荐条件、固定手指和审阅选择。正式指法只有在“接受并保存”后才会改变；重新启动或资料更新后，需要按原输入重新推荐。
        </p>
        {state.error && (
          <div className="fingering-workbench-storage" role="alert">
            <p>{state.error}</p>
            <div className="fingering-workbench-actions">
              <button disabled={!!busy} onClick={store.retry}>
                重试暂存
              </button>
              <button disabled={!!busy} onClick={store.preserveAndSave}>
                保留原文副本并暂存当前输入
              </button>
              {store.original() !== null && (
                <CopyPracticeDraft
                  label="复制原有暂存原文"
                  value={store.original()}
                  plainText
                />
              )}
              <CopyPracticeDraft label="复制当前工作台" value={state.rows} />
            </div>
          </div>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <label className="fingering-workbench-search">
          查找指法输入
          <input
            type="search"
            value={query}
            disabled={!!busy}
            placeholder="曲名或文件位置"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <BrowsePagination
          label="指法输入"
          unit="份输入"
          page={current}
          total={rows.length}
          pageSize={pageSize}
          disabled={!!busy}
          change={setPage}
        />
        <div className="fingering-workbench-rows">
          {rows
            .slice(current * pageSize, (current + 1) * pageSize)
            .map((row) => (
              <article key={fingeringDraftId(row)}>
                <div>
                  <h3>{row.title}</h3>
                  <p>
                    音轨 {row.form.track + 1} ·{" "}
                    {row.form.hand === "left" ? "左手" : "右手"} ·{" "}
                    {row.form.scope === "note" && row.origin
                      ? `音符 ${row.origin.index + 1}`
                      : `第 ${row.form.first}–${row.form.last} 小节`}{" "}
                    · {Math.round(row.form.practiceRate * 100)}% 原速
                  </p>
                  <p>
                    {row.receipt
                      ? row.receipt === "saved"
                        ? "指法保存已完成，待读取实际结果"
                        : row.receipt === "undone"
                          ? "撤销已完成，待读取实际结果"
                          : row.receipt === "saving"
                            ? "上次保存的回执待核对，只读取当前实际指法"
                            : "上次撤销的回执待核对，只读取当前实际指法"
                      : `${Object.keys(row.pins).length} 处固定手指 · ${row.selection?.length ?? 0} 处勾选位置`}{" "}
                    · {new Date(row.updatedAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="fingering-workbench-actions">
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      void open(row);
                    }}
                  >
                    {busy === fingeringDraftId(row)
                      ? "正在打开曲目…"
                      : row.receipt
                        ? "读取实际指法"
                        : "继续审阅"}
                  </button>
                  <CopyPracticeDraft label="复制这份输入" value={row} />
                  <button
                    disabled={!!busy}
                    onClick={() => store.remove(fingeringDraftId(row))}
                  >
                    移除记录
                  </button>
                </div>
              </article>
            ))}
          {!rows.length && (
            <p className="fingering-workbench-empty">
              {query.trim()
                ? "没有匹配的指法输入，可以调整曲名或文件位置关键词。"
                : "暂时没有保留的指法输入。关闭指法建议窗口时，编辑内容会留在这里。"}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
