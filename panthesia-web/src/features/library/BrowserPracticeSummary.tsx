import type { CollectionSong } from "../../api";
import type { LibraryAttempt } from "../../engine/sessionTypes";

const hands: Record<string, string> = {
  both: "双手",
  left: "左手",
  right: "右手",
  custom: "自选声部",
  other: "自选声部",
};
const modes: Record<string, string> = {
  wait: "等音",
  flow: "连续",
  recital: "完整演奏",
  memory: "背谱",
};
export const practiceDate = (at: number) =>
  new Date(at).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
export const attemptConditions = (attempt: LibraryAttempt) =>
  [
    hands[attempt.hands] ?? "原声部",
    modes[attempt.mode ?? ""] ?? "旧记录",
    attempt.bpm ? `${attempt.bpm} BPM` : null,
  ]
    .filter(Boolean)
    .join(" · ");
const rangeLabel = (attempt: LibraryAttempt) =>
  attempt.range
    ? attempt.range[0] === attempt.range[1]
      ? `第 ${attempt.range[0]} 小节 · 选段`
      : `第 ${attempt.range[0]}–${attempt.range[1]} 小节 · 选段`
    : attempt.kind === "exercise"
      ? "技术练习"
      : "整曲范围";

export function BrowserPracticeSummary({
  record,
  disabled,
  resume,
}: {
  record: CollectionSong | undefined;
  disabled: boolean;
  resume: (attempt: LibraryAttempt) => void;
}) {
  const last = record?.practice?.last,
    whole = record?.practice?.whole;
  if (!last)
    return (
      <section
        className="browser-practice-summary is-new"
        aria-label="所选演奏版本的练习记录"
      >
        <strong>从这里开始练习</strong>
        <p>这个演奏版本还没有已保存的练习记录。</p>
      </section>
    );
  return (
    <section
      className="browser-practice-summary"
      aria-label="所选演奏版本的练习记录"
    >
      <div className="browser-practice-heading">
        <strong>上次练习</strong>
        <time dateTime={new Date(last.recordedAt).toISOString()}>
          {practiceDate(last.recordedAt)}
        </time>
      </div>
      <p className="browser-practice-conditions">
        {rangeLabel(last)}
        {last.errorRestart ? " · 错误重开" : ""}
        <br />
        {attemptConditions(last)}
      </p>
      <div className="browser-practice-numbers">
        <span>
          命中率{" "}
          <b>{last.accuracy == null ? "—" : `${Math.round(last.accuracy)}%`}</b>
        </span>
        {last.target != null && last.target > 0 && (
          <span>
            已判定{" "}
            <b>
              {Math.min(last.judged ?? 0, last.target)} / {last.target} 音
            </b>
          </span>
        )}
      </div>
      <button
        className="browser-continue-practice"
        disabled={disabled || !last.restorable || !record?.available}
        onClick={() => resume(last)}
      >
        按上次条件继续
      </button>
      {!last.restorable && (
        <p className="browser-practice-note">
          这条旧记录缺少完整条件，可直接开始演奏。
        </p>
      )}
      {record?.available === false && (
        <p className="browser-practice-note">
          原文件位置暂不可用，请先在文件位置中修复。
        </p>
      )}
      {!record?.generated && (
        <div className="browser-whole-evidence">
          <strong>
            {whole ? "近 90 天有完整整曲记录" : "近 90 天尚无完整整曲记录"}
          </strong>
          {whole ? (
            <p>
              {attemptConditions(whole)}
              <br />
              最近命中率 {Math.round(whole.accuracy ?? 0)}% · 同条件{" "}
              {record?.practice?.comparableWholeCount ?? 0} 次
            </p>
          ) : (
            <p>在连续、完整演奏或背谱模式下完整弹完所选声部后显示。</p>
          )}
        </div>
      )}
      {record?.review?.due && (
        <p className="browser-practice-due">
          {record.generated
            ? "技术练习已到复习时间"
            : record.review.sourceIsWholeSong
              ? "整曲已到复习时间"
              : "有选段可复习"}
        </p>
      )}
    </section>
  );
}
