import { useId, useState } from "react";
import type { ReplayClip } from "./historyTypes";
import type { ClipInput, ReplayRangeInput } from "./replayEditorStore";
type Field = "name" | "notes" | "start" | "end";
const fields: { key: Field; label: string }[] = [
  { key: "name", label: "名称" },
  { key: "notes", label: "备注" },
  { key: "start", label: "起点（秒）" },
  { key: "end", label: "终点（秒）" },
];
export function ReplayClipMerge({
  draft,
  range,
  current,
  disabled,
  merge,
}: {
  draft: ClipInput;
  range: ReplayRangeInput;
  current: ReplayClip;
  disabled: boolean;
  merge: (
    draft: Pick<ClipInput, "name" | "notes">,
    range: Pick<ReplayRangeInput, "start" | "end">,
    proof: string,
  ) => void;
}) {
  const [choices, setChoices] = useState<
    Partial<Record<Field, "mine" | "saved">>
  >({});
  const group = useId();
  const mine = {
    name: draft.name,
    notes: draft.notes,
    start: range.start,
    end: range.end,
  };
  const stored = {
    name: current.name,
    notes: current.notes,
    start: String(current.start),
    end: String(current.end),
  };
  const equal = (field: Field, left: string, right: string) =>
    field === "start" || field === "end"
      ? left.trim() !== "" &&
        right.trim() !== "" &&
        Number(left) === Number(right)
      : left === right;
  const picked = (field: Field) =>
    choices[field] ??
    (draft.base && equal(field, mine[field], String(draft.base[field]))
      ? "saved"
      : "mine");
  const combined = Object.fromEntries(
    fields.map(({ key }) => [
      key,
      picked(key) === "saved" ? stored[key] : mine[key],
    ]),
  ) as Record<Field, string>;
  return (
    <details className="replay-clip-merge">
      <summary>按名称、备注和起止位置合并</summary>
      <p className="replay-editor-hint">
        未改动的字段默认采用已保存内容。可以逐项选择，再继续编辑。
      </p>
      <div className="replay-clip-merge-fields">
        {fields.map(({ key, label }) => (
          <fieldset key={key} disabled={disabled}>
            <legend>{label}</legend>
            <label>
              <input
                type="radio"
                name={`${group}-${key}`}
                checked={picked(key) === "mine"}
                onChange={() =>
                  setChoices((value) => ({ ...value, [key]: "mine" }))
                }
              />
              <span>当前输入</span>
              <output>{mine[key] || "（空白）"}</output>
            </label>
            <label>
              <input
                type="radio"
                name={`${group}-${key}`}
                checked={picked(key) === "saved"}
                onChange={() =>
                  setChoices((value) => ({ ...value, [key]: "saved" }))
                }
              />
              <span>已保存</span>
              <output>{stored[key] || "（空白）"}</output>
            </label>
          </fieldset>
        ))}
      </div>
      <button
        disabled={disabled}
        onClick={() =>
          merge(
            { name: combined.name, notes: combined.notes },
            { start: combined.start, end: combined.end },
            JSON.stringify([
              current.id,
              current.name,
              current.notes,
              current.start,
              current.end,
            ]),
          )
        }
      >
        采用合并结果，继续编辑
      </button>
    </details>
  );
}
