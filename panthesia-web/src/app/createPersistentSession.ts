interface Session {
  busy: boolean;
  storageError: string;
}
interface Persistence {
  key: string;
  maxCharacters: number;
  failureMessage: string;
}
export interface DraftRecoverySnapshot {
  version: number;
  protected: boolean;
  originalAvailable: boolean;
  archivedKey: string | null;
}
export interface PreservedSessionCopy {
  key: string;
  createdAt: number;
}

/** Each workbench owns one bounded draft; unreadable and foreign records retain their original text. */
export function createPersistentSession<State extends Session>(
  initial: State | ((raw: string | null) => State),
  persistence: Persistence,
) {
  let raw: string | null | undefined,
    readFailure = false;
  try {
    raw = localStorage.getItem(persistence.key);
  } catch {
    readFailure = true;
  }
  let state: State =
    typeof initial === "function"
      ? (initial as (raw: string | null) => State)(raw ?? null)
      : initial;
  let protectedRaw = readFailure || !!state.storageError;
  if (readFailure)
    state = {
      ...state,
      storageError:
        "原工作进度暂时无法读取，当前输入保留。可以复制输入后重新读取。",
    };
  let recovery: DraftRecoverySnapshot = {
    version: 0,
    protected: protectedRaw,
    originalAvailable: typeof raw === "string",
    archivedKey: null,
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const publishRecovery = () => {
    recovery = {
      ...recovery,
      version: recovery.version + 1,
      protected: protectedRaw,
      originalAvailable: typeof raw === "string",
    };
  };
  const content = (checkCapacity = true) => {
    const { busy: _busy, storageError: _error, ...value } = state;
    const serialized = JSON.stringify(value);
    if (checkCapacity && serialized.length > persistence.maxCharacters)
      throw new Error("当前输入超过暂存容量，请先复制输入。");
    return serialized;
  };
  const preserve = (current: string | null) => {
    raw = current;
    protectedRaw = true;
    publishRecovery();
    state = {
      ...state,
      storageError:
        "原工作进度或另一窗口的更新仍被保留。请查看原文，再决定采用当前输入。",
    };
  };
  const save = () => {
    try {
      const current = localStorage.getItem(persistence.key);
      if (raw === undefined || current !== raw) {
        preserve(current);
        return;
      }
      if (protectedRaw) {
        state = {
          ...state,
          storageError:
            "原保存记录受到保护。可以复制原文，或保留副本后采用当前输入。",
        };
        return;
      }
      const next = content();
      if (next !== raw) {
        localStorage.setItem(persistence.key, next);
        raw = next;
      }
      state = { ...state, storageError: "" };
    } catch (failure) {
      state = {
        ...state,
        storageError: `${persistence.failureMessage}${failure instanceof Error && failure.message.includes("容量") ? ` ${failure.message}` : ""}`,
      };
    }
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== null && event.key !== persistence.key) return;
    const current = event.key === null ? null : event.newValue;
    if (current !== raw) {
      preserve(current);
      notify();
    }
  };
  const prefix = `${persistence.key}.preserved.`;
  return {
    getSnapshot: () => state,
    getRecoverySnapshot: () => recovery,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1)
        window.addEventListener("storage", storageChanged);
      return () => {
        listeners.delete(listener);
        if (!listeners.size)
          window.removeEventListener("storage", storageChanged);
      };
    },
    update(change: Partial<State>) {
      state = { ...state, ...change };
      save();
      notify();
    },
    retrySave() {
      save();
      notify();
    },
    copyInput: () => content(false),
    originalText() {
      const current = localStorage.getItem(persistence.key);
      if (current !== raw) {
        preserve(current);
        notify();
      }
      return current;
    },
    listPreserved(): PreservedSessionCopy[] {
      const rows: PreservedSessionCopy[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const createdAt = Number(key.slice(prefix.length).split("-")[0]);
        if (
          Number.isSafeInteger(createdAt) &&
          createdAt > 0 &&
          createdAt <= 8_640_000_000_000_000
        )
          rows.push({ key, createdAt });
      }
      return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 32);
    },
    preservedText(key: string) {
      if (!key.startsWith(prefix))
        throw new Error("这份副本不属于当前工作台。");
      return localStorage.getItem(key);
    },
    adoptCurrent() {
      if (state.busy) throw new Error("当前任务仍在处理，完成后可以采用输入。");
      try {
        const current = localStorage.getItem(persistence.key);
        if (raw !== undefined && current !== raw) {
          preserve(current);
          throw new Error("原记录再次改变，请先查看最新原文。");
        }
        if (raw === undefined) raw = current;
        const next = content();
        if (typeof current === "string") {
          const existing =
            recovery.archivedKey &&
            localStorage.getItem(recovery.archivedKey) === current
              ? recovery.archivedKey
              : null;
          const key =
            existing ?? `${prefix}${Date.now()}-${crypto.randomUUID()}`;
          // Archive first. If space is insufficient, the original record remains untouched.
          if (!existing) localStorage.setItem(key, current);
          recovery = { ...recovery, archivedKey: key };
          publishRecovery();
        }
        if (localStorage.getItem(persistence.key) !== current) {
          preserve(localStorage.getItem(persistence.key));
          throw new Error("原记录再次改变，已保留副本与当前输入，请重新核对。");
        }
        localStorage.setItem(persistence.key, next);
        raw = next;
        protectedRaw = false;
        publishRecovery();
        state = { ...state, storageError: "" };
        notify();
      } catch (failure) {
        state = {
          ...state,
          storageError: `当前输入尚未采用，原记录继续保留：${failure instanceof Error ? failure.message : String(failure)}`,
        };
        notify();
        throw failure;
      }
    },
  };
}
export interface PersistentSessionRecovery {
  getRecoverySnapshot: () => DraftRecoverySnapshot;
  subscribe: (listener: () => void) => () => void;
  retrySave: () => void;
  copyInput: () => string;
  originalText: () => string | null;
  listPreserved: () => PreservedSessionCopy[];
  preservedText: (key: string) => string | null;
  adoptCurrent: () => void;
}
