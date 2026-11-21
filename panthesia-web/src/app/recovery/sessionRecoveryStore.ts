import type { WorkProgressStore } from "../../features/activity/workProgressStore";
import { api } from "../../api";
import type { SessionHealthStore } from "../../features/practice/sessionHealthStore";
import {
  projectRecovery,
  recoveryActionLabels,
  recoveryActionDisabled,
  type RecoveryAction,
  type RecoveryContext,
  type RecoveryIssue,
} from "./sessionRecoveryModel";

export interface RecoveryOperation {
  id: string;
  issueId: string;
  action: RecoveryAction;
  label: string;
  startedAt: number;
}
export interface RecoveryOutcome {
  id: string;
  title: string;
  engineId?: string;
  issueId: string;
  action: RecoveryAction;
  ok: boolean;
  detail: string;
  finishedAt: number;
}
export interface RecoverySnapshot {
  engineId?: string;
  issues: readonly RecoveryIssue[];
  availability: Record<string, Partial<Record<RecoveryAction, string>>>;
  problems: number;
  blocking: number;
  operations: readonly RecoveryOperation[];
  outcome: RecoveryOutcome | null;
  recent: readonly RecoveryOutcome[];
  connected: boolean;
  reading: boolean;
  closing: boolean;
}
class RecoveryStateChanged extends Error {}
export function createSessionRecoveryStore(
  health: SessionHealthStore,
  work: WorkProgressStore,
) {
  let context: RecoveryContext | null = null,
    serial = 0,
    signature = "",
    scheduled = false;
  let outcome: RecoveryOutcome | null = null;
  let recent: RecoveryOutcome[] = [];
  const operations = new Map<string, RecoveryOperation>(),
    listeners = new Set<() => void>();
  let snapshot: RecoverySnapshot = {
    issues: [],
    availability: {},
    problems: 0,
    blocking: 0,
    operations: [],
    outcome: null,
    recent: [],
    connected: false,
    reading: false,
    closing: false,
  };
  let release: (() => void) | undefined;
  const rebuild = () => {
    const issues = context
      ? projectRecovery(context, health.getSnapshot(), work.getSnapshot().rows)
      : [];
    const availability = Object.fromEntries(
      issues.map((issue) => [
        issue.id,
        Object.fromEntries(
          issue.actions.flatMap((action) => {
            const reason = context
              ? recoveryActionDisabled(context, action, api.desktop)
              : "练习室状态尚未准备好。";
            return reason ? [[action, reason]] : [];
          }),
        ),
      ]),
    );
    const next: RecoverySnapshot = {
      engineId: context?.engineId,
      issues,
      availability,
      problems: issues.filter((row) => row.severity !== "info").length,
      blocking: issues.filter((row) => row.severity === "blocking").length,
      operations: [...operations.values()],
      outcome,
      recent,
      connected: context?.connected ?? false,
      reading: context?.reading ?? false,
      closing: context?.closing ?? false,
    };
    const key = JSON.stringify(next);
    if (key === signature) return;
    signature = key;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      rebuild();
    });
  };
  const inspectIssue = (issue: RecoveryIssue, action: RecoveryAction) => {
    if (!context || context.closing)
      throw new Error("练习室正在准备退出，返回窗口后可继续处理。");
    const actual = projectRecovery(
      context,
      health.inspect(),
      work.getSnapshot().rows,
    ).find((row) => row.id === issue.id);
    const readOnly = [
      "readSession",
      "devices",
      "dataFolder",
      "workProgress",
      "openWork",
    ].includes(action);
    if (
      !readOnly &&
      (!actual ||
        actual.version !== issue.version ||
        !actual.actions.includes(action))
    )
      throw new RecoveryStateChanged(
        "这项状态已经更新，请查看当前说明。原请求继续保留。",
      );
    if (readOnly && !issue.actions.includes(action))
      throw new Error("这项说明没有对应的操作入口，请重新打开当前状态。");
    const reason = recoveryActionDisabled(context, action, api.desktop);
    if (reason) throw new Error(reason);
    return { issue: actual ?? issue, context };
  };
  return {
    health,
    getSnapshot: () => snapshot,
    getContext: () => context,
    setContext(next: RecoveryContext) {
      context = next;
      schedule();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const releases = [health.subscribe(schedule), work.subscribe(schedule)];
        release = () => releases.forEach((release) => release());
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          release?.();
          release = undefined;
        }
      };
    },
    async perform(
      issue: RecoveryIssue,
      action: RecoveryAction,
      run: (
        context: RecoveryContext,
        issue: RecoveryIssue,
      ) => Promise<string | void>,
    ) {
      const id = `recovery-${++serial}`;
      let operation: RecoveryOperation | undefined;
      let operationEngineId = context?.engineId;
      const finish = (ok: boolean, detail: string) => {
        outcome = {
          id,
          title: issue.title,
          engineId: operationEngineId,
          issueId: issue.id,
          action,
          ok,
          detail,
          finishedAt: Date.now(),
        };
        recent = [...recent, outcome].slice(-16);
      };
      try {
        const current = inspectIssue(issue, action);
        operationEngineId = current.context.engineId;
        if (operations.has(issue.id))
          throw new Error("这项操作仍在处理，请等待原结果。");
        operation = {
          id,
          issueId: issue.id,
          action,
          label: recoveryActionLabels[action],
          startedAt: Date.now(),
        };
        operations.set(issue.id, operation);
        outcome = null;
        rebuild();
        const detail = await run(current.context, current.issue);
        finish(true, detail || "操作已结束，请查看当前状态。");
      } catch (failure) {
        finish(
          failure instanceof RecoveryStateChanged,
          failure instanceof Error ? failure.message : String(failure),
        );
        if (!(failure instanceof RecoveryStateChanged)) throw failure;
      } finally {
        if (operation && operations.get(issue.id)?.id === operation.id)
          operations.delete(issue.id);
        rebuild();
      }
    },
    clearOutcome() {
      outcome = null;
      rebuild();
    },
    diagnostics() {
      return JSON.stringify(
        {
          format: "neothesia-session-recovery-v1",
          capturedAt: new Date().toISOString(),
          desktop: api.desktop,
          engineId: context?.engineId,
          source: context
            ? {
                contentId: context.state.contentId,
                title: context.title,
                path: context.path,
              }
            : null,
          connected: context?.connected,
          binding: context?.binding,
          reading: context?.reading,
          closing: context?.closing,
          startup: context?.state.startup,
          storage: context?.state.storage,
          recording: context
            ? {
                active: context.state.recording,
                unsaved: context.state.recordingUnsaved,
                path: context.state.recordingPath,
              }
            : null,
          sound: context?.state.sound,
          input: context?.state.input,
          inputConnected: context?.state.inputConnected,
          output: context?.state.output,
          issues: context
            ? projectRecovery(
                context,
                health.inspect(),
                work.getSnapshot().rows,
              )
            : [],
          health: health.inspect(),
          operations: [...operations.values()],
          lastAction: outcome,
          recentActions: recent,
        },
        null,
        2,
      );
    },
  };
}
export type SessionRecoveryStore = ReturnType<
  typeof createSessionRecoveryStore
>;
