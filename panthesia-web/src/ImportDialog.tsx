import { TaskActivity } from "./engine/TaskActivity";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X, FolderOpen, RefreshCw } from "lucide-react";
import { api } from "./api";
import { BatchScoreImportDialog } from "./BatchScoreImportDialog";
import {
  musicImportMessage,
  reconcileMusicRequeue,
  checkMusicReceipt,
  type ImportedSong,
} from "./features/imports/musicImportClient";
import { importNeedsFile } from "./features/imports/importQueueModel";
import { attachImportSources } from "./features/imports/importQueueSources";
import {
  getImportQueueRunner,
  refreshImportQueue,
  type ImportQueueRefresh,
} from "./features/imports/importQueueRunner";
import { PersistentSessionRecovery } from "./app/PersistentSessionRecovery";
import { BrowsePagination } from "./app/BrowsePagination";
import "./features/imports/importWorkbench.css";
import {
  createImportQueueStore,
  importable,
  type ImportItem,
  type ImportQueueStore,
} from "./features/imports/importQueueStore";

export function ImportDialog({
  close,
  changed,
  initialFiles = [],
  queue,
  openSong,
}: {
  close: () => void;
  changed: ImportQueueRefresh;
  initialFiles?: File[];
  queue?: ImportQueueStore;
  openSong: (song: ImportedSong) => Promise<boolean>;
}) {
  const [localQueue] = useState(() => queue ?? createImportQueueStore());
  const store = queue ?? localQueue;
  const runner = getImportQueueRunner(store);
  const {
    items,
    bpmInput,
    busy,
    stopping,
    error,
    storageError,
    refreshPending,
    filter,
    query,
    page,
  } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [pairOpen, setPairOpen] = useState(
    initialFiles.some((file) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name)),
  );
  const [pairFiles, setPairFiles] = useState<File[]>(initialFiles);
  const input = useRef<HTMLInputElement>(null),
    replacement = useRef<HTMLInputElement>(null),
    attachId = useRef<string | null>(null),
    replacements = useRef<HTMLInputElement>(null),
    attachment = useRef<AbortController | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState("");
  const mounted = useRef(true);
  const active = items.find((item) => item.state === "working");
  const visible = items.filter(
    (item) =>
      (filter === "all" ||
        (filter === "remaining"
          ? item.state !== "done"
          : item.state === filter)) &&
      item.source.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(visible.length / 30));
  const currentPage = Math.min(page, pages - 1);
  const shown = visible.slice(currentPage * 30, (currentPage + 1) * 30);
  const setError = (message: string) => store.update({ error: message });
  useEffect(() => {
    store.add(initialFiles.filter(importable));
  }, [store]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attachment.current?.abort();
    };
  }, []);
  const add = (files: File[]) => {
    if (files.some((file) => /\.(pdf|png|jpe?g|webp)$/i.test(file.name))) {
      if (store.getSnapshot().busy) {
        setError("当前文件仍在导入，暂停后可开始谱面配对。");
        return;
      }
      setPairFiles([
        ...store
          .getSnapshot()
          .items.flatMap((item) => (item.file ? [item.file] : [])),
        ...files,
      ]);
      setPairOpen(true);
      return;
    }
    store.add(files);
  };
  const refresh = () => refreshImportQueue(store, changed);
  const refreshOnly = () => runner.refresh(changed);
  const run = (only?: string) => runner.run(changed, only);
  const cancelCurrent = () => runner.cancelCurrent();
  const requeue = async (item: ImportItem) => {
    if (!store.claim()) return;
    try {
      const song = await reconcileMusicRequeue(item.receipt);
      if (song) {
        store.complete(item.id, song, item.receipt);
        await refresh();
        return;
      }
      store.patch(item.id, {
        state: "pending",
        receipt: undefined,
        message: "已核对曲库，等待重新导入",
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  const cancelPending = async (item: ImportItem) => {
    if (!item.receipt || !store.claim()) return;
    try {
      const result = checkMusicReceipt(
        item.receipt,
        await api.cancelMusicImport(item.receipt.id, item.receipt.kind),
      );
      if (result.phase === "done" && result.song)
        store.complete(item.id, result.song, result);
      else
        store.patch(item.id, {
          receipt: result,
          state:
            result.phase === "cancelled"
              ? "pending"
              : result.phase === "error"
                ? "error"
                : "review",
          message: musicImportMessage(result),
        });
      if (result.phase === "done") await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  const open = async (item: ImportItem) => {
    if (!item.song || !store.claim()) return;
    try {
      if (!(await openSong(item.song)))
        throw new Error("当前练习尚未保存完成，已导入结果继续保留。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      store.update({ busy: false });
    }
  };
  if (pairOpen)
    return (
      <BatchScoreImportDialog
        initialFiles={pairFiles}
        close={close}
        changed={() => refreshImportQueue(store, () => changed(false))}
        back={() => setPairOpen(false)}
        initialImports={items
          .filter((item) => item.song && item.file)
          .map((item) => ({ file: item.file!, song: item.song! }))}
        initialReceipts={items
          .filter((item) => item.receipt && item.file)
          .map((item) => ({ file: item.file!, receipt: item.receipt! }))}
        initialUnconfirmed={items
          .filter((item) => item.state === "review" && item.file)
          .map((item) => item.file!)}
        importProgress={(file, receipt, unconfirmed) =>
          store.track(file, receipt, unconfirmed)
        }
        imported={(file, song, receipt) => store.imported(file, song, receipt)}
      />
    );
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!attaching) close();
      }}
    >
      <section
        className="settings-dialog fingering-dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="import-title">导入曲目与乐谱</h2>
            <p>MIDI · MusicXML · MXL · PDF / 图片配对</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={attaching}
            aria-label="关闭导入"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <PersistentSessionRecovery
          store={store}
          error={storageError}
          busy={busy || attaching}
          label="导入队列进度"
        />
        <input
          hidden
          ref={replacement}
          type="file"
          accept=".mid,.midi,.musicxml,.xml,.mxl"
          aria-label="补选原导入文件"
          onChange={async (event) => {
            const file = event.target.files?.[0],
              id = attachId.current;
            event.target.value = "";
            attachId.current = null;
            if (!file || !id) return;
            setAttaching(true);
            try {
              await store.attach(id, file);
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            } finally {
              if (mounted.current) setAttaching(false);
            }
          }}
        />
        {busy && (
          <div className="import-background-note" role="status">
            <span>关闭此窗口后，当前导入会继续。可从顶部导入入口返回。</span>
            <button onClick={close}>后台继续</button>
          </div>
        )}
        <input
          hidden
          multiple
          ref={replacements}
          type="file"
          accept=".mid,.midi,.musicxml,.xml,.mxl"
          aria-label="批量补选队列原文件"
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length) return;
            const controller = new AbortController();
            attachment.current = controller;
            setAttaching(true);
            try {
              const result = await attachImportSources(
                store,
                files,
                controller.signal,
              );
              store.update({ error: result.issues.join("\n") });
              if (mounted.current)
                setAttachmentMessage(
                  `${controller.signal.aborted ? "已停止补选。" : ""}已核对 ${result.attached} 份原文件，${result.skipped} 份未匹配。${result.issues.length ? `另有 ${result.issues.length} 份需要处理。` : "可以继续导入。"}`,
                );
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            } finally {
              attachment.current = null;
              if (mounted.current) setAttaching(false);
            }
          }}
        />
        <div className="import-summary" aria-label="导入概况">
          <span>
            <strong>{items.length}</strong>份文件
          </span>
          <span>
            <strong>
              {items.filter((item) => item.state === "done").length}
            </strong>
            已完成
          </span>
          <span>
            <strong>
              {
                items.filter(
                  (item) => item.state === "review" || item.state === "error",
                ).length
              }
            </strong>
            待处理
          </span>
          <span>
            {busy
              ? stopping
                ? "本文件结束后暂停"
                : "正在导入"
              : items.some(importNeedsFile)
                ? "可补选原文件接续"
                : "原文件保留"}
          </span>
        </div>
        <TaskActivity
          label="准备导入曲目"
          taskId={active?.receipt?.taskId ?? "no-current-import"}
          cancelLabel="取消当前导入"
        />
        <div className="batch-import-actions">
          <button
            disabled={busy}
            onClick={() => {
              setPairFiles(
                items.flatMap((item) => (item.file ? [item.file] : [])),
              );
              setPairOpen(true);
            }}
          >
            批量配对谱面
          </button>
          <span>为多首曲目整理演奏乐谱、PDF 与连续图片</span>
        </div>
        <div
          className="import-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            add(Array.from(event.dataTransfer.files));
          }}
        >
          <FolderOpen size={24} />
          <span>拖入文件，或选择多个文件</span>
          <button disabled={attaching} onClick={() => input.current?.click()}>
            选择导入文件
          </button>
          <input
            hidden
            multiple
            ref={input}
            aria-label="导入曲目文件"
            type="file"
            accept=".mid,.midi,.musicxml,.xml,.mxl,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              add(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
        <div className="fingering-options">
          <label>
            乐谱默认速度
            <input
              aria-label="乐谱默认速度"
              type="text"
              inputMode="numeric"
              maxLength={16}
              value={bpmInput}
              disabled={busy}
              onChange={(event) =>
                store.update({
                  bpmInput: event.target.value,
                  ...(/^\d+$/.test(event.target.value) &&
                  Number(event.target.value) >= 20 &&
                  Number(event.target.value) <= 400
                    ? { bpm: Number(event.target.value) }
                    : {}),
                })
              }
            />
          </label>
          <p className="parameter-help">
            MIDI 上限 32 MB，MusicXML / MXL 上限 4
            MB。文件分块传输，原文件保留；乐谱中的速度标记优先。队列名称与结果会暂存。关闭导入窗口后继续处理；重启后可补选原文件，读取已有结果。
          </p>
        </div>
        {refreshPending && (
          <div className="workspace-selection-note" role="status">
            <span>已有文件保存成功，可只重读练习室与曲库。</span>
            <button disabled={busy} onClick={() => void refreshOnly()}>
              <RefreshCw size={14} />
              重读已导入结果
            </button>
          </div>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {attachmentMessage && (
          <p className="import-attachment-result" role="status">
            {attachmentMessage}
          </p>
        )}
        <div className="import-queue-toolbar">
          {items.some(importNeedsFile) && (
            <button
              disabled={busy || attaching}
              onClick={() => replacements.current?.click()}
            >
              批量补选原文件
            </button>
          )}
          {attaching && attachment.current && (
            <button onClick={() => attachment.current?.abort()}>
              停止补选
            </button>
          )}
          <label>
            查找文件
            <input
              type="search"
              value={query}
              placeholder="输入文件名"
              onChange={(event) =>
                store.update({ query: event.target.value, page: 0 })
              }
            />
          </label>
          <label>
            显示
            <select
              value={filter}
              onChange={(event) =>
                store.update({
                  filter: event.target.value as typeof filter,
                  page: 0,
                })
              }
            >
              <option value="all">全部文件（{items.length}）</option>
              <option value="remaining">
                剩余文件（{items.filter((item) => item.state !== "done").length}
                ）
              </option>
              <option value="review">
                待确认（{items.filter((item) => item.state === "review").length}
                ）
              </option>
              <option value="done">
                已完成（{items.filter((item) => item.state === "done").length}）
              </option>
            </select>
          </label>
          <span role="status">
            {active
              ? `正在处理：${active.source.name}`
              : `共 ${visible.length} 个匹配文件`}
          </span>
        </div>
        <div className="fingering-table-wrap">
          <table className="fingering-table">
            <thead>
              <tr>
                <th>文件</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    {items.length
                      ? "没有匹配的文件，可调整查找条件。"
                      : "请选择或拖入文件，开始整理曲库。"}
                  </td>
                </tr>
              )}
              {shown.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong className="import-file-name">
                      {item.source.name}
                    </strong>
                    <div className="parameter-help">
                      {(item.source.size / 1024).toFixed(0)} KB
                      {importNeedsFile(item) && (
                        <span className="import-file-missing">
                          {" "}
                          · 原文件待补选
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className={
                      item.state === "error" || item.state === "review"
                        ? "dialog-error"
                        : ""
                    }
                  >
                    {item.message}
                    {!!item.song?.importWarnings.length && (
                      <details className="import-file-warnings">
                        <summary>
                          查看 {item.song.importWarnings.length} 条导入提示
                        </summary>
                        <ul>
                          {item.song.importWarnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>
                    {importNeedsFile(item) && (
                      <button
                        disabled={busy || attaching}
                        aria-label={`补选原文件：${item.source.name}`}
                        onClick={() => {
                          attachId.current = item.id;
                          replacement.current?.click();
                        }}
                      >
                        补选原文件
                      </button>
                    )}
                    {item.song ? (
                      <button
                        disabled={busy}
                        aria-label={`打开练习：${item.song.title}`}
                        onClick={() => void open(item)}
                      >
                        打开练习
                      </button>
                    ) : item.state === "review" ? (
                      <>
                        <button
                          disabled={busy || !item.receipt}
                          aria-label={`处理导入文件：${item.source.name}`}
                          onClick={() => void run(item.id)}
                        >
                          {item.receipt?.catalogOnly &&
                          item.receipt.phase === "unconfirmed" &&
                          item.receipt.song
                            ? "接续谱面登记"
                            : "继续读取原请求"}
                        </button>
                        {item.receipt?.cancellable && (
                          <button
                            disabled={busy}
                            onClick={() => void cancelPending(item)}
                          >
                            取消原请求
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => void requeue(item)}
                        >
                          已核对曲库，重新排队
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={busy || attaching || !item.file}
                          aria-label={`处理导入文件：${item.source.name}`}
                          onClick={() => void run(item.id)}
                        >
                          {item.state === "error" ? "重试此文件" : "导入此文件"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            store.update((old) => ({
                              ...old,
                              items: old.items.filter(
                                (row) => row.id !== item.id,
                              ),
                            }))
                          }
                        >
                          移除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BrowsePagination
          page={currentPage}
          total={visible.length}
          pageSize={30}
          disabled={false}
          label="导入文件"
          unit="份"
          change={(page) => store.update({ page })}
        />
        <div className="dialog-actions">
          <span>
            已完成 {items.filter((item) => item.state === "done").length} /{" "}
            {items.length}
          </span>
          {busy ? (
            <>
              <button
                disabled={stopping}
                onClick={() => {
                  runner.pause();
                }}
              >
                {stopping ? "本文件结束后暂停" : "完成当前文件后暂停"}
              </button>
              {active?.receipt?.cancellable && (
                <button onClick={() => void cancelCurrent()}>
                  取消当前文件并暂停
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={close}>完成</button>
              <button
                disabled={!items.some((item) => item.state === "done")}
                onClick={() =>
                  store.update((old) => ({
                    ...old,
                    items: old.items.filter((item) => item.state !== "done"),
                  }))
                }
              >
                移除已完成项
              </button>
            </>
          )}
          <button
            className="primary-button"
            disabled={
              busy ||
              attaching ||
              !items.some(
                (item) => item.state !== "done" && (item.file || item.receipt),
              )
            }
            onClick={() => void run()}
          >
            {items.some((item) => item.state !== "pending")
              ? "继续处理剩余文件"
              : "开始导入"}
          </button>
        </div>
      </section>
    </div>
  );
}
