import { useApp } from "./AppContext";
import { DesktopCloseProgress } from "./DesktopCloseProgress";
import { SessionStatus } from "./SessionStatus";
import { StartupNotice } from "./StartupNotice";
import { pathKey } from "../engine/pathIdentity";
import { TaskActivity } from "../engine/TaskActivity";
import "./appNotices.css";

const normalize = pathKey;

/** Close progress, startup and session notices, and the busy indicator. */
export function AppNotices() {
  const {
    workspaceSessions,
    state,
    connected,
    health,
    error,
    fingeringDialog,
    sessionRecovery,
    startupReady,
    busy,
    exerciseDialog,
    notice,
    setNotice,
    action,
    openRecovery,
    recoverSession,
  } = useApp();
  return (
    <>
      <DesktopCloseProgress {...workspaceSessions.desktopClose} />
      <StartupNotice
        status={state.startup}
        connected={connected}
        recovery={sessionRecovery}
        act={recoverSession}
        openRecovery={openRecovery}
        error={health.getMessages().action || health.getMessages().session}
      />
      {notice && (
        <div className="app-notice" role="status">
          <span>{notice}</span>
          <button aria-label="关闭导入提示" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      )}
      {startupReady && (
        <SessionStatus
          store={sessionRecovery}
          act={recoverSession}
          openRecovery={openRecovery}
        />
      )}
      {busy && !fingeringDialog && !exerciseDialog && <TaskActivity />}
    </>
  );
}
