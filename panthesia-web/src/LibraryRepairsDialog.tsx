import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { api, type EngineCommand } from "./api";
import { TaskActivity } from "./engine/TaskActivity";
import { useHistoryRead } from "./engine/useHistoryRead";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import {
  createRepairSessionStore,
  repairIdentity,
  isRepairResult,
  type RepairSessionStore,
  type RepairItem as Item,
  type RepairResult,
} from "./features/library/repairSessionStore";
import type {
  LibraryPathState,
  RepairLocation as Location,
  RepairGroup as Group,
  RepairInventory as Inventory,
  MidiReplacementPage as Replacements,
  MidiReplacementPreview as ReplacementPreview,
  LibraryRelinkResult,
} from "./engine/commands.generated";
export type { RepairResult } from "./features/library/repairSessionStore";
import { key } from "./libraryQuery";
const identity = (id: string, path: string) =>
  repairIdentity({ contentId: id, from: path });
export function LibraryRepairsDialog({
  engineId,
  close,
  changed,
  initialKind = "missing",
  session,
}: {
  engineId?: string;
  close: () => void;
  changed: () => Promise<void>;
  initialKind?: string;
  session?: RepairSessionStore;
}) {
  const [local] = useState(() => session ?? createRepairSessionStore());
  const command = <T,>(value: EngineCommand) =>
    api.commandForEngine<T>(engineId, value);
  const store = session ?? local;
  const stored = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const selected = stored.selected,
    results = stored.results;
  const setSelected = (action: SetStateAction<Record<string, Item>>) => {
    const current = store.getSnapshot();
    const next =
      typeof action === "function" ? action(current.selected) : action;
    store.update({
      selected: Object.fromEntries(
        Object.entries(next).filter(([id]) => !current.unconfirmed[id]),
      ),
    });
  };
  const [progress, setProgress] = useState("");
  const stop = useRef(false);
  const [indexProgress, setIndexProgress] = useState<{
    status: string;
    done: number;
    total: number;
    errors: number;
  } | null>(null);
  const [kind, setKind] = useState(initialKind),
    [query, setQuery] = useState(""),
    [resolved, setResolved] = useState(false),
    [offset, setOffset] = useState(0);
  const [inventory, setData] = useState<Inventory | null>(null),
    [replacements, setReplacementData] = useState<Replacements | null>(null),
    [replacementPreview, setReplacementPreview] =
      useState<ReplacementPreview | null>(null),
    [replacementTarget, setReplacementTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const locationReads = useHistoryRead(engineId);
  const scopeKey = JSON.stringify([
    engineId ?? null,
    kind,
    query,
    resolved,
    offset,
  ]);
  const [readScope, setReadScope] = useState("");
  const data = readScope === scopeKey ? inventory : null;
  const replacementData = readScope === scopeKey ? replacements : null;
  const alive = useRef(true),
    requestVersion = useRef(0),
    working = useRef(false);
  const reload = async () => {
    const version = ++requestVersion.current;
    if (kind === "replacements") {
      const next = await command<Replacements>({
        type: "midiReplacements",
        query,
        include_reviewed: resolved,
        offset,
        limit: 25,
      });
      if (alive.current && version === requestVersion.current) {
        setReplacementData(next);
        setReadScope(scopeKey);
        if (next.offset !== offset) setOffset(next.offset);
      }
      return;
    }
    const read = locationReads.request<Inventory>({
      type: "libraryRepairs",
      query,
      kind,
      include_resolved: resolved,
      offset,
      limit: 25,
    });
    const next = await read.result;
    if (
      alive.current &&
      version === requestVersion.current &&
      read.isCurrent()
    ) {
      setData(next);
      setReadScope(scopeKey);
      if (next.offset !== offset) setOffset(next.offset);
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestVersion.current++;
    };
  }, []);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!working.current) {
        try {
          await reload();
          const progress = await command<{
            status: string;
            done: number;
            total: number;
            errors: number;
          }>({ type: "indexStatus" });
          if (!stopped) setIndexProgress(progress);
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(() => void poll(), 180);
    return () => {
      stopped = true;
      clearTimeout(timer);
      locationReads.invalidate();
      requestVersion.current++;
    };
  }, [query, kind, resolved, offset, engineId, locationReads]);
  useEffect(() => {
    setReplacementPreview(null);
    setIndexProgress(null);
  }, [engineId]);
  useEffect(() => {
    setOffset(0);
    setChoices({});
    setReplacementPreview(null);
    setReplacementData(null);
  }, [kind, query, resolved]);
  const work = async (job: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    stop.current = false;
    setBusy(true);
    setError("");
    try {
      await job();
      await reload();
      await changed();
      store.update({ refreshPending: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      setProgress("");
      if (alive.current) setBusy(false);
    }
  };
  const choice = (g: Group, p: Location) => {
    const retained =
      selected[identity(g.contentId, p.path)] ??
      stored.unconfirmed[identity(g.contentId, p.path)];
    if (retained) return retained.to;
    const chosen = choices[identity(g.contentId, p.path)];
    if (chosen && g.candidates.includes(chosen) && key(chosen) !== key(p.path))
      return chosen;
    if (g.candidates.length === 1 && key(g.candidates[0]) !== key(p.path))
      return g.candidates[0];
    if (
      kind === "duplicates" &&
      g.primaryPath &&
      key(g.primaryPath) !== key(p.path) &&
      g.candidates.includes(g.primaryPath)
    )
      return g.primaryPath;
    return "";
  };
  const select = (g: Group, p: Location, checked: boolean) => {
    const id = identity(g.contentId, p.path),
      to = choice(g, p);
    setSelected((old) => {
      const next = { ...old };
      if (checked && to) {
        if (Object.keys(next).length >= 100 && !next[id]) {
          setError("一次最多处理 100 个位置，请先处理已选项");
          return old;
        }
        next[id] = { contentId: g.contentId, from: p.path, to };
      } else delete next[id];
      return next;
    });
  };
  const choose = (g: Group, p: Location, to: string) => {
    const id = identity(g.contentId, p.path);
    setChoices((old) => ({ ...old, [id]: to }));
    setSelected((old) => {
      if (!old[id]) return old;
      const next = { ...old };
      if (to) next[id] = { contentId: g.contentId, from: p.path, to };
      else delete next[id];
      return next;
    });
  };
  const eligible = (p: Location) =>
    !p.resolved &&
    !p.ignored &&
    (kind === "duplicates" ? p.available : !p.available);
  const selectPage = () => {
    const next: Record<string, Item> = {};
    for (const g of data?.groups ?? [])
      for (const p of g.paths) {
        const to = choice(g, p);
        if (eligible(p) && to && Object.keys(next).length < 100)
          next[identity(g.contentId, p.path)] = {
            contentId: g.contentId,
            from: p.path,
            to,
          };
      }
    setSelected((old) => {
      const all = Object.entries({ ...old, ...next });
      if (all.length > 100)
        setError("已保留前 100 个位置；处理后可以继续选择其余位置。");
      return Object.fromEntries(all.slice(0, 100));
    });
  };
  const rememberResult = (row: RepairResult) => {
    const current = store.getSnapshot(),
      id = repairIdentity(row);
    store.update({
      results: [
        ...current.results.filter((old) => repairIdentity(old) !== id),
        row,
      ].slice(-100),
      refreshPending: current.refreshPending || row.ok,
    });
  };
  const repair = async (items: Item[]) => {
    for (const [index, item] of items.entries()) {
      if (stop.current) break;
      const id = repairIdentity(item),
        current = store.getSnapshot();
      if (current.unconfirmed[id])
        throw new Error("此位置已有待核对结果，请先读取当前关联。");
      setProgress(
        `关联 ${index + 1} / ${items.length}：${item.from.split(/[\\/]/).pop()}`,
      );
      const next = { ...current.selected };
      delete next[id];
      store.update({
        selected: next,
        unconfirmed: { ...current.unconfirmed, [id]: item },
      });
      try {
        const reply = await command<LibraryRelinkResult>({
          type: "relinkLibrary",
          items: [item],
        });
        const result = reply.results?.[0];
        if (
          reply.results?.length !== 1 ||
          !isRepairResult(result) ||
          result.contentId !== item.contentId ||
          key(result.from) !== key(item.from) ||
          key(result.to) !== key(item.to)
        )
          throw new Error("关联回执与原位置不一致。");
        const latest = store.getSnapshot(),
          pending = { ...latest.unconfirmed };
        delete pending[id];
        store.update({
          unconfirmed: pending,
          selected: result.ok
            ? latest.selected
            : { ...latest.selected, [id]: item },
        });
        rememberResult(result);
      } catch (e) {
        throw new Error(
          `此位置的关联结果待核对，原位置和目标已保留：${String(e)}`,
        );
      }
    }
  };
  const verifyPending = async () => {
    for (const item of Object.values(store.getSnapshot().unconfirmed)) {
      if (stop.current) break;
      setProgress(`核对关联：${item.from.split(/[\\/]/).pop()}`);
      const state = await command<LibraryPathState>({
        type: "readLibraryPath",
        content_id: item.contentId,
        path: item.from,
      });
      if (
        state.contentId !== item.contentId ||
        key(state.path) !== key(item.from)
      )
        throw new Error("位置核对结果与原请求不一致。");
      if (state.linkedTo && key(state.linkedTo) === key(item.to)) {
        const pending = { ...store.getSnapshot().unconfirmed };
        delete pending[repairIdentity(item)];
        store.update({ unconfirmed: pending });
        rememberResult({
          ...item,
          ok: true,
          warnings: ["重新读取后，当前位置记录已与原目标一致。"],
        });
      } else
        setError(
          "尚未核对到原目标关联。原输入继续保留，可按原位置重新关联或复制保存。",
        );
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
        className="settings-dialog library-repairs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-repairs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="library-repairs-title">文件位置</h2>
            <p>核对缺失文件和同内容的多个位置，保留原有练习记录。</p>
          </div>
          <button
            autoFocus
            aria-label="返回曲库管理"
            data-dialog-close=""
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <TaskActivity
          label={[
            "读取曲目文件位置",
            "读取文件内容变化",
            "比较文件内容变化",
            "保存文件变化处理",
            "关联曲目文件位置",
            "保存曲目文件位置",
            "核对曲目文件位置",
          ]}
          cancelLabel="停止本次准备或读取"
          onCancelRequested={() => {
            stop.current = true;
          }}
        />
        {progress && (
          <p role="status">
            {progress}
            <button
              onClick={() => {
                stop.current = true;
              }}
            >
              处理完当前项后停止
            </button>
          </p>
        )}
        {stored.storageError && (
          <p className="dialog-error" role="alert">
            {stored.storageError}
          </p>
        )}
        {stored.refreshPending && (
          <p role="status">
            文件位置已保存，曲库刷新尚未完成。
            <button disabled={busy} onClick={() => void work(async () => {})}>
              重试刷新曲库
            </button>
          </p>
        )}
        <div
          className="library-repair-tabs"
          role="tablist"
          aria-label="文件位置分类"
        >
          {[
            ["missing", `缺失文件 ${data?.missingFiles ?? ""}`],
            [
              "replacements",
              `原路径内容变化 ${kind === "replacements" ? (replacementData?.total ?? "") : (data?.replacementCount ?? "")}`,
            ],
            ["duplicates", `重复路径 ${data?.duplicateGroups ?? ""}`],
            ["unverified", `待核对 ${data?.unverifiedFiles ?? ""}`],
            ["resolved", `已处理 ${data?.resolvedFiles ?? ""}`],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={kind === value}
              disabled={busy}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="library-repair-toolbar">
          <input
            aria-label="文件位置搜索"
            placeholder="曲名或文件路径"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label>
            <input
              aria-label="显示已处理位置"
              type="checkbox"
              checked={resolved}
              disabled={busy}
              onChange={(e) => setResolved(e.target.checked)}
            />{" "}
            显示已处理位置
          </label>
          <button
            disabled={
              busy ||
              indexProgress?.status === "running" ||
              indexProgress?.status === "paused"
            }
            onClick={() =>
              void work(async () => {
                const paths = [
                  ...new Set(
                    data?.groups.flatMap((g) =>
                      g.paths.filter((p) => p.present).map((p) => p.path),
                    ) ?? [],
                  ),
                ];
                if (paths.length > 50000)
                  throw new Error("本页位置超过 50000 个，请按曲目逐项核对");
                if (paths.length) {
                  setIndexProgress(
                    await command({
                      type: "indexLibrary",
                      paths,
                      force: true,
                    }),
                  );
                }
              })
            }
          >
            检查本页位置
          </button>
        </div>
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        {indexProgress &&
          ["running", "paused"].includes(indexProgress.status) && (
            <p role="status" className="library-repair-help">
              正在核对位置 {indexProgress.done}/{indexProgress.total} ·{" "}
              {indexProgress.errors} 项需要处理
            </p>
          )}
        <p className="library-repair-help">
          {kind === "replacements"
            ? "文件在原路径换成新内容后，旧指法、批注和练习记录仍按旧 MIDI 内容保存。先预览，再选择旧曲目和新文件各自的去向。"
            : "关联前再次核对 MIDI 内容；相同名称不代表同一首曲目。新位置已有附加信息优先，原文件保留。"}
        </p>
        <div className="library-repair-scroll">
          {(Object.keys(selected).length > 0 ||
            Object.keys(stored.unconfirmed).length > 0 ||
            !!stored.storageError) && (
            <section
              className="library-repair-results library-repair-recovery"
              aria-label="保留的文件关联输入"
            >
              <h3>
                关联输入 · 待处理 {Object.keys(selected).length} · 结果待核对{" "}
                {Object.keys(stored.unconfirmed).length}
              </h3>
              <p>
                选择跨页保留，关闭后可以继续处理。保存结果待核对时，可读取当前位置记录。
              </p>
              <CopyPracticeDraft
                value={{ selected, unconfirmed: stored.unconfirmed, results }}
                label="复制关联输入与结果"
              />
              {stored.storageError && (
                <CopyPracticeDraft
                  value={store.originalText()}
                  plainText
                  label="复制原暂存原文"
                />
              )}
              {!!Object.keys(stored.unconfirmed).length && (
                <button
                  disabled={busy}
                  onClick={() => void work(verifyPending)}
                >
                  核对待确认关联
                </button>
              )}
              {Object.values(stored.unconfirmed).map((item) => (
                <div
                  key={repairIdentity(item)}
                  className="library-repair-pending"
                >
                  <p className="file-path">
                    {item.from} → {item.to}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        const current = store.getSnapshot(),
                          pending = { ...current.unconfirmed };
                        delete pending[repairIdentity(item)];
                        store.update({
                          unconfirmed: pending,
                          selected: {
                            ...current.selected,
                            [repairIdentity(item)]: item,
                          },
                        });
                        await repair([item]);
                      })
                    }
                  >
                    按原位置重新关联
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const pending = { ...store.getSnapshot().unconfirmed };
                      delete pending[repairIdentity(item)];
                      store.update({ unconfirmed: pending });
                    }}
                  >
                    移除这份暂存输入
                  </button>
                </div>
              ))}
              {!!Object.keys(selected).length && (
                <details>
                  <summary>
                    查看全部所选位置 · {Object.keys(selected).length}
                  </summary>
                  {Object.values(selected).map((item) => (
                    <div
                      key={repairIdentity(item)}
                      className="library-repair-pending"
                    >
                      <p className="file-path">
                        {item.from} → {item.to}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          setSelected((old) => {
                            const next = { ...old };
                            delete next[repairIdentity(item)];
                            return next;
                          })
                        }
                      >
                        取消此项
                      </button>
                    </div>
                  ))}
                </details>
              )}
            </section>
          )}

          {kind === "replacements" &&
            replacementData?.rows.map((r) => {
              const preview =
                replacementPreview?.path === r.path &&
                replacementPreview.oldContentId === r.oldContentId &&
                replacementPreview.newContentId === r.newContentId
                  ? replacementPreview
                  : null;
              const decided =
                r.review?.action === "keep"
                  ? "保留旧曲目，暂不显示新文件"
                  : r.review?.action === "new"
                    ? "新文件作为新曲目显示"
                    : r.review?.action === "relink"
                      ? `旧曲目已关联至 ${r.review.target}`
                      : "待审阅";
              return (
                <section
                  key={`${r.oldContentId}|${r.path}`}
                  className="library-repair-group"
                >
                  <div className="library-repair-heading">
                    <h3>{r.title}</h3>
                    <small>{decided}</small>
                  </div>
                  <p title={r.path}>{r.path}</p>
                  <p>
                    旧 MIDI：{r.oldNotes} 个音符 · {r.oldTracks} 条声部 ·{" "}
                    {r.oldDuration.toFixed(1)} 秒 · 内容{" "}
                    {r.oldContentId.slice(0, 12)}
                  </p>
                  <p>
                    现有 MIDI：{r.newNotes} 个音符 · {r.newTracks} 条声部 ·{" "}
                    {r.newDuration.toFixed(1)} 秒 · 内容{" "}
                    {r.newContentId.slice(0, 12)}
                  </p>
                  <button
                    disabled={busy || !r.available}
                    onClick={() =>
                      void work(async () => {
                        const next = await command<ReplacementPreview>({
                          type: "previewMidiReplacement",
                          path: r.path,
                          old_content_id: r.oldContentId,
                          new_content_id: r.newContentId,
                        });
                        setReplacementPreview(next);
                        setReplacementTarget(next.candidates[0] ?? "");
                      })
                    }
                  >
                    核对音符与处理方式
                  </button>
                  {r.error && (
                    <p role="alert" className="dialog-error">
                      {r.error}
                    </p>
                  )}
                  {preview && (
                    <div
                      className="library-repair-path"
                      aria-label="MIDI 内容变化预览"
                    >
                      <div>
                        {preview.exact ? (
                          <p>
                            逐音核对：相同 {preview.exact.matched}{" "}
                            个，旧曲目独有 {preview.exact.oldOnly}{" "}
                            个，新文件独有 {preview.exact.newOnly}{" "}
                            个。核对所用旧文件：{preview.oldSource}
                          </p>
                        ) : (
                          <p>
                            旧 MIDI
                            原件暂不可用。当前只能比较索引记录中的音符数、声部数和时长；系统不会据此迁移旧指法或批注。
                          </p>
                        )}
                        <p>
                          旧内容和新内容的身份不同。练习历史继续归属旧内容。
                        </p>
                        <label>
                          旧曲目的正确位置{" "}
                          <select
                            aria-label={`旧曲目的正确位置 ${r.path}`}
                            value={replacementTarget}
                            onChange={(e) =>
                              setReplacementTarget(e.target.value)
                            }
                          >
                            <option value="">尚未找到</option>
                            {preview.candidates.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="library-repair-path-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void work(async () => {
                              await command({
                                type: "decideMidiReplacement",
                                path: r.path,
                                old_content_id: r.oldContentId,
                                new_content_id: r.newContentId,
                                token: preview.token,
                                action: "keep",
                                target: null,
                              });
                              setReplacementPreview(null);
                            })
                          }
                        >
                          保留旧曲目，隐藏新文件
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void work(async () => {
                              await command({
                                type: "decideMidiReplacement",
                                path: r.path,
                                old_content_id: r.oldContentId,
                                new_content_id: r.newContentId,
                                token: preview.token,
                                action: "new",
                                target: null,
                              });
                              setReplacementPreview(null);
                            })
                          }
                        >
                          新文件建立独立曲目
                        </button>
                        <button
                          disabled={busy || !replacementTarget}
                          onClick={() =>
                            void work(async () => {
                              await command({
                                type: "decideMidiReplacement",
                                path: r.path,
                                old_content_id: r.oldContentId,
                                new_content_id: r.newContentId,
                                token: preview.token,
                                action: "relink",
                                target: replacementTarget,
                              });
                              setReplacementPreview(null);
                            })
                          }
                        >
                          旧曲目重新关联到所选位置
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          {kind === "replacements" &&
            replacementData &&
            !replacementData.rows.length && (
              <p className="library-empty">
                {resolved
                  ? "没有原路径内容变化记录"
                  : "没有待审阅的原路径内容变化"}
              </p>
            )}
          {kind !== "replacements" && (
            <>
              {data?.groups.map((g) => (
                <section
                  key={g.contentId}
                  data-content-id={g.contentId}
                  className="library-repair-group"
                >
                  <div className="library-repair-heading">
                    <h3>{g.title}</h3>
                    {g.preferredPath && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async () => {
                            await command({
                              type: "setLibraryPrimary",
                              content_id: g.contentId,
                              path: null,
                            });
                          })
                        }
                      >
                        使用默认位置
                      </button>
                    )}
                    <small>
                      {g.available} 个可用位置 · {g.missing} 个待修复
                      {g.resolved ? ` · ${g.resolved} 个已处理` : ""}
                    </small>
                  </div>
                  {g.paths.map((p) => {
                    const id = identity(g.contentId, p.path),
                      to = choice(g, p);
                    return (
                      <div
                        key={id}
                        className={`library-repair-path ${p.resolved || p.ignored ? "resolved" : ""}`}
                      >
                        <div className="library-repair-original">
                          <input
                            aria-label={`处理位置 ${p.path}`}
                            type="checkbox"
                            checked={Boolean(selected[id])}
                            disabled={
                              busy ||
                              !!stored.unconfirmed[id] ||
                              !eligible(p) ||
                              !to
                            }
                            onChange={(e) => select(g, p, e.target.checked)}
                          />
                          <div>
                            <strong>
                              {p.reason}
                              {p.primary ? " · 常用位置" : ""}
                              {p.resolved
                                ? " · 已关联"
                                : p.ignored
                                  ? " · 已忽略旧位置"
                                  : ""}
                            </strong>
                            <p title={p.path}>{p.path}</p>
                            {p.relinkedTo && (
                              <small>关联到 {p.relinkedTo}</small>
                            )}
                          </div>
                        </div>
                        <div className="library-repair-path-actions">
                          {p.resolved || p.ignored ? (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void work(async () => {
                                  await command({
                                    type: "restoreLibraryPath",
                                    content_id: g.contentId,
                                    path: p.path,
                                  });
                                })
                              }
                            >
                              恢复路径显示
                            </button>
                          ) : (
                            <>
                              {eligible(p) &&
                                g.candidates.some(
                                  (c) => key(c) !== key(p.path),
                                ) && (
                                  <>
                                    <select
                                      aria-label={`新位置 ${p.path}`}
                                      value={to}
                                      disabled={busy}
                                      onChange={(e) =>
                                        choose(g, p, e.target.value)
                                      }
                                    >
                                      <option value="">选择可用位置</option>
                                      {to && !g.candidates.includes(to) && (
                                        <option value={to}>
                                          暂存目标（需重新核对）· {to}
                                        </option>
                                      )}
                                      {g.candidates
                                        .filter((c) => key(c) !== key(p.path))
                                        .map((c) => (
                                          <option key={c} value={c}>
                                            {c}
                                          </option>
                                        ))}
                                    </select>
                                    <button
                                      disabled={busy || !to}
                                      onClick={() =>
                                        void work(() =>
                                          repair([
                                            {
                                              contentId: g.contentId,
                                              from: p.path,
                                              to,
                                            },
                                          ]),
                                        )
                                      }
                                    >
                                      {p.available ? "合并显示" : "重新关联"}
                                    </button>
                                  </>
                                )}
                              {!p.available && p.verified && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void work(async () => {
                                      await command({
                                        type: "ignoreLibraryPath",
                                        content_id: g.contentId,
                                        path: p.path,
                                      });
                                    })
                                  }
                                >
                                  忽略旧位置
                                </button>
                              )}
                              {!p.available && api.desktop && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void work(async () => {
                                      const to = await api.pickRepairPath(
                                        g.contentId,
                                        p.path,
                                      );
                                      if (to)
                                        await repair([
                                          {
                                            contentId: g.contentId,
                                            from: p.path,
                                            to,
                                          },
                                        ]);
                                    })
                                  }
                                >
                                  选择文件关联
                                </button>
                              )}
                              {p.available && !p.primary && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void work(async () => {
                                      await command({
                                        type: "setLibraryPrimary",
                                        content_id: g.contentId,
                                        path: p.path,
                                      });
                                    })
                                  }
                                >
                                  设为常用位置
                                </button>
                              )}
                              {p.present && !p.verified && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void work(async () => {
                                      await command({
                                        type: "inspectSong",
                                        path: p.path,
                                        force: true,
                                      });
                                    })
                                  }
                                >
                                  核对内容
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!g.candidates.length && (
                    <p className="parameter-help">
                      未找到同内容的可用位置。可先导入原文件或添加所在文件夹，完成索引后再关联。
                    </p>
                  )}
                </section>
              ))}
              {data && !data.groups.length && (
                <p className="library-empty">
                  {kind === "missing"
                    ? "没有需要重新关联的文件"
                    : kind === "duplicates"
                      ? "没有同内容的多个可用位置"
                      : kind === "unverified"
                        ? "文件位置已核对"
                        : "尚未关联文件位置"}
                </p>
              )}
              {!data && <p className="library-empty">正在读取文件位置…</p>}
            </>
          )}
        </div>
        {results.length > 0 && (
          <div className="library-repair-results" role="status">
            <strong>
              本次处理：{results.filter((r) => r.ok).length} 个成功
              {results.some((r) => !r.ok)
                ? `，${results.filter((r) => !r.ok).length} 个未处理`
                : ""}
            </strong>
            {results.map((r, i) => (
              <p key={i} className={r.ok ? "" : "dialog-error"}>
                {r.from} → {r.to}
                <br />
                {r.ok ? "已关联，原文件保留" : r.error}
                {r.warnings?.map((w, j) => (
                  <small key={j}>{w}</small>
                ))}
              </p>
            ))}
          </div>
        )}
        <div className="library-repair-footer">
          <span>
            {kind === "replacements"
              ? `${replacementData?.total ?? 0} 处内容变化`
              : `${data?.total ?? 0} 首 · 已选择 ${Object.keys(selected).length} 个位置`}
          </span>
          {kind !== "replacements" && (
            <>
              <button
                disabled={busy || !data?.groups.length}
                onClick={selectPage}
              >
                选择本页可匹配项
              </button>
              <button
                disabled={busy || !Object.keys(selected).length}
                onClick={() => setSelected({})}
              >
                取消选择
              </button>
              <button
                className="primary-button"
                disabled={busy || !Object.keys(selected).length}
                onClick={() => void work(() => repair(Object.values(selected)))}
              >
                关联所选位置
              </button>
            </>
          )}
          <span className="menu-spacer" />
          <button
            aria-label="上一页文件位置"
            disabled={busy || !offset}
            onClick={() => {
              setOffset(Math.max(0, offset - 25));
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span>
            {Math.floor(offset / 25) + 1}/
            {Math.max(
              1,
              Math.ceil(
                (kind === "replacements"
                  ? (replacementData?.total ?? 0)
                  : (data?.total ?? 0)) / 25,
              ),
            )}
          </span>
          <button
            aria-label="下一页文件位置"
            disabled={
              busy ||
              offset + 25 >=
                (kind === "replacements"
                  ? (replacementData?.total ?? 0)
                  : (data?.total ?? 0))
            }
            onClick={() => {
              setOffset(offset + 25);
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}
