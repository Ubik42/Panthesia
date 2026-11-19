import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type Snapshot } from "../../api";
import type {
  HistoryScoreReview,
  HistoryScoreTarget,
} from "../../historyScoreFocus";
import type { HistoryDetail, HistoryPaperTarget } from "./historyTypes";
import {
  getHistoryOperations,
  historyIntentLabel,
  type HistoryIntent,
  type HistoryDestination,
} from "./historyOperationStore";
import {
  historyFailure,
  HistorySourceError,
  requireHistorySource,
  requireHistoryReview,
  requireHistoryScoreTarget,
  requireHistoryPaperTarget,
  type HistorySource,
  type HistorySourceIssue,
} from "./historySource";
import type { HistoryActionKind } from "../../engine/commands.generated";

type Stage = "opening" | "reading" | "destination";
/** A persistent intent owns preparation. The hook owns only the current destination. */
export function useHistoryActions({
  engineId,
  detail,
  blocked,
  changed,
  close,
  review,
  paper,
  finger,
  score,
}: {
  engineId?: string;
  detail: HistoryDetail | null;
  blocked: boolean;
  changed: () => Promise<Snapshot | void>;
  close: () => void;
  review: (data: HistoryScoreReview) => void;
  paper: (focus: HistoryPaperTarget) => void;
  finger: (focus: HistoryPaperTarget) => Promise<void>;
  score: (focus: HistoryScoreTarget) => void;
}) {
  const operations = getHistoryOperations();
  const state = useSyncExternalStore(
    operations.subscribe,
    operations.getSnapshot,
    operations.getSnapshot,
  );
  const pending = [...state.entries]
    .reverse()
    .find(
      (entry) =>
        entry.disposition === "pending" &&
        entry.request.operation.source.contentId === detail?.contentId &&
        entry.request.operation.source.id === detail?.id,
    );
  const receipt = pending ? state.receipts[pending.request.id] : undefined;
  const [localBusy, setLocalBusy] = useState(false),
    [error, setError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [sourceIssue, setSourceIssue] = useState<HistorySourceIssue | null>(
    null,
  );
  const [stage, setStage] = useState<Stage>("opening");
  const [pendingNotice, setPendingNotice] = useState<
    "conditions" | "destination" | null
  >(null);
  const working = useRef(false),
    alive = useRef(true),
    connection = useRef(engineId),
    selected = useRef(""),
    epoch = useRef(0);
  connection.current = engineId;
  selected.current = JSON.stringify([detail?.contentId, detail?.id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const report = (failure?: unknown) => {
    if (!alive.current) return;
    const value = failure == null ? null : historyFailure(failure);
    setError(value?.message ?? "");
    setSourceIssue(value instanceof HistorySourceError ? value.issue : null);
  };
  useEffect(() => {
    report();
    setPendingNotice(null);
  }, [detail?.contentId, detail?.id, engineId]);
  useEffect(() => {
    if (
      !pending ||
      !engineId ||
      receipt ||
      state.working.includes(pending.request.id)
    )
      return;
    const request =
      pending.request.engineId === engineId
        ? operations.follow(pending.request.id, engineId)
        : operations.inspect(pending.request.id, engineId);
    void request.catch(() => {});
  }, [pending?.request.id, engineId]);
  const busy =
    localBusy || (!!pending && state.working.includes(pending.request.id));
  const previousEngine =
    !!pending && !!engineId && pending.request.engineId !== engineId;
  const present = async (intent: HistoryIntent, enterOnly = false) => {
    const retained = () =>
      operations
        .getSnapshot()
        .entries.some(
          (entry) =>
            entry.request.id === intent.request.id &&
            entry.disposition === "pending",
        );
    if (!retained()) return;
    const origin = engineId ?? (await api.state()).stateOrder?.engineId;
    if (!origin || intent.request.engineId !== origin)
      throw new Error(
        "原操作来自上次连接。可保留原结果，返回当前练习或重新打开原演奏。",
      );
    const selection = selected.current;
    const currentIntent = () =>
      alive.current &&
      connection.current === engineId &&
      selected.current === selection &&
      retained();
    setStage("reading");
    const known = await operations.follow(intent.request.id, origin);
    if (!currentIntent()) return;
    if (!known)
      throw new Error(
        "原请求的回执暂未读到。可以再次读取，或按原编号重试准备。",
      );
    if (known.phase !== "done" || !known.result)
      throw new Error(
        known.error ||
          (known.phase === "released"
            ? "这次操作已经接续完成，当前练习继续保留。可结束此处的旧提示。"
            : known.phase === "cancelled"
              ? "这次历史准备已取消，当前练习继续保留。"
              : ["queued", "running", "committing"].includes(known.phase)
                ? "原操作仍在后台处理，可稍后读取结果。"
                : "原操作结果待核对，请先返回当前练习。"),
      );
    const result = known.result,
      prepared = result.historyPrepared;
    const snapshot = (await changed()) ?? (await api.state());
    if (!currentIntent()) return;
    if (
      snapshot.stateOrder?.engineId !== origin ||
      snapshot.contentId !== prepared.contentId ||
      snapshot.scoreRevision !== prepared.scoreRevision
    )
      throw new Error(
        "当前练习已与原操作结果不同。原结果继续保留，可返回练习核对后重新打开原演奏。",
      );
    if (!enterOnly && result.restoreWarning) {
      setPendingNotice("conditions");
      throw new Error(result.restoreWarning);
    }
    setStage("destination");
    if (!enterOnly) {
      const action = intent.request.operation.action;
      try {
        if (intent.destination === "review")
          review(
            requireHistoryReview(result.scoreReview ?? undefined, prepared),
          );
        if (action.kind === "practiceRange") {
          if (intent.destination === "paper")
            paper(
              requireHistoryPaperTarget(
                result.paperFocus,
                prepared,
                action.reference,
              ),
            );
          if (intent.destination === "finger")
            await finger(
              requireHistoryPaperTarget(
                result.paperFocus,
                prepared,
                action.reference,
                true,
              ),
            );
          if (intent.destination === "score")
            score(
              requireHistoryScoreTarget(
                result.scoreFocus,
                prepared,
                action.reference,
              ),
            );
        }
      } catch (failure) {
        setPendingNotice("destination");
        throw failure;
      }
    }
    if (!currentIntent()) return;
    operations.present(intent.request.id);
    setPendingNotice(null);
    close();
  };
  const execute = async (job: () => Promise<void>) => {
    if (working.current || blocked) return;
    working.current = true;
    setLocalBusy(true);
    report();
    const admitted = ++epoch.current;
    try {
      await job();
    } catch (failure) {
      if (epoch.current === admitted) report(failure);
    } finally {
      if (epoch.current === admitted) {
        working.current = false;
        if (alive.current) setLocalBusy(false);
      }
    }
  };
  const prepare = async (
    source: HistorySource | undefined,
    action: HistoryActionKind,
    destination: HistoryDestination,
    measure?: number,
  ) => {
    if (!detail || pending) return;
    const original = detail,
      selection = selected.current,
      origin = engineId;
    await execute(async () => {
      setStage("opening");
      setPendingNotice(null);
      const admitted = epoch.current;
      const intent = await operations.create(
        origin,
        requireHistorySource(
          source,
          original.contentId,
          original.id,
          action.kind === "practiceRange",
        ),
        action,
        destination,
        original.title,
        measure,
        () =>
          alive.current &&
          connection.current === origin &&
          selected.current === selection &&
          epoch.current === admitted,
      );
      if (
        alive.current &&
        connection.current === origin &&
        selected.current === selection
      )
        await present(intent);
    });
  };
  const retryPrepared = (enterOnly = false) =>
    pending ? execute(() => present(pending, enterOnly)) : Promise.resolve();
  const lastError =
    error ||
    (pending ? state.errors[pending.request.id] : "") ||
    receipt?.error ||
    pending?.error ||
    state.storageError;
  const normalized = lastError ? historyFailure(lastError) : null;
  const knownPhase = receipt?.phase ?? pending?.lastPhase;
  const preparing = ["queued", "running", "committing"].includes(
    knownPhase ?? "",
  );
  const pendingDescription = previousEngine
    ? "原请求和结果来自上次连接。可保留记录，返回当前练习核对，或重新打开原演奏。"
    : preparing
      ? "请求已登记，后台继续准备曲目和范围。可以读取进度，提交前可以取消。"
      : pendingNotice === "conditions"
        ? "已按可用条件准备曲目。请阅读说明，再决定是否进入当前练习。"
        : knownPhase === "done"
          ? "曲目和范围已准备。接续操作只读取结果并打开所选界面。"
          : knownPhase === "cancelled"
            ? "这次准备已取消，原演奏和当前练习继续保留。"
            : knownPhase === "error"
              ? "这次准备尚未完成。原请求保留，可核对说明后结束本次操作。"
              : "原请求已保留，可重新读取实际结果。回执暂缺时，可按原编号重试准备。";
  return {
    busy,
    error: normalized?.message ?? "",
    sourceIssue:
      sourceIssue ??
      (normalized instanceof HistorySourceError ? normalized.issue : null),
    blocked: busy || blocked || !!pending,
    busyLabel: busy
      ? {
          opening: "正在准备历史练习…",
          reading: "正在核对原操作结果…",
          destination: "正在打开所选界面…",
        }[stage]
      : "",
    clearError: () => report(),
    pendingLabel: pending ? historyIntentLabel(pending) : null,
    pendingHeadline: pending
      ? `${historyIntentLabel(pending)} · ${preparing ? "正在准备" : knownPhase === "done" ? "已准备" : "待核对"}`
      : "",
    pendingNotice,
    pendingStage: stage,
    pendingDescription,
    pendingPreviousEngine: previousEngine,
    pendingWarning: receipt?.warning ?? "",
    pendingRetryLabel: preparing
      ? "读取准备进度"
      : knownPhase === "done"
        ? "接续所选操作"
        : "读取原结果",
    pendingEnterLabel: "核对后进入当前练习",
    retryDisabled: busy || blocked || previousEngine,
    dismissDisabled: blocked || cancelBusy,
    retryPrepared,
    resumeIntent: (id: string) =>
      execute(async () => {
        operations.resume(id);
        const intent = operations
          .getSnapshot()
          .entries.find((entry) => entry.request.id === id);
        if (intent) await present(intent);
      }),
    retryOriginal: () =>
      pending
        ? execute(async () => {
            await operations.retry(pending.request.id);
            await present(pending);
          })
        : Promise.resolve(),
    cancelPrepared: async () => {
      if (!pending || !engineId || cancelBusy || blocked) return;
      setCancelBusy(true);
      try {
        await operations.cancel(pending.request.id, engineId);
      } catch (failure) {
        report(failure);
      } finally {
        if (alive.current) setCancelBusy(false);
      }
    },
    canCancel:
      (!!receipt?.cancellable ||
        (!receipt && pending?.lastPhase === "unknown")) &&
      !previousEngine,
    cancelDisabled: cancelBusy || blocked,
    canRetryOriginal: !!pending && knownPhase === "unknown" && !previousEngine,
    canEnter: knownPhase === "done" && !previousEngine,
    operationStore: operations,
    dismissPrepared: () => {
      epoch.current++;
      working.current = false;
      setLocalBusy(false);
      if (pending) operations.keep(pending.request.id);
      report();
      setPendingNotice(null);
    },
    forgetPrepared: () => {
      if (pending) operations.forget(pending.request.id);
      report();
      setPendingNotice(null);
    },
    canForget:
      !!pending &&
      ["done", "released", "error", "cancelled", "unconfirmed"].includes(
        knownPhase ?? "",
      ) &&
      !busy,
    open: (restore: boolean, measure?: number) =>
      prepare(detail?.source, { kind: "open", restore }, "practice", measure),
    reviewScore: (source?: HistorySource) =>
      prepare(source ?? detail?.source, { kind: "scoreReview" }, "review"),
    practicePerformance: (
      reference: number,
      before: number,
      after: number,
      destination?: "score" | "paper" | "finger",
      source?: HistorySource,
    ) =>
      prepare(
        source,
        { kind: "practiceRange", reference, before, after },
        destination ?? "practice",
      ),
  };
}
