import { useCallback, useRef, useState } from "react";
export type Workspace = "library" | "practice" | "review";
export type BrowseWorkspace = Exclude<Workspace, "practice">;

export function useWorkspaceNavigation(options?: {
  initialReturn?: BrowseWorkspace | null;
  rememberReturn?: (value: BrowseWorkspace | null) => void;
}) {
  const remember = useRef(options?.rememberReturn);
  remember.current = options?.rememberReturn;
  const [workspace, setWorkspace] = useState<Workspace>("library");
  const [returnWorkspace, setReturnWorkspace] =
    useState<BrowseWorkspace | null>(options?.initialReturn ?? null);
  const [pending, setPending] = useState<Workspace | null>(null);
  const [locks, setLocks] = useState({ library: false, review: false });
  const lockRef = useRef(locks),
    current = useRef(workspace),
    sequence = useRef(0);
  const locked = workspace !== "practice" && locks[workspace];
  const commit = useCallback((next: Workspace, bypass = false) => {
    if (next === "review") next = "library";
    const from = current.current;
    if (
      !bypass &&
      from !== next &&
      from !== "practice" &&
      lockRef.current[from]
    )
      return false;
    if (from !== "practice" && next === "practice") {
      setReturnWorkspace(from);
      remember.current?.(from);
    } else if (next !== "practice") remember.current?.(next);
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
      if (from !== next && from !== "practice" && lockRef.current[from]) {
        setPending(null);
        return false;
      }
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
  // A completed operation can return while its own workspace still holds its busy lock.
  const closeLibrary = useCallback(() => {
    if (current.current === "library") {
      sequence.current++;
      setPending(null);
      commit("practice", true);
    }
  }, [commit]);
  const closeReview = useCallback(() => {
    if (current.current === "review") {
      sequence.current++;
      setPending(null);
      commit("practice", true);
    }
  }, [commit]);
  const setLibraryLocked = useCallback((value: boolean) => {
    lockRef.current = { ...lockRef.current, library: value };
    setLocks((old) =>
      old.library === value ? old : { ...old, library: value },
    );
  }, []);
  const setReviewLocked = useCallback((value: boolean) => {
    lockRef.current = { ...lockRef.current, review: value };
    setLocks((old) => (old.review === value ? old : { ...old, review: value }));
  }, []);
  return {
    getCurrent: () => ({
      workspace: current.current,
      locked:
        current.current !== "practice" && lockRef.current[current.current],
    }),
    workspace,
    returnWorkspace,
    dismissReturn: () => {
      setReturnWorkspace(null);
      remember.current?.(null);
    },
    pending,
    locked,
    navigate,
    request,
    closeLibrary,
    closeReview,
    setLibraryLocked,
    setReviewLocked,
  };
}
