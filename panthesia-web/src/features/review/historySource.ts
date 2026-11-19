import { api } from "../../api";
import type {
  HistoryActionKind,
  HistorySource,
  HistoryReplayRequest,
  HistoryPrepared,
} from "../../engine/commands.generated";
export type { HistorySource };
export type { HistoryPrepared };
export type HistorySourceIssue =
  "sourceChanged" | "performanceChanged" | "sourceMissing";
export class HistorySourceError extends Error {
  constructor(
    message: string,
    readonly issue: HistorySourceIssue,
  ) {
    super(message);
  }
}
export function historyFailure(failure: unknown): Error {
  if (failure instanceof HistorySourceError) return failure;
  const message = failure instanceof Error ? failure.message : String(failure);
  const issues: Record<string, HistorySourceIssue> = {
    "history-source-changed:": "sourceChanged",
    "history-performance-changed:": "performanceChanged",
    "history-source-invalid:": "sourceMissing",
  };
  for (const [prefix, issue] of Object.entries(issues)) {
    const at = message.indexOf(prefix);
    if (at >= 0)
      return new HistorySourceError(message.slice(at + prefix.length), issue);
  }
  return failure instanceof Error ? failure : new Error(message);
}
const revision = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
export function validHistorySource(value: unknown): value is HistorySource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.contentId === "string" &&
    source.contentId.length > 0 &&
    source.contentId.length <= 160 &&
    typeof source.id === "string" &&
    source.id.length > 0 &&
    source.id.length <= 512 &&
    revision(source.conditionsRevision) &&
    (source.performanceRevision == null || revision(source.performanceRevision))
  );
}
export function requireHistorySource(
  value: HistorySource | null | undefined,
  contentId: string,
  id: string,
  performance = false,
): HistorySource {
  if (
    !validHistorySource(value) ||
    value.contentId !== contentId ||
    value.id !== id ||
    (performance && !revision(value.performanceRevision))
  )
    throw new HistorySourceError(
      "这条演奏的版本信息尚未读到，请重新读取原记录。",
      "sourceMissing",
    );
  return {
    contentId,
    id,
    conditionsRevision: value.conditionsRevision,
    performanceRevision: value.performanceRevision ?? null,
  };
}
export function sameHistorySource(
  left: HistorySource | null | undefined,
  right: HistorySource | null | undefined,
) {
  return (
    !!left &&
    !!right &&
    left.contentId === right.contentId &&
    left.id === right.id &&
    left.conditionsRevision === right.conditionsRevision &&
    (left.performanceRevision ?? null) === (right.performanceRevision ?? null)
  );
}
export function rangeSourceChanged(
  left: HistorySource | null | undefined,
  right: HistorySource | null | undefined,
) {
  return (
    !!right?.performanceRevision &&
    (!left?.performanceRevision ||
      left.contentId !== right.contentId ||
      left.id !== right.id ||
      left.performanceRevision !== right.performanceRevision)
  );
}
export function clipHistorySource(
  clip: { performanceRevision?: string },
  current: HistorySource | undefined,
): HistorySource | undefined {
  return current
    ? { ...current, performanceRevision: clip.performanceRevision ?? null }
    : undefined;
}
export function requireHistoryReview(
  value:
    import("../../engine/commands.generated").HistoryScoreReview | undefined,
  prepared: HistoryPrepared,
) {
  if (
    !value ||
    value.contentId !== prepared.contentId ||
    value.historyId !== prepared.source.id ||
    value.scoreRevision !== prepared.scoreRevision ||
    !validHistorySource(value.source) ||
    value.source.contentId !== value.contentId ||
    value.source.id !== value.historyId ||
    !revision(value.source.performanceRevision) ||
    (prepared.source.performanceRevision &&
      value.source.performanceRevision !==
        prepared.source.performanceRevision) ||
    !Number.isFinite(value.duration) ||
    value.duration < 0 ||
    !Array.isArray(value.notes)
  )
    throw new Error("谱面批阅结果与这次演奏不一致，请重新读取原记录。");
  return value;
}
export function requireHistoryScoreTarget(
  value:
    import("../../historyScoreFocus").HistoryScoreTarget | null | undefined,
  prepared: HistoryPrepared,
  reference: number,
) {
  if (
    !value ||
    value.contentId !== prepared.contentId ||
    value.historyId !== prepared.source.id ||
    value.scoreRevision !== prepared.scoreRevision ||
    value.reference !== reference ||
    ![value.track, value.index, value.pitch, value.measure].every(
      Number.isSafeInteger,
    ) ||
    value.track < 0 ||
    value.index < 0 ||
    value.pitch < 0 ||
    value.pitch > 127 ||
    value.measure < 1
  )
    throw new Error(
      "选段已经准备，所选参考音暂时无法在当前谱面上定位。可返回练习核对。",
    );
  return value;
}
export function requireHistoryPaperTarget(
  value:
    | import("../../engine/commands.generated").HistoryPaperTarget
    | null
    | undefined,
  prepared: HistoryPrepared,
  reference: number,
  unique = false,
) {
  if (
    !value ||
    value.contentId !== prepared.contentId ||
    value.historyId !== prepared.source.id ||
    value.reference !== reference ||
    ![
      value.track,
      value.pitch,
      value.measure,
      value.startMeasure,
      value.endMeasure,
    ].every(Number.isSafeInteger) ||
    value.track < 0 ||
    value.pitch < 0 ||
    value.pitch > 127 ||
    value.startMeasure < 1 ||
    value.startMeasure > value.measure ||
    value.endMeasure < value.measure ||
    !Number.isFinite(value.songTime) ||
    value.songTime < 0 ||
    (value.index != null &&
      (!Number.isSafeInteger(value.index) || value.index < 0)) ||
    (unique && value.index == null)
  )
    throw new Error(
      unique
        ? "选段已准备，这处参考音尚无唯一的原曲位置。可进入当前练习后人工定位。"
        : "选段已准备，纸谱定位资料尚未核对。可进入当前练习继续。",
    );
  return value;
}
export const historySourceApi = {
  async perform<T>(
    engineId: string | undefined,
    source: HistorySource,
    action: HistoryActionKind,
  ): Promise<T & { historyPrepared: HistoryPrepared }> {
    const captured = requireHistorySource(
      source,
      source.contentId,
      source.id,
      action.kind === "practiceRange",
    );
    const result = await api
      .commandForEngine<T & { historyPrepared: HistoryPrepared }>(engineId, {
        type: "performHistoryAction",
        request: { source: captured, action },
      })
      .catch((failure) => {
        throw historyFailure(failure);
      });
    if (
      !result?.historyPrepared ||
      !sameHistorySource(result.historyPrepared.source, captured) ||
      result.historyPrepared.contentId !== captured.contentId ||
      !Number.isSafeInteger(result.historyPrepared.scoreRevision) ||
      result.historyPrepared.scoreRevision < 0
    )
      throw new Error("历史操作回复与原请求不一致，请读取当前练习核对结果。");
    return result;
  },
  replay(engineId: string, request: HistoryReplayRequest) {
    return api
      .commandForEngine<import("../../engine/commands.generated").DemoState>(
        engineId,
        {
          type: "playHistorySource",
          request: {
            ...request,
            source: requireHistorySource(
              request.source,
              request.source.contentId,
              request.source.id,
              true,
            ),
          },
        },
      )
      .catch((failure) => {
        throw historyFailure(failure);
      });
  },
};
