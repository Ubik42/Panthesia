import { useMemo } from "react";
import { BrowsePagination } from "../../app/BrowsePagination";
import type { RoutinePlan, RoutineRun } from "./routineTypes";
import { scheduleText } from "../../RoutineScheduleEditor";

const pageSize = 18;
export function RoutinePlanList({
  plans,
  templates,
  runs,
  template,
  selected,
  query,
  page,
  busy,
  create,
  choose,
  changeQuery,
  changePage,
}: {
  plans: RoutinePlan[];
  templates: RoutinePlan[];
  runs: RoutineRun[];
  template: boolean;
  selected: string | null;
  query: string;
  page: number;
  busy: boolean;
  create: () => void;
  choose: (plan: RoutinePlan) => void;
  changeQuery: (value: string) => void;
  changePage: (value: number) => void;
}) {
  const indexed = useMemo(
    () =>
      plans.map((plan) => ({
        plan,
        text: `${plan.name} ${plan.notes}`.toLocaleLowerCase(),
      })),
    [plans],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? indexed
          .filter((entry) => entry.text.includes(needle))
          .map(({ plan }) => plan)
      : plans;
  }, [plans, indexed, query]);
  const schedules = useMemo(
    () => new Map(templates.map((plan) => [plan.id, plan.schedule])),
    [templates],
  );
  const dayPlans = useMemo(
    () => new Set(runs.map((run) => run.routine.id)),
    [runs],
  );
  const current = Math.max(
    0,
    Math.min(page, Math.ceil(filtered.length / pageSize) - 1),
  );
  return (
    <>
      <div className="routine-plan-list-heading">
        <h3 tabIndex={-1} data-browse-list-heading>
          {template ? "常用计划" : "当天可用计划"}
        </h3>
        <button disabled={busy} onClick={create}>
          新建常用计划
        </button>
      </div>
      <label className="routine-plan-search">
        查找计划
        <input
          type="search"
          aria-label="查找练习计划"
          maxLength={4096}
          value={query}
          disabled={busy}
          placeholder="计划名称或备注"
          onChange={(event) => changeQuery(event.target.value)}
        />
      </label>
      <BrowsePagination
        label="计划列表"
        unit="个计划"
        page={current}
        total={filtered.length}
        pageSize={pageSize}
        disabled={busy}
        change={changePage}
      />
      {selected &&
        query.trim() &&
        !filtered.some((plan) => plan.id === selected) && (
          <p className="parameter-help">
            当前计划在筛选结果之外。
            <button disabled={busy} onClick={() => changeQuery("")}>
              显示全部计划
            </button>
          </p>
        )}
      {filtered
        .slice(current * pageSize, (current + 1) * pageSize)
        .map((plan) => (
          <button
            className={`routine-plan ${selected === plan.id ? "selected" : ""}`}
            key={plan.id}
            disabled={busy}
            data-browse-selected={selected === plan.id ? "true" : undefined}
            aria-pressed={selected === plan.id}
            onClick={() => choose(plan)}
          >
            <strong>{plan.name}</strong>
            <span>
              {plan.items.length} 个项目 ·{" "}
              {scheduleText(schedules.get(plan.id))}
              {!template && dayPlans.has(plan.id) ? " · 已建立当天安排" : ""}
            </span>
          </button>
        ))}
      {!filtered.length && (
        <p className="parameter-help">
          {query.trim()
            ? "没有找到对应计划，可以调整名称或备注关键词。"
            : "还没有练习计划。可以先创建常用计划，再添加曲目或选段。"}
        </p>
      )}
    </>
  );
}
