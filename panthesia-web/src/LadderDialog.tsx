import {
  measureBpm,
  ladderBpm,
  passageTransformLabel,
} from "./features/practice/passagePractice";
import {
  ladderForm,
  ladderSpeeds,
  readLadderExpression,
  ladderInputProblem,
  integerInput,
  newLadderForm,
  ladderPlan,
} from "./features/practice/practiceEditorForms";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import type { LadderCatalog } from "./features/practice/catalogTypes";
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
import {
  ExpressionGoalControl,
  expressionGoalText,
} from "./ExpressionGoalControl";
import {
  api,
  type LoadedSong,
  type Snapshot,
  type LadderPreset,
  type LadderRun,
  type EngineCommand,
} from "./api";
export { ladderSpeeds };
export function LadderStatus({
  song,
  state,
  action,
  manage,
}: {
  song?: LoadedSong;
  state: Pick<Snapshot, "ladder" | "routine" | "status" | "speed" | "mode">;
  action: (c: EngineCommand) => void;
  manage: () => void;
}) {
  const run = state.ladder;
  if (!run) return null;
  const speeds = ladderSpeeds(run.preset.plan);
  const roundExpression = state.routine
    ? state.routine.goal.expression
    : run.preset.expression;
  return (
    <div className="ladder-status" aria-live="polite">
      <div>
        <strong>{run.preset.name}</strong>
        <span>
          第 {run.progress.stage + 1}/{speeds.length} 级 ·{" "}
          {ladderBpm(song, run.preset.start, speeds[run.progress.stage])} →{" "}
          {ladderBpm(song, run.preset.start, run.preset.plan.targetPercent)} BPM
          · 连续达标 {run.progress.successStreak}/
          {run.preset.plan.passesRequired} 轮 · 已练 {run.progress.totalRounds}{" "}
          轮
        </span>
        <span>
          正确率 ≥{run.preset.plan.accuracyPercent}%
          {run.preset.plan.onTimePercent !== null &&
            ` · 准时率 ≥${run.preset.plan.onTimePercent}%`}
        </span>
        {roundExpression && (
          <span>力度/踏板：{expressionGoalText(roundExpression)}</span>
        )}
      </div>
      <span className="ladder-outcome">
        {run.progress.lastResult ||
          (state.status === "ready" ? "已应用，按开始练习" : "等待本轮结果")}
      </span>
      <button onClick={manage}>查看方案</button>
      {run.active && (
        <button onClick={() => action({ type: "stopLadder" })}>结束阶梯</button>
      )}
    </div>
  );
}
export function LadderDialog({
  song,
  state,
  start,
  end,
  close,
  changed,
}: {
  song: LoadedSong;
  state: Pick<Snapshot, "ladder" | "routine" | "status" | "speed" | "mode">;
  start: number;
  end: number;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const source = useRef(capturePracticeScope(song)),
    sourceChanged = !samePracticeScope(source.current, song);
  const initial = newLadderForm(start, end, state.speed);
  const editor = usePracticeEditor(
      "ladder",
      song.contentId,
      source.current,
      initial,
      song,
    ),
    { store, draft, form } = editor;
  const id = draft?.id ?? null,
    name = form.name,
    first = integerInput(form.first),
    last = integerInput(form.last);
  const plan = ladderPlan(form);
  const expression = readLadderExpression(form.expression);
  const [presets, setPresets] = useState<LadderPreset[]>([]),
    [runs, setRuns] = useState<LadderRun[]>([]),
    [loaded, setLoaded] = useState(false),
    [catalogRevision, setCatalogRevision] = useState<string>(),
    [reading, setReading] = useState(false),
    [readError, setReadError] = useState(""),
    [error, setError] = useState(""),
    [actionBusy, setActionBusy] = useState(false),
    [readFor, setReadFor] = useState<string | null>(null),
    [settled, setSettled] = useState(false),
    [showAllLevels, setShowAllLevels] = useState(false);
  const busy = actionBusy || editor.state.busy,
    pending = !!editor.state.receipt,
    working = useRef(false),
    active = !!state.ladder?.active;
  const navigationLocked = busy || pending || sourceChanged;
  const locked = navigationLocked || !draft;
  const readCatalog = useCatalogRead(source.current, song);
  const reload = async () => {
    const receipt = store.getSnapshot().receipt?.key ?? null,
      request = readCatalog<LadderCatalog>({ type: "ladderPresets" });
    setReading(true);
    setReadError("");
    try {
      const data = await request.result;
      if (!request.isCurrent())
        throw new Error("曲目已改变，请重新打开速度阶梯。");
      setPresets(data.presets);
      setRuns(data.runs);
      setCatalogRevision(data.catalogRevision);
      setLoaded(true);
      setReadFor(receipt);
      setSettled(data.writeSettled === true);
      if (receipt === store.getSnapshot().receipt?.key)
        store.reconcile(
          data.presets,
          data.writeSettled === true,
          source.current,
          ladderForm,
          data.catalogRevision,
        );
      store.refreshClean(data.presets, source.current, ladderForm);
    } catch (error) {
      if (request.isCurrent())
        setReadError(error instanceof Error ? error.message : String(error));
      throw error;
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
      setShowAllLevels(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const saved = presets.find((row) => row.id === id),
    conflict = loaded && practiceDraftConflict(draft, source.current, saved),
    checkpoint =
      state.ladder?.preset.id === id
        ? state.ladder
        : runs.find((row) => row.preset.id === id);
  const dirty =
    !!saved && JSON.stringify(form) !== JSON.stringify(ladderForm(saved));
  const staleRange =
    !!saved && !saved.practice && !!song.grid && saved.grid !== song.grid;
  const runMap = new Map(runs.map((run) => [run.preset.id, run]));
  const search = editor.state.query.trim().toLocaleLowerCase("zh-CN"),
    visible = sortPracticeRows(
      presets.filter((row) => {
        if (
          search &&
          ![
            row.name,
            row.start,
            row.end,
            row.plan.startPercent,
            row.plan.targetPercent,
          ]
            .join(" ")
            .toLocaleLowerCase("zh-CN")
            .includes(search)
        )
          return false;
        const run = runMap.get(row.id);
        switch (editor.state.filter) {
          case "drafts":
            return editor.state.drafts.some(
              (draft) => draft.id === row.id && practiceDraftDirty(draft),
            );
          case "needsReview":
            return !!song.grid && row.grid !== song.grid;
          case "unstarted":
            return !run;
          case "progress":
            return !!run && !run.progress.completed;
          case "completed":
            return !!run?.progress.completed;
          default:
            return true;
        }
      }),
      editor.state.sort,
    );
  const page = Math.min(
    editor.state.page,
    Math.max(0, Math.ceil(visible.length / 12) - 1),
  );
  useEffect(() => {
    if (loaded && editor.state.page !== page) store.update({ page });
  }, [loaded, page, editor.state.page, store]);
  const baseBpm = measureBpm(song, first);
  const speedFields = new Set(["startPercent", "targetPercent", "stepPercent"]);
  const problem = ladderInputProblem(
    form,
    plan,
    first,
    last,
    song.measures.length,
    state.mode,
    expression,
    baseBpm,
  );
  const speedValid =
    [plan.startPercent, plan.targetPercent, plan.stepPercent].every(
      Number.isInteger,
    ) &&
    plan.startPercent >= 25 &&
    plan.targetPercent <= 200 &&
    plan.targetPercent >= plan.startPercent &&
    plan.stepPercent >= 1 &&
    plan.stepPercent <= 50;
  const speeds = speedValid ? ladderSpeeds(plan) : [],
    displayedSpeeds = showAllLevels ? speeds : speeds.slice(0, 12);
  const minimumRounds =
    Number.isInteger(plan.passesRequired) &&
    plan.passesRequired >= 1 &&
    plan.passesRequired <= 10
      ? speeds.length * plan.passesRequired
      : null;
  const ready =
    !locked && !reading && loaded && !active && !conflict && !!catalogRevision;
  const apply = (resume: boolean) =>
    void work(async () => {
      if (!id) return;
      await api.editPractice(
        source.current,
        { type: "startLadder", id, resume },
        catalogRevision,
      );
      await changed();
      close();
    });
  const fields: { key: string; label: string; min: number; max: number }[] = [
    { key: "first", label: "开始小节", min: 1, max: song.measures.length },
    {
      key: "last",
      label: "结束小节",
      min: Number.isFinite(first) ? first : 1,
      max: song.measures.length,
    },
    { key: "startPercent", label: "起始速度 BPM", min: 25, max: 200 },
    {
      key: "targetPercent",
      label: "目标速度 BPM",
      min: Number.isFinite(plan.startPercent) ? plan.startPercent : 25,
      max: 200,
    },
    { key: "stepPercent", label: "每级增加 BPM", min: 1, max: 50 },
    { key: "passesRequired", label: "连续达标轮数", min: 1, max: 10 },
    { key: "accuracyPercent", label: "正确率至少 %", min: 50, max: 100 },
    { key: "attemptLimit", label: "本次轮数上限", min: 1, max: 500 },
  ];
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        className="settings-dialog ladder-dialog practice-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ladder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="ladder-title">速度阶梯</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={busy}
            aria-label="关闭速度阶梯"
            onClick={close}
          >
            关闭
          </button>
        </div>
        <TaskActivity
          contentId={song.contentId}
          label={["读取速度阶梯方案", "保存速度阶梯方案", "打开速度阶梯"]}
        />
        <div className="practice-catalog-toolbar">
          <button
            disabled={busy || reading || sourceChanged}
            onClick={() => void work(reload)}
          >
            {reading
              ? "正在读取…"
              : pending
                ? "读取保存结果"
                : "重新读取方案列表"}
          </button>
          <CopyPracticeDraft
            label="复制阶梯方案草稿"
            value={{
              source: source.current,
              contentId: song.contentId,
              title: song.title,
              id,
              ...form,
            }}
          />
        </div>
        {sourceChanged && (
          <p className="catalog-source-warning" role="alert">
            曲目、标注或连接已变化。当前输入已保留，请重新打开速度阶梯并核对范围。
          </p>
        )}
        {readError && (
          <p className="ladder-error" role="alert">
            方案读取失败：{readError}
          </p>
        )}
        {error && (
          <p className="ladder-error" role="alert">
            {error}
          </p>
        )}
        <PracticeEditorDrafts
          store={store}
          source={source.current}
          rows={presets}
          toForm={ladderForm}
          describe={(row) => <SavedPracticeDetails row={row} song={song} />}
          loaded={loaded}
          readFor={readFor}
          settled={settled}
          revision={catalogRevision}
          reading={reading}
          blocked={sourceChanged || actionBusy}
          reload={() => void work(reload)}
          create={create}
        />
        <div className="ladder-layout">
          <aside className="ladder-library" aria-label="已保存速度阶梯">
            <div className="ladder-list-heading">
              <strong>本曲方案</strong>
              <span>{presets.length} 份</span>
            </div>
            <label className="passage-search">
              查找方案
              <input
                type="search"
                aria-label="查找阶梯方案"
                maxLength={1024}
                value={editor.state.query}
                placeholder="名称、小节或速度"
                onChange={(event) =>
                  store.update({ query: event.target.value, page: 0 })
                }
              />
            </label>
            <PracticeCatalogFilters store={store} kind="ladder" />
            <PracticeListPager
              count={visible.length}
              page={page}
              change={(page) => store.update({ page })}
            />
            {!loaded && (
              <p className="parameter-help">
                {reading ? "正在读取已保存方案…" : "请重新读取方案列表。"}
              </p>
            )}
            {loaded && !presets.length && (
              <p className="parameter-help">
                还没有方案。设置范围和达标标准后保存。
              </p>
            )}
            {loaded && presets.length > 0 && !visible.length && (
              <p className="parameter-help">没有找到符合条件的方案。</p>
            )}
            {visible.slice(page * 12, (page + 1) * 12).map((row) => {
              const run = runMap.get(row.id);
              return (
                <button
                  className={
                    "ladder-preset " + (id === row.id ? "selected" : "")
                  }
                  key={row.id}
                  aria-pressed={id === row.id}
                  disabled={navigationLocked}
                  onClick={() => {
                    try {
                      store.open(ladderForm(row), source.current, row);
                      setShowAllLevels(false);
                    } catch (error) {
                      setError(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  }}
                >
                  <strong>{row.name}</strong>
                  <span>
                    第 {row.start}–{row.end} 小节 ·{" "}
                    {ladderBpm(song, row.start, row.plan.startPercent)} →{" "}
                    {ladderBpm(song, row.start, row.plan.targetPercent)} BPM ·{" "}
                    {passageTransformLabel(row)}
                  </span>
                  <small>
                    {run
                      ? run.progress.completed
                        ? "已完成"
                        : "已练 " +
                          run.progress.totalRounds +
                          " 轮 · 停在第 " +
                          (run.progress.stage + 1) +
                          " 级"
                      : "尚未练习"}
                  </small>
                  {row.expression && (
                    <small>
                      力度/踏板：{expressionGoalText(row.expression)}
                    </small>
                  )}
                  {editor.state.drafts.some((draft) => draft.id === row.id) && (
                    <small>有暂存输入</small>
                  )}
                  {!row.practice && !!song.grid && row.grid !== song.grid && (
                    <small className="passage-stale">小节范围待核对</small>
                  )}
                </button>
              );
            })}
            {active && !state.routine && (
              <button
                className="ladder-stop"
                disabled={busy || sourceChanged}
                onClick={() =>
                  void work(async () => {
                    await api.adjustForSong(source.current, {
                      type: "stopLadder",
                    });
                    await changed();
                    await reload();
                  })
                }
              >
                结束当前阶梯，保留进度
              </button>
            )}
            {active && state.routine && (
              <p className="parameter-help">
                当前阶梯由练习计划管理，请在计划中结束本项。
              </p>
            )}
          </aside>
          <div className="ladder-editor">
            <div className="practice-editor-summary">
              <strong>{id ? "编辑阶梯方案" : "新建阶梯方案"}</strong>
              <span>
                {dirty ? "有待保存输入" : id ? "已保存版本" : "本机草稿"}
              </span>
            </div>
            <RevealPracticeSelection
              store={store}
              rows={presets}
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
                  conflict
                }
                onClick={() => store.duplicate(source.current)}
              >
                复制为新方案
              </button>
              {saved && (
                <button
                  disabled={locked || !loaded}
                  onClick={() =>
                    store.rebase(source.current, saved, ladderForm(saved))
                  }
                >
                  恢复保存版本
                </button>
              )}
              <button
                disabled={locked}
                onClick={() =>
                  store.patch({ first: String(start), last: String(end) })
                }
              >
                使用主界面选段
              </button>
            </div>
            <label className="ladder-name">
              方案名称
              <input
                aria-label="阶梯方案名称"
                value={name}
                maxLength={160}
                disabled={locked}
                placeholder="例如：右手第 1–4 小节提速"
                onChange={(event) => store.patch({ name: event.target.value })}
              />
            </label>
            <div className="ladder-form-grid">
              {fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    aria-label={"阶梯" + field.label}
                    type="number"
                    min={
                      speedFields.has(field.key)
                        ? (baseBpm * field.min) / 100
                        : field.min
                    }
                    max={
                      speedFields.has(field.key)
                        ? (baseBpm * field.max) / 100
                        : field.max
                    }
                    step={speedFields.has(field.key) ? baseBpm / 100 : 1}
                    value={
                      speedFields.has(field.key) && form[field.key] !== ""
                        ? Math.round(Number(form[field.key]) * baseBpm) / 100
                        : form[field.key]
                    }
                    disabled={locked}
                    onChange={(event) =>
                      store.patch({
                        [field.key]:
                          speedFields.has(field.key) &&
                          event.target.value !== ""
                            ? String(
                                Math.round(
                                  (Number(event.target.value) * 100) / baseBpm,
                                ),
                              )
                            : event.target.value,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="ladder-checkbox">
              <input
                aria-label="阶梯要求准时率"
                type="checkbox"
                disabled={
                  locked ||
                  (state.mode !== "flow" && form.onTimeEnabled !== "yes")
                }
                checked={form.onTimeEnabled === "yes"}
                onChange={(event) =>
                  store.patch({
                    onTimeEnabled: event.target.checked ? "yes" : "no",
                  })
                }
              />
              同时要求准时率（连续模式）
            </label>
            {form.onTimeEnabled === "yes" && (
              <label className="ladder-name">
                准时率至少 %
                <input
                  aria-label="阶梯准时率门槛"
                  type="number"
                  min={50}
                  max={100}
                  value={form.onTimePercent}
                  disabled={locked}
                  onChange={(event) =>
                    store.patch({ onTimePercent: event.target.value })
                  }
                />
              </label>
            )}
            <label className="ladder-failure">
              未达标处理
              <select
                aria-label="阶梯未达标处理"
                disabled={locked}
                value={form.failuresBeforeStepBack}
                onChange={(event) =>
                  store.patch({ failuresBeforeStepBack: event.target.value })
                }
              >
                <option value="0">重复当前速度</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      连续 {count} 轮未达标，回退一级
                    </option>
                  ),
                )}
              </select>
            </label>
            <ExpressionGoalControl
              value={expression.value}
              wait={state.mode === "wait"}
              disabled={locked}
              change={(value) =>
                store.patch({ expression: JSON.stringify(value) })
              }
              labelPrefix="阶梯"
            />
            {speeds.length > 0 && (
              <>
                <div className="ladder-levels" aria-label="阶梯速度级别">
                  {displayedSpeeds.map((speed, index) => (
                    <span key={speed}>
                      {index + 1}. {ladderBpm(song, first, speed)} BPM
                    </span>
                  ))}
                </div>
                {speeds.length > 12 && (
                  <button onClick={() => setShowAllLevels(!showAllLevels)}>
                    {showAllLevels
                      ? "收起级别"
                      : "展开全部 " + speeds.length + " 级"}
                  </button>
                )}
                <div className="practice-settings-summary">
                  <span>共 {speeds.length} 级</span>
                  <span>
                    {minimumRounds === null
                      ? "待输入达标轮数"
                      : "最快需 " + minimumRounds + " 轮达标"}
                  </span>
                  <span>
                    {Number.isInteger(plan.attemptLimit)
                      ? "本次最多 " + plan.attemptLimit + " 轮"
                      : "待输入轮数上限"}
                  </span>
                </div>
                {minimumRounds !== null &&
                  plan.attemptLimit < minimumRounds && (
                    <p className="parameter-help">
                      本次轮数上限小于最少达标轮数，可分次继续保存进度。
                    </p>
                  )}
              </>
            )}
            <p className="parameter-help">
              保存采用当前转调、量化、模式、声部、左右手、预备拍和节拍器设置。BPM
              按选段起点显示，保留原曲内部的速度变化。每一级连续达标后晋级，目标级也需达标。
            </p>
            {active && (
              <p className="practice-input-problem" role="status">
                当前阶梯正在进行。可以准备草稿，结束阶梯后保存或应用。
              </p>
            )}
            {staleRange && (
              <p className="practice-input-problem" role="status">
                小节网格已变化。请核对范围后保存方案，再应用练习。更新范围或条件后会重新开始计入进度。
              </p>
            )}
            {saved && (
              <p className="parameter-help">
                已存方案：{saved.settings.mode === "wait" ? "等音" : "连续"} ·{" "}
                {saved.settings.hands === "left"
                  ? "左手"
                  : saved.settings.hands === "right"
                    ? "右手"
                    : saved.settings.hands === "custom"
                      ? "自定义声部"
                      : "双手"}{" "}
                · 预备 {saved.settings.countIn}{" "}
                小节。更改范围、设置或晋级规则会清除进度。“仅更新名称”保留原设置与进度。
              </p>
            )}
            {checkpoint && (
              <p className="ladder-checkpoint">
                上次：{checkpoint.progress.lastResult || "已应用"} · 第{" "}
                {checkpoint.progress.stage + 1} 级 · 已练{" "}
                {checkpoint.progress.totalRounds} 轮
                {checkpoint.progress.lastAccuracy !== null &&
                  " · 上轮正确率 " +
                    Math.round(checkpoint.progress.lastAccuracy * 100) +
                    "%"}
              </p>
            )}
            {dirty && (
              <p className="parameter-help">
                应用与继续进度采用已保存方案。当前输入继续暂存，保存后才会用于练习。
              </p>
            )}
            {problem && (
              <p className="practice-input-problem" role="status">
                {problem}
              </p>
            )}
            <div className="ladder-actions">
              <button
                className="primary-button"
                disabled={!ready || !!problem || !!editor.state.storageError}
                onClick={() =>
                  void work(async () => {
                    await store.commit(
                      source.current,
                      {
                        type: "saveLadder",
                        id,
                        name,
                        start: first,
                        end: last,
                        plan,
                        expression: expression.value,
                      },
                      catalogRevision,
                      "save",
                      "速度阶梯方案已保存",
                    );
                    await reload();
                    await changed();
                  })
                }
              >
                {id ? "保存方案与当前设置" : "保存方案"}
              </button>
              {id && (
                <>
                  <button
                    disabled={
                      !ready ||
                      !name.trim() ||
                      Array.from(name).length > 80 ||
                      name.trim() === saved?.name ||
                      !!editor.state.storageError
                    }
                    onClick={() =>
                      void work(async () => {
                        await store.commit(
                          source.current,
                          { type: "updateLadderName", id, name },
                          catalogRevision,
                          "save",
                          "名称已更新，原方案设置与进度已保留",
                          true,
                        );
                        await reload();
                        await changed();
                      })
                    }
                  >
                    仅更新名称
                  </button>
                  <button
                    disabled={!ready || !saved || staleRange}
                    onClick={() => apply(false)}
                  >
                    应用已存方案
                  </button>
                  <button
                    disabled={
                      !ready ||
                      !checkpoint ||
                      checkpoint.progress.completed ||
                      staleRange
                    }
                    onClick={() => apply(true)}
                  >
                    继续保存进度
                  </button>
                  <button
                    disabled={!ready || !!editor.state.storageError}
                    onClick={() =>
                      void work(async () => {
                        await store.commit(
                          source.current,
                          { type: "removeLadder", id },
                          catalogRevision,
                          "remove",
                          "速度阶梯方案已移除",
                        );
                        await reload();
                        await changed();
                      })
                    }
                  >
                    移除已存方案
                  </button>
                </>
              )}
            </div>
            <p className="parameter-help">
              应用后按“开始练习”。结束阶梯会保留进度，可在下次继续。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
