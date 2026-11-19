import { useEffect, useId, useState } from "react";
import type { ExpressionGoal } from "../../engine/commands.generated";
import {
  expressionFields,
  expressionInputs,
  parseExpressionInputs,
  type ExpressionInputs,
} from "./expressionDraft";
import { CopyPracticeDraft } from "./CopyPracticeDraft";
import { editDraftValue } from "../editing/editDraftStore";

export function ExpressionGoalConflict({
  contentId,
  base,
  draft,
  latest,
  inputs,
  disabled,
  resolve,
  resolveInputs,
}: {
  contentId?: string;
  base: ExpressionGoal | null;
  draft: ExpressionGoal | null;
  latest: ExpressionGoal | null;
  inputs?: ExpressionInputs;
  disabled: boolean;
  resolve: (goal: ExpressionGoal | null) => void;
  resolveInputs?: (inputs: ExpressionInputs) => void;
}) {
  const id = useId(),
    [choices, setChoices] = useState<
      Partial<Record<keyof ExpressionGoal, "draft" | "latest">>
    >({});
  const original = expressionInputs(base),
    local = inputs ?? expressionInputs(draft),
    remote = expressionInputs(latest);
  useEffect(() => setChoices({}), [editDraftValue([original, local, remote])]);
  const rows = expressionFields.map((field) => ({
    ...field,
    original: original[field.key],
    draft: local[field.key],
    latest: remote[field.key],
    changed:
      local[field.key] !== original[field.key] ||
      remote[field.key] !== original[field.key],
    conflict:
      local[field.key] !== original[field.key] &&
      remote[field.key] !== original[field.key] &&
      local[field.key] !== remote[field.key],
    merged:
      local[field.key] === original[field.key]
        ? remote[field.key]
        : local[field.key],
  }));
  const unresolved = rows.some((row) => row.conflict && !choices[row.key]);
  const apply = (next: ExpressionInputs) => {
    if (resolveInputs) resolveInputs(next);
    else resolve(parseExpressionInputs(next).value);
  };
  return (
    <section className="song-expression-conflict" aria-label="合并曲目专项要求">
      <p>
        已保存目标有更新，当前输入继续保留。逐项核对后可合并，合并结果仍需保存。
      </p>
      <div className="expression-merge-fields">
        {rows
          .filter((row) => row.changed)
          .map((row) => {
            const text = (value: string | null) =>
              value === null
                ? "不要求"
                : value.trim() === ""
                  ? "等待输入"
                  : value + row.unit;
            return (
              <fieldset key={row.key} disabled={disabled}>
                <legend>{row.label}</legend>
                <dl>
                  <div>
                    <dt>原值</dt>
                    <dd>{text(row.original)}</dd>
                  </div>
                  <div>
                    <dt>当前输入</dt>
                    <dd>{text(row.draft)}</dd>
                  </div>
                  <div>
                    <dt>已保存</dt>
                    <dd>{text(row.latest)}</dd>
                  </div>
                </dl>
                {row.conflict ? (
                  <div className="expression-merge-choice">
                    <label>
                      <input
                        type="radio"
                        name={id + row.key}
                        checked={choices[row.key] === "draft"}
                        onChange={() =>
                          setChoices((old) => ({ ...old, [row.key]: "draft" }))
                        }
                      />
                      保留当前输入
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={id + row.key}
                        checked={choices[row.key] === "latest"}
                        onChange={() =>
                          setChoices((old) => ({ ...old, [row.key]: "latest" }))
                        }
                      />
                      采用已保存值
                    </label>
                  </div>
                ) : (
                  <small>合并后：{text(row.merged)}</small>
                )}
              </fieldset>
            );
          })}
      </div>
      <button
        disabled={disabled || unresolved}
        onClick={() =>
          apply(
            Object.fromEntries(
              rows.map((row) => [
                row.key,
                row.conflict
                  ? choices[row.key] === "latest"
                    ? row.latest
                    : row.draft
                  : row.merged,
              ]),
            ) as ExpressionInputs,
          )
        }
      >
        {unresolved ? "请先选择有冲突的要求" : "合并后继续编辑"}
      </button>
      <div className="expression-merge-actions">
        <button disabled={disabled} onClick={() => apply(local)}>
          保留当前全部输入
        </button>
        <button disabled={disabled} onClick={() => apply(remote)}>
          采用最新已保存目标
        </button>
      </div>
      <CopyPracticeDraft
        label="复制输入与冲突内容"
        value={{ contentId, base, draft, inputs: local, latest }}
      />
    </section>
  );
}
