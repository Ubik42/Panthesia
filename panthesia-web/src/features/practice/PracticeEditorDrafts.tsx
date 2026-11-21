import {
  ladderBpm,
  passageInitialBpm,
  passageTransformLabel,
} from "./passagePractice";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LoadedSong, PracticeEditScope } from "../../api";
import type {
  PassagePreset,
  LadderPreset,
} from "../../engine/commands.generated";
import { expressionGoalText } from "./ExpressionGoalControl";
import type { ReactNode } from "react";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import {
  getPracticeEditor,
  practiceScopeKey,
  practiceDraftDirty,
  type EditorForm,
  type PracticeEditorStore,
  type PracticeDraft,
} from "./practiceEditorStore";
import "./practiceEditor.css";

export function usePracticeEditor(
  kind: "passage" | "ladder",
  contentId: string,
  source: PracticeEditScope,
  initial: EditorForm,
  info: LoadedSong,
) {
  const [store] = useState(() => getPracticeEditor(kind, contentId));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    store.rememberSource(info);
    if (!store.getSnapshot().drafts.length && !store.getSnapshot().receipt)
      store.open(initial, source);
  }, [store]);
  const draft = state.drafts.find((row) => row.key === state.selected);
  return { store, state, draft, form: { ...initial, ...draft?.form } };
}
export function practiceDraftConflict(
  draft: PracticeDraft | undefined,
  source: PracticeEditScope,
  row: { id: string } | undefined,
) {
  return (
    !!draft &&
    (draft.scope !== practiceScopeKey(source) ||
      (!!draft.id && (!row || draft.base !== JSON.stringify(row))))
  );
}

export function PracticeEditorDrafts<Row extends { id: string; name: string }>({
  store,
  source,
  rows,
  toForm,
  describe,
  loaded,
  readFor,
  settled,
  revision,
  reading,
  blocked,
  reload,
  create,
}: {
  store: PracticeEditorStore;
  source: PracticeEditScope;
  rows: Row[];
  toForm: (row: Row) => EditorForm;
  describe: (row: Row) => ReactNode;
  loaded: boolean;
  readFor: string | null;
  settled: boolean;
  revision: string | undefined;
  reading: boolean;
  blocked: boolean;
  reload: () => void;
  create: () => void;
}) {
  const state = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    ),
    current = state.drafts.find((row) => row.key === state.selected),
    saved = rows.find((row) => row.id === current?.id),
    receipt = state.receipt,
    result = rows.find((row) => row.id === receipt?.target),
    fresh = !!receipt && readFor === receipt.key,
    resultReady = fresh && settled,
    locked = state.busy || blocked || !!receipt;
  const conflict = loaded && practiceDraftConflict(current, source, saved);
  const draftTabs = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = draftTabs.current;
    const selected = strip?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (!strip || !selected) return;
    const outer = strip.getBoundingClientRect(),
      inner = selected.getBoundingClientRect();
    if (inner.left < outer.left) strip.scrollLeft += inner.left - outer.left;
    else if (inner.right > outer.right)
      strip.scrollLeft += inner.right - outer.right;
  }, [state.selected, state.drafts.length]);
  const acknowledge = (keepInput: boolean) =>
    store.reconcile(rows, settled, source, toForm, revision, true, keepInput);
  return (
    <>
      <PersistentSessionRecovery
        store={store}
        error={state.storageError}
        busy={state.busy}
        label="练习输入"
      />
      <div className="practice-draft-strip" aria-label="本曲暂存输入">
        <div className="practice-draft-strip-heading">
          <strong>暂存输入 · {state.drafts.length}/24</strong>
          <button disabled={locked} onClick={create}>
            新建草稿
          </button>
        </div>
        <div className="practice-draft-tabs" ref={draftTabs}>
          {state.drafts.map((draft, index) => (
            <button
              key={draft.key}
              disabled={locked}
              aria-pressed={draft.key === state.selected}
              onClick={() => store.select(draft.key)}
              title={draft.form.name || `未命名草稿 ${index + 1}`}
            >
              <span>{draft.form.name || `未命名草稿 ${index + 1}`}</span>
              <small>
                {practiceDraftDirty(draft) ? "待保存输入" : "已保存"}
              </small>
            </button>
          ))}
        </div>
        <p>输入自动暂存于本机。切换方案或关闭窗口后可以继续。</p>
        {current && (
          <button
            className="practice-forget-draft"
            disabled={locked}
            onClick={() => store.forget(current.key)}
          >
            删除当前暂存输入
          </button>
        )}
        {state.discarded.length > 0 && (
          <button
            className="practice-forget-draft"
            disabled={locked || state.drafts.length >= 24}
            onClick={() => store.restore()}
          >
            恢复最近删除的输入 · {state.discarded.length}
          </button>
        )}
      </div>
      {receipt && (
        <section
          className="practice-save-receipt"
          aria-label="保存结果核对"
          role="status"
        >
          <strong>
            {receipt.phase === "sending"
              ? "正在保存练习资料…"
              : receipt.phase === "acknowledged"
                ? receipt.message
                : "保存回复需要核对"}
          </strong>
          <p>
            {receipt.phase === "acknowledged"
              ? "保存回复已收到。读取列表后可继续编辑。"
              : "原输入和保存编号已保留。读取当前列表后，核对实际资料再继续。"}
          </p>
          <button disabled={state.busy || reading || blocked} onClick={reload}>
            {reading ? "正在读取结果…" : "读取保存结果"}
          </button>
          {fresh && result && (
            <div className="practice-receipt-result">
              <strong>当前保存版本：{result.name}</strong>
              {describe(result)}
              <button
                disabled={state.busy || blocked || !resultReady}
                onClick={() => acknowledge(false)}
              >
                采用保存版本
              </button>
              <button
                disabled={state.busy || blocked || !resultReady}
                onClick={() => acknowledge(true)}
              >
                保留当前输入继续编辑
              </button>
            </div>
          )}
          {fresh && !settled && <p>后台资料仍在处理，请稍后重新读取结果。</p>}
          {resultReady && !result && (
            <>
              <p>当前列表中没有这份资料，后台写入已结束。</p>
              <button
                disabled={state.busy || blocked}
                onClick={() => acknowledge(true)}
              >
                确认结果，保留输入
              </button>
            </>
          )}
        </section>
      )}
      {!receipt && conflict && (
        <section className="practice-draft-conflict" role="status">
          <strong>
            {current?.scope !== practiceScopeKey(source)
              ? "草稿来源需要重新核对"
              : saved
                ? "保存的资料已变化"
                : "原方案已从列表移除"}
          </strong>
          <p>
            当前输入继续保留。请核对小节范围、练习设置和保存版本，再选择如何继续。
          </p>
          {!saved && current?.id && state.kind === "passage" && (
            <p>
              新建小节段采用当前起止小节。拍内或原谱定位可在范围编辑器中重新选择。
            </p>
          )}
          {saved && (
            <>
              <p>当前保存版本：{saved.name}</p>
              {describe(saved)}
              <button
                disabled={locked || reading}
                onClick={() => store.rebase(source, saved, toForm(saved))}
              >
                采用保存版本
              </button>
            </>
          )}
          <button
            disabled={locked || reading}
            onClick={() =>
              store.rebase(
                source,
                saved,
                undefined,
                saved ? toForm(saved) : undefined,
              )
            }
          >
            {saved
              ? "保留输入，以当前版本继续编辑"
              : current?.id
                ? state.kind === "passage"
                  ? "保留输入，新建小节段"
                  : "保留输入，新建阶梯方案"
                : "已核对，按当前谱面继续"}
          </button>
        </section>
      )}
      {state.notice && !receipt && (
        <p className="practice-draft-notice" role="status">
          {state.notice}
        </p>
      )}
    </>
  );
}
export function PracticeCatalogFilters({
  store,
  kind,
}: {
  store: PracticeEditorStore;
  kind: "passage" | "ladder";
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <div className="practice-catalog-filters">
      <label>
        筛选
        <select
          aria-label="筛选已保存方案"
          value={state.filter}
          onChange={(event) =>
            store.update({
              filter: event.target.value as typeof state.filter,
              page: 0,
            })
          }
        >
          <option value="all">全部方案</option>
          <option value="drafts">有待保存输入</option>
          <option value="needsReview">小节待核对</option>
          {kind === "ladder" && (
            <>
              <option value="unstarted">尚未练习</option>
              <option value="progress">已有进度</option>
              <option value="completed">已完成</option>
            </>
          )}
        </select>
      </label>
      <label>
        排序
        <select
          aria-label="方案排序"
          value={state.sort}
          onChange={(event) =>
            store.update({
              sort: event.target.value as typeof state.sort,
              page: 0,
            })
          }
        >
          <option value="source">新建优先</option>
          <option value="name">按名称</option>
          <option value="range">按小节</option>
        </select>
      </label>
    </div>
  );
}
export function sortPracticeRows<
  Row extends { name: string; start: number; end: number },
>(rows: Row[], sort: "source" | "name" | "range") {
  return sort === "source"
    ? [...rows].reverse()
    : [...rows].sort((left, right) =>
        sort === "range"
          ? left.start - right.start ||
            left.end - right.end ||
            left.name.localeCompare(right.name, "zh-CN", { numeric: true })
          : left.name.localeCompare(right.name, "zh-CN", { numeric: true }),
      );
}
export function SavedPracticeDetails({
  row,
  song,
}: {
  song: LoadedSong;
  row: PassagePreset | LadderPreset;
}) {
  const ladder = "plan" in row,
    range =
      "preciseRange" in row && row.preciseRange
        ? row.preciseRange.description
        : "scoreRange" in row && row.scoreRange
          ? row.scoreRange.description
          : `第 ${row.start}–${row.end} 小节`;
  return (
    <div className="practice-saved-details">
      <dl>
        <div>
          <dt>练习范围</dt>
          <dd>{range}</dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>
            {ladder
              ? `${ladderBpm(song, row.start, row.plan.startPercent)} → ${ladderBpm(song, row.start, row.plan.targetPercent)} BPM`
              : `${passageInitialBpm(song, row)} BPM`}
          </dd>
        </div>
        <div>
          <dt>转调与量化</dt>
          <dd>{passageTransformLabel(row)}</dd>
        </div>
        <div>
          <dt>模式与手别</dt>
          <dd>
            {row.settings.mode === "wait"
              ? "等音"
              : row.settings.mode === "flow"
                ? "连续"
                : row.settings.mode === "listen"
                  ? "聆听"
                  : "原练习模式"}{" "}
            ·{" "}
            {row.settings.hands === "left"
              ? "左手"
              : row.settings.hands === "right"
                ? "右手"
                : row.settings.hands === "custom"
                  ? "自定义声部"
                  : "双手"}
          </dd>
        </div>
        <div>
          <dt>预备与节拍器</dt>
          <dd>
            预备 {row.settings.countIn} 小节 ·{" "}
            {row.settings.metronome ? "节拍器开启" : "节拍器关闭"}
          </dd>
        </div>
      </dl>
      {ladder && (
        <p>
          每级增加 {ladderBpm(song, row.start, row.plan.stepPercent)} BPM ·
          连续达标 {row.plan.passesRequired} 轮 · 正确率 ≥
          {row.plan.accuracyPercent}%
          {row.plan.onTimePercent !== null &&
            ` · 准时率 ≥${row.plan.onTimePercent}%`}{" "}
          · 本次上限 {row.plan.attemptLimit} 轮
        </p>
      )}
      {"expression" in row && row.expression && (
        <p>力度/踏板：{expressionGoalText(row.expression)}</p>
      )}
      {"notes" in row && row.notes && (
        <p className="practice-saved-notes">{row.notes}</p>
      )}
    </div>
  );
}

export function PracticeListPager({
  count,
  page,
  change,
  disabled = false,
}: {
  count: number;
  page: number;
  change: (page: number) => void;
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(count / 12));
  return (
    <nav className="practice-list-pager" aria-label="方案列表分页">
      <button disabled={disabled || page <= 0} onClick={() => change(page - 1)}>
        上一页
      </button>
      <span>
        {page + 1} / {pages} 页 · {count} 项
      </span>
      <button
        disabled={disabled || page >= pages - 1}
        onClick={() => change(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
export function RevealPracticeSelection<
  Row extends { id: string; name: string; start: number; end: number },
>({
  store,
  rows,
  id,
  visible,
}: {
  store: PracticeEditorStore;
  rows: Row[];
  id: string | null;
  visible: boolean;
}) {
  if (!id || visible || !rows.some((row) => row.id === id)) return null;
  return (
    <button
      className="practice-reveal-selection"
      onClick={() => {
        const sorted = sortPracticeRows(rows, store.getSnapshot().sort),
          index = sorted.findIndex((row) => row.id === id);
        store.update({
          query: "",
          filter: "all",
          page: Math.max(0, Math.floor(index / 12)),
        });
      }}
    >
      在列表中定位当前方案
    </button>
  );
}
