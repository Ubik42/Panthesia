import { createPreparationSession } from "../activity/preparationSession";
import { api } from "../../api";
import {
  HistoryOperationPhaseValues,
  type HistoryActionKind,
  type HistoryOperationPhase,
  type HistoryOperationReceipt,
  type HistoryOperationRequest,
  type HistorySource,
} from "../../engine/commands.generated";
import {
  requireHistorySource,
  sameHistorySource,
  validHistorySource,
} from "./historySource";

export type HistoryDestination =
  "practice" | "review" | "score" | "paper" | "finger";
export interface HistoryIntent {
  request: HistoryOperationRequest;
  title: string;
  destination: HistoryDestination;
  disposition: "pending" | "kept" | "presented";
  lastPhase: HistoryOperationPhase | "unknown";
  error: string;
  releasePending?: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 4096): value is string =>
  typeof value === "string" && value.length <= limit;
const integer = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max;
const phase = (value: unknown): value is HistoryOperationPhase =>
  HistoryOperationPhaseValues.some((phase) => phase === value);
const actionValid = (value: unknown): value is HistoryActionKind =>
  object(value) &&
  ((value.kind === "open" && typeof value.restore === "boolean") ||
    value.kind === "scoreReview" ||
    (value.kind === "practiceRange" &&
      integer(value.reference, 50000) &&
      integer(value.before, 8) &&
      integer(value.after, 8)));
function validRequest(value: unknown): value is HistoryOperationRequest {
  return (
    object(value) &&
    text(value.engineId, 160) &&
    value.engineId.length > 0 &&
    typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{8,96}$/.test(value.id) &&
    integer(value.createdAtMs) &&
    object(value.origin) &&
    (value.origin.contentId === null || text(value.origin.contentId, 160)) &&
    integer(value.origin.scoreRevision) &&
    integer(value.origin.midiEvents) &&
    text(value.origin.status, 32) &&
    object(value.operation) &&
    validHistorySource(value.operation.source) &&
    actionValid(value.operation.action) &&
    (value.measure == null ||
      (integer(value.measure, 100000) &&
        value.measure > 0 &&
        value.operation.action.kind === "open"))
  );
}
function validIntent(value: unknown): value is HistoryIntent {
  return (
    object(value) &&
    validRequest(value.request) &&
    text(value.title) &&
    ["practice", "review", "score", "paper", "finger"].includes(
      String(value.destination),
    ) &&
    ["pending", "kept", "presented"].includes(String(value.disposition)) &&
    (value.lastPhase === "unknown" || phase(value.lastPhase)) &&
    text(value.error) &&
    (value.releasePending === undefined ||
      typeof value.releasePending === "boolean")
  );
}
const actionKey = (action: HistoryActionKind) =>
  action.kind === "open"
    ? [action.kind, action.restore]
    : action.kind === "practiceRange"
      ? [action.kind, action.reference, action.before, action.after]
      : [action.kind];
function sameRequest(
  left: HistoryOperationRequest,
  right: HistoryOperationRequest,
) {
  return (
    left.id === right.id &&
    left.engineId === right.engineId &&
    left.createdAtMs === right.createdAtMs &&
    (left.measure ?? null) === (right.measure ?? null) &&
    left.origin.contentId === right.origin.contentId &&
    left.origin.scoreRevision === right.origin.scoreRevision &&
    left.origin.midiEvents === right.origin.midiEvents &&
    left.origin.status === right.origin.status &&
    sameHistorySource(left.operation.source, right.operation.source) &&
    JSON.stringify(actionKey(left.operation.action)) ===
      JSON.stringify(actionKey(right.operation.action))
  );
}
function checkedReceipt(value: HistoryOperationReceipt, intent: HistoryIntent) {
  if (
    !value ||
    !validRequest(value.request) ||
    !sameRequest(value.request, intent.request) ||
    !phase(value.phase) ||
    typeof value.cancellable !== "boolean" ||
    typeof value.hasResult !== "boolean" ||
    !text(value.stage, 160) ||
    (value.phase === "done" && !value.hasResult) ||
    (value.result &&
      (!value.result.historyPrepared ||
        !sameHistorySource(
          value.result.historyPrepared.source,
          intent.request.operation.source,
        ) ||
        value.result.historyPrepared.contentId !==
          intent.request.operation.source.contentId ||
        !integer(value.result.historyPrepared.scoreRevision)))
  )
    throw new Error("历史操作回执与原请求不一致，请核对当前练习和原演奏记录。");
  return value;
}
function createStore() {
  const base = createPreparationSession<
    HistoryOperationRequest,
    HistoryIntent,
    HistoryOperationReceipt
  >({
    key: "neothesia.history-operations.v1",
    validIntent,
    checkReceipt: checkedReceipt,
    subject: (intent) =>
      JSON.stringify([
        intent.request.operation.source.contentId,
        intent.request.operation.source.id,
      ]),
    start: (request) =>
      api.commandForEngine(request.engineId, {
        type: "startHistoryOperation",
        request,
      }),
    read: (engineId, id, metadataOnly) =>
      api.commandForEngine(engineId, {
        type: "readHistoryOperation",
        id,
        metadata_only: metadataOnly,
      }),
    cancel: (engineId, id) =>
      api.commandForEngine(engineId, { type: "cancelHistoryOperation", id }),
    release: (engineId, id) =>
      api.commandForEngine(engineId, { type: "releaseHistoryOperation", id }),
  });
  return {
    ...base,
    async create(
      engineId: string | undefined,
      source: HistorySource,
      action: HistoryActionKind,
      destination: HistoryDestination,
      title: string,
      measure?: number,
      canAdmit?: () => boolean,
    ) {
      const current = await api.state();
      if (canAdmit && !canAdmit())
        throw new Error("已离开原演奏记录，这次准备尚未提交。");
      const origin = engineId ?? current.stateOrder?.engineId;
      if (!origin || current.stateOrder?.engineId !== origin)
        throw new Error("练习室连接已变化，请重新读取后打开历史练习。");
      return base.add(
        {
          request: {
            engineId: origin,
            id: `history-${crypto.randomUUID()}`,
            createdAtMs: Date.now(),
            origin: {
              contentId: current.contentId ?? null,
              scoreRevision: current.scoreRevision ?? 0,
              midiEvents: current.midiEvents,
              status: current.status,
            },
            operation: {
              source: requireHistorySource(
                source,
                source.contentId,
                source.id,
                action.kind === "practiceRange",
              ),
              action,
            },
            measure: measure ?? null,
          },
          title,
          destination,
          disposition: "pending",
          lastPhase: "unknown",
          error: "",
        },
        canAdmit,
      );
    },
  };
}
let store: ReturnType<typeof createStore> | undefined;
export const getHistoryOperations = () => (store ??= createStore());
export const historyIntentLabel = (intent: HistoryIntent) =>
  intent.destination === "review"
    ? "谱面批阅"
    : intent.request.operation.action.kind === "practiceRange"
      ? "选段重练"
      : "历史练习";
export const historyOperationPending = () => {
  const state = getHistoryOperations().getSnapshot();
  return (
    state.storageError ||
    (state.entries.some(
      (intent) =>
        intent.disposition !== "presented" &&
        state.receipts[intent.request.id]?.warning,
    )
      ? "历史操作的结果回执尚未写入，可先接续结果或复制操作记录。"
      : null)
  );
};
