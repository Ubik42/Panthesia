import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getLibraryOpens,
  type LibraryOpenIntent,
  type LibraryOpenWorkspace,
} from "./libraryOpenStore";
import type {
  LibraryOpenSource,
  LibraryPrepared,
} from "../../engine/commands.generated";

export function useLibraryOpening({
  engineId,
  workspace,
  visible,
  canPresent,
  present,
}: {
  engineId?: string;
  workspace: LibraryOpenWorkspace;
  visible: boolean;
  canPresent: boolean;
  present: (
    intent: LibraryOpenIntent,
    result: LibraryPrepared,
    current: () => boolean,
    workspace: LibraryOpenWorkspace,
  ) => Promise<void>;
}) {
  const store = getLibraryOpens();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [error, setError] = useState("");
  const [submission, setSubmission] = useState<{
    ticket: number;
    engineId: string;
  } | null>(null);
  const [ready, setReady] = useState<{ id: string; ticket: number } | null>(
    null,
  );
  const current = useRef({ engineId, workspace, visible, canPresent, present });
  current.current = { engineId, workspace, visible, canPresent, present };
  const epoch = useRef(0),
    admission = useRef<{ ticket: number; engineId: string } | null>(null);
  const previousWorkspace = useRef(workspace),
    previousEngine = useRef(engineId);
  useEffect(() => {
    if (
      !visible ||
      previousWorkspace.current !== workspace ||
      previousEngine.current !== engineId
    ) {
      epoch.current++;
      store.keepPending();
    }
    previousWorkspace.current = workspace;
    previousEngine.current = engineId;
  }, [visible, workspace, engineId]);
  useEffect(() => {
    if (engineId) void store.refreshPending(engineId);
  }, [engineId, store]);
  const activeIds = state.entries
    .filter(
      (entry) =>
        entry.request.engineId === engineId &&
        ["queued", "running", "committing"].includes(
          state.receipts[entry.request.id]?.phase ?? entry.lastPhase,
        ),
    )
    .map((entry) => entry.request.id);
  const activeKey = JSON.stringify(activeIds);
  useEffect(() => {
    if (!visible || !engineId || !activeIds.length) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await Promise.all(
        activeIds.map((id) => store.inspect(id, engineId).catch(() => {})),
      );
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeKey, visible, engineId, store]);
  const fail = (failure: unknown) =>
    setError(failure instanceof Error ? failure.message : String(failure));
  const enter = async (id: string, ticket: number) => {
    const engine = current.current.engineId,
      owner = current.current.workspace;
    if (!engine) throw new Error("练习室尚未连接，请稍后读取打开结果。");
    const receipt = await store.follow(id, engine);
    const intent = store
      .getSnapshot()
      .entries.find((entry) => entry.request.id === id);
    if (!intent || !receipt) return;
    if (
      ticket !== epoch.current ||
      !current.current.visible ||
      intent.disposition !== "pending"
    )
      return;
    if (["queued", "running", "committing"].includes(receipt.phase)) {
      setReady({ id, ticket });
      return;
    }
    if (receipt.phase !== "done" || !receipt.result) return;
    if (!current.current.canPresent) {
      setReady({ id, ticket });
      return;
    }
    await current.current.present(
      intent,
      receipt.result.libraryPrepared,
      () =>
        ticket === epoch.current &&
        current.current.visible &&
        current.current.canPresent &&
        current.current.engineId === engine &&
        current.current.workspace === owner &&
        store.getSnapshot().entries.find((entry) => entry.request.id === id)
          ?.disposition === "pending",
      owner,
    );
    store.present(id);
  };
  useEffect(() => {
    if (!ready || !visible || !canPresent) return;
    setReady(null);
    if (ready.ticket === epoch.current)
      void enter(ready.id, ready.ticket).catch((failure) => {
        if (ready.ticket === epoch.current) fail(failure);
      });
  }, [ready, visible, canPresent, engineId]);
  const start = async (
    source: LibraryOpenSource,
    title: string,
    path: string,
  ) => {
    if (!current.current.engineId || !current.current.visible)
      throw new Error("练习室重新连接后，可在曲库中打开曲目。");
    const snapshot = store.getSnapshot();
    const pending = snapshot.entries.filter(
      (entry) => entry.disposition === "pending",
    );
    if (
      admission.current?.engineId === current.current.engineId ||
      pending.some(
        (entry) =>
          entry.request.engineId === current.current.engineId &&
          !["error", "cancelled", "released"].includes(
            snapshot.receipts[entry.request.id]?.phase ?? entry.lastPhase,
          ),
      )
    )
      throw new Error("还有待接续的曲目打开操作，请先读取结果或保留进度。");
    for (const entry of pending) store.keep(entry.request.id);
    setError("");
    const ticket = ++epoch.current,
      engine = current.current.engineId,
      owner = current.current.workspace;
    admission.current = { ticket, engineId: engine };
    setSubmission({ ticket, engineId: engine });
    // The workspace remains available while the native worker prepares the song.
    void store
      .create(
        source,
        title,
        path,
        engine,
        () =>
          ticket === epoch.current &&
          current.current.visible &&
          current.current.engineId === engine &&
          current.current.workspace === owner,
        owner,
      )
      .then((intent) => enter(intent.request.id, ticket))
      .catch((failure) => {
        if (ticket === epoch.current && current.current.engineId === engine)
          fail(failure);
      })
      .finally(() => {
        if (admission.current?.ticket === ticket) {
          admission.current = null;
          setSubmission(null);
        }
      });
  };
  return {
    store,
    state,
    error,
    submitting: submission?.engineId === engineId && !!submission,
    clearError: () => setError(""),
    start,
    async reopen(id: string) {
      try {
        if (!current.current.canPresent)
          throw new Error("请先完成当前编辑，再按原选择重新打开。");
        const snapshot = store.getSnapshot();
        const intent = snapshot.entries.find(
          (entry) => entry.request.id === id,
        );
        if (!intent) throw new Error("原打开选择尚未读到。");
        const receipt = snapshot.receipts[id];
        if (
          intent.request.engineId === current.current.engineId &&
          receipt &&
          ["queued", "running", "committing"].includes(receipt.phase)
        )
          throw new Error("原打开仍在处理，可先读取进度或取消准备。");
        store.keep(id);
        await start(intent.request.source, intent.title, intent.path);
      } catch (failure) {
        fail(failure);
      }
    },
    async resume(id: string, retry = false) {
      const engine = current.current.engineId,
        owner = current.current.workspace;
      if (!engine) return;
      if (!current.current.canPresent) {
        setError("请先完成当前编辑，再接续曲目打开结果。");
        return;
      }
      setError("");
      store.resume(id);
      const ticket = ++epoch.current;
      try {
        if (retry) {
          const intent = store
            .getSnapshot()
            .entries.find((entry) => entry.request.id === id);
          if (intent?.request.engineId !== engine)
            throw new Error("原操作来自上次连接，可读取原结果后核对当前曲目。");
          await store.retry(
            id,
            () =>
              ticket === epoch.current &&
              current.current.visible &&
              current.current.engineId === engine &&
              current.current.workspace === owner,
          );
        }
        await enter(id, ticket);
      } catch (failure) {
        if (ticket === epoch.current && current.current.engineId === engine)
          fail(failure);
      }
    },
    keep(id: string) {
      epoch.current++;
      store.keep(id);
      setError("");
    },
    async cancel(id: string) {
      epoch.current++;
      if (current.current.engineId)
        try {
          await store.cancel(id, current.current.engineId);
        } catch (failure) {
          fail(failure);
        }
    },
  };
}
