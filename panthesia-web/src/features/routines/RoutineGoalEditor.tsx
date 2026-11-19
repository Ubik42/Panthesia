import { useId } from "react";
import type { RoutineGoal } from "./routineTypes";
import {
  readRoutineGoalInput,
  routineGoalFields,
  type RoutineGoalField,
  type RoutineGoalInputs,
} from "./routineGoalInputs";

export function RoutineGoalEditor({
  goal,
  input,
  changeInput,
  patch,
  disabled,
  wait,
}: {
  goal: RoutineGoal;
  input: RoutineGoalInputs;
  changeInput: (field: RoutineGoalField, value: string) => void;
  patch: (value: Partial<RoutineGoal>) => void;
  disabled: boolean;
  wait: boolean;
}) {
  const id = useId();
  const field = (name: RoutineGoalField) => {
    const definition = routineGoalFields[name];
    const invalid = readRoutineGoalInput(name, input[name]) === null;
    return (
      <label key={name}>
        {definition.label}
        <input
          type="text"
          inputMode="numeric"
          maxLength={8}
          value={input[name]}
          disabled={disabled}
          aria-label={definition.accessible}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-${name}` : undefined}
          onChange={(event) => changeInput(name, event.target.value)}
          onBlur={() => {
            const value = readRoutineGoalInput(name, input[name]);
            if (value !== null) changeInput(name, String(value));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              const value = readRoutineGoalInput(name, input[name]);
              if (value !== null) changeInput(name, String(value));
            }
            if (event.key === "Escape" && invalid) {
              event.preventDefault();
              event.stopPropagation();
              changeInput(name, String(goal[name] ?? 80));
            }
          }}
        />
        {invalid && (
          <small id={`${id}-${name}`} className="routine-goal-input-error">
            请输入 {definition.min} 到 {definition.max} 之间的整数。
          </small>
        )}
      </label>
    );
  };
  return (
    <div className="routine-goal-editor" role="group" aria-label="项目达标目标">
      <div className="routine-goal-grid">
        {field("passes")}
        {field("accuracy")}
        {field("attemptLimit")}
      </div>
      <div className="routine-goal-options">
        <label>
          <input
            type="checkbox"
            aria-label="计划项目要求连续达标"
            checked={goal.consecutive}
            disabled={disabled}
            onChange={(event) => patch({ consecutive: event.target.checked })}
          />
          要求连续达标
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="计划项目要求准时率"
            checked={goal.onTime != null}
            disabled={disabled || (wait && goal.onTime == null)}
            onChange={(event) =>
              patch({
                onTime: event.target.checked
                  ? (readRoutineGoalInput("onTime", input.onTime) ?? 80)
                  : null,
              })
            }
          />
          准时率门槛
        </label>
      </div>
      {goal.onTime != null && (
        <div className="routine-goal-timing">{field("onTime")}</div>
      )}
      {wait && (
        <p
          className={
            goal.onTime != null ? "routine-goal-input-error" : "parameter-help"
          }
        >
          {goal.onTime != null
            ? "当前条件是等音模式，请关闭准时率门槛后保存。"
            : "等音模式按音符正确率达标。切换到连续练习后可设置准时率门槛。"}
        </p>
      )}
    </div>
  );
}
