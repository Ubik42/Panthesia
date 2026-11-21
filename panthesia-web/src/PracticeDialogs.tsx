export { ExerciseDialog } from "./features/practice/ExerciseDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { FeedbackPager, feedbackPageSize } from "./features/practice/FeedbackPager";
import { X } from "lucide-react";
import { TaskActivity } from "./engine/TaskActivity";
import { api, type Feedback, type Snapshot } from "./api";
import { noteVelocityEvidenceText, notePedalEvidenceText } from "./features/practice/ExpressionGoalControl";
const percentage = (b: {
  matched_notes: number;
  wrong_notes: number;
  missed_notes: number;
}) => {
  const total = b.matched_notes + b.wrong_notes + b.missed_notes;
  return total ? `${Math.round((b.matched_notes / total) * 100)}%` : "—";
};
export type FeedbackPlanSource = {
  contentId: string;
  id: string;
  title: string;
  recordedAt: number;
  total: number;
  notes: { reference: number; measure: number; pitch: number; kind: string; velocityDifference?: number; velocityLimit?: number; referenceVelocity?: number; actualVelocity?: number; timingKind?: string | null }[];
};
export type MeasurePartFeedback = NonNullable<Feedback["measure_parts"]>[number];
const feedbackPartName = (part: MeasurePartFeedback["part"]) =>
  part === "LeftHand" ? "左手" : part === "RightHand" ? "右手" : "其他声部";
export function FeedbackDialog({
  close,
  state,
  contentId,
  practice,
  practicePart,
  trackNames,
  retry,
  arrangeNext,
}: {
  close: () => void;
  state: Snapshot;
  contentId: string | null;
  practice: (start: number, end: number) => Promise<void>;
  practicePart: (target: MeasurePartFeedback) => Promise<void>;
  trackNames: Record<number, string>;
  retry: () => Promise<void>;
  arrangeNext: (source: FeedbackPlanSource) => void;
}) {
  const [summary, setSummary] = useState<Feedback | null>(state.summary),
    [error, setError] = useState(""),
    [reportLoading, setReportLoading] = useState(false),
    [reportRevision, setReportRevision] = useState(0),
    [planSource, setPlanSource] = useState<FeedbackPlanSource | null>(null),
    [planLoading, setPlanLoading] = useState(false),
    [planError, setPlanError] = useState<{ contentId: string; id: string; message: string } | null>(null),
    [planRevision, setPlanRevision] = useState(0),
    [selectedPart, setSelectedPart] = useState<MeasurePartFeedback | null>(null),
    [partLoading, setPartLoading] = useState(false),
    [measurePage, setMeasurePage] = useState(0),
    [partPage, setPartPage] = useState(0),
    [onlyProblems, setOnlyProblems] = useState(false);
  const measureTable = useRef<HTMLDivElement>(null), partTable = useRef<HTMLDivElement>(null);
  const practicePending = useRef(false);
  const practiceSource = useRef("");
  practiceSource.current = JSON.stringify([state.stateOrder?.engineId, contentId, state.currentHistoryId, state.summaryVersion, state.scoreRevision, state.annotationRevision]);
  const roundSaving = state.storage?.operation === "round" || state.storage?.operation === "closing";
  const practiceBlocked = roundSaving || partLoading || state.recording;
  const runPractice = (work: () => Promise<void>) => {
    if (practiceBlocked || practicePending.current) return;
    practicePending.current = true;
    const source = practiceSource.current;
    setPartLoading(true);
    setError("");
    void Promise.resolve().then(() => {
      if (practiceSource.current === source) return work();
    }).catch((e) => {
      if (practiceSource.current === source) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { practicePending.current = false; setPartLoading(false); });
  };
  useEffect(() => {
    setMeasurePage(0); setPartPage(0); setSelectedPart(null);
  }, [contentId, state.stateOrder?.engineId, state.currentHistoryId, state.summaryVersion, state.scoreRevision, state.annotationRevision]);
  useEffect(() => {
    let cancelled = false;
    setSummary(state.summary);
    setError("");
    if (!contentId) { setReportLoading(false); return; }
    setReportLoading(true);
    if (roundSaving) return;
    void (async () => {
      const result = await api.commandForEngine<Feedback>(state.stateOrder?.engineId, { type: "feedback" });
      if (cancelled) return;
      const currentState = await api.pollState(state);
      if (cancelled) return;
      if (currentState.stateOrder?.engineId !== state.stateOrder?.engineId || currentState.contentId !== contentId ||
          currentState.currentHistoryId !== state.currentHistoryId ||
          (result.source && (result.source.contentId !== contentId ||
            result.source.historyId !== state.currentHistoryId ||
            result.source.summaryVersion !== currentState.summaryVersion ||
            result.source.scoreRevision !== currentState.scoreRevision ||
            result.source.annotationRevision !== currentState.annotationRevision)))
        throw new Error("练习记录或练习条件已切换，请重新打开练习反馈");
      if (!cancelled) setSummary(result);
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [contentId, state.stateOrder?.engineId, state.currentHistoryId, state.saved, state.summaryVersion, state.scoreRevision, state.annotationRevision, roundSaving, reportRevision]);
  useEffect(() => {
    const id = state.currentHistoryId;
    if (roundSaving || !state.saved || !contentId || !id || state.routine || state.ladder?.active) {
      setPlanSource(null);
      setPlanError(null);
      setPlanLoading(false);
      return;
    }
    let cancelled = false;
    setPlanSource(null);
    setPlanError(null);
    setPlanLoading(true);
    void api.commandForEngine<FeedbackPlanSource>(state.stateOrder?.engineId, {
      type: "historyProblemNotes",
      content_id: contentId,
      id,
      offset: 0,
    }).then((source) => {
      if (cancelled) return;
      if (source.contentId !== contentId || source.id !== id) {
        setPlanError({ contentId, id, message: "练习记录已变化，请重新读取本轮问题音。" });
        return;
      }
      setPlanSource(source.total > 0 && source.notes.length > 0 ? source : null);
    }).catch((e) => {
      if (!cancelled) {
        setPlanSource(null);
        setPlanError({
          contentId,
          id,
          message: `本轮问题音读取失败：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }).finally(() => {
      if (!cancelled) setPlanLoading(false);
    });
    return () => { cancelled = true; };
  }, [contentId, state.stateOrder?.engineId, state.saved, state.currentHistoryId, state.routine, state.ladder?.active, roundSaving, planRevision]);
  const weakest = useMemo(() => summary?.measures.reduce<Feedback["measures"][number] | undefined>((worst, item) => {
    const errors = item.breakdown.missed_notes + item.breakdown.wrong_notes;
    return errors > (worst ? worst.breakdown.missed_notes + worst.breakdown.wrong_notes : 0) ? item : worst;
  }, undefined), [summary]);
  const measureParts = summary?.measure_parts ?? [];
  const problemParts = useMemo(() => (summary?.measure_parts ?? []).filter(
    ({ breakdown: b }) => b.missed_notes + b.early_notes + b.late_notes > 0,
  ), [summary]);
  const filteredMeasures = useMemo(() => (summary?.measures ?? []).filter((item) => !onlyProblems ||
    item.breakdown.wrong_notes + item.breakdown.missed_notes +
      (item.breakdown.early_notes ?? 0) + (item.breakdown.late_notes ?? 0) > 0,
  ), [summary, onlyProblems]);
  const currentMeasurePage = Math.min(measurePage, Math.max(0, Math.ceil(filteredMeasures.length / feedbackPageSize) - 1));
  const currentPartPage = Math.min(partPage, Math.max(0, Math.ceil(problemParts.length / feedbackPageSize) - 1));
  const shownMeasures = filteredMeasures.slice(currentMeasurePage * feedbackPageSize, (currentMeasurePage + 1) * feedbackPageSize);
  const shownParts = problemParts.slice(currentPartPage * feedbackPageSize, (currentPartPage + 1) * feedbackPageSize);
  const reportCancelled = error === "后台任务已取消";
  const selectedPartLabel = selectedPart
    ? selectedPart.part === "Other"
      ? `第 ${selectedPart.measure} 小节 · 其他声部 · ${trackNames[selectedPart.track_id] ?? `音轨 ${selectedPart.track_id + 1}`}`
      : `第 ${selectedPart.measure} 小节 · ${feedbackPartName(selectedPart.part)} · ${trackNames[selectedPart.track_id] ?? `音轨 ${selectedPart.track_id + 1}`}`
    : "";
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="settings-dialog feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="feedback-title">
            {["recital", "memory"].includes(summary?.mode ?? state.mode)
              ? "演奏完成"
              : "逐小节反馈"}
          </h2>
          <button autoFocus aria-label="关闭练习反馈" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {reportLoading && <p role="status">{state.storage?.operation === "closing" ? "正在完成退出前保存，已有成绩继续保留。" : state.storage?.operation === "round" ? state.summary ? "正在保存本轮结果，已汇总的成绩可先查看…" : "正在后台汇总本轮成绩…" : "正在整理本轮成绩与历史趋势…"}</p>}
        <TaskActivity engineId={state.stateOrder?.engineId} contentId={contentId ?? undefined} label="生成本轮反馈" />
        {error && <div className={`feedback-read-error${reportCancelled ? " feedback-read-cancelled" : ""}`} role={reportCancelled ? "status" : "alert"}><p>{reportCancelled ? "已取消反馈整理，已有成绩仍可查看。" : error}</p>
          <button disabled={reportLoading} onClick={() => setReportRevision((value) => value + 1)}>{reportCancelled ? "继续整理反馈" : "重新读取反馈"}</button>
        </div>}
        {!roundSaving && !state.saved && state.status === "finished" && state.mode !== "listen" && (
          <div className="feedback-read-error" role="status">
            <p>本轮成绩尚未保存，演奏记录仍保留在当前程序中。</p>
            <button disabled={practiceBlocked} onClick={() => runPractice(async () => {
              await api.commandForEngine(state.stateOrder?.engineId, { type: "save" });
              setReportRevision((value) => value + 1);
            })}>保存本轮成绩</button>
          </div>
        )}
        {summary && (
          <>
            {["recital", "memory"].includes(summary.mode ?? state.mode) && (
              <button disabled={practiceBlocked} onClick={() => runPractice(retry)}>再演奏一遍</button>
            )}
            <div className="feedback-overview">
              <strong>{percentage(summary.overall)}</strong>
              <span>
                正确 {summary.overall.matched_notes} · 错音{" "}
                {summary.overall.wrong_notes} · 漏音{" "}
                {summary.overall.missed_notes}
              </span>
            </div>
            {state.songExpressionGoalResult && !state.routine && !state.ladder?.active && (
              <p className={state.songExpressionGoalResult?.passed ? "song-expression-passed" : "song-expression-failed"}>
                本轮目标：{state.songExpressionGoalResult.message}
                {state.songExpressionGoalResult.noteVelocity && <> · {noteVelocityEvidenceText(state.songExpressionGoalResult.noteVelocity)}</>}
                {state.songExpressionGoalResult.notePedal && <> · {notePedalEvidenceText(state.songExpressionGoalResult.notePedal)}</>}
              </p>
            )}
            {["flow", "recital", "memory"].includes(
              summary.mode ?? state.mode,
            ) ? (
              <p>
                节奏偏移中位数 {summary.timing.median_offset_ms ?? "—"} ms ·
                波动 {summary.timing.median_deviation_ms ?? "—"} ms
                <br />
                完整和弦 {summary.chords.complete_chords} /{" "}
                {summary.chords.eligible_chords} · 起音跨度{" "}
                {summary.chords.median_attack_span_ms ?? "—"} ms
              </p>
            ) : (
              <p className="parameter-help">
                等音模式不评价节奏。请使用连续模式练习节奏、和弦起音与音符时值。
              </p>
            )}
            {["flow", "recital", "memory"].includes(
              summary.mode ?? state.mode,
            ) && (
              <p className="parameter-help">
                力度：
                {summary.expression.velocity.matched_samples >= 4
                  ? `平均差 ${summary.expression.velocity.mean_abs_difference ?? "—"} / 127`
                  : "样本不足"}{" "}
                · 力度走向：
                {summary.expression.velocity.contour_steps >= 6
                  ? `${summary.expression.velocity.contour_aligned}/${summary.expression.velocity.contour_steps} 段一致`
                  : "样本不足"}
                <br />
                踏板：
                {summary.expression.pedal.target_present
                  ? `有效对照 ${summary.expression.pedal.timing_samples} 次，偏移 ${summary.expression.pedal.median_offset_ms ?? "—"} ms`
                  : "参考 MIDI 未提供踏板，暂不评判"}{" "}
                · 音符时值：
                {summary.expression.articulation.matched_samples >= 4
                  ? `${summary.expression.articulation.median_duration_ratio_percent ?? "—"}%`
                  : "样本不足"}
              </p>
            )}
            {summary.trend && (
              <p className="parameter-help">
                同段落、声部、模式共 {summary.trend.attempts} 次记录
                {summary.trend.accuracyDelta !== null
                  ? ` · 准确率变化 ${Math.round(summary.trend.accuracyDelta * 100)} 个百分点`
                  : ""}
                {summary.trend.tempoDelta !== null
                  ? ` · 速度变化 ${summary.trend.tempoDelta} BPM`
                  : ""}
              </p>
            )}
            <div className="feedback-parts">
              {summary.parts.map((p) => (
                <span key={p.part}>
                  {p.part === "LeftHand"
                    ? "左手"
                    : p.part === "RightHand"
                      ? "右手"
                      : "其他声部"}{" "}
                  {percentage(p.breakdown)}
                </span>
              ))}
            </div>
            <section className="feedback-part-review" aria-label="本轮分手问题">
              <h3>本轮小节与声部</h3>
              {measureParts.length === 0 ? (
                <p className="parameter-help">本轮没有可核对的小节与声部记录。旧记录不会按曲目当前分手重新推断。</p>
              ) : problemParts.length === 0 ? (
                <p className="parameter-help">本轮有 {measureParts.length} 组已评判的目标音，没有偏早、偏晚或漏音。</p>
              ) : (
                <>
                  <p className="parameter-help">下列问题来自本轮已评判的目标音。无法定位到目标音的误弹只计入总成绩，不会猜测归属到某只手。</p>
                  <div ref={partTable} className="feedback-table feedback-part-table">
                    <table>
                      <thead><tr><th>小节</th><th>声部 / 音轨</th><th>目标音</th><th>偏早</th><th>偏晚</th><th>漏音</th><th /></tr></thead>
                      <tbody>
                        {shownParts.map((item) => (
                          <tr key={`${item.measure}:${item.part}:${item.track_id}`}>
                            <td>{item.measure}</td>
                            <td>{feedbackPartName(item.part)} · {trackNames[item.track_id] ?? `音轨 ${item.track_id + 1}`}</td>
                            <td>{item.breakdown.matched_notes}/{item.breakdown.target_notes}</td>
                            <td>{item.breakdown.early_notes}</td>
                            <td>{item.breakdown.late_notes}</td>
                            <td>{item.breakdown.missed_notes}</td>
                            <td><button disabled={practiceBlocked} onClick={() => setSelectedPart(item)}>准备重练</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <FeedbackPager page={currentPartPage} total={problemParts.length} label="小节与声部问题" change={(page) => {
                    setPartPage(page); if (partTable.current) partTable.current.scrollTop = 0;
                  }} />
                </>
              )}
              {selectedPart && (
                <div className="feedback-part-prepare" role="group" aria-label="分手重练设置预览">
                  <strong>重练设置：{selectedPartLabel}</strong>
                  <p>重练会只将这个音轨中所选声部的目标音交给你弹，其他音轨或声部作为伴奏。循环范围为第 {selectedPart.measure} 小节。{state.routine || state.ladder?.active ? "当前计划或速度阶梯会先结束。" : ""}{["recital", "memory", "listen"].includes(state.mode) ? "当前模式会先切换到连续练习。" : ""}{state.recording ? "请先停止录音。" : ""}</p>
                  <div>
                    <button disabled={partLoading} onClick={() => setSelectedPart(null)}>取消</button>
                    <button className="primary" disabled={practiceBlocked} onClick={() => runPractice(() => practicePart(selectedPart))}>应用设置并重练</button>
                  </div>
                </div>
              )}
            </section>
            {weakest && (
              <button
                disabled={practiceBlocked}
                onClick={() => runPractice(() => practice(weakest.measure, weakest.measure))}
              >
                重练第 {weakest.measure} 小节
              </button>
            )}
            {planError && planError.contentId === contentId && planError.id === state.currentHistoryId && state.saved && !state.routine && !state.ladder?.active && (
              <div className="feedback-next-practice" role="alert">
                <p>{planError.message}</p>
                <button disabled={planLoading} onClick={() => setPlanRevision((revision) => revision + 1)}>
                  重试读取本轮问题音
                </button>
              </div>
            )}
            {planSource && state.saved && contentId === planSource.contentId && state.currentHistoryId === planSource.id && (
              <div className="feedback-next-practice">
                <p>本轮保存的演奏记录发现 {planSource.total} 个偏早、偏晚、漏音或逐音力度超限。这是单次练习证据，不代表长期弱项。</p>
                <button className="primary" disabled={planLoading || practiceBlocked} onClick={() => arrangeNext(planSource)}>
                  预览并安排下次练习
                </button>
              </div>
            )}
            <div className="feedback-table-toolbar">
              <h3>逐小节成绩 <small>{summary.measures.length} 个小节</small></h3>
              <label><input type="checkbox" checked={onlyProblems} onChange={(event) => {
                setOnlyProblems(event.target.checked); setMeasurePage(0);
                if (measureTable.current) measureTable.current.scrollTop = 0;
              }} />只看需要重练的小节</label>
            </div>
            {filteredMeasures.length === 0 && <p className="parameter-help">{summary.measures.length ? "当前筛选下没有小节。" : "本轮尚无可定位到小节的成绩。"}</p>}
            <div ref={measureTable} className="feedback-table">
              <table>
                <thead>
                  <tr>
                    <th>小节</th>
                    <th>准确率</th>
                    <th>错音</th>
                    <th>漏音</th>
                    <th>偏早 / 偏晚</th>
                    <th>节奏偏移</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shownMeasures.map((m) => (
                    <tr key={m.measure}>
                      <td>{m.measure}</td>
                      <td>{percentage(m.breakdown)}</td>
                      <td>{m.breakdown.wrong_notes}</td>
                      <td>{m.breakdown.missed_notes}</td>
                      <td>{m.breakdown.early_notes === undefined && m.breakdown.late_notes === undefined
                        ? "—" : `${m.breakdown.early_notes ?? 0} / ${m.breakdown.late_notes ?? 0}`}</td>
                      <td>
                        {["flow", "recital", "memory"].includes(
                          summary.mode ?? state.mode,
                        )
                          ? `${m.timing.median_offset_ms ?? "—"} ms`
                          : "—"}
                      </td>
                      <td>
                        <button
                          disabled={practiceBlocked}
                          onClick={() => runPractice(() => practice(m.measure, m.measure))}
                        >
                          重练
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FeedbackPager page={currentMeasurePage} total={filteredMeasures.length} label="逐小节成绩" change={(page) => {
              setMeasurePage(page); if (measureTable.current) measureTable.current.scrollTop = 0;
            }} />
          </>
        )}
      </section>
    </div>
  );
}
export { MetadataDialog } from "./features/library/SongMetadataDialog";
