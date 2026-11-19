import type { LadderPreset } from "../../api";

export function RoutineLadderGoalSummary({
  preset,
}: {
  preset: LadderPreset | undefined;
}) {
  if (!preset)
    return (
      <p className="parameter-help">
        重新读取练习来源后，可查看所选速度阶梯的目标。
      </p>
    );
  const plan = preset.plan;
  return (
    <section className="routine-ladder-goal" aria-label="速度阶梯达标目标">
      <h4>速度阶梯目标</h4>
      <p>
        {preset.name} · 第 {preset.start}–{preset.end} 小节
      </p>
      <dl>
        <div>
          <dt>速度范围</dt>
          <dd>
            {plan.startPercent}% → {plan.targetPercent}%
          </dd>
        </div>
        <div>
          <dt>每级速度增量</dt>
          <dd>{plan.stepPercent} 个百分点</dd>
        </div>
        <div>
          <dt>每级达标要求</dt>
          <dd>连续 {plan.passesRequired} 次</dd>
        </div>
        <div>
          <dt>正确率至少</dt>
          <dd>{plan.accuracyPercent}%</dd>
        </div>
        {plan.onTimePercent != null && (
          <div>
            <dt>准时率至少</dt>
            <dd>{plan.onTimePercent}%</dd>
          </div>
        )}
        <div>
          <dt>本次轮数上限</dt>
          <dd>{plan.attemptLimit} 轮</dd>
        </div>
      </dl>
      <p className="parameter-help">
        目标随所选阶梯保存，达到目标速度后本项才完成。切回普通练习来源后，可继续编辑此前输入的次数和百分比。
      </p>
    </section>
  );
}
