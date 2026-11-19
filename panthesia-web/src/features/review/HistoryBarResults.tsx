import { useEffect, useMemo, useRef, useState } from "react";
import { BrowsePagination } from "../../app/BrowsePagination";
import type { HistoryDetail } from "./historyTypes";
import type { HistoryBarReview } from "./historyBrowse";
import { accuracy, percent } from "./historyPresentation";

const pageSize = 24;

export function HistoryBarResults({
  detail,
  order,
  changeOrder,
  initial,
  remember,
  busy,
  practiceBlocked,
  practice,
}: {
  detail: HistoryDetail;
  order: string;
  changeOrder: (order: string) => void;
  initial?: HistoryBarReview;
  remember: (review: HistoryBarReview) => void;
  busy: boolean;
  practiceBlocked: boolean;
  practice: (measure: number) => void;
}) {
  const restored =
    initial?.contentId === detail.contentId && initial.id === detail.id
      ? initial
      : undefined;
  const [page, setPage] = useState(
    restored?.order && restored.order !== order ? 0 : (restored?.page ?? 0),
  );
  const [errorsOnly, setErrorsOnly] = useState(restored?.errorsOnly ?? false);
  const previousOrder = useRef(order);
  const save = useRef(remember);
  save.current = remember;
  const bars = useMemo(
    () =>
      detail.summary.measures
        .filter(
          (bar) =>
            !errorsOnly ||
            bar.breakdown.wrong_notes + bar.breakdown.missed_notes > 0,
        )
        .sort((left, right) =>
          order === "measure"
            ? left.measure - right.measure
            : right.breakdown.wrong_notes +
                right.breakdown.missed_notes -
                left.breakdown.wrong_notes -
                left.breakdown.missed_notes || left.measure - right.measure,
        ),
    [detail.summary.measures, errorsOnly, order],
  );
  const current = Math.min(
    Math.max(0, previousOrder.current === order ? page : 0),
    Math.max(0, Math.ceil(bars.length / pageSize) - 1),
  );
  const shown = bars.slice(current * pageSize, (current + 1) * pageSize);
  const timed = ["flow", "recital", "memory"].includes(detail.mode ?? "");
  useEffect(() => {
    if (previousOrder.current === order) return;
    previousOrder.current = order;
    setPage(0);
  }, [order]);
  useEffect(() => {
    save.current({
      contentId: detail.contentId,
      id: detail.id,
      page: current,
      errorsOnly,
      order,
    });
  }, [detail.contentId, detail.id, current, errorsOnly, order]);
  return (
    <section className="history-measure-results" aria-label="逐小节成绩">
      <div className="history-bars-heading">
        <h4>逐小节成绩</h4>
        <select
          aria-label="历史小节排序"
          value={order}
          disabled={busy}
          onChange={(event) => changeOrder(event.target.value)}
        >
          <option value="errors">错漏最多优先</option>
          <option value="measure">按小节顺序</option>
        </select>
      </div>
      <label className="history-measure-filter">
        <input
          type="checkbox"
          checked={errorsOnly}
          disabled={busy}
          onChange={(event) => {
            setErrorsOnly(event.target.checked);
            setPage(0);
          }}
        />
        仅看有错音或漏音的小节
      </label>
      <BrowsePagination
        label="小节成绩"
        unit="个小节"
        page={current}
        pageSize={pageSize}
        total={bars.length}
        disabled={busy}
        change={setPage}
      />
      {shown.length ? (
        <div className="history-measure-table-scroll">
          <table className="history-bar-table">
            <caption className="history-table-caption">
              {errorsOnly ? "有错音或漏音的小节" : "本次练习的小节成绩"} ·{" "}
              {order === "measure" ? "按小节顺序" : "错漏最多优先"}
            </caption>
            <thead>
              <tr>
                <th scope="col">小节</th>
                <th scope="col">正确率</th>
                <th scope="col">错 / 漏</th>
                {timed && <th scope="col">偏移 ms</th>}
                <th scope="col">重练</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((bar) => (
                <tr key={bar.measure}>
                  <td>第 {bar.measure} 小节</td>
                  <td>{percent(accuracy(bar.breakdown))}</td>
                  <td>
                    {bar.breakdown.wrong_notes} / {bar.breakdown.missed_notes}
                  </td>
                  {timed && <td>{bar.timing.median_offset_ms ?? "—"}</td>}
                  <td>
                    <button
                      disabled={practiceBlocked}
                      aria-label={`重练第 ${bar.measure} 小节`}
                      onClick={() => practice(bar.measure)}
                    >
                      重练
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="browse-detail-note">
          {errorsOnly && detail.summary.measures.length
            ? "这次记录没有包含错音或漏音的小节。可以关闭筛选查看全部小节。"
            : "这条记录没有逐小节数据。"}
        </p>
      )}
      {practiceBlocked && !detail.restorable && (
        <p className="parameter-help">
          当前记录暂时无法恢复练习，可从曲库打开曲目后选择范围。
        </p>
      )}
    </section>
  );
}
