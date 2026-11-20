import { reportDiagnostic } from "./diagnostics";
import { api } from "../api";
import { useEffect, useSyncExternalStore } from "react";
import { CheckCircle2, LifeBuoy, LoaderCircle, X } from "lucide-react";
import {
  recoveryActionLabels,
  type RecoveryAction,
  type RecoveryIssue,
} from "./recovery/sessionRecoveryModel";
import type { SessionRecoveryStore } from "./recovery/sessionRecoveryStore";
import type { RecoveryActor } from "./recovery/SessionRecovery";
import "./SessionStatus.css";

export function SessionStatus({
  store,
  act,
  openRecovery,
}: {
  store: SessionRecoveryStore;
  act: RecoveryActor;
  openRecovery: () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    for (const issue of state.issues) {
      if (issue.severity !== "info" || issue.startupWarning)
        reportDiagnostic(issue.title, issue.detail);
    }
  }, [state.issues]);
  const problems = state.issues.filter((issue) => issue.severity !== "info"),
    primary = problems[0];
  const progress = state.issues.find(
      (issue) =>
        issue.severity === "info" &&
        issue.id !== "recording-saved" &&
        !issue.startupWarning,
    ),
    recording = state.issues.find((issue) => issue.id === "recording-saved");
  const actionButton = (
    issue: RecoveryIssue,
    action: RecoveryAction,
    key?: string,
  ) => (
    <button
      key={key}
      type="button"
      disabled={
        !!state.availability[issue.id]?.[action] ||
        state.operations.some((operation) => operation.issueId === issue.id)
      }
      title={state.availability[issue.id]?.[action]}
      onClick={() => {
        void act(issue, action).catch(() => {});
      }}
    >
      {state.operations.some(
        (operation) =>
          operation.issueId === issue.id && operation.action === action,
      ) && <LoaderCircle size={14} className="session-reading" />}
      {recoveryActionLabels[action]}
    </button>
  );
  return (
    <div className="session-status-stack">
      {progress && (
        <div
          className="session-save-status session-compact-progress"
          role="status"
        >
          <LoaderCircle size={14} className="session-reading" />
          <span>{progress.title}</span>
          {progress.id === "connection" || progress.id === "binding"
            ? actionButton(progress, "readSession")
            : null}
        </div>
      )}
      {primary && (
        <div
          className={`session-problem-strip severity-${primary.severity}`}
          role="alert"
        >
          <LifeBuoy size={17} />
          <div>
            <strong>{primary.title}</strong>
          </div>

          {api.desktop && (
            <button
              type="button"
              onClick={() => void api.openLogs().catch(() => {})}
            >
              打开日志
            </button>
          )}
          <button type="button" onClick={openRecovery}>
            详情
          </button>
          {(primary.actions.includes("dismissAction") ||
            primary.actions.includes("dismissStartup")) && (
            <button
              type="button"
              className="icon-button"
              aria-label="收起这条操作提示"
              disabled={
                state.closing ||
                !!state.availability[primary.id]?.[
                  primary.actions.includes("dismissStartup")
                    ? "dismissStartup"
                    : "dismissAction"
                ] ||
                state.operations.some(
                  (operation) => operation.issueId === primary.id,
                )
              }
              onClick={() => {
                void act(
                  primary,
                  primary.actions.includes("dismissStartup")
                    ? "dismissStartup"
                    : "dismissAction",
                ).catch(() => {});
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {!primary && state.outcome && !state.outcome.ok && (
        <div className="session-problem-strip severity-attention" role="alert">
          <div>
            <strong>上次恢复操作尚未完成</strong>
            <span>{state.outcome.detail}</span>
          </div>
          <button type="button" onClick={openRecovery}>
            查看处理结果
          </button>
        </div>
      )}
      {recording && (
        <div className="app-notice recording-saved-notice" role="status">
          <CheckCircle2 size={15} />
          <span>{recording.title}</span>
          {actionButton(recording, "openRecording")}
        </div>
      )}
    </div>
  );
}
