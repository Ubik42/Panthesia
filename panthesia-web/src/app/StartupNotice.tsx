import { startupStages, startupFailureTitles } from "./startupStages";
import { api } from "../api";
import { useSyncExternalStore } from "react";
import type { SessionRecoveryStore } from "./recovery/sessionRecoveryStore";
import type { RecoveryActor } from "./recovery/SessionRecovery";
import type { RecoveryAction } from "./recovery/sessionRecoveryModel";
import {
  FolderOpen,
  LoaderCircle,
  Music2,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import type { Snapshot } from "../api";
import "./StartupNotice.css";

export function StartupNotice({
  status,
  connected,
  recovery,
  act,
  openRecovery,
  error,
}: {
  status: Snapshot["startup"];
  connected: boolean;
  error: string;
  recovery: SessionRecoveryStore;
  act: RecoveryActor;
  openRecovery: () => void;
}) {
  const recoveryState = useSyncExternalStore(
    recovery.subscribe,
    recovery.getSnapshot,
    recovery.getSnapshot,
  );
  const working = recoveryState.operations.some((operation) =>
    ["retryStartup", "skipStartup", "dataFolder"].includes(operation.action),
  );
  const invoke = (action: RecoveryAction) => {
    const issue = recovery
      .getSnapshot()
      .issues.find(
        (issue) =>
          issue.id.startsWith("startup") && issue.actions.includes(action),
      );
    if (!issue) {
      openRecovery();
      return;
    }
    void act(issue, action).catch(() => openRecovery());
  };
  const disabled = (action: RecoveryAction) => {
    const issue = recoveryState.issues.find(
      (issue) =>
        issue.id.startsWith("startup") && issue.actions.includes(action),
    );
    return (
      working || !issue || !!recoveryState.availability[issue.id]?.[action]
    );
  };
  if (!status || status.ready) return null;
  const failed = !status.active;
  const [title, detail] = startupStages[status.stage] ?? [
    "正在恢复练习室",
    "准备练习资料。",
  ];
  return (
    <section
      className={`startup-notice ${failed ? "startup-failed" : ""}`}
      aria-labelledby="startup-title"
      aria-busy={status.active}
    >
      <div className="startup-symbol" aria-hidden="true">
        {failed ? <ShieldAlert size={30} /> : <Music2 size={30} />}
      </div>
      <div className="startup-copy" role={failed ? "alert" : "status"}>
        <span className="startup-eyebrow">PANTHESIA · 练习室</span>
        <h1 id="startup-title">
          {failed
            ? startupFailureTitles[status.stage] || "练习室准备未完成"
            : title}
        </h1>
        <p>{failed ? status.error || "请重新读取练习资料。" : detail}</p>
        {failed && (
          <p className="startup-preserved">
            已保存的练习资料保持原状。可查看具体原因并继续处理。
          </p>
        )}
        <div className="startup-actions">
          {status.active && (
            <span>
              <LoaderCircle size={15} className="startup-spinner" />
              正在处理
            </span>
          )}
          {status.canSkip && (
            <button
              disabled={disabled("skipStartup")}
              onClick={() => invoke("skipStartup")}
            >
              跳过上次曲目
            </button>
          )}
          {failed && (
            <button
              disabled={disabled("retryStartup")}
              onClick={() => invoke("retryStartup")}
            >
              <RotateCcw size={15} />
              重新读取资料
            </button>
          )}
          {failed && api.desktop && (
            <button
              disabled={disabled("dataFolder")}
              onClick={() => invoke("dataFolder")}
            >
              <FolderOpen size={15} />
              打开资料文件夹
            </button>
          )}
          <button disabled={recoveryState.closing} onClick={openRecovery}>
            查看恢复与问题
          </button>
          {!connected && <span>正在重新连接练习室…</span>}
        </div>
        {error && error !== status.error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
