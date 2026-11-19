import { useMemo, useState } from "react";
import type {
  ScoreExportConflict,
  ScoreExportPosition,
  ScoreExportOptions,
} from "../../engine/commands.generated";

function positionText(
  position: ScoreExportPosition,
  conflict: ScoreExportConflict,
  ppq: number,
) {
  return [
    conflict.fingers ? `指法 ${position.finger ?? "沿用原谱"}` : null,
    conflict.hands ? (position.hand ?? "沿用原谱分手") : null,
    conflict.substitutions
      ? position.changes === null
        ? "换指需重新审阅"
        : !position.changes.length
          ? "无个人换指"
          : position.changes
              .map(
                (action) =>
                  `${action.from}→${action.to}（起音后 ${(action.offsetTick / ppq).toFixed(3)} 四分音符拍）`,
              )
              .join("、")
      : null,
  ]
    .filter(Boolean)
    .join("，");
}
function ConflictRow({
  conflict,
  ppq,
}: {
  conflict: ScoreExportConflict;
  ppq: number;
}) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(conflict.positions.length / 5));
  const pageIndex = Math.min(page, count - 1);
  return (
    <article className="score-export-conflict-row">
      <strong>
        {conflict.part} · 第 {conflict.measure} 小节 · 第 {conflict.note} 谱音
      </strong>
      <ol start={pageIndex * 5 + 1}>
        {conflict.positions
          .slice(pageIndex * 5, pageIndex * 5 + 5)
          .map((position, index) => (
            <li key={`${position.track}:${position.index}`}>
              <b>第 {pageIndex * 5 + index + 1} 次</b>
              <span>{positionText(position, conflict, ppq)}</span>
            </li>
          ))}
      </ol>
      {count > 1 && (
        <div
          className="score-export-position-pages"
          aria-label={`${conflict.part} 第 ${conflict.measure} 小节的反复位置分页`}
        >
          <button
            disabled={pageIndex === 0}
            onClick={() => setPage(pageIndex - 1)}
          >
            前 5 次
          </button>
          <span role="status">
            第 {pageIndex * 5 + 1}—
            {Math.min((pageIndex + 1) * 5, conflict.positions.length)} 次 / 共{" "}
            {conflict.positions.length} 次
          </span>
          <button
            disabled={pageIndex + 1 >= count}
            onClick={() => setPage(pageIndex + 1)}
          >
            后 5 次
          </button>
        </div>
      )}
    </article>
  );
}
export function ScoreExportConflicts({
  conflicts,
  ppq,
  options,
}: {
  conflicts: ScoreExportConflict[];
  ppq: number;
  options: ScoreExportOptions;
}) {
  const [part, setPart] = useState(""),
    [measure, setMeasure] = useState(""),
    [page, setPage] = useState(0);
  const parts = useMemo(
    () => [...new Set(conflicts.map((conflict) => conflict.part))],
    [conflicts],
  );
  const filtered = useMemo(
    () =>
      conflicts.filter(
        (conflict) =>
          (!part || conflict.part === part) &&
          (!measure || conflict.measure === Number(measure)),
      ),
    [conflicts, part, measure],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    pageIndex = Math.min(page, pages - 1);
  return (
    <details className="score-export-conflicts" open>
      <summary>核对反复分歧 · {conflicts.length} 个谱音</summary>
      <p>
        {options.repeatPolicy === "consistent"
          ? "只跳过存在分歧的指法、分手或换指；同一谱音的其他一致标记仍会导出。"
          : "同一谱音采用首次演奏的标记，后续演奏的不同设置仍保留在软件中。"}
      </p>
      <div className="score-export-filter">
        <label>
          声部
          <select
            value={part}
            onChange={(event) => {
              setPart(event.target.value);
              setPage(0);
            }}
          >
            <option value="">全部声部</option>
            {parts.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          小节
          <input
            type="number"
            min={1}
            step={1}
            placeholder="全部"
            value={measure}
            onChange={(event) => {
              setMeasure(event.target.value);
              setPage(0);
            }}
          />
        </label>
        {(part || measure) && (
          <button
            onClick={() => {
              setPart("");
              setMeasure("");
              setPage(0);
            }}
          >
            清除筛选
          </button>
        )}
        <span role="status">{filtered.length} 个谱音</span>
      </div>
      {!filtered.length ? (
        <p>没有符合筛选条件的反复分歧。</p>
      ) : (
        filtered
          .slice(pageIndex * 20, (pageIndex + 1) * 20)
          .map((conflict) => (
            <ConflictRow
              key={`${conflict.part}:${conflict.measure}:${conflict.note}`}
              conflict={conflict}
              ppq={ppq}
            />
          ))
      )}
      {pages > 1 && (
        <nav className="score-export-conflict-pages" aria-label="反复分歧分页">
          <button
            disabled={pageIndex === 0}
            onClick={() => setPage(pageIndex - 1)}
          >
            上一页
          </button>
          <span role="status">
            第 {pageIndex + 1} / {pages} 页 · 每页 20 个谱音
          </span>
          <button
            disabled={pageIndex + 1 >= pages}
            onClick={() => setPage(pageIndex + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </details>
  );
}
