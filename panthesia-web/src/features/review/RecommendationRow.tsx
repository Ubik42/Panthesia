import { expressionGoalText } from "../../ExpressionGoalControl";
import type { Suggestion, ReviewEdit } from "./recommendationTypes";

export function RecommendationRow({
  row: r,
  selected,
  disabled,
  selectionFull,
  edit,
  modified,
  changed,
  toggle,
  reset,
}: {
  row: Suggestion;
  selected: boolean;
  disabled: boolean;
  selectionFull: boolean;
  edit: ReviewEdit;
  modified: boolean;
  changed: (change: Partial<ReviewEdit>) => void;
  toggle: (selected: boolean) => void;
  reset: () => void;
}) {
  return (
    <div
      className={`weak-practice-row${selected ? " is-selected" : ""}`}
      key={r.id}
    >
      <label>
        <input
          type="checkbox"
          aria-label={
            r.expression
              ? `选择 ${r.title} ${r.range} ${r.kind === "dynamics" ? "力度起伏" : "踏板时机"}`
              : r.kind === "review"
                ? `选择 ${r.title} 全曲到期复习`
                : r.kind === "passageReview"
                  ? `选择 ${r.title} ${r.range} 到期选段复习`
                  : `选择 ${r.title} 第 ${r.measure} 小节`
          }
          disabled={disabled || (!selected && selectionFull)}
          checked={selected}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span>
          <strong>
            {r.title} · {r.range ?? `第 ${r.measure} 小节`} ·{" "}
            {
              {
                rhythm: "节奏",
                accuracy: "音符",
                dynamics: "力度起伏",
                pedal: "踏板时机",
                review: "到期复习",
                passageReview: "选段复习",
              }[r.kind]
            }
          </strong>
          <small>
            {r.kind === "review" || r.kind === "passageReview"
              ? "最近正确率"
              : "正确率"}{" "}
            {Math.round(r.accuracy * 100)}% ·{" "}
            {r.kind === "review" || r.kind === "passageReview"
              ? `同条件连续达标 ${r.attempts} 次`
              : `${r.attempts}${r.expression ? " 轮完整练习" : " 次完整小节"}`}{" "}
            · {r.judged} 次音符判断
          </small>
          {r.timing && (
            <small>
              准时率 {Math.round(r.timing.onTime * 100)}% · {r.timing.samples}{" "}
              个节奏样本 · 偏移 {Math.round(r.timing.offsetMs)} ms · 波动{" "}
              {Math.round(r.timing.deviationMs)} ms
            </small>
          )}
          {r.expression && (
            <small>
              {r.kind === "dynamics" ? (
                <>
                  起伏一致率 {Math.round(r.expression.contourPercent ?? 0)}% ·{" "}
                  {r.expression.contourSteps} 段参考变化 ·{" "}
                  {r.expression.samples} 个力度样本
                </>
              ) : (
                <>
                  参考 {r.expression.referenceTransitions} 次踏板转换 ·{" "}
                  {r.expression.correspondenceFailures} 轮未完整对应
                  {r.expression.pedalOffsetMs != null &&
                    ` · 偏移汇总 ${Math.round(r.expression.pedalOffsetMs)} ms`}
                  {r.expression.pedalAbsoluteOffsetMs != null &&
                    ` · 绝对偏移汇总 ${Math.round(r.expression.pedalAbsoluteOffsetMs)} ms`}
                  {r.expression.pedalDeviationMs != null &&
                    ` · 波动汇总 ${Math.round(r.expression.pedalDeviationMs)} ms`}
                  {r.expression.calibratedLegacy > 0 &&
                    ` · ${r.expression.calibratedLegacy} 轮旧记录已换算输入延迟`}
                </>
              )}
            </small>
          )}
          <small>
            原条件：{Math.round(r.sourceSpeed * 100)}% ·{" "}
            {
              (
                {
                  wait: "等音",
                  flow: "连续",
                  recital: "完整演奏",
                  memory: "背谱",
                } as Record<string, string>
              )[r.sourceMode]
            }{" "}
            ·{" "}
            {(
              {
                both: "双手",
                left: "左手",
                right: "右手",
                custom: "自定义声部",
              } as Record<string, string>
            )[r.item.settings.hands] ?? r.item.settings.hands}
          </small>
          <small>
            {(
              {
                wait: "等音",
                flow: "连续",
                recital: "完整演奏",
                memory: "背谱",
              } as Record<string, string>
            )[r.item.settings.mode ?? "wait"] ?? r.item.settings.mode}{" "}
            · {edit.speedPercent}% · 连续 {edit.passes} 轮达标，正确率 ≥{" "}
            {edit.accuracy}%
            {r.item.goal.expression &&
              `、${expressionGoalText(r.item.goal.expression)}`}
            {edit.onTime !== null ? `、准时率 ≥ ${edit.onTime}%` : ""}
            {r.item.settings.metronome ? "、节拍器开启" : ""}
            ；打开时检查曲目版本与练习范围
          </small>
        </span>
      </label>
      <details className="weak-practice-reason">
        <summary>查看建议依据与练习要求</summary>
        <p>{r.item.notes}</p>
        <p>
          最近一轮相关成绩：
          {new Date(r.sourceAt).toLocaleString("zh-CN")}
        </p>
      </details>
      <details className="weak-practice-edit">
        <summary>调整加入计划的条件</summary>
        <div>
          <label>
            练习速度
            <input
              type="number"
              min={25}
              max={200}
              step={5}
              disabled={disabled}
              value={edit.speedPercent}
              onChange={(e) =>
                changed({ speedPercent: Number(e.target.value) })
              }
            />
            %
          </label>
          <label>
            达标轮数
            <input
              type="number"
              min={1}
              max={100}
              disabled={disabled}
              value={edit.passes}
              onChange={(e) => changed({ passes: Number(e.target.value) })}
            />
          </label>
          <label>
            正确率门槛
            <input
              type="number"
              min={50}
              max={100}
              disabled={disabled}
              value={edit.accuracy}
              onChange={(e) => changed({ accuracy: Number(e.target.value) })}
            />
            %
          </label>
          {r.item.settings.mode !== "wait" && (
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={edit.onTime !== null}
                onChange={(e) =>
                  changed({
                    onTime: e.target.checked ? 80 : null,
                  })
                }
              />
              准时率门槛
              {edit.onTime !== null && (
                <>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    disabled={disabled}
                    value={edit.onTime ?? 80}
                    onChange={(e) =>
                      changed({ onTime: Number(e.target.value) })
                    }
                  />
                  %
                </>
              )}
            </label>
          )}
          <button
            type="button"
            disabled={disabled || !modified}
            onClick={reset}
          >
            恢复建议值
          </button>
        </div>
      </details>
    </div>
  );
}
