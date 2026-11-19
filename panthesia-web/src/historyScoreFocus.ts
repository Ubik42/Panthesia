export type HistoryMeasureSpan =
  import("./engine/commands.generated").PerformanceMeasureSpan;
export type HistoryScoreTarget =
  import("./engine/commands.generated").HistoryScoreTarget;
export type HistoryScoreFocus = HistoryScoreTarget & { request: string };

type ReviewExpression = "velocityDifference" | "velocityLimit" | "timingKind";
export type HistoryReviewNote = Omit<
  import("./engine/commands.generated").HistoryReviewNote,
  ReviewExpression
> &
  Partial<
    Pick<
      import("./engine/commands.generated").HistoryReviewNote,
      ReviewExpression
    >
  > & {
    sourceTitle?: string;
    sourceContentId?: string;
    sourceHistoryId?: string;
    sourceReference?: number;
  };
export type HistoryScoreReview =
  import("./engine/commands.generated").HistoryScoreReview;
export const historyGradeName = (kind: string) =>
  (
    ({
      onTime: "准时",
      early: "偏早",
      late: "偏晚",
      missed: "漏音",
      velocityHigh: "逐音力度超限",
      pending: "未计分",
      approximate: "近似对照",
    }) as Record<string, string>
  )[kind] ?? kind;

export const historyProblemName = (
  note: Pick<
    HistoryReviewNote,
    "kind" | "timingKind" | "velocityDifference" | "velocityLimit"
  >,
) =>
  note.kind === "velocityHigh"
    ? `逐音力度超限${note.velocityDifference != null ? `（差 ${note.velocityDifference}，上限 ${note.velocityLimit}）` : ""}${note.timingKind && ["early", "late"].includes(note.timingKind) ? ` · 同时${historyGradeName(note.timingKind)}` : ""}`
    : historyGradeName(note.kind);
