import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FilePenLine, X } from "lucide-react";
import { readLibraryMetadata } from "../library/metadataClient";
import { LibraryMetadataEditor } from "../../LibraryMetadataEditor";
import { SavedMetadataReceipt } from "./SavedMetadataReceipt";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import type { Metadata } from "../library/metadataTypes";
import {
  editDraftValue,
  type EditDraftStore,
  type EditDraftKind,
} from "./editDraftStore";
import "./editDrafts.css";

export function EditDraftButton({
  store,
  disabled,
  open,
}: {
  store: EditDraftStore;
  disabled: boolean;
  open: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  if (!state.count && !state.error) return null;
  return (
    <button
      className={`edit-draft-button${state.error ? " needs-attention" : ""}`}
      disabled={disabled || state.busy}
      aria-busy={state.busy}
      onClick={open}
      aria-label="未提交输入"
      title={
        state.error
          ? "输入暂存需要处理"
          : state.busy
            ? "编辑资料正在保存或读取，完成后可继续处理"
            : "继续编辑本机保留的输入"
      }
    >
      <FilePenLine size={16} />
      <span>未提交输入 {state.count}</span>
      {state.error ? <b>暂存失败</b> : state.busy ? <b>处理中</b> : null}
    </button>
  );
}

const identity = (key: string) => JSON.parse(key) as [string, string];
const kindLabels: Record<EditDraftKind, string> = {
  metadata: "曲目信息",
};
const metadataLabels = {
  title: "曲名",
  artist: "演奏者",
  composer: "作曲家",
  collection: "作品集",
  difficulty: "难度",
  tags: "标签",
  notes: "备注",
} as const;
const brief = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 180);
export function EditDraftCenter({
  store,
  close,
  changed,
  resumePractice,
}: {
  store: EditDraftStore;
  close: () => void;
  changed: () => Promise<void>;
  resumePractice: (contentId: string, path: string) => Promise<boolean>;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState<EditDraftKind | "all">("all"),
    [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [recoveries, setRecoveries] = useState<ReturnType<
    EditDraftStore["recoveries"]
  > | null>(null);
  const [recoveryPage, setRecoveryPage] = useState(0);
  const [metadata, setMetadata] = useState<{
    key: string;
    contentId: string;
    path: string;
    value: Metadata;
  } | null>(null);
  const [metadataReceipt, setMetadataReceipt] = useState<string | null>(null);
  const generation = useRef(0),
    mounted = useRef(true),
    working = useRef(false);
  const root = useRef<HTMLElement>(null);
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (metadata || metadataReceipt) {
      root.current
        ?.querySelector<HTMLElement>(
          ".edit-draft-receipt .primary-button, .edit-draft-editor input:not(:disabled), .edit-draft-editor textarea:not(:disabled)",
        )
        ?.focus({ preventScroll: true });
      return;
    }
  }, [metadata?.key, metadataReceipt]);
  useEffect(() => {
    if (
      metadata ||
      metadataReceipt ||
      busy ||
      !lastOpened.current
    )
      return;
    const button = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-edit-draft-key]",
      ) ?? []),
    ].find(
      (node) =>
        node.dataset.editDraftKey === lastOpened.current && !node.disabled,
    );
    if (button) {
      button.focus({ preventScroll: true });
      lastOpened.current = null;
    }
  }, [
    state.revision,
    metadata?.key,
    metadataReceipt,
    busy,
  ]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const rows = useMemo(
    () => [
      ...[...store.metadata].map(([key, value]) => {
        const fields = (
          Object.keys(metadataLabels) as (keyof typeof metadataLabels)[]
        ).filter(
          (field) =>
            editDraftValue(value.base[field]) !==
            editDraftValue(value.draft[field]),
        );
        if (
          !fields.includes("tags") &&
          value.tagsText !== undefined &&
          value.tagsText !== value.base.tags.join("，")
        )
          fields.push("tags");
        return {
          kind: "metadata" as const,
          key,
          contentId: identity(key)[0],
          path: identity(key)[1],
          title: value.draft.title || value.base.title || identity(key)[1],
          value,
          preview: value.refresh
            ? "资料已经保存，继续处理可刷新界面。"
            : value.submission
              ? "保存结果待核对，继续处理将读取实际资料并保留原修改。"
              : `修改了${fields.map((field) => metadataLabels[field]).join("、") || "曲目信息"}`,
          search:
            Object.values(value.draft).flat().join(" ") +
            " " +
            (value.tagsText ?? ""),
        };
      }),
    ],
    [state.revision, store],
  );
  const [removed, setRemoved] = useState<(typeof rows)[number] | null>(null);
  const remove = (row: (typeof rows)[number]) => {
    if (working.current || busy || store.isOpen(row.kind, row.key)) return;
    store[row.kind].delete(row.key);
    setRemoved(row);
  };
  const undoRemove = () => {
    if (!removed || busy) return;
    if (store[removed.kind].has(removed.key)) {
      setError(
        "这个位置已有新的输入，请先处理现有记录；刚移除的输入仍可复制。",
      );
      return;
    }
    store.metadata.set(removed.key, removed.value);
    setRemoved(null);
  };
  const matching = rows.filter(
    (row) =>
      (kind === "all" || row.kind === kind) &&
      `${row.title}\n${row.path}\n${row.search}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const lastPage = Math.max(0, Math.ceil(matching.length / 20) - 1),
    currentPage = Math.min(page, lastPage);
  const open = async (row: (typeof rows)[number]) => {
    if (working.current || store.isOpen(row.kind, row.key)) return;
    lastOpened.current = `${row.kind}:${row.key}`;
    working.current = true;
    setBusy(true);
    setError("");
    const token = ++generation.current;
    try {
      if (row.value.refresh) {
        setMetadataReceipt(row.key);
        return;
      }
      if (row.value.source === "practice") {
        if (!(await resumePractice(row.contentId, row.path)))
          throw new Error("暂时无法打开原曲目，草稿继续保留，可先复制输入。");
        close();
        return;
      }
      setReading(true);
      const result = await readLibraryMetadata(row.path, row.contentId);
      if (!mounted.current || token !== generation.current) return;
      if (
        result.contentId !== row.contentId ||
        !result.value ||
        !Array.isArray(result.value.tags)
      )
        throw new Error("曲目资料与原草稿来源不一致，请从曲库核对原文件。");
      if (mounted.current && token === generation.current)
        setMetadata({
          key: row.key,
          contentId: row.contentId,
          path: row.path,
          value: result.value,
        });
    } catch (failure) {
      if (mounted.current && token === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current && token === generation.current) {
        working.current = false;
        setBusy(false);
        setReading(false);
      }
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        ref={root}
        className="settings-dialog edit-draft-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-draft-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="edit-draft-title">未提交输入</h2>
            <p>按原曲目和演奏记录保留，正式保存前会核对最新资料。</p>
          </div>
          <button
            aria-label="关闭未提交输入"
            data-dialog-close
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {state.error && (
          <section className="edit-draft-storage" role="alert">
            <p>{state.error}</p>
            <div>
              <button disabled={busy || state.busy} onClick={store.retry}>
                重试暂存
              </button>
              <button
                disabled={busy || state.busy}
                onClick={store.preserveAndSave}
              >
                保留原文副本并暂存当前输入
              </button>
              <CopyPracticeDraft
                label="复制磁盘原文"
                value={state.error}
                plainText
                createText={() => {
                  const raw = store.original();
                  if (raw === null)
                    throw new Error("磁盘中没有可复制的草稿原文。");
                  return raw;
                }}
              />
              <CopyPracticeDraft
                label="复制当前输入集"
                value={state}
                plainText
                createText={store.copy}
              />
            </div>
          </section>
        )}
        <details className="edit-draft-recoveries">
          <summary>保留的原文副本</summary>
          <p>处理暂存冲突时保留的完整原文。复制后可单独核对其中的输入。</p>
          <button
            disabled={busy}
            onClick={() => {
              try {
                setRecoveries(store.recoveries());
                setRecoveryPage(0);
                setError("");
              } catch (failure) {
                setError(`原文副本读取失败：${String(failure)}`);
              }
            }}
          >
            读取副本清单
          </button>
          {recoveries && (
            <>
              <ul>
                {recoveries
                  .slice(recoveryPage * 10, (recoveryPage + 1) * 10)
                  .map((entry) => (
                    <li key={entry.key}>
                      <span>
                        {new Date(entry.createdAt).toLocaleString("zh-CN")}
                      </span>
                      <CopyPracticeDraft
                        label="复制原文副本"
                        value={entry.key}
                        plainText
                        createText={() => store.recovery(entry.key)}
                      />
                    </li>
                  ))}
              </ul>
              <p>
                {recoveries.length
                  ? `共 ${recoveries.length} 份原文副本`
                  : "暂时没有保留的原文副本。"}
              </p>
              {recoveries.length > 10 && (
                <nav aria-label="原文副本分页">
                  <button
                    disabled={recoveryPage === 0}
                    onClick={() => setRecoveryPage(recoveryPage - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {recoveryPage + 1} / {Math.ceil(recoveries.length / 10)}
                  </span>
                  <button
                    disabled={(recoveryPage + 1) * 10 >= recoveries.length}
                    onClick={() => setRecoveryPage(recoveryPage + 1)}
                  >
                    下一页
                  </button>
                </nav>
              )}
            </>
          )}
        </details>
        {removed && (
          <div className="edit-draft-undo" role="status">
            <span>已移除“{removed.title}”的暂存输入。</span>
            <button disabled={busy} onClick={undoRemove}>
              撤销移除
            </button>
            <CopyPracticeDraft
              label="复制刚移除的输入"
              value={removed}
              plainText
              createText={() => editDraftValue(removed)}
            />
          </div>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {busy &&
          !metadata &&
          !metadataReceipt && (
            <div className="edit-draft-loading" role="status">
              <span>正在准备原编辑位置…</span>
              {reading && (
                <button
                  onClick={() => {
                    generation.current++;
                    working.current = false;
                    setReading(false);
                    setBusy(false);
                    setError("已停止等待读取，原输入继续保留。");
                  }}
                >
                  停止等待读取
                </button>
              )}
            </div>
          )}
        {metadataReceipt ? (
          <div className="edit-draft-editor">
            <SavedMetadataReceipt
              key={metadataReceipt}
              store={store}
              memoryKey={metadataReceipt}
              changed={changed}
              close={() => setMetadataReceipt(null)}
              onBusy={setBusy}
            />
          </div>
        ) : metadata ? (
          <div className="edit-draft-editor">
            <button
              disabled={busy}
              data-dialog-escape
              onClick={() => setMetadata(null)}
            >
              返回草稿清单
            </button>
            <LibraryMetadataEditor
              key={metadata.key}
              edit={metadata}
              draftMemory={store.metadata}
              onBusy={setBusy}
              saved={changed}
              cancel={() => setMetadata(null)}
            />
          </div>
        ) : (
          <>
            <div className="edit-draft-search">
              <input
                type="search"
                aria-label="查找未提交输入"
                value={query}
                maxLength={4096}
                placeholder="曲名、文件位置或输入内容"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              <select
                aria-label="未提交输入类型"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as typeof kind);
                  setPage(0);
                }}
              >
                <option value="all">全部类型 · {rows.length}</option>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label} · {rows.filter((row) => row.kind === value).length}
                  </option>
                ))}
              </select>
            </div>
            <div className="edit-draft-list">
              <ul>
                {matching
                  .slice(currentPage * 20, (currentPage + 1) * 20)
                  .map((row) => (
                    <li key={`${row.kind}:${row.key}`}>
                      <div>
                        <strong>{row.title}</strong>
                        <span>
                          {kindLabels[row.kind]}
                          {row.kind === "metadata" && row.value.refresh
                            ? " · 待读取已保存结果"
                            : row.kind === "metadata" && row.value.submission
                              ? " · 保存结果待核对"
                              : ""}
                        </span>
                        <p className="edit-draft-preview">{row.preview}</p>
                        <small>{row.path}</small>
                      </div>
                      <div className="edit-draft-actions">
                        <button
                          data-edit-draft-key={`${row.kind}:${row.key}`}
                          disabled={busy || store.isOpen(row.kind, row.key)}
                          onClick={() => void open(row)}
                        >
                          {store.isOpen(row.kind, row.key)
                            ? "正在编辑"
                            : "继续处理"}
                        </button>
                        <CopyPracticeDraft
                          label="复制输入"
                          value={row.value}
                          plainText
                          createText={() =>
                            editDraftValue({
                              contentId: row.contentId,
                              path: row.path,
                              ...row.value,
                            })
                          }
                        />
                        <button
                          disabled={busy || store.isOpen(row.kind, row.key)}
                          onClick={() => remove(row)}
                        >
                          移除暂存
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
              {!matching.length && (
                <p className="edit-draft-empty">
                  {rows.length
                    ? "没有符合当前查找条件的输入。"
                    : "暂时没有未提交输入。曲目信息的修改会在这里保留。"}
                </p>
              )}
            </div>
            <nav className="edit-draft-pagination" aria-label="未提交输入分页">
              <span>
                {matching.length} 份 · {currentPage + 1} / {lastPage + 1} 页
              </span>
              <button
                disabled={busy || currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <button
                disabled={busy || currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
