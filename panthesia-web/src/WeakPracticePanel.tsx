import { RecommendationRow } from "./features/review/RecommendationRow";
import "./features/review/recommendations.css";
import { useEffect, useRef, useState } from "react";
import { useRoutineService } from "./features/routines/useRoutineService";
import { useRecommendationDraft } from "./features/review/useRecommendationDraft";
import { usePendingRecommendation } from "./features/review/usePendingRecommendation";
import { useHistoryRead } from "./engine/useHistoryRead";
import { TaskActivity } from "./engine/TaskActivity";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import type {
  Suggestion,
  RecommendationPage as SuggestionResult,
  RecommendationAccepted as AddedResult,
  RecommendationSubmission as Submission,
  ReviewEdit,
} from "./features/review/recommendationTypes";
const suggestedEdit = (row: Suggestion): ReviewEdit => ({
  speedPercent: Math.round(row.item.speed * 100),
  passes: row.item.goal.passes,
  accuracy: row.item.goal.accuracy,
  onTime: row.item.goal.onTime ?? null,
});
const addedMessage = (result: AddedResult) =>
  result.existing
    ? "计划已保存；本次重试没有重复创建。"
    : `已加入 ${result.added} 项，跳过相同条件项目 ${result.skipped} 项。`;
export function WeakPracticePanel({
  engineId,
  initiallyExpanded = false,
  routineId,
  day,
  disabled,
  work,
  added,
  openLibrary,
  resumeRevision,
}: {
  engineId?: string;
  initiallyExpanded?: boolean;
  routineId: string | null;
  day: string | null;
  disabled: boolean;
  work: (job: () => Promise<void>) => Promise<void>;
  added: (id: string) => Promise<void>;
  openLibrary: (focus: "missing" | "review") => void;
  resumeRevision: number;
}) {
  const service = useRoutineService(engineId);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lastResume = useRef(resumeRevision);
  const requestRevision = useRef(0);
  const draftRequestId = useRef<string | null>(null);
  const {
    rows,
    retired,
    chosen,
    edits,
    note,
    duePage,
    passageAvailability,
    name,
    message,
    stale,
    edited,
    filter,
    receipt: pendingAdded,
    rememberSaved,
    clearSaved,
    updateDraft,
    touch,
    setRows,
    setRetired,
    setChosen,
    setEdits,
    setDuePage,
    setName,
    setMessage,
    setStale,
    setFilter,
  } = useRecommendationDraft(routineId, day);
  const scope = JSON.stringify([routineId, day, engineId ?? null]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => {
    requestRevision.current++;
    draftRequestId.current = null;
    if (rows.length) setStale(true);
    return () => {
      requestRevision.current++;
    };
  }, [scope]);
  const retained = usePendingRecommendation(routineId, day);
  const pendingSubmission = retained.pending;
  const dueReader = useHistoryRead(engineId),
    weakReader = useHistoryRead(engineId);
  const [expanded, setExpanded] = useState(
    () =>
      initiallyExpanded ||
      !!pendingSubmission ||
      !!pendingAdded ||
      rows.length > 0 ||
      retired.length > 0,
  );
  useEffect(() => {
    if (pendingSubmission || pendingAdded || retained.error) setExpanded(true);
  }, [pendingSubmission, pendingAdded, retained.error]);
  const rememberSubmission = retained.remember;
  const clearSubmission = retained.clear;
  const locked =
    disabled ||
    !!pendingSubmission ||
    !!pendingAdded ||
    retained.original !== null ||
    retained.unread;
  const submit = async (submission: Submission) => {
    let result: AddedResult;
    try {
      result = await service.command<AddedResult>({
        type: "acceptWeakPractice",
        ids: submission.ids,
        edits: submission.edits,
        routine_id: submission.routineId,
        day: submission.day,
        name: submission.name,
        request_id: submission.requestId,
      });
    } catch (cause) {
      setMessage(
        "上次加入结果尚未确认。请用原条件重试核对，避免新建重复计划。",
      );
      throw cause;
    }
    clearSubmission(submission);
    updateDraft({
      chosen: [],
      edited:
        edited &&
        (retired.length > 0 ||
          Object.keys(edits).some((id) => !submission.ids.includes(id))),
    });
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !submission.ids.includes(id)),
      ),
    );
    draftRequestId.current = null;
    setMessage(addedMessage(result));
    rememberSaved(result);
    if (!mounted.current || activeScope.current !== scope) return;
    try {
      await added(result.id);
      clearSaved(result);
      setMessage(addedMessage(result));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setMessage(
        `${addedMessage(result)} 计划已保存，但界面读取失败：${detail}。请重试显示计划。`,
      );
    }
  };
  useEffect(() => {
    if (lastResume.current === resumeRevision) return;
    lastResume.current = resumeRevision;
    requestRevision.current++;
    draftRequestId.current = null;
    setStale(true);
    setMessage(
      pendingSubmission
        ? "上次加入结果尚未确认，请按原条件核对。"
        : pendingAdded
          ? "计划已经保存。曲库核对完成后，请重试显示已保存计划。"
          : "曲库资料可能已变化，请重新生成复习建议。",
    );
  }, [resumeRevision, pendingAdded, pendingSubmission]);
  const generate = () =>
    void work(async () => {
      if (pendingSubmission || retained.original !== null || retained.unread)
        return;
      const request = ++requestRevision.current;
      draftRequestId.current = null;
      setMessage("");
      const [dueResult, weakResult] = await Promise.allSettled([
        dueReader.request<SuggestionResult>({ type: "dueReview" }).result,
        weakReader.request<SuggestionResult>({ type: "weakPractice" }).result,
      ]);
      service.assertCurrent();
      if (request !== requestRevision.current) return;
      const due = dueResult.status === "fulfilled" ? dueResult.value : null;
      const weak = weakResult.status === "fulfilled" ? weakResult.value : null;
      const failure = [
        dueResult.status === "rejected" &&
          `到期复习读取失败：${String(dueResult.reason)}`,
        weakResult.status === "rejected" &&
          `薄弱项读取失败：${String(weakResult.reason)}`,
      ].filter((message): message is string => Boolean(message));
      if (!due && !weak) {
        setMessage(`${failure.join("；")}。当前预览和输入已保留，请重试生成。`);
        return;
      }
      const suggestions = [
        ...(weak?.suggestions ?? []),
        ...(due?.suggestions ?? []),
      ];
      const balanced = [
        ...(weak?.suggestions
          .filter((row) => row.kind !== "passageReview")
          .slice(0, 2) ?? []),
        ...(weak?.suggestions
          .filter((row) => row.kind === "passageReview")
          .slice(0, 2) ?? []),
        ...(due?.suggestions.slice(0, 2) ?? []),
      ];
      const initial = [
        ...balanced,
        ...suggestions.filter(
          (row) => !balanced.some((picked) => picked.id === row.id),
        ),
      ].slice(0, 6);
      const chosenIds = new Set(chosen);
      const retainedById = new Map<
        string,
        { row: Suggestion; chosen: boolean }
      >();
      for (const entry of [
        ...rows
          .filter((row) => chosenIds.has(row.id) || edits[row.id])
          .map((row) => ({ row, chosen: chosenIds.has(row.id) })),
        ...retired,
      ]) {
        if (!retainedById.has(entry.row.id))
          retainedById.set(entry.row.id, entry);
      }
      const retainedInputs = [...retainedById.values()];
      const currentIds = new Set(suggestions.map((row) => row.id));
      const nextChosen =
        rows.length || retired.length
          ? retainedInputs
              .filter((entry) => entry.chosen && currentIds.has(entry.row.id))
              .map((entry) => entry.row.id)
              .slice(0, 60)
          : initial.map((row) => row.id);
      const resultMessage = suggestions.length
        ? ""
        : due?.dueTotal
          ? "待复习曲目的原条件或文件位置暂不能自动编排。请在曲库核对曲目，缺失文件先重新关联。"
          : weak?.passageDueTotal
            ? "到期选段的曲目文件暂不可用。请在曲库核对文件并重新关联原曲。"
            : "暂无足够的重复薄弱证据；完成几轮后再生成。";
      updateDraft({
        rows: suggestions,
        chosen: nextChosen,
        retired: retainedInputs.filter(
          (entry) => !currentIds.has(entry.row.id),
        ),
        stale: false,
        note: [due?.note, weak?.note].filter(Boolean).join(" "),
        duePage: due
          ? {
              dueTotal: due.dueTotal ?? 0,
              eligibleTotal: due.eligibleTotal ?? 0,
              missingTotal: due.missingTotal ?? 0,
              revision: due.revision ?? "",
              nextOffset: due.nextOffset ?? due.suggestions.length,
              hasMore: due.hasMore === true,
            }
          : null,
        passageAvailability: weak
          ? {
              due: weak.passageDueTotal ?? 0,
              missing: weak.passageUnavailableTotal ?? 0,
            }
          : null,
        message: [resultMessage, ...failure].filter(Boolean).join(" "),
      });
    });
  const loadMoreDue = () =>
    void work(async () => {
      if (pendingSubmission || !duePage?.hasMore) return;
      const request = ++requestRevision.current;
      try {
        const data = await dueReader.request<SuggestionResult>({
          type: "dueReview",
          offset: duePage.nextOffset,
          expected: duePage.revision,
        }).result;
        service.assertCurrent();
        if (request !== requestRevision.current) return;
        setRows((current) => {
          const known = new Set(current.map((row) => row.id));
          return [
            ...current,
            ...data.suggestions.filter((row) => !known.has(row.id)),
          ];
        });
        setDuePage({
          dueTotal: data.dueTotal ?? duePage.dueTotal,
          eligibleTotal: data.eligibleTotal ?? duePage.eligibleTotal,
          missingTotal: data.missingTotal ?? duePage.missingTotal,
          revision: data.revision ?? duePage.revision,
          nextOffset:
            data.nextOffset ?? duePage.nextOffset + data.suggestions.length,
          hasMore: data.hasMore === true,
        });
      } catch (cause) {
        if (request !== requestRevision.current) return;
        const detail = cause instanceof Error ? cause.message : String(cause);
        setMessage(
          `到期复习分页读取失败：${detail}。已保留当前预览和选择，可重试读取；资料有变化时请重新生成。`,
        );
      }
    });
  const shownRows = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "notes" &&
        (row.kind === "accuracy" || row.kind === "rhythm")) ||
      (filter === "expression" &&
        (row.kind === "dynamics" || row.kind === "pedal")) ||
      (filter === "due" &&
        (row.kind === "review" || row.kind === "passageReview")),
  );
  const shownDue = rows.filter((row) => row.kind === "review").length;
  const editFor = (row: Suggestion) => edits[row.id] ?? suggestedEdit(row);
  const patchEdit = (row: Suggestion, change: Partial<ReviewEdit>) => {
    touch();
    setEdits((current) => ({
      ...current,
      [row.id]: { ...(current[row.id] ?? suggestedEdit(row)), ...change },
    }));
  };
  return (
    <details
      className="weak-practice-panel"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>从历史练习安排复习</summary>
      <TaskActivity
        label={["生成历史复习建议", "整理到期复习建议", "将复习建议加入计划"]}
        cancelLabel="取消复习准备"
      />
      {retained.error && (
        <div className="recommendation-retention" role="status">
          <p>{retained.error}</p>
          <button disabled={disabled} onClick={retained.retry}>
            {retained.unread
              ? "重试读取暂存"
              : pendingSubmission
                ? "重试暂存"
                : "重试清理"}
          </button>
          {pendingSubmission && (
            <CopyPracticeDraft
              label="复制上次加入请求"
              value={pendingSubmission}
            />
          )}
          {(retained.original !== null || retained.unread) && (
            <>
              {retained.original !== null && (
                <CopyPracticeDraft
                  plainText
                  label="复制旧请求原文"
                  value={retained.original}
                />
              )}
              <button disabled={disabled} onClick={retained.clearOriginal}>
                已核对计划，清理旧缓存
              </button>
            </>
          )}
        </div>
      )}
      <button disabled={locked} onClick={generate}>
        生成复习建议
      </button>
      {stale && (
        <p className="recommendation-stale" role="status">
          当前预览需要更新。已保留选择和条件，请重新生成建议后加入计划。
        </p>
      )}
      {pendingSubmission && (
        <div className="parameter-help" role="status">
          <p>
            “{pendingSubmission.name}”的 {pendingSubmission.ids.length}{" "}
            个复习项目尚未确认。软件保留了当时的条件。改选前请先在计划列表核对已有项目。
          </p>
          <button
            type="button"
            disabled={disabled || retained.original !== null}
            onClick={() => void work(() => submit(pendingSubmission))}
          >
            按原条件核对上次加入
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              clearSubmission(pendingSubmission);
              draftRequestId.current = null;
              setMessage("请核对计划列表后重新生成建议。");
            }}
          >
            已核对计划，重新选择
          </button>
        </div>
      )}
      <p className="parameter-help">
        预览后勾选加入
        {routineId
          ? day
            ? "当前日期安排"
            : "当前常用计划"
          : day
            ? "新计划与当前日期安排"
            : "新的常用计划"}
        ，不自动演奏。音符等薄弱项、到期选段和到期整曲各默认选择最多两项；你可以逐项修改。
      </p>
      {duePage && duePage.dueTotal > 0 && (
        <div className="parameter-help">
          <p>
            曲库中 {duePage.dueTotal} 首曲目待复习；{duePage.eligibleTotal}{" "}
            首可按原条件加入计划，当前已读取 {shownDue} 首。
            {duePage.missingTotal > 0 &&
              ` ${duePage.missingTotal} 首文件缺失，请先重新关联。`}
            {duePage.dueTotal - duePage.eligibleTotal - duePage.missingTotal >
              0 &&
              ` ${duePage.dueTotal - duePage.eligibleTotal - duePage.missingTotal} 首需核对练习条件。`}
          </p>
          {duePage.missingTotal > 0 && (
            <button
              type="button"
              disabled={locked}
              onClick={() => openLibrary("missing")}
            >
              查看缺失文件
            </button>
          )}
          {duePage.dueTotal - duePage.eligibleTotal - duePage.missingTotal >
            0 && (
            <button
              type="button"
              disabled={locked}
              onClick={() => openLibrary("review")}
            >
              查看待复习曲目
            </button>
          )}
          {duePage.dueTotal > duePage.eligibleTotal && (
            <small>
              关闭曲库后会返回当前计划，保留已输入的内容；复习建议需要重新生成。
            </small>
          )}
        </div>
      )}
      {passageAvailability && passageAvailability.missing > 0 && (
        <div className="parameter-help">
          <p>
            {passageAvailability.due} 个选段达到复习日期，其中{" "}
            {passageAvailability.missing}{" "}
            个选段的曲目文件缺失或内容已变，已从建议中排除。曲库中没有列出该曲目时，请按曲名搜索并重新关联原文件。
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => openLibrary("missing")}
          >
            打开曲库核对文件
          </button>
        </div>
      )}
      {retired.length > 0 && (
        <details className="recommendation-retired">
          <summary>保留的旧输入 · {retired.length} 项</summary>
          <p>
            这些建议未出现在当前结果中。已保留当时的选择和条件；后续读取到同一建议时会恢复，加入计划只使用当前有效建议。
          </p>
          <ul>
            {retired.map(({ row, chosen: wasChosen }) => (
              <li key={row.id}>
                <strong>
                  {row.title} · {row.range ?? `第 ${row.measure} 小节`}
                </strong>
                <span>
                  {wasChosen ? "此前已勾选" : "此前已修改条件"} ·{" "}
                  {editFor(row).speedPercent}% · {editFor(row).passes} 轮 ·
                  正确率 ≥ {editFor(row).accuracy}%
                </span>
              </li>
            ))}
          </ul>
          <div className="recommendation-selection">
            <CopyPracticeDraft
              label="复制保留的旧输入"
              value={retired.map(({ row, chosen }) => ({
                suggestion: row,
                chosen,
                edit: editFor(row),
              }))}
            />
            <button
              disabled={locked}
              onClick={() => {
                const ids = new Set(retired.map((entry) => entry.row.id));
                setRetired([]);
                setEdits((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([id]) => !ids.has(id)),
                  ),
                );
              }}
            >
              清理保留的旧输入
            </button>
          </div>
        </details>
      )}
      {note && (
        <details className="weak-practice-method">
          <summary>建议依据与适用范围</summary>
          <p className="parameter-help">{note}</p>
        </details>
      )}
      {!routineId && (
        <label className="weak-plan-name">
          新计划名称
          <input
            aria-label="复习计划名称"
            maxLength={80}
            value={name}
            disabled={locked}
            onChange={(e) => {
              touch();
              setName(e.target.value);
            }}
          />
        </label>
      )}
      {rows.length > 0 && (
        <>
          <div className="recommendation-toolbar">
            <label>
              筛选建议
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as typeof filter)
                }
              >
                <option value="all">全部建议</option>
                <option value="notes">音符与节奏</option>
                <option value="expression">力度与踏板</option>
                <option value="due">到期复习</option>
              </select>
            </label>
            <span role="status">
              已选 {chosen.length} 项 · 当前显示 {shownRows.length} 项
            </span>
            <div className="recommendation-selection">
              <button
                disabled={locked || !shownRows.length || chosen.length >= 60}
                onClick={() =>
                  setChosen((current) =>
                    [
                      ...new Set([
                        ...current,
                        ...shownRows.map((row) => row.id),
                      ]),
                    ].slice(0, 60),
                  )
                }
              >
                选中当前建议
              </button>
              <button
                disabled={
                  locked || !shownRows.some((row) => chosen.includes(row.id))
                }
                onClick={() =>
                  setChosen((current) =>
                    current.filter(
                      (id) => !shownRows.some((row) => row.id === id),
                    ),
                  )
                }
              >
                清除当前选择
              </button>
            </div>
          </div>
          {!shownRows.length && (
            <p className="parameter-help">当前分类没有建议，可切换分类查看。</p>
          )}
          <div className="weak-practice-rows">
            {shownRows.map((row) => (
              <RecommendationRow
                key={row.id}
                row={row}
                selected={chosen.includes(row.id)}
                disabled={locked}
                selectionFull={chosen.length >= 60}
                edit={editFor(row)}
                modified={!!edits[row.id]}
                changed={(change) => patchEdit(row, change)}
                toggle={(selected) =>
                  setChosen((current) =>
                    selected
                      ? [...new Set([...current, row.id])]
                      : current.filter((id) => id !== row.id),
                  )
                }
                reset={() =>
                  setEdits((current) => {
                    const next = { ...current };
                    delete next[row.id];
                    return next;
                  })
                }
              />
            ))}
          </div>
          {duePage?.hasMore && (
            <button disabled={locked} onClick={loadMoreDue}>
              再读取 30 首到期曲目
            </button>
          )}
          <button
            disabled={
              locked || stale || !chosen.length || (!routineId && !name.trim())
            }
            onClick={() =>
              void work(async () => {
                if (stale) throw new Error("请先更新复习建议");
                const selectedEdits = chosen.map((id) => {
                  const row = rows.find((item) => item.id === id);
                  if (!row) throw new Error("所选建议已变化，请重新生成");
                  const edit = editFor(row);
                  if (
                    !Number.isFinite(edit.speedPercent) ||
                    edit.speedPercent < 25 ||
                    edit.speedPercent > 200 ||
                    !Number.isInteger(edit.passes) ||
                    edit.passes < 1 ||
                    edit.passes > 100 ||
                    !Number.isInteger(edit.accuracy) ||
                    edit.accuracy < 50 ||
                    edit.accuracy > 100 ||
                    (edit.onTime !== null &&
                      (!Number.isInteger(edit.onTime) ||
                        edit.onTime < 50 ||
                        edit.onTime > 100))
                  ) {
                    throw new Error(
                      `“${row.title}”的练习条件超出范围，请核对速度、轮数和达标门槛`,
                    );
                  }
                  return {
                    id,
                    speed: edit.speedPercent / 100,
                    passes: edit.passes,
                    accuracy: edit.accuracy,
                    onTime: edit.onTime,
                  };
                });
                const submission: Submission = {
                  ids: [...chosen],
                  edits: selectedEdits,
                  routineId,
                  day,
                  name,
                  requestId: routineId
                    ? null
                    : (draftRequestId.current ??= crypto.randomUUID()),
                };
                const retained = rememberSubmission(submission);
                if (retained.original !== null || retained.unread)
                  throw new Error(
                    "旧请求尚未核对，已保留当前输入，请先核对旧计划。",
                  );
                await submit(submission);
              })
            }
          >
            加入 {chosen.length} 个复习项目
          </button>
        </>
      )}
      {pendingAdded && (
        <div className="recommendation-saved" role="status">
          <p>{addedMessage(pendingAdded)} 重新读取只更新计划显示。</p>
          <button
            disabled={disabled}
            onClick={() =>
              void work(async () => {
                try {
                  await added(pendingAdded.id);
                  setMessage(addedMessage(pendingAdded));
                  clearSaved(pendingAdded);
                } catch (cause) {
                  const detail =
                    cause instanceof Error ? cause.message : String(cause);
                  setMessage(
                    `计划已保存，但界面读取失败：${detail}。请重试显示计划。`,
                  );
                }
              })
            }
          >
            重试显示已保存计划
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
