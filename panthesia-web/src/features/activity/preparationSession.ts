import { createPersistentSession } from "../../app/createPersistentSession";
import { activitySignal } from "./activitySignal";
import {
  type PreparationPhase,
  type PreparationOrigin,
} from "../../engine/commands.generated";
export interface PreparationRequest {
  engineId: string;
  id: string;
  createdAtMs: number;
  origin: PreparationOrigin;
}
export interface PreparationReceipt<R extends PreparationRequest> {
  request: R;
  phase: PreparationPhase;
  stage: string;
  taskId: string | null;
  result: unknown;
  hasResult: boolean;
  error: string | null;
  warning: string | null;
  cancellable: boolean;
}
export interface PreparedIntent<R extends PreparationRequest> {
  request: R;
  title: string;
  disposition: "pending" | "kept" | "presented";
  lastPhase: PreparationPhase | "unknown";
  error: string;
  releasePending?: boolean;
}
interface State<I> {
  version: 1;
  entries: I[];
  busy: boolean;
  storageError: string;
}
interface Configuration<
  R extends PreparationRequest,
  I extends PreparedIntent<R>,
  N extends PreparationReceipt<R>,
> {
  key: string;
  validIntent: (value: unknown) => value is I;
  subject: (intent: I) => string;
  checkReceipt: (value: N, intent: I) => void;
  start: (request: R) => Promise<N>;
  read: (
    engineId: string,
    id: string,
    metadataOnly: boolean,
  ) => Promise<N | null>;
  cancel: (engineId: string, id: string) => Promise<N | null>;
  release: (engineId: string, id: string) => Promise<N | null>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const terminal = (value: PreparationPhase) =>
  !["queued", "running", "committing"].includes(value);
export function createPreparationSession<
  R extends PreparationRequest,
  I extends PreparedIntent<R>,
  N extends PreparationReceipt<R>,
>(config: Configuration<R, I, N>) {
  const session = createPersistentSession<State<I>>(
    (raw) => {
      const empty: State<I> = {
        version: 1,
        entries: [],
        busy: false,
        storageError: "",
      };
      if (raw === null) return empty;
      try {
        if (raw.length > 500000) throw new Error();
        const value: unknown = JSON.parse(raw);
        if (
          !object(value) ||
          value.version !== 1 ||
          !Array.isArray(value.entries) ||
          value.entries.length > 32 ||
          !value.entries.every(config.validIntent) ||
          new Set(value.entries.map((entry) => entry.request.id)).size !==
            value.entries.length
        )
          throw new Error();
        return { ...empty, entries: value.entries };
      } catch {
        return {
          ...empty,
          storageError: "原打开操作进度无法读取，原文已保留。",
        };
      }
    },
    {
      key: config.key,
      maxCharacters: 500000,
      failureMessage: "打开操作进度尚未暂存，可复制原请求保留。",
    },
  );
  let receipts: Record<string, N | null> = {};
  let errors: Record<string, string> = {};
  let currentEngine: string | undefined;
  let working: string[] = [];
  let snapshot = { ...session.getSnapshot(), receipts, working, errors };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = { ...session.getSnapshot(), receipts, working, errors };
    for (const listener of [...listeners]) listener();
    activitySignal.changed();
  };
  session.subscribe(publish);
  const change = (id: string, value: Partial<PreparedIntent<R>>) =>
    session.update({
      entries: session
        .getSnapshot()
        .entries.map((entry) =>
          entry.request.id === id ? { ...entry, ...value } : entry,
        ),
    });
  const entry = (id: string) =>
    session.getSnapshot().entries.find((entry) => entry.request.id === id);
  const capture = (intent: I, value: N | null) => {
    if (value) config.checkReceipt(value, intent);
    const previous = receipts[intent.request.id];
    // A progress response captured before cancellation or commit can arrive later.
    // Keep terminal receipts and the commit boundary visible while a read catches up.
    if (
      previous &&
      value &&
      ((previous.phase === "released" && value.phase !== "released") ||
        (terminal(previous.phase) && !terminal(value.phase)) ||
        (previous.phase === "committing" &&
          ["queued", "running"].includes(value.phase)) ||
        (previous.phase === "running" && value.phase === "queued"))
    )
      return previous;
    if (
      value?.hasResult &&
      !value.result &&
      receipts[intent.request.id]?.result
    )
      value = { ...value, result: receipts[intent.request.id]!.result };
    const nextError =
      value?.error ??
      (value ? "" : "原请求的回执暂未读到，请核对当前练习后继续。");
    // Metadata polls usually repeat the same stage. Retain its identity so
    // playback and workbench subscribers only render an actual progress change.
    if (
      errors[intent.request.id] === nextError &&
      ((previous === null && value === null) ||
        (previous &&
          value &&
          previous.phase === value.phase &&
          previous.stage === value.stage &&
          previous.taskId === value.taskId &&
          previous.hasResult === value.hasResult &&
          previous.error === value.error &&
          previous.warning === value.warning &&
          previous.cancellable === value.cancellable &&
          previous.result === value.result))
    )
      return previous;
    receipts = { ...receipts, [intent.request.id]: value };
    errors = {
      ...errors,
      [intent.request.id]: nextError,
    };
    publish();
    return value;
  };
  const operations = new Map<string, Promise<N | null>>();
  const job = (id: string, run: () => Promise<N | null>) => {
    const old = operations.get(id);
    if (old) return old;
    working = [...working, id];
    publish();
    const promise = Promise.resolve()
      .then(run)
      .catch((failure) => {
        errors = {
          ...errors,
          [id]: failure instanceof Error ? failure.message : String(failure),
        };
        publish();
        throw failure;
      })
      .finally(() => {
        operations.delete(id);
        working = working.filter((key) => key !== id);
        publish();
      });
    operations.set(id, promise);
    return promise;
  };
  const read = async (id: string, engineId: string, metadataOnly = false) => {
    currentEngine = engineId;
    const intent = entry(id);
    if (!intent) throw new Error("原打开操作尚未读到，请返回原资料。");
    const result = await config.read(engineId, id, metadataOnly);
    return capture(intent, result);
  };
  const settle = async (intent: I, first: N | null) => {
    let receipt = first;
    const deadline = Date.now() + 120000;
    while (receipt && !terminal(receipt.phase) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 650));
      receipt = await read(intent.request.id, intent.request.engineId, true);
    }
    return receipt;
  };
  const invoke = (id: string, canAdmit?: () => boolean) =>
    job(id, async () => {
      const intent = entry(id);
      if (!intent) throw new Error("原打开操作尚未读到。");
      if (intent.lastPhase === "cancelled") return receipts[id] ?? null;
      if (canAdmit && !canAdmit()) {
        change(id, { disposition: "kept", lastPhase: "cancelled", error: "" });
        return null;
      }
      if (
        session.getSnapshot().storageError ||
        session.getRecoverySnapshot().protected
      )
        throw new Error("原打开操作进度尚未暂存，请保留副本后继续。");
      let receipt: N | null;
      try {
        receipt = capture(intent, await config.start(intent.request));
      } catch (failure) {
        try {
          receipt = await read(id, intent.request.engineId);
        } catch {}
        if (!receipts[id]) throw failure;
        receipt = receipts[id];
      }
      return settle(intent, receipt);
    });
  const release = async (id: string, engineId: string) => {
    const intent = entry(id);
    if (!intent || intent.disposition !== "presented") return;
    try {
      const value = await config.release(engineId, id);
      if (value) config.checkReceipt(value, intent);
      if (value?.phase !== "released")
        throw new Error("原操作已接续，结果回执稍后可再核对。");
      receipts = { ...receipts, [id]: value };
      change(id, { releasePending: false, lastPhase: "released", error: "" });
    } catch (failure) {
      change(id, {
        releasePending: true,
        error: `所选界面已接续，结果回执尚未更新：${failure instanceof Error ? failure.message : String(failure)}`,
      });
    }
  };
  return {
    ...session,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async add(intent: I, canAdmit?: () => boolean) {
      if (!config.validIntent(intent))
        throw new Error("打开操作的来源或入口不完整，请重新读取后继续。");
      currentEngine = intent.request.engineId;
      const entries = session.getSnapshot().entries;
      if (
        entries.some(
          (entry) =>
            entry.disposition === "pending" &&
            config.subject(entry) === config.subject(intent),
        )
      )
        throw new Error("这个来源还有待核对的打开操作，请先读取原结果。");
      const retained = entries.filter(
        (entry) => entry.disposition !== "presented" || entry.releasePending,
      );
      if (retained.length >= 32)
        throw new Error("保留的打开操作较多，请先核对或结束部分原操作。");
      session.update({ entries: [...retained, intent] });
      const retainedIds = new Set(
        [...retained, intent].map((entry) => entry.request.id),
      );
      receipts = Object.fromEntries(
        Object.entries(receipts).filter(([id]) => retainedIds.has(id)),
      );
      errors = Object.fromEntries(
        Object.entries(errors).filter(([id]) => retainedIds.has(id)),
      );
      if (session.getSnapshot().storageError)
        throw new Error(session.getSnapshot().storageError);
      await invoke(intent.request.id, canAdmit);
      return intent;
    },
    read: (id: string, engineId: string) => job(id, () => read(id, engineId)),
    inspect: (id: string, engineId: string) =>
      job(id, () => read(id, engineId, true)),
    follow: async (id: string, engineId: string) => {
      const joined = operations.has(id);
      let receipt = await job(id, async () => {
        const intent = entry(id);
        if (!intent) return null;
        const receipt = await read(id, engineId);
        return intent.request.engineId === engineId
          ? settle(intent, receipt)
          : receipt;
      });
      const intent = entry(id);
      if (
        joined &&
        receipt &&
        !terminal(receipt.phase) &&
        intent?.request.engineId === engineId
      ) {
        const previous = receipt;
        receipt = await job(id, () => settle(intent, previous));
      }
      return receipt?.phase === "done" && !receipt.result
        ? job(id, () => read(id, engineId))
        : receipt;
    },
    async refreshPending(engineId: string) {
      for (const intent of [...session.getSnapshot().entries]) {
        if (intent.disposition === "presented" && intent.releasePending) {
          await release(intent.request.id, engineId);
          continue;
        }
        if (intent.disposition === "presented") continue;
        try {
          await job(intent.request.id, () =>
            read(intent.request.id, engineId, true),
          );
        } catch {}
      }
    },
    retry: invoke,
    cancel: async (id: string, engineId: string) => {
      const intent = entry(id);
      if (!intent) return null;
      if (intent.request.engineId !== engineId)
        throw new Error("原请求来自上次连接，可先读取原结果。");
      const receipt = await config.cancel(engineId, id);
      const value = capture(intent, receipt);
      if (!value) {
        errors = { ...errors, [id]: "" };
        change(id, { lastPhase: "cancelled", error: "" });
      }
      return value;
    },
    present: (id: string) => {
      const intent = entry(id);
      if (!intent) return;
      change(id, { disposition: "presented", releasePending: true, error: "" });
      void release(id, intent.request.engineId);
    },
    keep: (id: string) => change(id, { disposition: "kept" }),
    keepPending: () => {
      const state = session.getSnapshot();
      if (state.entries.some((entry) => entry.disposition === "pending"))
        session.update({
          entries: state.entries.map((entry) =>
            entry.disposition === "pending"
              ? { ...entry, disposition: "kept" }
              : entry,
          ),
        });
    },
    resume: (id: string) => {
      const intent = entry(id);
      if (!intent || intent.disposition === "presented") return;
      const subject = config.subject(intent);
      session.update({
        entries: session
          .getSnapshot()
          .entries.map((entry) =>
            entry.request.id === id
              ? { ...entry, disposition: "pending", error: "" }
              : entry.disposition === "pending" &&
                  config.subject(entry) === subject
                ? { ...entry, disposition: "kept" }
                : entry,
          ),
      });
    },
    forget: (id: string) => {
      if (working.includes(id)) return;
      const current = entry(id),
        known = receipts[id]?.phase ?? current?.lastPhase;
      const absentPreviousEngine =
        known === "unknown" &&
        receipts[id] === null &&
        !!currentEngine &&
        current?.request.engineId !== currentEngine;
      if (
        !current ||
        (!absentPreviousEngine &&
          !["done", "released", "cancelled", "error", "unconfirmed"].includes(
            known ?? "",
          ))
      )
        return;
      if (known === "done" && currentEngine) {
        change(id, {
          disposition: "presented",
          releasePending: true,
          error: "",
        });
        void release(id, currentEngine);
        return;
      }
      session.update({
        entries: session
          .getSnapshot()
          .entries.filter((entry) => entry.request.id !== id),
      });
      const next = { ...receipts };
      delete next[id];
      receipts = next;
      publish();
      const nextErrors = { ...errors };
      delete nextErrors[id];
      errors = nextErrors;
      publish();
    },
  };
}
