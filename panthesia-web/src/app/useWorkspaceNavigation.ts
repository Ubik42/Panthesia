import { useCallback, useRef, useState } from "react";
export type Workspace = "home" | "practice";

/** The current workspace and guarded transitions between home and practice. */
export function useWorkspaceNavigation() {
  const [workspace, setWorkspace] = useState<Workspace>("home");
  const [pending, setPending] = useState<Workspace | null>(null);
  const current = useRef(workspace),
    sequence = useRef(0);
  const commit = useCallback((next: Workspace) => {
    current.current = next;
    setWorkspace(next);
    return true;
  }, []);
  const navigate = useCallback(
    (next: Workspace) => {
      sequence.current++;
      setPending(null);
      return commit(next);
    },
    [commit],
  );
  const request = useCallback(
    async (
      next: Workspace,
      prepare: (from: Workspace, next: Workspace) => Promise<boolean>,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) return false;
      const request = ++sequence.current,
        from = current.current;
      if (from === next) {
        setPending(null);
        return true;
      }
      setPending(next);
      const cancel = () => {
        if (request === sequence.current) {
          sequence.current++;
          setPending(null);
        }
      };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (
          !(await prepare(from, next)) ||
          request !== sequence.current ||
          current.current !== from ||
          signal?.aborted
        )
          return false;
        return commit(next);
      } finally {
        signal?.removeEventListener("abort", cancel);
        if (request === sequence.current) setPending(null);
      }
    },
    [commit],
  );
  return { workspace, pending, navigate, request };
}
