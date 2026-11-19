import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./scoreRoutePreview.css";
import { PaperListPager } from "./features/scores/PaperListPager";

export type ScoreRouteVisit = {
  ordinal: number;
  measure: number;
  number: string;
  pass: number;
  start: number;
  end: number;
  startBeat: number;
  endBeat: number;
  partialStart: boolean;
  partialEnd: boolean;
};

export type ScoreRouteEvidence = {
  review?: import("./engine/commands.generated").ScoreReviewExpectation;
  route: { complete: boolean; visits: ScoreRouteVisit[] } | null;
  diagnostics: string[];
  warnings: string[];
  readiness: string;
  coverage: number;
  versionId?: string;
  contentId?: string;
  fingerprint?: string;
};

const readinessName: Record<string, string> = {
  Ready: "可以跟随演奏",
  Review: "对应关系需要人工核对",
  Poor: "谱音与演奏对应很少",
  Partial: "部分音符可以跟随",
  Blocked: "演奏跟随不可用",
};

const time = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "时间未知";
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
};
const beat = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "?";

export const ScoreRoutePreview = memo(function ScoreRoutePreview({
  evidence,
  title = "演奏顺序",
  initialVisible = 80,
}: {
  evidence: ScoreRouteEvidence | null | undefined;
  title?: string;
  initialVisible?: number;
}) {
  const [page, setPage] = useState(0),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [jumpText, setJumpText] = useState(""),
    [jumpError, setJumpError] = useState(""),
    [selectedOrder, setSelectedOrder] = useState<number | null>(null),
    [issuePage, setIssuePage] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const pageSize = Math.min(80, Math.max(10, Math.trunc(initialVisible) || 80));
  const indexed = useMemo(() => {
    const visits = Array.isArray(evidence?.route?.visits)
      ? evidence.route.visits
      : [];
    const totals = new Map<number, number>(),
      occurrences = new Map<number, number>();
    for (const visit of visits)
      totals.set(visit.measure, (totals.get(visit.measure) ?? 0) + 1);
    return visits.map((visit, index) => {
      const occurrence = (occurrences.get(visit.measure) ?? 0) + 1;
      occurrences.set(visit.measure, occurrence);
      return {
        visit,
        order: index + 1,
        occurrence,
        total: totals.get(visit.measure) ?? 1,
      };
    });
  }, [evidence?.route?.visits]);
  const matching = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return indexed.filter(
      ({ visit, total }) =>
        (!text ||
          (visit.number || String(visit.measure + 1))
            .toLocaleLowerCase()
            .includes(text)) &&
        (filter === "all" ||
          (filter === "repeats" && total > 1) ||
          (filter === "partial" && (visit.partialStart || visit.partialEnd))),
    );
  }, [indexed, query, filter]);
  const issues = useMemo(
    () => [
      ...(evidence?.diagnostics ?? []).map((text) => ({
        text,
        label: "需校对",
      })),
      ...(evidence?.warnings ?? []).map((text) => ({
        text,
        label: "谱面提示",
      })),
    ],
    [evidence?.diagnostics, evidence?.warnings],
  );
  const actualPage = Math.min(
    page,
    Math.max(0, Math.ceil(matching.length / pageSize) - 1),
  );
  const actualIssuePage = Math.min(
    issuePage,
    Math.max(0, Math.ceil(issues.length / 12) - 1),
  );
  useEffect(() => {
    setPage(0);
    setQuery("");
    setFilter("all");
    setSelectedOrder(null);
    setJumpText("");
    setJumpError("");
    setIssuePage(0);
  }, [evidence]);
  useLayoutEffect(() => {
    if (!selectedOrder) return;
    const row = list.current?.querySelector<HTMLElement>(
      `[data-route-order="${selectedOrder}"]`,
    );
    if (!row || !list.current || !row.getClientRects().length) return;
    row.focus({ preventScroll: true });
    list.current.scrollTop = Math.max(
      0,
      row.offsetTop - list.current.offsetTop - 10,
    );
  }, [selectedOrder, actualPage]);
  if (!evidence)
    return (
      <section className="score-route-preview" aria-label={title}>
        <h4>{title}</h4>
        <p role="status">当前谱面没有可核对的演奏顺序。</p>
      </section>
    );
  const complete = evidence.route?.complete === true;
  const jump = () => {
    const order = jumpText.trim() ? Number(jumpText) : NaN;
    if (!Number.isSafeInteger(order) || order < 1 || order > indexed.length) {
      setJumpError(`请输入 1–${indexed.length} 之间的经过序号。`);
      return;
    }
    setQuery("");
    setFilter("all");
    setPage(Math.floor((order - 1) / pageSize));
    setSelectedOrder(order);
    setJumpError("");
  };
  return (
    <section className="score-route-preview" aria-label={title}>
      <header>
        <h4>{title}</h4>
        <span
          className={complete ? "score-route-ready" : "score-route-warning"}
        >
          {complete ? "顺序完整" : "顺序尚未确认"}
        </span>
      </header>
      <p>
        {indexed.length} 次小节经过 · 与演奏音符对应 {evidence.coverage}% ·{" "}
        {readinessName[evidence.readiness] ?? evidence.readiness}
      </p>
      {!complete && (
        <p className="score-route-warning" role="status">
          当前预览不能证明整首曲目的演奏顺序。请查看下方问题并校对谱面与演奏对应，再使用这条路线。
        </p>
      )}
      {!!indexed.length && (
        <div className="score-route-tools">
          <label>
            查找谱上小节号
            <input
              aria-label="查找演奏顺序小节"
              value={query}
              placeholder="谱上编号"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
                setSelectedOrder(null);
              }}
            />
          </label>
          <label>
            显示
            <select
              aria-label="演奏顺序显示范围"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
                setSelectedOrder(null);
              }}
            >
              <option value="all">全部经过</option>
              <option value="repeats">反复出现的小节</option>
              <option value="partial">局部经过</option>
            </select>
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              jump();
            }}
          >
            <label>
              跳到经过序号
              <input
                aria-label="跳到演奏经过序号"
                type="number"
                min={1}
                max={indexed.length}
                value={jumpText}
                onChange={(event) => setJumpText(event.target.value)}
              />
            </label>
            <button type="submit">定位</button>
          </form>
          {jumpError && <p role="status">{jumpError}</p>}
        </div>
      )}
      {matching.length ? (
        <ol
          className="score-route-visits"
          ref={list}
          aria-label="演奏小节经过列表"
        >
          {matching
            .slice(actualPage * pageSize, actualPage * pageSize + pageSize)
            .map(({ visit, order, occurrence, total }) => {
              return (
                <li
                  key={`${visit.ordinal}-${order}`}
                  data-route-order={order}
                  tabIndex={-1}
                  className={selectedOrder === order ? "selected" : ""}
                >
                  <span className="score-route-position">{order}</span>
                  <strong>第 {visit.number || visit.measure + 1} 小节</strong>
                  {total > 1 && <span>本小节第 {occurrence} 次</span>}
                  {visit.pass > 1 && <span>第 {visit.pass} 遍</span>}
                  <span
                    className={
                      visit.partialStart || visit.partialEnd
                        ? "score-route-partial"
                        : undefined
                    }
                  >
                    第 {beat(visit.startBeat)}–{beat(visit.endBeat)} 拍
                    {visit.partialStart || visit.partialEnd ? " · 局部" : ""}
                  </span>
                  <time>
                    {time(visit.start)}–{time(visit.end)}
                  </time>
                </li>
              );
            })}
        </ol>
      ) : (
        <p className="parameter-help" role="status">
          {indexed.length
            ? "没有符合条件的小节经过，请修改筛选。"
            : "这份谱面没有可显示的小节经过，请查看下方校对问题。"}
        </p>
      )}
      <PaperListPager
        page={actualPage}
        total={matching.length}
        size={pageSize}
        label="演奏顺序分页"
        change={(page) => {
          setPage(page);
          setSelectedOrder(null);
          if (list.current) list.current.scrollTop = 0;
        }}
      />
      {!!indexed.length && (
        <p className="parameter-help">
          经过序号按实际演奏顺序展开；反复段中的同一谱上小节会重复列出。
        </p>
      )}
      {issues
        .slice(actualIssuePage * 12, actualIssuePage * 12 + 12)
        .map((issue, index) => (
          <p
            className="score-route-diagnostic"
            key={`${actualIssuePage}-${index}`}
          >
            {issue.label}：{issue.text}
          </p>
        ))}
      <PaperListPager
        page={actualIssuePage}
        total={issues.length}
        size={12}
        label="谱面校对问题分页"
        change={setIssuePage}
      />
    </section>
  );
});
