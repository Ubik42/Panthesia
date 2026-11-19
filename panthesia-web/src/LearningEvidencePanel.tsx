import { useEffect, useMemo, useState } from "react";
import { useHistoryRead } from "./engine/useHistoryRead";
import { useCachedRead } from "./engine/useCachedRead";
import { ReadCache } from "./engine/readCache";
import { TaskActivity } from "./engine/TaskActivity";
import type { Evidence as LearningEvidence } from "./engine/commands.generated";
export type { Evidence as LearningEvidence } from "./engine/commands.generated";
import "./learningEvidencePanel.css";

type Detail = {
  id: string;
  contentId: string;
  recordedAt?: number;
  title?: string;
  score?: { matched_notes: number; wrong_notes: number; missed_notes: number };
  tempo?: number | null;
  context?: {
    routine?: { routine_name: string; item_title: string; day: string };
  };
};

const minutes = (ms: number) => `${Math.round(ms / 60000)} 分钟`;
const date = (value: number) =>
  new Date(value < 1e11 ? value * 1000 : value).toLocaleString("zh-CN");

export function LearningEvidencePanel({
  contentId,
  targetBpm,
  targetMinutes,
  draftChanged,
  active = true,
  engineId,
}: {
  contentId: string;
  targetBpm: number | null;
  targetMinutes: number | null;
  draftChanged: boolean;
  active?: boolean;
  engineId?: string;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [selected, setSelected] = useState("");
  const detailReads = useHistoryRead(engineId);
  const evidenceReads = useHistoryRead(engineId);
  const cache = useMemo(() => new ReadCache<LearningEvidence>(4), []);
  const read = useCachedRead({
    cache,
    key: JSON.stringify([engineId, contentId]),
    enabled: active,
    load: async (signal) => {
      const result = await evidenceReads.request<LearningEvidence>(
        {
          type: "songLearningEvidence",
          content_id: contentId,
        },
        signal,
      ).result;
      if (!result || result.contentId !== contentId)
        throw new Error("练习证据与当前曲目不一致，请重新读取。");
      if (
        !Object.hasOwn(result, "targetBpm") ||
        !result.routines ||
        !Object.hasOwn(result.routines, "totalCount")
      )
        throw new Error("学习证据读取不完整，请重新打开软件后再试。");
      return result;
    },
  });
  const evidence = read.current ? read.value : null;
  const loading = read.pending,
    error = read.error;
  useEffect(() => {
    detailReads.invalidate();
    setSelected("");
    setDetail(null);
    setDetailError("");
  }, [contentId, engineId, active, detailReads]);
  const targetsChanged =
    draftChanged ||
    (!!evidence &&
      (evidence.targetBpm !== targetBpm ||
        evidence.week.targetMinutes !== targetMinutes));

  const showSession = async (id: string) => {
    setSelected(id);
    setDetail(null);
    setDetailError("");
    const read = detailReads.request<Detail>({
      type: "historyDetail",
      content_id: contentId,
      id,
    });
    try {
      const value = await read.result;
      if (!read.isCurrent()) return;
      if (value.contentId !== contentId || value.id !== id)
        throw new Error("读取结果与所选成绩不一致，请重新读取。");
      setDetail(value);
    } catch (reason) {
      if (read.isCurrent())
        setDetailError(
          reason instanceof Error ? reason.message : String(reason),
        );
    }
  };

  return (
    <section className="learning-evidence" aria-label="曲目练习证据">
      <header>
        <div>
          <h3>练习证据</h3>
          <p>这里汇总实际练习记录。你仍需自己确认学习阶段。</p>
        </div>
        <button
          type="button"
          disabled={loading || !active}
          onClick={read.refresh}
        >
          重新读取
        </button>
      </header>
      <TaskActivity
        contentId={contentId}
        label="整理曲目学习证据"
        cancelLabel="取消本次读取"
      />
      {loading && (
        <p role="status">
          {evidence ? "正在更新，保留上次读取的练习证据…" : "正在读取练习证据…"}
        </p>
      )}
      {error && (
        <p role="alert" className="dialog-error">
          {evidence ? "显示上次读取的证据。" : ""}
          {error}
        </p>
      )}
      {targetsChanged && (
        <p className="learning-evidence-notice">
          当前输入与证据使用的目标不同。下方按读取时的已保存目标计算；保存新目标后可重新读取。
        </p>
      )}
      {evidence && (
        <>
          <div className="learning-evidence-overview">
            <article>
              <span>本周实际练习</span>
              <strong>{minutes(evidence.week.runningMs)}</strong>
              <small>
                {evidence.week.targetMinutes == null
                  ? "尚未设定每周时长"
                  : `已保存目标 ${evidence.week.targetMinutes} 分钟 · ${evidence.week.met ? "已达到" : "尚未达到"}`}
              </small>
            </article>
            <article>
              <span>整曲速度</span>
              <strong>
                {evidence.targetBpm == null
                  ? "未设置目标速度"
                  : evidence.wholeSong.targetBpmMet
                    ? "有达到目标速度的整曲记录"
                    : "等待目标速度记录"}
              </strong>
              <small>
                {evidence.targetBpm == null
                  ? "尚未设定目标 BPM"
                  : `证据使用已保存目标 ${evidence.targetBpm} BPM`}
              </small>
            </article>
            <article>
              <span>日期计划</span>
              <strong>{evidence.routines.completedCount} 项达标</strong>
              <small>局部选段只证明该段，不代表整曲掌握</small>
            </article>
          </div>
          <p className="parameter-help">
            证据读取于 {date(evidence.generatedAt)}
            ；重新读取可更新已保存的成绩与日期计划。
          </p>
          {!!evidence.reasons.length && (
            <div className="learning-evidence-reasons">
              {evidence.reasons.map((reason, index) => (
                <p key={index}>{reason}</p>
              ))}
            </div>
          )}
          {!!evidence.historicalRefs?.some(
            (reference) => !reference.readable,
          ) && (
            <p className="learning-evidence-notice">
              有{" "}
              {
                evidence.historicalRefs.filter(
                  (reference) => !reference.readable,
                ).length
              }{" "}
              条阶段证据引用的原成绩已清理。阶段变更时保存的统计仍可查看，原成绩无法重新打开。
            </p>
          )}
          <details>
            <summary>
              查看整曲成绩 ·{" "}
              {evidence.wholeSong.recent.length <
              evidence.wholeSong.comparableCount
                ? `最近 ${evidence.wholeSong.recent.length} / ${evidence.wholeSong.comparableCount} 条`
                : `${evidence.wholeSong.recent.length} 条`}
            </summary>
            {!!evidence.wholeSong.reasons.length && (
              <p className="parameter-help">
                {evidence.wholeSong.reasons.join("；")}
              </p>
            )}
            <ol className="learning-evidence-list">
              {evidence.wholeSong.recent.map((row) => (
                <li key={row.sessionId}>
                  <div>
                    <strong>{date(row.recordedAt)}</strong>
                    <span>
                      {row.accuracyPercent == null
                        ? "正确率未记录"
                        : `正确率 ${row.accuracyPercent}%`}
                      {row.effectiveBpm == null
                        ? " · 有效速度未知"
                        : ` · ${row.effectiveBpm} BPM`}
                      {row.meetsTargetBpm ? " · 达到目标速度" : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!row.readable}
                    onClick={() => void showSession(row.sessionId)}
                  >
                    {row.readable ? "查看成绩" : "原成绩已移除"}
                  </button>
                </li>
              ))}
            </ol>
            {!evidence.wholeSong.recent.length && (
              <p className="parameter-help">目前没有可核验的整曲成绩。</p>
            )}
          </details>
          <details>
            <summary>
              查看日期计划 ·{" "}
              {evidence.routines.items.length < evidence.routines.totalCount
                ? `最近 ${evidence.routines.items.length} / ${evidence.routines.totalCount} 项`
                : `${evidence.routines.items.length} 项`}
            </summary>
            {!!evidence.routines.reasons.length && (
              <p className="parameter-help">
                {evidence.routines.reasons.join("；")}
              </p>
            )}
            <ol className="learning-evidence-list">
              {evidence.routines.items.map((item) => (
                <li key={`${item.routineId}-${item.day}-${item.itemId}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.day} ·{" "}
                      {(
                        {
                          whole: "整曲",
                          passage: "选段",
                          ladder: "速度阶梯",
                        } as Record<string, string>
                      )[item.targetKind] ?? "练习项目"}{" "}
                      ·{" "}
                      {item.completed
                        ? "已达标"
                        : item.skipped
                          ? "已跳过"
                          : "尚未达标"}{" "}
                      · 可读取成绩 {item.readableSessionIds.length}/
                      {item.sessionIds.length} 条
                    </span>
                  </div>
                  {!!item.readableSessionIds.length && (
                    <button
                      type="button"
                      onClick={() =>
                        void showSession(item.readableSessionIds.at(-1)!)
                      }
                    >
                      查看关联成绩
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {!evidence.routines.items.length && (
              <p className="parameter-help">这首曲目还没有日期计划项目。</p>
            )}
          </details>
          {selected && (
            <aside
              className="learning-evidence-detail"
              aria-label="关联练习成绩"
            >
              <button
                type="button"
                onClick={() => {
                  detailReads.invalidate();
                  setSelected("");
                  setDetail(null);
                  setDetailError("");
                }}
              >
                收起成绩
              </button>
              {detailError && (
                <div role="alert">
                  <p>{detailError}</p>
                  <button
                    type="button"
                    onClick={() => void showSession(selected)}
                  >
                    重新读取这次成绩
                  </button>
                </div>
              )}
              {!detail && !detailError && <p role="status">正在读取原成绩…</p>}
              {detail && (
                <p>
                  {detail.title ?? "这首曲目"} ·{" "}
                  {detail.recordedAt ? date(detail.recordedAt) : "日期未知"}
                  {detail.tempo != null ? ` · ${detail.tempo} BPM` : ""}
                  {detail.score
                    ? ` · 正确 ${detail.score.matched_notes}、错音 ${detail.score.wrong_notes}、漏音 ${detail.score.missed_notes}`
                    : ""}
                  {detail.context?.routine
                    ? ` · ${detail.context.routine.day} ${detail.context.routine.routine_name} / ${detail.context.routine.item_title}`
                    : ""}
                </p>
              )}
            </aside>
          )}
        </>
      )}
    </section>
  );
}
