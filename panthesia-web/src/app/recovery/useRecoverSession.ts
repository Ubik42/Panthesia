import { useCallback, useRef } from "react";
import { performRecoveryAction, type RecoveryHost } from "./recoveryActions";
import type { RecoveryAction, RecoveryIssue } from "./sessionRecoveryModel";
import type { createSessionRecoveryStore } from "./sessionRecoveryStore";

/** A stable `recoverSession` whose actions use the latest host (rebuilt every render). */
export function useRecoverSession(store: ReturnType<typeof createSessionRecoveryStore>, host: RecoveryHost) {
  const current = useRef(host);
  current.current = host;
  return useCallback(
    (issue: RecoveryIssue, action: RecoveryAction, signal?: AbortSignal) =>
      performRecoveryAction(store, () => current.current, issue, action, signal),
    [store],
  );
}
