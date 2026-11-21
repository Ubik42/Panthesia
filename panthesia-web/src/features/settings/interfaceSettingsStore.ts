import {
  displayStorage,
  displayDefaults,
  normalizeDisplayPreferences,
  type DisplayPreferences,
} from "./displayPreferences";
import { shortcutActions } from "../../app/shortcuts";
import {
  canonicalSetting,
  decodeLayouts,
  layoutStorage,
  settingsObject,
  type SavedLayout,
} from "./layoutModel";
import { activitySignal } from "../activity/activitySignal";
import type { Dispatch, SetStateAction } from "react";

const journalKey = "neothesia.interface-transaction.v1",
  archivePrefix = "neothesia.interface-preserved.v1:";
interface Raw {
  preferences: string | null;
  layouts: string | null;
}
interface Transaction {
  format: "neothesia-interface-transaction";
  version: 1;
  id: string;
  before: Raw;
  after: Raw;
}
interface Snapshot {
  preferences: DisplayPreferences;
  layouts: SavedLayout[];
  pending: boolean;
  saving: boolean;
  maintenance: boolean;
  protected: boolean;
  error: string;
  notice: string;
  recovery: boolean;
  revision: number;
}
const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const sameRaw = (left: Raw, right: Raw) =>
  left.preferences === right.preferences && left.layouts === right.layouts;
const sharePreferences = (
  next: DisplayPreferences,
  previous: DisplayPreferences,
): DisplayPreferences => {
  const preferences = { ...next };
  if (
    canonicalSetting(preferences.keyCodes) ===
    canonicalSetting(previous.keyCodes)
  )
    preferences.keyCodes = previous.keyCodes;
  if (
    canonicalSetting(preferences.shortcuts) ===
    canonicalSetting(previous.shortcuts)
  )
    preferences.shortcuts = previous.shortcuts;
  if (canonicalSetting(preferences.keyboardViewport) === canonicalSetting(previous.keyboardViewport)) preferences.keyboardViewport = previous.keyboardViewport;
  if (canonicalSetting(preferences.keyboardDeviceRanges) === canonicalSetting(previous.keyboardDeviceRanges)) preferences.keyboardDeviceRanges = previous.keyboardDeviceRanges;
  return canonicalSetting(preferences) === canonicalSetting(previous)
    ? previous
    : preferences;
};
function readRaw(): Raw {
  return {
    preferences: localStorage.getItem(displayStorage),
    layouts: localStorage.getItem(layoutStorage),
  };
}
function decodePreferences(raw: string | null): DisplayPreferences {
  if (raw === null) return normalizeDisplayPreferences({});
  if (raw.length > 500_000)
    throw new Error("保存的界面设置超过读取容量，原文已保留。");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("本机界面设置格式无法读取，原文已保留。");
  }
  if (!settingsObject(value))
    throw new Error("保存的界面设置格式无法读取，原文已保留。");
  const result = normalizeDisplayPreferences(value);
  for (const key of Object.keys(
    displayDefaults,
  ) as (keyof DisplayPreferences)[]) {
    if (value[key] === undefined) continue;
    if (key === "shortcuts") {
      if (!settingsObject(value.shortcuts))
        throw new Error("快捷键记录无法读取，原文已保留。");
      for (const action of shortcutActions)
        if (
          value.shortcuts[action.id] !== undefined &&
          value.shortcuts[action.id] !== result.shortcuts[action.id]
        )
          throw new Error(
            "保存的快捷键有冲突或当前版本无法采用的按键，原文已保留。",
          );
    } else if (canonicalSetting(value[key]) !== canonicalSetting(result[key]))
      throw new Error("保存的界面设置有当前版本无法采用的内容，原文已保留。");
  }
  return result;
}
function decodeTransaction(raw: string): Transaction {
  if (raw.length > 2_500_000) throw new Error("未完成的保存记录超过读取容量。");
  const value: unknown = JSON.parse(raw),
    valid = (row: unknown): row is Raw =>
      settingsObject(row) &&
      [row.preferences, row.layouts].every(
        (part) =>
          part === null || (typeof part === "string" && part.length <= 500_000),
      );
  if (
    !settingsObject(value) ||
    value.format !== "neothesia-interface-transaction" ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    value.id.length > 100 ||
    !valid(value.before) ||
    !valid(value.after)
  )
    throw new Error("未完成的保存记录格式无法读取，请先保留原文。");
  return value as unknown as Transaction;
}
function mergeRaw(
  previous: Raw,
  preferences: DisplayPreferences,
  layouts: SavedLayout[],
): Raw {
  let root: Record<string, unknown> = {},
    oldLayouts: unknown[] = [];
  try {
    const value: unknown = JSON.parse(previous.preferences ?? "{}");
    if (settingsObject(value)) root = value;
  } catch {}
  try {
    const value: unknown = JSON.parse(previous.layouts ?? "[]");
    if (Array.isArray(value)) oldLayouts = value;
  } catch {}
  return {
    preferences: JSON.stringify({
      ...root,
      ...preferences,
      shortcuts: {
        ...(settingsObject(root.shortcuts) ? root.shortcuts : {}),
        ...preferences.shortcuts,
      },
    }),
    layouts: JSON.stringify(
      layouts.map((row) => {
        const old = oldLayouts.find(
          (item) => settingsObject(item) && item.id === row.id,
        );
        return {
          ...(settingsObject(old) ? old : {}),
          ...row,
          layout: {
            ...(settingsObject(old) && settingsObject(old.layout)
              ? old.layout
              : {}),
            ...row.layout,
          },
        };
      }),
    ),
  };
}
function createStore() {
  let baseline: Raw = { preferences: null, layouts: null },
    known = false,
    timer: ReturnType<typeof setTimeout> | null = null,
    flushing: Promise<void> | null = null,
    maintenance: Promise<void> | null = null,
    externalTimer: ReturnType<typeof setTimeout> | null = null,
    externalDirty = false;
  let state: Snapshot = {
    preferences: normalizeDisplayPreferences({}),
    layouts: [],
    pending: false,
    saving: false,
    maintenance: false,
    protected: false,
    error: "",
    notice: "",
    recovery: false,
    revision: 0,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    for (const listener of [...listeners]) listener();
    activitySignal.changed();
  };
  const lock = async <T>(job: () => Promise<T> | T): Promise<T> =>
    navigator.locks
      ? await navigator.locks.request(
          "neothesia-interface-settings",
          async () => await job(),
        )
      : await Promise.resolve().then(job);
  const archive = (raw: Raw, journal: string | null) => {
    const key = archivePrefix + Date.now() + "-" + crypto.randomUUID();
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        raw,
        journal,
        input: { preferences: state.preferences, layouts: state.layouts },
      }),
    );
    return key;
  };
  const load = (force = false) => {
    try {
      const raw = readRaw(),
        journal = localStorage.getItem(journalKey);
      if (journal) {
        let preferences = state.preferences,
          layouts = state.layouts;
        if (!state.pending) {
          try {
            preferences = sharePreferences(
              decodePreferences(raw.preferences),
              state.preferences,
            );
          } catch {}
          try {
            layouts = decodeLayouts(raw.layouts);
          } catch {}
        }
        publish({
          preferences,
          layouts,
          protected: true,
          recovery: true,
          error: "界面设置有未完成的保存记录，请核对后继续。",
        });
        return;
      }
      if (state.pending && !force) {
        if (!known || !sameRaw(raw, baseline))
          publish({
            protected: true,
            error:
              "另一窗口更新了界面设置。当前输入与本机记录均已保留，请选择采用哪一份。",
          });
        return;
      }
      let preferences = state.preferences,
        layouts = state.layouts,
        error = "";
      try {
        preferences = sharePreferences(
          decodePreferences(raw.preferences),
          state.preferences,
        );
      } catch (failure) {
        error = describe(failure);
      }
      try {
        layouts = decodeLayouts(raw.layouts);
      } catch (failure) {
        error ||= describe(failure);
      }
      baseline = raw;
      known = true;
      publish({
        preferences,
        layouts,
        pending: false,
        protected: !!error,
        error,
        recovery: false,
      });
    } catch (failure) {
      publish({
        protected: true,
        error:
          "本机界面设置暂时无法读取，当前显示继续保留：" + describe(failure),
      });
    }
  };
  load();
  const refreshExternal = () => {
    if (!externalDirty || flushing || maintenance) return;
    externalDirty = false;
    load();
  };
  const writeKey = (
    key: string,
    expected: string | null,
    next: string | null,
    journal: string,
  ) => {
    if (
      localStorage.getItem(journalKey) !== journal ||
      localStorage.getItem(key) !== expected
    )
      throw new Error("本机设置再次改变，保存记录与当前输入继续保留。");
    if (next === null) localStorage.removeItem(key);
    else localStorage.setItem(key, next);
  };
  // Replace an earlier journal only after its complete raw copy has been preserved.
  const writeTransaction = (
    before: Raw,
    after: Raw,
    previousJournal: string | null,
  ) => {
    const transaction: Transaction = {
        format: "neothesia-interface-transaction",
        version: 1,
        id: crypto.randomUUID(),
        before,
        after,
      },
      journal = JSON.stringify(transaction);
    if (
      !sameRaw(readRaw(), before) ||
      localStorage.getItem(journalKey) !== previousJournal
    )
      throw new Error("原记录再次变化，请重新查看。");
    if (sameRaw(before, after) && previousJournal === null) {
      baseline = before;
      known = true;
      return;
    }
    if (
      [
        before.preferences,
        before.layouts,
        after.preferences,
        after.layouts,
      ].some((value) => value !== null && value.length > 500_000) ||
      journal.length > 2_500_000
    )
      throw new Error(
        "当前设置超过保存容量，原记录与当前输入继续保留，请先复制输入。",
      );
    if (
      !sameRaw(readRaw(), before) ||
      localStorage.getItem(journalKey) !== previousJournal
    )
      throw new Error("原记录再次变化，请重新查看。");
    localStorage.setItem(journalKey, journal);
    if (!sameRaw(readRaw(), before))
      throw new Error("本机设置在保存开始时改变，请核对未完成的保存记录。");
    writeKey(displayStorage, before.preferences, after.preferences, journal);
    writeKey(layoutStorage, before.layouts, after.layouts, journal);
    if (
      !sameRaw(readRaw(), after) ||
      localStorage.getItem(journalKey) !== journal
    )
      throw new Error("保存结果需要核对，原记录继续保留。");
    localStorage.removeItem(journalKey);
    baseline = after;
    known = true;
  };
  const commit = async () => {
    if (!state.pending) return;
    if (state.protected)
      throw new Error(state.error || "请先核对本机保存记录。");
    const preferences = state.preferences,
      layouts = state.layouts;
    await lock(() => {
      const before = readRaw();
      if (
        !known ||
        !sameRaw(before, baseline) ||
        localStorage.getItem(journalKey)
      )
        throw new Error(
          "本机设置或保存记录已变化，当前输入继续保留，请重新核对。",
        );
      const after = mergeRaw(before, preferences, layouts);
      writeTransaction(before, after, null);
    });
    const pending =
      canonicalSetting(preferences) !== canonicalSetting(state.preferences) ||
      canonicalSetting(layouts) !== canonicalSetting(state.layouts);
    publish({
      pending,
      error: "",
      protected: false,
      recovery: false,
      notice: pending ? "正在保存后续设置…" : "界面设置已保存在本机。",
    });
  };
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushing) return flushing;
    if (!state.pending)
      return state.protected
        ? Promise.reject(new Error(state.error))
        : Promise.resolve();
    publish({ saving: true });
    flushing = Promise.resolve().then(async () => {
      try {
        for (let pass = 0; state.pending && pass < 8; pass++) await commit();
        if (state.pending)
          throw new Error("设置仍在变化，请停止调整后重试保存。");
      } catch (failure) {
        let recovery = false;
        try {
          recovery = !!localStorage.getItem(journalKey);
        } catch {}
        publish({ error: describe(failure), protected: true, recovery });
        throw failure;
      } finally {
        flushing = null;
        publish({ saving: false });
        refreshExternal();
      }
    });
    return flushing;
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => undefined);
    }, 160);
  };
  const maintain = (job: () => Promise<void>): Promise<void> => {
    if (maintenance)
      return Promise.reject(new Error("界面设置仍在处理，请稍后继续。"));
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    publish({ maintenance: true });
    maintenance = Promise.resolve()
      .then(async () => {
        if (flushing) await flushing.catch(() => undefined);
        await job();
      })
      .catch((failure) => {
        let recovery = state.recovery;
        let protectedRecord = state.protected;
        try {
          recovery = !!localStorage.getItem(journalKey);
          const raw = readRaw();
          protectedRecord ||= recovery || !known || !sameRaw(raw, baseline);
          decodePreferences(raw.preferences);
          decodeLayouts(raw.layouts);
        } catch {
          protectedRecord = true;
        }
        publish({
          protected: protectedRecord,
          recovery,
          error: describe(failure),
        });
        throw failure;
      })
      .finally(() => {
        maintenance = null;
        publish({ maintenance: false });
        refreshExternal();
        if (state.pending && !state.protected) schedule();
      });
    return maintenance;
  };
  const stage = (preferences: DisplayPreferences, layouts: SavedLayout[]) => {
    if (
      canonicalSetting(preferences) === canonicalSetting(state.preferences) &&
      canonicalSetting(layouts) === canonicalSetting(state.layouts)
    ) {
      if (state.error && !state.protected) publish({ error: "" });
      return;
    }
    publish({
      preferences: sharePreferences(preferences, state.preferences),
      layouts,
      pending: true,
      error: state.protected ? state.error : "",
      notice: "设置已在当前窗口生效，正在保存…",
    });
    if (!state.protected && !maintenance) schedule();
  };
  const setPreferences: Dispatch<SetStateAction<DisplayPreferences>> = (
    change,
  ) => {
    const preferences =
      typeof change === "function" ? change(state.preferences) : change;
    const normalized = normalizeDisplayPreferences(preferences);
    if (canonicalSetting(normalized) !== canonicalSetting(preferences)) {
      publish({ error: "这些设置包含无效值或按键冲突，请核对后重试。" });
      return;
    }
    stage(normalized, state.layouts);
  };
  const storageChanged = (event: StorageEvent) => {
    if (
      event.key !== null &&
      ![displayStorage, layoutStorage, journalKey].includes(event.key)
    )
      return;
    if (externalTimer) clearTimeout(externalTimer);
    externalDirty = true;
    externalTimer = setTimeout(() => {
      externalTimer = null;
      refreshExternal();
    }, 80);
  };
  const visible = () => {
    if (document.visibilityState === "visible") {
      externalDirty = true;
      refreshExternal();
    }
  };
  const restoreValues = (
    preferences: DisplayPreferences,
    layouts: SavedLayout[],
    expected: string,
    fromPreserved = false,
  ): Promise<void> =>
    maintain(async () => {
      if (
        canonicalSetting(normalizeDisplayPreferences(preferences)) !==
        canonicalSetting(preferences)
      )
        throw new Error("恢复内容有无效设置或按键冲突。");
      decodeLayouts(JSON.stringify(layouts));
      await lock(() => {
        const raw = readRaw(),
          journal = localStorage.getItem(journalKey);
        const current = fromPreserved
          ? canonicalSetting([state.preferences, state.layouts, raw, journal])
          : canonicalSetting([state.preferences, state.layouts, baseline]);
        if (expected !== current)
          throw new Error("当前设置或本机原文已变化，请重新核对后恢复。");
        if (
          !fromPreserved &&
          (state.protected || !known || !sameRaw(raw, baseline) || journal)
        )
          throw new Error("本机原文或保存记录需要先核对，恢复选择继续保留。");
        archive(raw, journal);
        writeTransaction(
          raw,
          mergeRaw(raw, preferences, layouts),
          fromPreserved ? journal : null,
        );
        publish({
          preferences: sharePreferences(preferences, state.preferences),
          layouts,
          pending: false,
          protected: false,
          recovery: false,
          error: "",
          notice: "所选界面设置已保存在本机，恢复前的设置副本继续保留。",
        });
      });
    });
  return {
    getSnapshot: () => state,
    getPreferences: () => state.preferences,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener("storage", storageChanged);
        document.addEventListener("visibilitychange", visible);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener("storage", storageChanged);
          document.removeEventListener("visibilitychange", visible);
        }
      };
    },
    setPreferences,
    flush: async () => {
      if (maintenance) await maintenance;
      await flush();
    },
    prepareClose: async () => {
      if (maintenance) await maintenance;
      if (state.pending) await flush();
    },
    closeSummary: () =>
      state.pending || state.saving || state.maintenance
        ? state.error || "界面设置尚未完成本机保存。"
        : null,
    retry: () =>
      maintain(async () => {
        await lock(() => {
          const raw = readRaw();
          if (
            !known ||
            !sameRaw(raw, baseline) ||
            localStorage.getItem(journalKey)
          )
            throw new Error("本机原文或保存记录需要核对，请先查看原文。");
          decodePreferences(raw.preferences);
          decodeLayouts(raw.layouts);
          publish({ protected: false, error: "" });
        });
        await flush();
      }),
    baseline: () =>
      canonicalSetting([state.preferences, state.layouts, baseline]),
    setLayouts(rows: SavedLayout[], expected?: string) {
      if (
        expected !== undefined &&
        expected !== canonicalSetting(state.layouts)
      )
        throw new Error("布局列表已变化，请核对当前方案后保存。");
      decodeLayouts(JSON.stringify(rows));
      stage(state.preferences, rows);
    },
    restore: (
      preferences: DisplayPreferences,
      layouts: SavedLayout[],
      expected: string,
    ) => restoreValues(preferences, layouts, expected),
    recoveryBaseline: () =>
      canonicalSetting([
        state.preferences,
        state.layouts,
        readRaw(),
        localStorage.getItem(journalKey),
      ]),
    async restorePreserved(key: string, expected: string) {
      if (!key.startsWith(archivePrefix))
        throw new Error("这份副本不属于界面设置。");
      const raw = localStorage.getItem(key);
      if (!raw || raw.length > 4_000_000)
        throw new Error("这份副本暂时无法读取，请先保留原文。");
      const value: unknown = JSON.parse(raw);
      if (
        !settingsObject(value) ||
        value.version !== 1 ||
        !settingsObject(value.input) ||
        !settingsObject(value.input.preferences) ||
        !Array.isArray(value.input.layouts)
      )
        throw new Error("副本中没有可采用的界面设置输入。");
      const preferences = decodePreferences(
        JSON.stringify(value.input.preferences),
      );
      const layouts = decodeLayouts(JSON.stringify(value.input.layouts));
      await restoreValues(preferences, layouts, expected, true);
    },
    adoptCurrent: () =>
      maintain(async () => {
        await lock(() => {
          const raw = readRaw(),
            journal = localStorage.getItem(journalKey);
          archive(raw, journal);
          if (
            !sameRaw(readRaw(), raw) ||
            localStorage.getItem(journalKey) !== journal
          )
            throw new Error("原记录再次变化，请重新查看。");
          const preferences = state.preferences,
            layouts = state.layouts;
          writeTransaction(raw, mergeRaw(raw, preferences, layouts), journal);
          publish({
            protected: false,
            recovery: false,
            pending: false,
            error: "",
            notice: "当前界面设置已保存在本机，原记录副本继续保留。",
          });
        });
        if (state.pending) await flush();
      }),
    readSaved: () =>
      maintain(async () => {
        await lock(() => {
          if (state.pending || state.error)
            archive(readRaw(), localStorage.getItem(journalKey));
          load(true);
        });
      }),
    recover: (direction: "before" | "after") =>
      maintain(async () => {
        await lock(() => {
          const journal = localStorage.getItem(journalKey);
          if (!journal)
            throw new Error(
              "保存记录已由另一窗口处理，请重新读取本机设置后继续。",
            );
          const transaction = decodeTransaction(journal),
            current = readRaw();
          if (
            ![
              transaction.before.preferences,
              transaction.after.preferences,
            ].includes(current.preferences) ||
            ![transaction.before.layouts, transaction.after.layouts].includes(
              current.layouts,
            )
          )
            throw new Error(
              "原设置还包含其他更新，请保留原文后采用当前窗口设置。",
            );
          const target = transaction[direction];
          if (direction === "after") {
            decodePreferences(target.preferences);
            decodeLayouts(target.layouts);
          }
          archive(current, journal);
          writeKey(
            displayStorage,
            current.preferences,
            target.preferences,
            journal,
          );
          writeKey(layoutStorage, current.layouts, target.layouts, journal);
          if (
            !sameRaw(readRaw(), target) ||
            localStorage.getItem(journalKey) !== journal
          )
            throw new Error("恢复结果再次改变，请重新核对。");
          localStorage.removeItem(journalKey);
          load(true);
        });
      }),
    rawText: () =>
      JSON.stringify(
        { raw: readRaw(), journal: localStorage.getItem(journalKey) },
        null,
        2,
      ),
    copyInput: () =>
      JSON.stringify(
        { preferences: state.preferences, layouts: state.layouts },
        null,
        2,
      ),
    preserved: () => {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(archivePrefix)) keys.push(key);
      }
      return keys.sort().reverse().slice(0, 24);
    },
    preservedText: (key: string) => {
      if (!key.startsWith(archivePrefix))
        throw new Error("这份副本不属于界面设置。");
      return localStorage.getItem(key);
    },
    exportValues: () => {
      const raw = mergeRaw(baseline, state.preferences, state.layouts);
      return {
        preferences: JSON.parse(raw.preferences!),
        layouts: JSON.parse(raw.layouts!),
      } as { preferences: DisplayPreferences; layouts: SavedLayout[] };
    },
  };
}
let instance: ReturnType<typeof createStore> | undefined;
export const getInterfaceSettings = () => (instance ??= createStore());
export type InterfaceSettingsStore = ReturnType<typeof getInterfaceSettings>;
