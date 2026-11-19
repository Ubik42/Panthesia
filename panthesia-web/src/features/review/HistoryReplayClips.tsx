import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Bookmark, Check, Copy, RefreshCw, Undo2 } from "lucide-react";
import type { HistoryReplay } from "../../useHistoryReplay";
import { BrowsePagination } from "../../app/BrowsePagination";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { TaskActivity } from "../../engine/TaskActivity";
import {
  clipInputError,
  clipValue,
  getReplayEditor,
  hasClipInput,
  hasCurrentClipInput,
  replayRange,
} from "./replayEditorStore";
import type { ReplayClip } from "./historyTypes";
import { ReplayClipMerge } from "./ReplayClipMerge";
import { clipHistorySource, rangeSourceChanged } from "./historySource";
import "./historyReplayEditor.css";

export function HistoryReplayClips({
  replay,
  duration,
  refreshSource,
  rangeContextVisible = false,
}: {
  replay: HistoryReplay;
  start?: number;
  end?: number;
  duration: number;
  pick?: (start: number, end: number) => void;
  refreshSource?: () => void | Promise<void>;
  rangeContextVisible?: boolean;
}) {
  const store = getReplayEditor(replay.contentId, replay.historyId);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [remove, setRemove] = useState<ReplayClip | null>(null);
  const [copyText, setCopyText] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const copySequence = useRef(0);
  const nameId = useId(),
    rangeId = useId();
  const { draft, rows, receipt } = state;
  const range = replayRange(state.range, duration);
  const inputError = clipInputError(draft);
  const rangeChanged = rangeSourceChanged(
    state.rangeSource,
    replay.historySource,
  );
  const current = rows?.clips.find((clip) => clip.id === draft.id);
  const conflict =
    !!draft.id &&
    !!rows &&
    (!current ||
      (draft.base
        ? clipValue(current) !== clipValue(draft.base)
        : draft.revision !== rows.revision));
  const blocked = state.busy || !!receipt;
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = (rows?.clips ?? [])
    .filter((clip) =>
      `${clip.name} ${clip.notes}`.toLocaleLowerCase().includes(query),
    )
    .sort(
      (left, right) =>
        right.updatedAtUnixMs - left.updatedAtUnixMs ||
        left.id.localeCompare(right.id),
    );
  const page = Math.min(
    state.page,
    Math.max(0, Math.ceil(filtered.length / 12) - 1),
  );
  useEffect(() => {
    store.bind(replay.engineId);
  }, [store, replay.engineId, state.busy]);
  useEffect(() => {
    const current = store.getSnapshot();
    if (current.clipsOpen && !current.rows && !current.busy)
      void store.reload(replay.engineId);
  }, [store, state.clipsOpen, replay.engineId, state.engineId]);
  useEffect(() => {
    copySequence.current++;
    setRemove(null);
    setCopyText("");
    setCopyNotice("");
    return () => {
      copySequence.current++;
    };
  }, [store]);
  const copy = async (legacy = false) => {
    const value = legacy ? state.legacyOriginal : store.copyInput();
    if (!value) return;
    const sequence = ++copySequence.current;
    setCopyText(value);
    try {
      await navigator.clipboard.writeText(value);
      if (sequence === copySequence.current)
        setCopyNotice("已复制，原文也保留在下方。");
    } catch {
      if (sequence === copySequence.current)
        setCopyNotice("可在下方选取原文并复制。");
    }
  };
  const locate = async (clip: ReplayClip) => {
    if (needsRangeReview(clip)) return;
    if (
      replay.loop &&
      !(await replay.control("loop", 0, { end: replay.end, enabled: false }))
    )
      return;
    await replay.control("seek", clip.start);
  };
  const needsRangeReview = (clip: ReplayClip) =>
    rangeSourceChanged(
      clipHistorySource(clip, replay.historySource),
      replay.historySource,
    );
  const chooseClip = (clip: ReplayClip) => {
    if (needsRangeReview(clip))
      store.beginEdit(clip, false, replay.historySource);
    else
      store.pick(
        clip.start,
        clip.end,
        clipHistorySource(clip, replay.historySource),
      );
    store.update({ rangeOpen: true });
  };
  return (
    <details
      className="history-replay-clips replay-editor"
      open={state.clipsOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== store.getSnapshot().clipsOpen)
          store.update({ clipsOpen: open });
      }}
      aria-busy={state.busy}
    >
      <summary>
        <Bookmark size={16} /> 收藏的回放片段
        {rows ? ` · ${rows.clips.length}` : ""}
        {receipt ? " · 待核对提交" : hasClipInput(state) ? " · 有草稿" : ""}
      </summary>
      <div className="replay-editor-body">
        {!!Object.keys(state.drafts).length && (
          <div className="replay-draft-bank" aria-label="其他片段草稿">
            <strong>其他片段草稿 · {Object.keys(state.drafts).length}</strong>
            <div className="replay-editor-actions">
              {Object.entries(state.drafts).map(([key, saved]) => (
                <button
                  key={key}
                  disabled={blocked}
                  onClick={() => store.restoreDraft(key)}
                >
                  继续「{saved.draft.name.trim() || "未命名片段"}」
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="replay-editor-intro">
          收藏本次演奏中的选段，回顾时可直接采用范围、定位或循环听。
        </p>
        <section
          className="replay-clip-form"
          aria-label={draft.id ? "修改收藏片段" : "收藏当前范围"}
        >
          <div className="replay-editor-heading">
            <strong>{draft.id ? "修改收藏片段" : "收藏当前范围"}</strong>
            <span aria-describedby={range.error ? rangeId : undefined}>
              {range.error
                ? "范围待填写"
                : `${range.start.toFixed(3)}–${range.end.toFixed(3)} 秒`}
            </span>
          </div>
          <label htmlFor={nameId}>片段名称</label>
          <input
            id={nameId}
            aria-label="回放片段名称"
            maxLength={320}
            value={draft.name}
            disabled={blocked}
            onChange={(event) =>
              store.changeDraft({ ...draft, name: event.target.value })
            }
            placeholder="例如：左手进入前两小节"
          />
          <label>
            片段备注
            <textarea
              aria-label="回放片段备注"
              maxLength={8192}
              rows={3}
              disabled={blocked}
              value={draft.notes}
              onChange={(event) =>
                store.changeDraft({ ...draft, notes: event.target.value })
              }
              placeholder="记录下次要听什么、练什么"
            />
          </label>
          {inputError && draft.name && (
            <p className="replay-editor-hint">{inputError}</p>
          )}
          {range.error && (
            <p id={rangeId} className="replay-editor-hint">
              {range.error}可在上方设置范围。
            </p>
          )}
          {rangeChanged && !rangeContextVisible && replay.historySource && (
            <div className="replay-editor-conflict" role="status">
              <p>
                {state.rangeSource?.performanceRevision
                  ? "这份范围来自此前的演奏资料，起止秒数已保留。"
                  : "这份范围尚未记录演奏版本，起止秒数已保留。"}
                核对后可以采用当前演奏版本。
              </p>
              <button
                disabled={blocked}
                onClick={() => store.adoptRangeSource(replay.historySource!)}
              >
                保留秒数，采用当前演奏版本
              </button>
            </div>
          )}
          <div className="replay-editor-actions">
            <button
              className="replay-editor-primary"
              disabled={
                blocked ||
                !!range.error ||
                !!inputError ||
                conflict ||
                rangeChanged
              }
              onClick={() =>
                void store.save(duration, replay.engineId, replay.historySource)
              }
            >
              <Check size={15} />
              {state.operation === "save"
                ? "正在保存…"
                : draft.id
                  ? "保存片段修改"
                  : "收藏当前范围"}
            </button>
            {hasCurrentClipInput(state) && !receipt && (
              <button disabled={blocked} onClick={store.clearDraft}>
                清除草稿
              </button>
            )}
            {state.undo && !hasCurrentClipInput(state) && (
              <button disabled={blocked} onClick={store.undoClear}>
                <Undo2 size={14} />
                撤销清除
              </button>
            )}
            {(hasClipInput(state) || receipt) && (
              <button onClick={() => void copy()}>
                <Copy size={14} />
                复制输入与提交
              </button>
            )}
            {draft.id && (
              <button disabled={blocked} onClick={store.newDraft}>
                收藏另一个范围
              </button>
            )}
          </div>
          {hasClipInput(state) && !receipt && (
            <p className="replay-editor-hint">
              名称、备注和范围会暂存在本机，切换记录后可继续编辑。
            </p>
          )}
        </section>
        {conflict && !receipt && (
          <section
            className="replay-editor-conflict"
            aria-label="收藏片段变化"
            role="status"
          >
            <strong>
              {current ? "这个收藏已有更新" : "这个收藏已从列表移除"}
            </strong>
            {current && (
              <div className="replay-clip-comparison">
                <div>
                  <span>当前输入</span>
                  <strong>{draft.name || "未命名"}</strong>
                  <p>{draft.notes || "无备注"}</p>
                  <small>
                    {state.range.start}–{state.range.end} 秒
                  </small>
                </div>
                <div>
                  <span>已保存内容</span>
                  <strong>{current.name}</strong>
                  <p>{current.notes || "无备注"}</p>
                  <small>
                    {current.start.toFixed(3)}–{current.end.toFixed(3)} 秒
                  </small>
                </div>
              </div>
            )}
            {current && (
              <ReplayClipMerge
                key={`${replay.contentId}:${replay.historyId}:${current.id}:${current.updatedAtUnixMs}`}
                draft={draft}
                range={state.range}
                current={current}
                disabled={blocked || !rows?.writeSettled}
                merge={store.merge}
              />
            )}
            <div className="replay-editor-actions">
              {current && (
                <>
                  <button
                    disabled={blocked}
                    onClick={() =>
                      store.beginEdit(current, true, replay.historySource)
                    }
                  >
                    载入已保存内容
                  </button>
                  <button
                    disabled={blocked || !rows?.writeSettled}
                    onClick={() => store.rebase()}
                  >
                    保留输入，采用最新版本
                  </button>
                </>
              )}
              <button
                disabled={blocked || !rows?.writeSettled}
                onClick={() => store.rebase(true)}
              >
                将输入另存为新收藏
              </button>
            </div>
          </section>
        )}
        {receipt && (
          <section
            className="replay-editor-receipt"
            aria-label="原收藏提交"
            role="status"
          >
            <strong>
              {receipt.action === "delete"
                ? "删除收藏的原提交"
                : "收藏片段的原提交"}
            </strong>
            <p>
              {receipt.phase === "acknowledged"
                ? "保存回复已收到，可读取当前列表完成核对。"
                : "原请求及输入已保留，可读取结果或重试同一请求。"}
            </p>
            {receipt.value && (
              <p>
                「{receipt.value.name.trim()}」 ·{" "}
                {receipt.value.start.toFixed(3)}–{receipt.value.end.toFixed(3)}{" "}
                秒
              </p>
            )}
            <code>{receipt.requestId}</code>
            <div className="replay-editor-actions">
              <button
                disabled={state.busy}
                onClick={() => void store.reload(replay.engineId)}
              >
                <RefreshCw size={14} />
                核对原结果
              </button>
              {receipt.phase !== "acknowledged" && (
                <button
                  disabled={state.busy}
                  onClick={() => void store.retry(replay.engineId)}
                >
                  重试原提交
                </button>
              )}
              <button
                disabled={state.busy || !rows?.writeSettled}
                onClick={() =>
                  store.rebase(receipt.action === "save" && !draft.id)
                }
              >
                保留输入，继续编辑
              </button>
            </div>
          </section>
        )}
        <TaskActivity
          contentId={replay.contentId}
          label="保存回放片段"
          cancelLabel="取消片段保存准备"
        />
        {state.notice && (
          <p className="replay-editor-notice" role="status">
            {state.notice}
          </p>
        )}
        {state.lastReceipt && !receipt && (
          <details className="replay-last-receipt">
            <summary>上次保存详情</summary>
            <p>
              {state.lastReceipt.action === "save"
                ? `收藏「${state.lastReceipt.value!.name.trim()}」`
                : "删除收藏"}{" "}
              · 已核对处理结果
            </p>
            {state.lastReceipt.value && (
              <>
                <p>
                  {state.lastReceipt.value.start.toFixed(3)}–
                  {state.lastReceipt.value.end.toFixed(3)} 秒
                </p>
                {state.lastReceipt.value.notes && (
                  <p>{state.lastReceipt.value.notes}</p>
                )}
              </>
            )}
            <code>{state.lastReceipt.requestId}</code>
            <button onClick={() => void copy()}>复制保存详情与当前输入</button>
          </details>
        )}
        {state.error && (
          <div className="replay-editor-error" role="alert">
            <p>{state.error}</p>
            {state.sourceIssue && refreshSource && (
              <button
                disabled={state.busy || replay.busy}
                onClick={() => void refreshSource()}
              >
                重新读取演奏，保留草稿
              </button>
            )}
            <button
              disabled={state.busy}
              onClick={() => void store.reload(replay.engineId)}
            >
              重新读取片段
            </button>
          </div>
        )}
        <PersistentSessionRecovery
          store={store}
          error={state.storageError}
          busy={state.busy}
          label="回放输入"
        />
        {state.legacyError && (
          <div className="replay-editor-error" role="status">
            <p>{state.legacyError}</p>
            {state.legacyOriginal && (
              <button onClick={() => void copy(true)}>
                复制旧窗口草稿原文
              </button>
            )}
          </div>
        )}
        {copyText && (
          <details className="replay-editor-copy">
            <summary>查看已复制原文</summary>
            {copyNotice && <p role="status">{copyNotice}</p>}
            <textarea
              aria-label="回放输入与提交原文"
              readOnly
              value={copyText}
              rows={7}
            />
          </details>
        )}
        <div className="replay-clip-list-tools">
          <label>
            查找片段
            <input
              aria-label="查找回放片段"
              value={state.search}
              maxLength={2000}
              onChange={(event) =>
                store.update({ search: event.target.value, page: 0 })
              }
              placeholder="名称或备注"
            />
          </label>
          <button
            disabled={state.busy}
            onClick={() => void store.reload(replay.engineId)}
          >
            <RefreshCw size={14} />
            {state.operation === "read" ? "正在读取…" : "重新读取"}
          </button>
        </div>
        {!rows && !state.busy && !state.error && (
          <p>展开收藏列表后可读取片段。</p>
        )}
        {rows && !rows.clips.length && (
          <div className="replay-editor-empty">
            <Bookmark size={24} />
            <strong>收藏值得再听的片段</strong>
            <p>先在上方采用小节范围，再填写名称保存。</p>
          </div>
        )}
        {rows && rows.clips.length > 0 && !filtered.length && (
          <p>
            没有匹配的片段。
            <button onClick={() => store.update({ search: "", page: 0 })}>
              清除查找
            </button>
          </p>
        )}
        <ul className="replay-clip-cards">
          {filtered.slice(page * 12, page * 12 + 12).map((clip) => (
            <li
              key={clip.id}
              className={draft.id === clip.id ? "is-editing" : ""}
            >
              <div className="replay-editor-heading">
                <strong>{clip.name}</strong>
                <span>
                  {clip.start.toFixed(3)}–{clip.end.toFixed(3)} 秒
                </span>
              </div>
              {clip.notes && <p>{clip.notes}</p>}
              {needsRangeReview(clip) && (
                <p className="replay-editor-hint">
                  {clip.performanceRevision
                    ? "收藏所用的演奏资料已有更新，请核对原秒数。"
                    : "旧收藏未记录演奏版本，可先核对范围。"}
                </p>
              )}
              <div className="replay-editor-actions">
                <button
                  disabled={
                    blocked ||
                    replay.busy ||
                    duration <= 0 ||
                    needsRangeReview(clip) ||
                    clip.end > duration + 0.001
                  }
                  onClick={() => {
                    const end = Math.min(clip.end, duration);
                    chooseClip(clip);
                    store.update({ rangeOpen: true });
                    void replay.play(state.source, state.rate, {
                      start: clip.start,
                      end,
                    });
                  }}
                >
                  循环听这个片段
                </button>
                <button
                  disabled={blocked || replay.busy}
                  onClick={() => chooseClip(clip)}
                >
                  {needsRangeReview(clip) ? "核对片段范围" : "采用片段范围"}
                </button>
                <button
                  disabled={
                    replay.busy ||
                    replay.phase === "idle" ||
                    needsRangeReview(clip)
                  }
                  onClick={() => void locate(clip)}
                >
                  定位片段起点
                </button>
                <button
                  disabled={blocked}
                  onClick={() => {
                    store.beginEdit(clip, false, replay.historySource);
                    setRemove(null);
                  }}
                >
                  修改片段
                </button>
                <button disabled={blocked} onClick={() => setRemove(clip)}>
                  删除片段
                </button>
              </div>
              {remove?.id === clip.id && (
                <div
                  className="replay-clip-remove"
                  role="group"
                  aria-label={`删除${clip.name}`}
                >
                  <span>删除「{clip.name}」？演奏记录仍会保留。</span>
                  <button
                    disabled={blocked}
                    onClick={() => {
                      const candidate = remove;
                      setRemove(null);
                      void store.remove(candidate, replay.engineId);
                    }}
                  >
                    确认删除片段
                  </button>
                  <button disabled={state.busy} onClick={() => setRemove(null)}>
                    取消
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!!filtered.length && (
          <BrowsePagination
            page={page}
            total={filtered.length}
            pageSize={12}
            disabled={false}
            label="收藏片段"
            unit="个"
            change={(page) => store.update({ page })}
          />
        )}
      </div>
    </details>
  );
}
