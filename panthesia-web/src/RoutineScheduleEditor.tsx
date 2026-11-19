import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  routineValue,
  type RoutineScheduleDraft,
} from "./features/routines/routineWorkbenchStore";
import type { RoutineSchedule } from "./features/routines/routineTypes";
export type { RoutineSchedule } from "./features/routines/routineTypes";
const labels = ["一", "二", "三", "四", "五", "六", "日"];
export const scheduleText = (s: RoutineSchedule | undefined | null) =>
  !s
    ? "手动安排"
    : `${s.enabled ? "每周" : "已暂停 · 周"}${s.weekdays.map((d) => labels[d]).join("、")}${s.skipDates?.length || s.extraDates?.length ? ` · ${s.skipDates?.length ?? 0} 天跳过 · ${s.extraDates?.length ?? 0} 天加练` : ""}`;
export function RoutineScheduleEditor({
  value,
  day,
  disabled,
  save,
  revision = null,
  memory,
  remember,
}: {
  value?: RoutineSchedule | null;
  day: string;
  disabled: boolean;
  save: (s: RoutineSchedule | null, expected: string | null) => Promise<void>;
  revision?: string | null;
  memory?: RoutineScheduleDraft;
  remember?: (
    draft: Omit<
      RoutineScheduleDraft,
      "routineId" | "day" | "updatedAt" | "title"
    > | null,
  ) => void;
}) {
  const defaults = (): RoutineSchedule => ({
    enabled: true,
    weekdays: [0, 1, 2, 3, 4],
    start: day,
    end: null,
    skipDates: [],
    extraDates: [],
  });
  const normalized = (schedule: RoutineSchedule) => ({
    ...schedule,
    skipDates: schedule.skipDates ?? [],
    extraDates: schedule.extraDates ?? [],
  });
  const [draft, setValue] = useState<RoutineSchedule>(
    () => memory?.value ?? (value ? normalized(value) : defaults()),
  );
  const [exceptionDay, setExceptionDay] = useState(memory?.exceptionDay ?? day);
  const [base, setBase] = useState(
    memory?.base ?? routineValue(value ? normalized(value) : null),
  );
  const [expected, setExpected] = useState(memory?.revision ?? revision);
  const [touched, setTouched] = useState(memory?.touched ?? false);
  const current = routineValue(value ? normalized(value) : null);
  const draftValue = routineValue(draft);
  const conflict = touched && base !== current && draftValue !== current;
  const setDraft: Dispatch<SetStateAction<RoutineSchedule>> = (change) => {
    setTouched(true);
    setValue(change);
  };
  useEffect(() => {
    if (!touched || draftValue === current) {
      setValue(value ? normalized(value) : defaults());
      setBase(current);
      setExpected(revision);
      setTouched(false);
    } else if (base === current) setExpected(revision);
  }, [current, revision, day]);
  useEffect(() => {
    remember?.(
      touched || exceptionDay !== day
        ? { value: draft, exceptionDay, base, revision: expected, touched }
        : null,
    );
  }, [draft, exceptionDay, base, expected, touched, day, remember]);
  const exceptionValid =
    !!exceptionDay &&
    exceptionDay >= draft.start &&
    (!draft.end || exceptionDay <= draft.end);
  const valid =
    draft.weekdays.length > 0 &&
    !!draft.start &&
    (!draft.end || draft.end >= draft.start) &&
    [...(draft.skipDates ?? []), ...(draft.extraDates ?? [])].every(
      (d) => d >= draft.start && (!draft.end || d <= draft.end),
    );
  const addException = (key: "skipDates" | "extraDates") => {
    if (!exceptionValid) return;
    const other = key === "skipDates" ? "extraDates" : "skipDates";
    setDraft((s) => ({
      ...s,
      [key]: [...new Set([...(s[key] ?? []), exceptionDay])].sort(),
      [other]: (s[other] ?? []).filter((d) => d !== exceptionDay),
    }));
  };
  return (
    <details className="routine-schedule">
      <summary>周期安排 · {scheduleText(value)}</summary>
      <fieldset disabled={disabled}>
        {touched && <p role="status">周期安排有未提交修改，输入已暂存。</p>}
        {conflict && (
          <div className="routine-draft-conflict" role="alert">
            <p>周期安排已由其他操作修改。当前保存：{scheduleText(value)}</p>
            <button
              onClick={() => {
                setValue(value ? normalized(value) : defaults());
                setBase(current);
                setExpected(revision);
                setTouched(false);
              }}
            >
              采用已保存安排
            </button>
            <button
              onClick={() => {
                setBase(current);
                setExpected(revision);
              }}
            >
              按最新版本保留我的输入
            </button>
          </div>
        )}
        <legend>每周练习日</legend>
        <div className="routine-weekdays">
          {labels.map((label, d) => (
            <label key={d}>
              <input
                type="checkbox"
                aria-label={`星期${label}`}
                checked={draft.weekdays.includes(d)}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    weekdays: e.target.checked
                      ? [...s.weekdays, d].sort()
                      : s.weekdays.filter((v) => v !== d),
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="routine-schedule-dates">
          <label>
            开始日期
            <input
              aria-label="周期开始日期"
              type="date"
              min="2000-01-01"
              max="2200-12-31"
              value={draft.start}
              onChange={(e) =>
                setDraft((s) => ({ ...s, start: e.target.value }))
              }
            />
          </label>
          <label>
            结束日期（可留空）
            <input
              aria-label="周期结束日期"
              type="date"
              min={draft.start}
              max="2200-12-31"
              value={draft.end ?? ""}
              onChange={(e) =>
                setDraft((s) => ({ ...s, end: e.target.value || null }))
              }
            />
          </label>
        </div>
        <div className="routine-schedule-exceptions">
          <p>指定日期</p>
          <div className="routine-schedule-dates">
            <label>
              日期
              <input
                aria-label="例外日期"
                type="date"
                min={draft.start}
                max={draft.end ?? "2200-12-31"}
                value={exceptionDay}
                onChange={(e) => setExceptionDay(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !exceptionValid || (draft.skipDates?.length ?? 0) >= 366
              }
              onClick={() => addException("skipDates")}
            >
              这天跳过
            </button>
            <button
              type="button"
              disabled={
                !exceptionValid || (draft.extraDates?.length ?? 0) >= 366
              }
              onClick={() => addException("extraDates")}
            >
              这天加练
            </button>
          </div>
          {[
            { key: "skipDates" as const, label: "跳过" },
            { key: "extraDates" as const, label: "加练" },
          ].map(
            ({ key, label }) =>
              (draft[key] ?? []).length > 0 && (
                <div className="routine-schedule-exception-list" key={key}>
                  <span>{label}：</span>
                  {(draft[key] ?? []).map((date) => (
                    <button
                      type="button"
                      key={date}
                      aria-label={`移除${label}${date}`}
                      onClick={() =>
                        setDraft((s) => ({
                          ...s,
                          [key]: (s[key] ?? []).filter((d) => d !== date),
                        }))
                      }
                    >
                      {date} ×
                    </button>
                  ))}
                </div>
              ),
          )}
        </div>
        <label className="routine-schedule-enable">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft((s) => ({ ...s, enabled: e.target.checked }))
            }
          />
          启用周期安排
        </label>
        <div className="routine-meta-actions">
          <button
            disabled={!valid || conflict || !expected}
            onClick={() => void save(draft, expected)}
          >
            保存周期安排
          </button>
          {value && (
            <>
              <button
                disabled={conflict || !expected}
                onClick={() =>
                  void save({ ...value, enabled: !value.enabled }, expected)
                }
              >
                {value.enabled ? "暂停周期安排" : "恢复周期安排"}
              </button>
              <button
                disabled={conflict || !expected}
                onClick={() => void save(null, expected)}
              >
                取消周期安排
              </button>
            </>
          )}
        </div>
      </fieldset>
      <p className="parameter-help">
        打开符合每周规则或“加练”规则的日期时，软件会建立当天安排。“跳过”日期不会建立安排。修改规则只影响尚未建立的日期；已有安排及成绩保留。软件不会自动开始演奏，也不会补建未查看的过去日期。
      </p>
    </details>
  );
}
