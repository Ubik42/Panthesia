import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import {
  passageForm,
  newPassageForm,
  integerInput,
  validMeasureRange,
} from "./features/practice/practiceEditorForms";
import type { PassageCatalog } from "./features/practice/catalogTypes";
import {
  useCatalogRead,
  capturePracticeScope,
  samePracticeScope,
} from "./engine/useCatalogRead";
import {
  PracticeEditorDrafts,
  PracticeCatalogFilters,
  PracticeListPager,
  SavedPracticeDetails,
  RevealPracticeSelection,
  sortPracticeRows,
  practiceDraftConflict,
  usePracticeEditor,
} from "./features/practice/PracticeEditorDrafts";
import { practiceDraftDirty } from "./features/practice/practiceEditorStore";
import { TaskActivity } from "./engine/TaskActivity";
import { useEffect, useRef, useState } from "react";
import { TickRangeDialog } from "./TickRangeDialog";
import { X } from "lucide-react";
import { api, type LoadedSong, type Snapshot } from "./api";
import { ScoreRangeDialog } from "./ScoreRangeDialog";
import type { PassagePreset as Passage } from "./engine/commands.generated";

export function PassageDialog({
  song,
  state,
  start,
  end,
  close,
  changed,
  addToRoutine,
}: {
  song: LoadedSong;
  state: Pick<Snapshot, "speed" | "routine" | "recording" | "status">;
  start: number;
  end: number;
  close: () => void;
  changed: () => Promise<void>;
  addToRoutine: (passage: {
    contentId: string;
    id: string;
    name: string;
    notes: string;
  }) => void;
}) {
  const [precise, setPrecise] = useState<Passage | "new" | null>(null),
    [review, setReview] = useState<Passage | null>(null);
  const source = useRef(capturePracticeScope(song)),
    sourceChanged = !samePracticeScope(source.current, song);
  const initial = newPassageForm(start, end);
  const editor = usePracticeEditor(
      "passage",
      song.contentId,
      source.current,
      initial,
      song,
    ),
    { store, draft, form } = editor;
  const id = draft?.id ?? null,
    { name, notes } = form,
    first = integerInput(form.first),
    last = integerInput(form.last);
  const [passages, setPassages] = useState<Passage[]>([]),
    [grid, setGrid] = useState(""),
    [loaded, setLoaded] = useState(false),
    [catalogRevision, setCatalogRevision] = useState<string>(),
    [reading, setReading] = useState(false),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [actionBusy, setActionBusy] = useState(false),
    [readFor, setReadFor] = useState<string | null>(null),
    [settled, setSettled] = useState(false);
  const busy = actionBusy || editor.state.busy,
    pending = !!editor.state.receipt,
    working = useRef(false);
  const readCatalog = useCatalogRead(source.current, song);
  const reload = async () => {
    const receipt = store.getSnapshot().receipt?.key ?? null;
    const request = readCatalog<PassageCatalog>({ type: "passages" });
    setReading(true);
    setReadError("");
    try {
      const result = await request.result;
      if (!request.isCurrent() || result.contentId !== song.contentId)
        throw new Error("曲目已切换，请重新打开练习段落");
      setGrid(result.grid);
      setCatalogRevision(result.catalogRevision);
      setPassages(result.passages);
      setLoaded(true);
      setReadFor(receipt);
      setSettled(result.writeSettled === true);
      if (receipt === store.getSnapshot().receipt?.key)
        store.reconcile(
          result.passages,
          result.writeSettled === true,
          source.current,
          passageForm,
          result.catalogRevision,
        );
      store.refreshClean(result.passages, source.current, passageForm);
      return result.passages;
    } catch (failure) {
      if (request.isCurrent())
        setReadError(
          failure instanceof Error ? failure.message : String(failure),
        );
      throw failure;
    } finally {
      if (request.isCurrent()) setReading(false);
    }
  };
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [readCatalog]);
  useEffect(() => {
    if (sourceChanged) setReading(false);
  }, [sourceChanged]);
  const work = async (job: () => Promise<unknown>) => {
    if (working.current || sourceChanged) return;
    working.current = true;
    setActionBusy(true);
    setError("");
    try {
      await job();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      working.current = false;
      setActionBusy(false);
    }
  };
  const create = () => {
    try {
      store.open(initial, source.current);
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  };
  const active = passages.find((row) => row.id === id),
    conflict = loaded && practiceDraftConflict(draft, source.current, active);
  const stale = (row: Passage) => !!(grid && row.grid && row.grid !== grid);
  const navigationLocked = busy || pending || sourceChanged;
  const locked = navigationLocked || !draft;
  const search = editor.state.query.trim().toLocaleLowerCase("zh-CN"),
    visible = sortPracticeRows(
      passages.filter(
        (row) =>
          (!search ||
            `${row.name} ${row.notes} ${row.start} ${row.end}`
              .toLocaleLowerCase("zh-CN")
              .includes(search)) &&
          (editor.state.filter === "all" ||
            (editor.state.filter === "needsReview" && stale(row)) ||
            (editor.state.filter === "drafts" &&
              editor.state.drafts.some(
                (draft) => draft.id === row.id && practiceDraftDirty(draft),
              ))),
      ),
      editor.state.sort,
    );
  const page = Math.min(
    editor.state.page,
    Math.max(0, Math.ceil(visible.length / 12) - 1),
  );
  useEffect(() => {
    if (loaded && editor.state.page !== page) store.update({ page });
  }, [loaded, page, editor.state.page, store]);
  const validRange = validMeasureRange(first, last, song.measures.length);
  const detailsProblem = !name.trim()
    ? "请输入练习段名称。"
    : Array.from(name).length > 80
      ? "名称最多 80 个字符。"
      : new TextEncoder().encode(notes).length > 8192
        ? "练习备注过长，请缩短内容。"
        : "";
  const problem =
    detailsProblem ||
    (!active?.scoreRange && !active?.preciseRange && !validRange
      ? `请输入 1–${song.measures.length} 内的完整起止小节，结束小节应大于或等于起始小节。`
      : "");
  const dirty =
    !!active && JSON.stringify(form) !== JSON.stringify(passageForm(active));
  const nestedChanged = async (presetId?: string) => {
    await changed();
    const rows = await reload(),
      updated = rows.find((row) => row.id === presetId);
    if (updated && store.current()?.id === updated.id)
      store.rebase(
        source.current,
        updated,
        {
          ...store.current()!.form,
          first: String(updated.start),
          last: String(updated.end),
        },
        passageForm(updated),
      );
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        className="settings-dialog passage-dialog practice-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="passage-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="passage-title">练习段落</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={busy}
            aria-label="关闭练习段落"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <TaskActivity
          contentId={song.contentId}
          label={["读取练习段资料", "保存练习段资料", "打开保存的练习段"]}
        />
        <div className="practice-catalog-toolbar">
          <button
            disabled={busy || reading || sourceChanged}
            onClick={() => void work(reload)}
          >
            {reading ? "正在读取…" : pending ? "读取保存结果" : "重新读取列表"}
          </button>
          <CopyPracticeDraft
            label="复制段落草稿"
            value={{
              source: source.current,
              contentId: song.contentId,
              title: song.title,
              id,
              ...form,
              preciseRange: active?.preciseRange,
              scoreRange: active?.scoreRange,
            }}
          />
        </div>
        {readError && (
          <p role="alert" className="dialog-error">
            列表读取失败：{readError}
          </p>
        )}
        {sourceChanged && (
          <p className="catalog-source-warning" role="alert">
            曲目、标注或连接已变化。当前输入已保留，请重新打开练习段落并核对范围。
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <PracticeEditorDrafts
          store={store}
          source={source.current}
          rows={passages}
          toForm={passageForm}
          describe={(row) => <SavedPracticeDetails row={row} />}
          loaded={loaded}
          readFor={readFor}
          settled={settled}
          revision={catalogRevision}
          reading={reading}
          blocked={sourceChanged || actionBusy}
          reload={() => void work(reload)}
          create={create}
        />
        <div className="passage-layout">
          <aside className="passage-list" aria-label="已保存练习段">
            <label className="passage-search">
              查找练习段
              <input
                type="search"
                value={editor.state.query}
                maxLength={1024}
                onChange={(event) =>
                  store.update({ query: event.target.value, page: 0 })
                }
                placeholder="名称、备注或小节号"
              />
            </label>
            <PracticeCatalogFilters store={store} kind="passage" />
            <PracticeListPager
              count={visible.length}
              page={page}
              change={(page) => store.update({ page })}
            />
            {visible.slice(page * 12, (page + 1) * 12).map((row) => (
              <article key={row.id} className={id === row.id ? "active" : ""}>
                <button
                  className="passage-select"
                  aria-pressed={id === row.id}
                  disabled={navigationLocked}
                  onClick={() => {
                    try {
                      store.open(passageForm(row), source.current, row);
                    } catch (error) {
                      setError(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  }}
                >
                  <strong>{row.name}</strong>
                  <span>
                    {row.preciseRange?.description ??
                      row.scoreRange?.description ??
                      `第 ${row.start}–${row.end} 小节`}{" "}
                    · {Math.round(row.speed * 100)}% ·{" "}
                    {row.settings.mode === "flow"
                      ? "连续"
                      : row.settings.mode === "listen"
                        ? "聆听"
                        : "等音"}
                  </span>
                  <small>{row.notes || "未添加备注"}</small>
                  {editor.state.drafts.some((draft) => draft.id === row.id) && (
                    <small>有暂存输入</small>
                  )}
                  {stale(row) && (
                    <span className="passage-stale">
                      小节网格已变，请重新确认范围
                    </span>
                  )}
                </button>
                <div>
                  <button
                    disabled={
                      busy ||
                      reading ||
                      sourceChanged ||
                      pending ||
                      stale(row) ||
                      !catalogRevision
                    }
                    onClick={() =>
                      void work(async () => {
                        await api.editPractice(
                          source.current,
                          { type: "openPassage", id: row.id },
                          catalogRevision,
                        );
                        await changed();
                        close();
                      })
                    }
                  >
                    练已保存段
                  </button>
                  <button
                    disabled={busy || sourceChanged || pending || stale(row)}
                    onClick={() =>
                      addToRoutine({
                        contentId: song.contentId,
                        id: row.id,
                        name: row.name,
                        notes: row.notes,
                      })
                    }
                  >
                    加入计划…
                  </button>
                </div>
              </article>
            ))}
            {!loaded && (
              <p className="library-empty">
                {reading ? "正在读取练习段…" : "请重新读取练习段列表。"}
              </p>
            )}
            {loaded && !passages.length && (
              <p className="library-empty">
                保存经常重练的段落，记下配置与练习目标。
              </p>
            )}
            {loaded && passages.length > 0 && !visible.length && (
              <p className="library-empty">没有找到符合条件的练习段。</p>
            )}
          </aside>
          <div className="passage-form">
            <div className="practice-editor-summary">
              <strong>{id ? "编辑练习段" : "新建练习段"}</strong>
              <span>
                {dirty ? "有待保存输入" : id ? "已保存版本" : "本机草稿"}
              </span>
            </div>
            <RevealPracticeSelection
              store={store}
              rows={passages}
              id={id}
              visible={visible
                .slice(page * 12, (page + 1) * 12)
                .some((row) => row.id === id)}
            />
            <div className="practice-editor-tools">
              <button
                disabled={
                  locked ||
                  !loaded ||
                  editor.state.drafts.length >= 24 ||
                  conflict ||
                  !!active?.preciseRange ||
                  !!active?.scoreRange
                }
                onClick={() => store.duplicate(source.current)}
              >
                复制为新草稿
              </button>
              {active && (
                <button
                  disabled={locked || !loaded}
                  onClick={() =>
                    store.rebase(source.current, active, passageForm(active))
                  }
                >
                  恢复保存版本
                </button>
              )}
            </div>
            {active && stale(active) && (
              <p className="passage-stale" role="status">
                {active.scoreRange
                  ? "原谱路线或小节网格已变，请重新审阅原谱范围。"
                  : active.preciseRange
                    ? "小节网格已变，请重新编辑拍内范围。"
                    : "小节网格已变，请核对起止小节后保存。"}
              </p>
            )}
            <label>
              名称
              <input
                aria-label="练习段名称"
                placeholder="例如：左手伴奏、转指、结尾"
                value={name}
                maxLength={160}
                disabled={locked}
                onChange={(event) => store.patch({ name: event.target.value })}
              />
            </label>
            <div className="passage-range">
              <label>
                起始小节
                <input
                  aria-label="保存段落起始小节"
                  type="number"
                  min={1}
                  max={song.measures.length}
                  value={form.first}
                  disabled={
                    locked || !!active?.scoreRange || !!active?.preciseRange
                  }
                  onChange={(event) =>
                    store.patch({ first: event.target.value })
                  }
                />
              </label>
              <label>
                结束小节
                <input
                  aria-label="保存段落结束小节"
                  type="number"
                  min={Number.isFinite(first) ? first : 1}
                  max={song.measures.length}
                  value={form.last}
                  disabled={
                    locked || !!active?.scoreRange || !!active?.preciseRange
                  }
                  onChange={(event) =>
                    store.patch({ last: event.target.value })
                  }
                />
              </label>
            </div>
            {!active?.scoreRange && !active?.preciseRange && (
              <button
                disabled={locked}
                onClick={() =>
                  store.patch({ first: String(start), last: String(end) })
                }
              >
                使用主界面选段 · {start}–{end} 小节
              </button>
            )}
            <button
              disabled={
                locked ||
                conflict ||
                !loaded ||
                (!active?.preciseRange && !validRange) ||
                !!active?.scoreRange
              }
              onClick={() => setPrecise(active?.preciseRange ? active : "new")}
            >
              {active?.preciseRange ? "编辑拍内范围" : "新建拍内段落"}
            </button>
            {active?.preciseRange && <p>{active.preciseRange.description}</p>}
            {active?.scoreRange && (
              <div className="score-range-original">
                <p>{active.scoreRange.description}</p>
                <button
                  disabled={locked || conflict || !loaded}
                  onClick={() => setReview(active)}
                >
                  重新审阅原谱范围
                </button>
              </div>
            )}
            <label>
              练习备注
              <textarea
                aria-label="练习段备注"
                rows={4}
                placeholder="要解决的问题、教师要求或下次练习目标"
                value={notes}
                maxLength={8192}
                disabled={locked}
                onChange={(event) => store.patch({ notes: event.target.value })}
              />
            </label>
            <p>
              保存采用当前音轨、手别、模式、{Math.round(state.speed * 100)}%
              速度、预备拍和遍数。应用已保存段落后，按“开始练习”演奏。
            </p>
            {dirty && (
              <p className="parameter-help">
                “练已保存段”和“加入计划”采用保存版本。当前输入会继续暂存。
              </p>
            )}
            {problem && (
              <p className="practice-input-problem" role="status">
                {problem}
              </p>
            )}
            <div className="file-actions">
              <button
                className="primary-button"
                disabled={
                  locked ||
                  reading ||
                  !loaded ||
                  conflict ||
                  !!problem ||
                  !!editor.state.storageError
                }
                onClick={() =>
                  void work(async () => {
                    await store.commit(
                      source.current,
                      active?.scoreRange || active?.preciseRange
                        ? {
                            type: "updatePassageDetails",
                            content_id: song.contentId,
                            id: active.id,
                            name,
                            notes,
                          }
                        : {
                            type: "savePassage",
                            content_id: song.contentId,
                            id,
                            name,
                            start: first,
                            end: last,
                            notes,
                          },
                      catalogRevision,
                      "save",
                      "练习段已保存",
                    );
                    await reload();
                  })
                }
              >
                {active?.scoreRange || active?.preciseRange
                  ? "更新名称与备注"
                  : id
                    ? "保存段落与当前设置"
                    : "保存练习段"}
              </button>
              {active && !active.scoreRange && !active.preciseRange && (
                <button
                  disabled={
                    locked ||
                    reading ||
                    !loaded ||
                    conflict ||
                    !!detailsProblem ||
                    !!editor.state.storageError ||
                    (name.trim() === active.name && notes === active.notes)
                  }
                  onClick={() =>
                    void work(async () => {
                      await store.commit(
                        source.current,
                        {
                          type: "updatePassageDetails",
                          content_id: song.contentId,
                          id: active.id,
                          name,
                          notes,
                        },
                        catalogRevision,
                        "save",
                        "名称与备注已更新，原范围和练习设置已保留",
                        true,
                      );
                      await reload();
                    })
                  }
                >
                  仅更新名称与备注
                </button>
              )}
              {id && (
                <button
                  disabled={
                    locked ||
                    reading ||
                    !loaded ||
                    conflict ||
                    !catalogRevision ||
                    !!editor.state.storageError
                  }
                  onClick={() =>
                    void work(async () => {
                      await store.commit(
                        source.current,
                        {
                          type: "removePassage",
                          content_id: song.contentId,
                          id,
                        },
                        catalogRevision,
                        "remove",
                        "练习段已移除",
                      );
                      await reload();
                    })
                  }
                >
                  移除已保存段
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      {precise && (
        <TickRangeDialog
          expectedCatalog={precise !== "new" ? catalogRevision : undefined}
          song={song}
          state={state}
          first={first}
          last={last}
          preset={
            precise !== "new" && precise.preciseRange
              ? { ...precise, preciseRange: precise.preciseRange }
              : undefined
          }
          close={() => setPrecise(null)}
          changed={() =>
            nestedChanged(precise !== "new" ? precise.id : undefined)
          }
        />
      )}
      {review?.scoreRange && (
        <ScoreRangeDialog
          expectedCatalog={catalogRevision}
          song={song}
          first={review.scoreRange.firstVisit}
          last={review.scoreRange.lastVisit}
          preset={{ ...review, scoreRange: review.scoreRange }}
          close={() => setReview(null)}
          changed={() => nestedChanged(review.id)}
        />
      )}
    </div>
  );
}
