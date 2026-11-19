import type {
  HistoryEntry as Entry,
  HistoryDetail as Detail,
} from "./historyTypes";
import { expressionGoalText } from "../../ExpressionGoalControl";
export const modeName = (m: string | null) =>
  ({
    wait: "等音",
    flow: "连续",
    listen: "聆听",
    recital: "完整演奏",
    memory: "背谱",
  })[m ?? ""] ?? "未记录模式";
export const handName = (h: string) =>
  ({
    Left: "左手",
    Right: "右手",
    Both: "双手",
    Custom: "自定义声部",
    Unspecified: "未记录手别",
  })[h] ?? h;
export const accuracy = (s: {
  matched_notes: number;
  wrong_notes: number;
  missed_notes: number;
}) => {
  const n = s.matched_notes + s.wrong_notes + s.missed_notes;
  return n ? s.matched_notes / n : null;
};
export const percent = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;
export const coverageName = (e: Entry) =>
  e.coverage && e.coverage.target > 0
    ? `${e.coverage.judged >= e.coverage.target ? "已完成" : "部分结果"} · ${e.coverage.judged}/${e.coverage.target} 个目标音符`
    : "完成范围未记录";
export const rangeName = (e: Entry) =>
  e.range
    ? `第 ${e.range[0]}–${e.range[1]} 小节${e.exactPassage ? " · 原位置" : ""}`
    : "全曲";
export const date = (n: number) =>
  new Date(n).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const delta = (a: number | null, b: number | null) =>
  a === null || b === null
    ? "—"
    : `${a >= b ? "+" : ""}${Math.round((a - b) * 100)} 个百分点`;
export const trackModeName = (mode: string) =>
  ({ Human: "自己弹", Auto: "伴奏", Mute: "静音" })[mode] ?? mode;
export const partName = (part: string) =>
  ({ LeftHand: "左手", RightHand: "右手", Other: "其他" })[part] ?? part;
function exerciseName(
  spec: NonNullable<
    NonNullable<Detail["comparison"]["conditions"]>["exerciseSpec"]
  >,
) {
  const key =
    ["C", "升 C", "D", "降 E", "E", "F", "升 F", "G", "降 A", "A", "降 B", "B"][
      spec.tonic
    ] ?? `音级 ${spec.tonic}`;
  const kind =
    { Scale: "音阶", Arpeggio: "琶音", PrimaryChords: "主和弦" }[
      spec.pattern
    ] ?? spec.pattern;
  const direction =
    { Ascending: "上行", Descending: "下行", UpAndDown: "上下行" }[
      spec.direction
    ] ?? spec.direction;
  const hands =
    { Right: "右手", Left: "左手", Both: "双手" }[spec.hands] ?? spec.hands;
  const minor =
    spec.tonality === "Minor"
      ? `、${{ Natural: "自然", Harmonic: "和声", Melodic: "旋律" }[spec.minor_form ?? "Natural"] ?? spec.minor_form}小调`
      : "大调";
  return `${key}${minor} ${kind}；${direction}；${hands}；${spec.octaves} 个八度；${spec.repetitions} 次；${spec.tempo_bpm} BPM`;
}
export function ComparisonConditions({ detail }: { detail: Detail }) {
  const c = detail.comparison.conditions;
  if (!c) return null;
  const parts = Object.entries(c.parts ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  return (
    <details className="history-comparison-conditions">
      <summary>查看本次比较条件</summary>
      <p className="parameter-help">
        软件只比较这首曲目中更早保存、且以下条件相同的成绩。曲名和文件路径可以改变；曲目内容必须相同。
      </p>
      <dl>
        <div>
          <dt>曲目内容</dt>
          <dd title={detail.contentId}>
            已按文件内容核对（{detail.contentId.slice(0, 12)}…）
          </dd>
        </div>
        <div>
          <dt>小节与练习音符</dt>
          <dd>
            {c.grid ? `小节版本 ${c.grid}` : "小节版本未记录"}；
            {c.scope ? `练习音符版本 ${c.scope}` : "练习音符版本未记录"}
          </dd>
        </div>
        <div>
          <dt>范围与弹法</dt>
          <dd>
            {c.range
              ? (c.passageLocation ??
                `第 ${c.range[0]}–${c.range[1]} 小节${c.passageBounds ? "（准确位置已保存；原文件或音乐网格暂不能核对）" : "（旧记录只保留小节）"}`)
              : "全曲"}
            ；{modeName(c.mode)}；{handName(c.hands)}；逐音分手{" "}
            {c.assignedHands || "未记录"}
          </dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>
            {Math.round(c.speed * 100)}%；
            {c.effectiveTempoBpm == null
              ? "有效速度未记录"
              : `${c.effectiveTempoBpm} BPM`}
          </dd>
        </div>
        <div>
          <dt>判断范围</dt>
          <dd>
            {c.targetNotes == null || c.judgedNotes == null
              ? "目标音符与判断数未记录"
              : `${c.judgedNotes}/${c.targetNotes} 个目标音符已判断`}
          </dd>
        </div>
        <div>
          <dt>音轨安排</dt>
          <dd>
            {c.tracks?.length
              ? c.tracks
                  .map(
                    (t) =>
                      `音轨 ${t.track_id + 1} ${trackModeName(t.mode)}${t.visible ? "、显示" : "、隐藏"}`,
                  )
                  .join("；")
              : "未记录"}
          </dd>
        </div>
        <div>
          <dt>音轨分手</dt>
          <dd>
            {parts.length
              ? parts
                  .map(
                    ([track, part]) =>
                      `音轨 ${Number(track) + 1} ${partName(part)}`,
                  )
                  .join("；")
              : "没有单独指定的音轨分手"}
          </dd>
        </div>
        <div>
          <dt>练习来源</dt>
          <dd>
            {c.exerciseSpec == null
              ? "导入曲目"
              : `生成的技术练习：${exerciseName(c.exerciseSpec)}`}
          </dd>
        </div>
        <div>
          <dt>预备与节拍</dt>
          <dd>
            预备 {c.countIn ?? "未记录"} 小节；节拍器{" "}
            {c.metronome == null ? "未记录" : c.metronome ? "开" : "关"}
          </dd>
        </div>
        <div>
          <dt>设备校准</dt>
          <dd>
            输入 {c.inputLatencyMs ?? "未记录"} ms；踏板{" "}
            {c.pedalLatencyMs ?? "未记录"} ms
            {c.pedalLatencySource === "legacyInputLatency"
              ? "（旧记录沿用输入校准值）"
              : ""}
          </dd>
        </div>
        <div>
          <dt>重复与自适应</dt>
          <dd>
            {c.rounds == null
              ? "轮数未记录"
              : c.rounds === 0
                ? "不限轮数"
                : `${c.rounds} 轮`}
            ；自适应 {c.adaptive == null ? "未记录" : c.adaptive ? "开" : "关"}
          </dd>
        </div>
        <div>
          <dt>力度与踏板目标</dt>
          <dd>
            {c.expressionGoal == null
              ? "无专项要求"
              : expressionGoalText({
                  velocityDifference: c.expressionGoal.velocity_difference,
                  noteVelocityDifference:
                    c.expressionGoal.note_velocity_difference,
                  notePedalMismatchCount:
                    c.expressionGoal.note_pedal_mismatch_count,
                  contourPercent: c.expressionGoal.contour_percent,
                  pedalOffsetMs: c.expressionGoal.pedal_offset_ms,
                })}
          </dd>
        </div>
      </dl>
      {c.range && !c.passageBounds && (
        <p className="parameter-help">
          这条旧记录只保存了起止小节。软件无法确认两次练习的拍内起止位置是否相同；同小节的历史比较只可按小节参考。
        </p>
      )}
      {!c.complete && (
        <p className="parameter-help">
          这条记录缺少可确认的完整条件或有效判断，因此软件不会把它当作同条件比较的依据。
        </p>
      )}
    </details>
  );
}
export function Trend({ detail }: { detail: Detail }) {
  const points = [...detail.comparison.recent, detail];
  const judged = points
    .map((e, i) => ({
      entry: e,
      x: 12 + (i * 296) / Math.max(1, points.length - 1),
      value: accuracy(e.score),
    }))
    .filter((p) => p.value !== null);
  if (judged.length < 2) return null;
  return (
    <figure className="history-trend">
      <svg
        viewBox="0 0 320 90"
        role="img"
        aria-label={`最近 ${points.length} 次同条件正确率走势`}
      >
        <path d="M12 8H308M12 44H308M12 80H308" className="trend-grid" />
        <polyline
          points={judged.map((p) => `${p.x},${80 - p.value! * 72}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {judged.map((p) => (
          <circle
            key={p.entry.id}
            cx={p.x}
            cy={80 - p.value! * 72}
            r={p.entry.id === detail.id ? 4 : 2.5}
          >
            <title>
              {date(p.entry.recordedAt)} · {percent(p.value)}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        同曲目、选段、模式、手别、速度、评分范围及完成量；仅比较此前记录。
      </figcaption>
    </figure>
  );
}
