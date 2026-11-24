import { practiceUi, usePracticeUi } from "../stores/practiceUi";
import { useApp } from "./AppContext";
import { DesktopCloseProgress } from "./DesktopCloseProgress";
import { SessionStatus } from "./SessionStatus";
import { StartupNotice } from "./StartupNotice";
import { TaskActivity } from "../engine/TaskActivity";
import { useEffect, useState, type ReactNode } from "react";
import "./appNotices.css";

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
    action,
    openRecovery,
    recoverSession,
  } = useApp();
  const notice = usePracticeUi((s) => s.notice);
  const { setNotice } = practiceUi;
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
      {/* Notices float over the page (bottom right) so they never move its layout. */}
      <div className="app-toasts">
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
        {busy && !fingeringDialog && !exerciseDialog && (
          <Delayed ms={400}>
            <TaskActivity />
          </Delayed>
        )}
      </div>
    </>
  );
}

/** Shows its content only when it is still wanted after `ms` (desktop convention: short work
 * shows no progress). */
function Delayed({ ms, children }: { ms: number; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [ms]);
  return shown ? <>{children}</> : null;
}
