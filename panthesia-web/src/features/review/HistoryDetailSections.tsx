import type {
  HistoryEntry as Entry,
  HistoryDetail as Detail,
} from "./historyTypes";
import { practiceDuration } from "../../practiceTime";
import {
  expressionGoalText,
  noteVelocityEvidenceText,
  notePedalEvidenceText,
} from "../practice/ExpressionGoalControl";
import {
  accuracy,
  percent,
  date,
  rangeName,
  modeName,
  handName,
  delta,
  trackModeName,
  ComparisonConditions,
  Trend,
  coverageName,
} from "./historyPresentation";

export function HistorySavedConditions({ detail }: { detail: Detail }) {
  return (
    <>
      {detail.context ? (
        <p className="parameter-help">
          {detail.context.loop_restart ? `本轮达到 ${detail.context.loop_restart} 个错误后自动重开，记录不计入完整练习达标。` : ""}
          预备 {detail.context.count_in} 小节 · 节拍器
          {detail.context.metronome ? "开" : "关"} · 自适应速度
          {detail.context.adaptive ? "开" : "关"} ·{" "}
          {detail.context.rounds || "不限"} 轮 · 输入校准{" "}
          {detail.context.latency} ms
          {detail.context.pedal_latency_ms != null
            ? `（踏板同步 ${detail.context.pedal_latency_ms} ms）`
            : `（旧记录踏板沿用输入校准 ${detail.context.latency} ms）`}
          <br />
          {detail.context.tracks
            .map(
              (t) =>
                `音轨 ${t.track_id + 1}：${trackModeName(t.mode)}${t.visible ? "" : "（隐藏）"}`,
            )
            .join("；")}
        </p>
      ) : (
        <p className="parameter-help">
          旧记录未保存完整声部与预备设置，无法精确恢复条件。
        </p>
      )}
      {detail.path && (
        <details className="history-source">
          <summary>记录时的曲目文件</summary>
          <span>{detail.path}</span>
        </details>
      )}
      {detail.context?.routine && (
        <p className="parameter-help">
          练习计划：{detail.context.routine.routine_name} ·{" "}
          {detail.context.routine.day} · {detail.context.routine.item_title}
          <br />
          {detail.context.routine.consecutive ? "连续达标" : "累计达标"}{" "}
          {detail.context.routine.passes_required} 次 · 正确率 ≥
          {detail.context.routine.accuracy_percent}%
          {detail.context.routine.expression && (
            <>
              <br />
              专项目标：
              {expressionGoalText({
                velocityDifference:
                  detail.context.routine.expression.velocity_difference,
                noteVelocityDifference:
                  detail.context.routine.expression.note_velocity_difference,
                notePedalMismatchCount:
                  detail.context.routine.expression.note_pedal_mismatch_count,
                contourPercent:
                  detail.context.routine.expression.contour_percent,
                pedalOffsetMs:
                  detail.context.routine.expression.pedal_offset_ms,
              })}
            </>
          )}
          {detail.expressionGoalResult && (
            <>
              <br />
              本轮专项：{detail.expressionGoalResult.message}
              {detail.expressionGoalResult.noteVelocity && (
                <>
                  {" "}
                  ·{" "}
                  {noteVelocityEvidenceText(
                    detail.expressionGoalResult.noteVelocity,
                  )}
                </>
              )}
              {detail.expressionGoalResult.notePedal && (
                <>
                  {" "}
                  ·{" "}
                  {notePedalEvidenceText(detail.expressionGoalResult.notePedal)}
                </>
              )}
            </>
          )}
          {detail.context.routine.item_notes && (
            <>
              <br />
              {detail.context.routine.item_notes}
            </>
          )}
        </p>
      )}
      {!detail.context?.routine && detail.context?.expression && (
        <p className="parameter-help">
          本次单曲目标：
          {expressionGoalText({
            velocityDifference: detail.context.expression.velocity_difference,
            noteVelocityDifference:
              detail.context.expression.note_velocity_difference,
            notePedalMismatchCount:
              detail.context.expression.note_pedal_mismatch_count,
            contourPercent: detail.context.expression.contour_percent,
            pedalOffsetMs: detail.context.expression.pedal_offset_ms,
          })}
          {detail.expressionGoalResult && (
            <>
              <br />
              本轮目标：{detail.expressionGoalResult.message}
              {detail.expressionGoalResult.noteVelocity && (
                <>
                  {" "}
                  ·{" "}
                  {noteVelocityEvidenceText(
                    detail.expressionGoalResult.noteVelocity,
                  )}
                </>
              )}
              {detail.expressionGoalResult.notePedal && (
                <>
                  {" "}
                  ·{" "}
                  {notePedalEvidenceText(detail.expressionGoalResult.notePedal)}
                </>
              )}
            </>
          )}
        </p>
      )}
      {detail.context?.ladder && (
        <p className="parameter-help">
          速度阶梯：{detail.context.ladder.plan_name} · 第{" "}
          {detail.context.ladder.stage} 级 ·{" "}
          {detail.context.ladder.speed_percent}% →{" "}
          {detail.context.ladder.target_percent}%
        </p>
      )}
    </>
  );
}

export function HistoryResultSummary({ detail }: { detail: Detail }) {
  const timed = ["flow", "recital", "memory"].includes(detail.mode ?? "");
  const metric = (value: number | null, unit: string) =>
    value == null ? "—" : `${Math.round(value * 10) / 10}${unit}`;
  return (
    <section className="history-result-overview" aria-label="本次表现">
      <div className="history-result-hero">
        <div className="history-result-accuracy">
          <strong>{percent(accuracy(detail.score))}</strong>
          <span>音符准确率</span>
        </div>
        <dl className="history-result-counts">
          <div>
            <dt>正确</dt>
            <dd>{detail.score.matched_notes}</dd>
          </div>
          <div>
            <dt>错音</dt>
            <dd>{detail.score.wrong_notes}</dd>
          </div>
          <div>
            <dt>漏音</dt>
            <dd>{detail.score.missed_notes}</dd>
          </div>
        </dl>
      </div>
      <p className="history-coverage">{coverageName(detail)}</p>
      <p className="parameter-help">
        {detail.playingMs != null
          ? `本轮练习 ${practiceDuration(detail.playingMs)}，含等音等待，不含暂停和预备拍。`
          : "这条旧记录未保存运行用时。"}
      </p>
      {timed ? (
        <dl className="history-result-metrics">
          <div>
            <dt>节奏偏移</dt>
            <dd>{metric(detail.summary.timing.median_offset_ms, " 毫秒")}</dd>
          </div>
          <div>
            <dt>节奏波动</dt>
            <dd>
              {metric(detail.summary.timing.median_deviation_ms, " 毫秒")}
            </dd>
          </div>
          <div>
            <dt>完整和弦</dt>
            <dd>
              {detail.summary.chords.complete_chords} /{" "}
              {detail.summary.chords.eligible_chords}
            </dd>
          </div>
          <div>
            <dt>起音跨度</dt>
            <dd>
              {metric(detail.summary.chords.median_attack_span_ms, " 毫秒")}
            </dd>
          </div>
          <div>
            <dt>时值比例</dt>
            <dd>
              {metric(
                detail.summary.expression.articulation
                  .median_duration_ratio_percent,
                "%",
              )}
            </dd>
          </div>
          <div>
            <dt>力度平均差</dt>
            <dd>
              {metric(
                detail.summary.expression.velocity.mean_abs_difference,
                " 级",
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="browse-detail-note">
          {detail.mode === "wait"
            ? "等音模式只比较音符准确率，不评价节奏。"
            : "这条记录没有节奏评分。"}
        </p>
      )}
      {detail.summary.parts.length > 0 && (
        <div className="history-parts">
          {detail.summary.parts.map((part) => (
            <span key={part.part}>
              {{ LeftHand: "左手", RightHand: "右手", Other: "其他声部" }[
                part.part
              ] ?? part.part}{" "}
              {percent(accuracy(part.breakdown))}
              {" · "}错音 {part.breakdown.wrong_notes} / 漏音{" "}
              {part.breakdown.missed_notes}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function HistoryComparison({
  detail,
  blocked,
  select,
}: {
  detail: Detail;
  blocked: boolean;
  select: (entry: Entry) => void;
}) {
  return (
    <>
      <h4>同条件比较</h4>
      <ComparisonConditions detail={detail} />
      {detail.comparison.count ? (
        <>
          <p className="history-comparison">
            相对此前一次：
            {delta(
              accuracy(detail.score),
              detail.comparison.previous
                ? accuracy(detail.comparison.previous.score)
                : null,
            )}
            <br />
            此前最佳：{percent(detail.comparison.bestAccuracy)} · 共{" "}
            {detail.comparison.count} 次
          </p>
          <Trend detail={detail} />
        </>
      ) : (
        <p className="parameter-help">
          {detail.comparison.reason ?? "此前没有可比较记录。"}
        </p>
      )}
      {!!detail.comparison.excludedRecent?.length && (
        <details className="history-excluded-attempts">
          <summary>
            查看未纳入比较的旧成绩（最近{" "}
            {detail.comparison.excludedRecent.length} 条）
          </summary>
          <p className="parameter-help">
            软件按保存时间列出最近的不同条件成绩。每条原因来自本地引擎保存的练习条件。
          </p>
          <ul>
            {detail.comparison.excludedRecent.map(({ entry, reasons }) => (
              <li key={`${entry.contentId}:${entry.id}`}>
                <div>
                  <strong>
                    {date(entry.recordedAt)} · {percent(accuracy(entry.score))}
                  </strong>
                  <button disabled={blocked} onClick={() => select(entry)}>
                    查看这次成绩
                  </button>
                </div>
                <span>
                  {rangeName(entry)} · {modeName(entry.mode)} ·{" "}
                  {handName(entry.hands)} · {Math.round(entry.speed * 100)}%
                </span>
                <p>{reasons.join("；")}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="history-saved-conditions">
        <summary>本次保存的练习条件</summary>
        <HistorySavedConditions detail={detail} />
      </details>
    </>
  );
}
