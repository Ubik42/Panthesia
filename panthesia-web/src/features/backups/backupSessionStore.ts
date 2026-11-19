import { withBackupDraftSave, settleBackupDraftLeases } from "./backupDraftLease";
import type {
  BackupImportReceipt,
  BackupImportRequest,
  BackupImportResult,
  BackupPolicy,
  BackupSelection,
  MetadataHistoryClaim,
} from "../../engine/commands.generated";
import type { BatchData } from "../../batchImportStore";
import type { BackupSummary } from "./backupTypes";
export interface BackupWorkspace {
  practice: File;
  batches: BatchData[];
  selected: string[];
  saved: number;
}
export interface PreparedWorkspaceBackup {
  file: Blob;
  name: string;
  createdAt: number;
  batches: number;
  items: number;
  savedPath?: string;
  downloaded?: boolean;
  selection: BackupSelection;
}
export interface BackupSession {
  historyClaim?: HistoryClaimSession;
  selection: BackupSelection;
  summary: BackupSummary | null;
  workspace: BackupWorkspace | null;
  policy: BackupPolicy;
  request?: BackupImportRequest;
  receipt?: BackupImportReceipt;
  result?: BackupImportResult;
  refreshPending: boolean;
  busy: boolean;
  saving: boolean;
  loading: boolean;
  progress: string;
  error: string;
  message: string;
  storageError: string;
  preparedExport: PreparedWorkspaceBackup | null;
  legacyPending: boolean;
}
export interface HistoryClaimSession {
  requestId: string;
  sourcePath: string;
  contentId: string;
  targetPath: string;
  fingerprint: string;
  receipt?: MetadataHistoryClaim;
}
function validHistoryClaim(value: unknown): value is HistoryClaimSession {
  if (!value || typeof value !== "object") return false;
  const row = value as HistoryClaimSession;
  const hash = (s: unknown) =>
    typeof s === "string" && /^[a-f\d]{64}$/i.test(s);
  if (
    typeof row.requestId !== "string" ||
    !/^[\w-]{8,96}$/.test(row.requestId) ||
    !hash(row.contentId) ||
    !hash(row.fingerprint) ||
    ![row.sourcePath, row.targetPath].every(
      (path) =>
        typeof path === "string" && path.length > 0 && path.length <= 32768,
    )
  )
    return false;
  const r = row.receipt;
  return (
    !r ||
    (r.version === 1 &&
      r.requestId === row.requestId &&
      r.sourcePath === row.sourcePath &&
      r.contentId === row.contentId &&
      r.targetPath === row.targetPath &&
      r.fingerprint === row.fingerprint &&
      Number.isSafeInteger(r.records) &&
      r.records >= 0 &&
      r.records <= 200 &&
      Number.isSafeInteger(r.added) &&
      r.added >= 0 &&
      r.added <= r.records)
  );
}
const initial = (): BackupSession => ({
  selection: { plans: true, records: true, presets: true, days: 0 },
  summary: null,
  workspace: null,
  policy: "keep",
  refreshPending: false,
  busy: false,
  saving: false,
  loading: true,
  progress: "",
  error: "",
  message: "",
  storageError: "",
  preparedExport: null,
  legacyPending: false,
});
const persisted = new Set([
  "historyClaim",
  "selection",
  "summary",
  "workspace",
  "policy",
  "request",
  "receipt",
  "result",
  "refreshPending",
  "message",
  "legacyPending",
]);
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("neothesia-backup-workbench", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("payload");
    };
    let abandoned = false;
    request.onsuccess = () => {
      if (abandoned) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(request.error || new Error("备份预览无法保存"));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("另一个窗口正在使用备份预览"));
    };
  });
}
const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("备份预览保存未完成"));
    tx.onerror = () => {};
  });
function validRequest(value: unknown): value is BackupImportRequest {
  if (!value || typeof value !== "object") return false;
  const row = value as BackupImportRequest;
  return (
    typeof row.id === "string" &&
    /^[\w-]{8,96}$/.test(row.id) &&
    typeof row.engineId === "string" &&
    row.engineId.length <= 256 &&
    typeof row.token === "string" &&
    /^[a-f0-9]{64}$/i.test(row.token) &&
    Number.isSafeInteger(row.createdAtMs) &&
    !!row.selection &&
    [row.selection.plans, row.selection.records, row.selection.presets].every(
      (v) => typeof v === "boolean",
    ) &&
    row.selection.days === 0 &&
    ["keep", "backup"].includes(row.policy)
  );
}
function savedResult(value: unknown): BackupImportResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as BackupImportResult;
  const counts = [
    row.metadataHistoryAdded,
    row.metadataHistoryDuplicates,
    row.metadataHistoryUnmatched,
    row.metadataHistoryAmbiguous,
    row.metadataHistoryPendingAdded,
    row.addedTimeEntries,
    row.importedPerformances,
    row.duplicatePerformances,
    row.keptPerformances,
    row.replacedPerformances,
    row.trimmedPerformances,
    row.learningChanged,
    row.addedRecords,
    row.duplicateRecords,
    row.renamedRecords,
    row.trimmedRecords,
  ];
  return counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    typeof row.restorePoint === "string" &&
    row.restorePoint.length <= 4096
    ? row
    : undefined;
}
export function createBackupSessionStore() {
  let state = initial(),
    revision = 0,
    initialized = false,
    pendingSaves = 0,
    blocked = false,
    savedPayload: BackupWorkspace | null = null,
    queue = Promise.resolve();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const save = () => {
    if (blocked) return;
    const snapshot = state;
    pendingSaves++;
    state = { ...state, saving: true };
    queue = queue
      .then(() =>
        withBackupDraftSave(async () => {
          const db = await openDatabase();
          try {
            const tx = db.transaction(["state", "payload"], "readwrite"),
              done = completed(tx);
            const {
              busy: _busy,
              saving: _saving,
              loading: _loading,
              error: _error,
              progress: _progress,
              storageError: _storage,
              preparedExport: _export,
              workspace,
              ...metadata
            } = snapshot;
            try {
              tx.objectStore("state").put(
                {
                  ...metadata,
                  workspace: workspace
                    ? { selected: workspace.selected, saved: workspace.saved }
                    : null,
                },
                "current",
              );
              if (
                workspace?.practice !== savedPayload?.practice ||
                workspace?.batches !== savedPayload?.batches
              ) {
                if (workspace)
                  tx.objectStore("payload").put(
                    {
                      practice: workspace.practice,
                      batches: workspace.batches,
                    },
                    "current",
                  );
                else tx.objectStore("payload").delete("current");
              }
            } catch (error) {
              try {
                tx.abort();
              } catch {}
              await done.catch(() => {});
              throw error;
            }
            await done;
            blocked = false;
            savedPayload = workspace;
            state = { ...state, storageError: "" };
            notify();
          } finally {
            db.close();
          }
        }),
      )
      .catch(() => {
        state = {
          ...state,
          storageError:
            "备份工作进度尚未写入本机。当前窗口保留预览和文件，可以重试保存进度。",
        };
        notify();
      })
      .finally(() => {
        pendingSaves--;
        state = { ...state, saving: pendingSaves > 0 };
        notify();
      });
  };
  const update = (patch: Partial<BackupSession>) => {
    revision++;
    state = { ...state, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "summary") && patch.summary)
      blocked = false;
    if (Object.keys(patch).some((key) => persisted.has(key))) save();
    notify();
  };
  const hydrate = async (expectedRevision = revision) => {
    let db: IDBDatabase | undefined;
    try {
      db = await openDatabase();
      const tx = db.transaction(["state", "payload"], "readonly");
      const [raw, payload] = await Promise.all([
        requestValue(tx.objectStore("state").get("current")),
        requestValue(tx.objectStore("payload").get("current")),
      ]);
      if (revision !== expectedRevision) return;
      if (raw) {
        if (
          !raw.selection ||
          ![
            raw.selection.plans,
            raw.selection.records,
            raw.selection.presets,
          ].every((v: unknown) => typeof v === "boolean") ||
          !Number.isInteger(raw.selection.days) ||
          raw.selection.days < 0 ||
          raw.selection.days > 36500 ||
          !["keep", "backup"].includes(raw.policy)
        )
          throw new Error("invalid-state");
        if (
          raw.summary &&
          (!/^[a-f0-9]{64}$/i.test(raw.summary.token) ||
            !Array.isArray(raw.summary.plans) ||
            !Array.isArray(raw.summary.references) ||
            !Array.isArray(raw.summary.conflictRows))
        )
          throw new Error("invalid-summary");
        if (raw.summary) {
          const preview = raw.summary as BackupSummary;
          if (
            !Number.isSafeInteger(preview.createdAt) ||
            preview.createdAt < 0 ||
            preview.createdAt > 8_640_000_000_000_000 ||
            !preview.plans.every(
              (row) =>
                row &&
                typeof row.id === "string" &&
                typeof row.name === "string" &&
                typeof row.notes === "string" &&
                Number.isSafeInteger(row.items) &&
                row.items >= 0,
            ) ||
            !preview.references.every(
              (row) =>
                row &&
                typeof row.contentId === "string" &&
                typeof row.title === "string" &&
                typeof row.generated === "boolean" &&
                typeof row.indexed === "boolean",
            ) ||
            !preview.conflictRows.every(
              (row) =>
                row &&
                [row.kind, row.local, row.incoming].every(
                  (value) => typeof value === "string",
                ),
            ) ||
            (preview.metadataTemplateRows != null &&
              (!Array.isArray(preview.metadataTemplateRows) ||
                !preview.metadataTemplateRows.every(
                  (row) =>
                    row &&
                    typeof row.name === "string" &&
                    !!row.rules &&
                    typeof row.rules === "object",
                )))
          )
            throw new Error("invalid-preview-rows");
        }
        if (raw.request && !validRequest(raw.request))
          throw new Error("invalid-request");
        if (raw.historyClaim && !validHistoryClaim(raw.historyClaim))
          throw new Error("invalid-history-claim");
        let workspace: BackupWorkspace | null = null;
        if (raw.workspace) {
          if (
            !(payload?.practice instanceof File) ||
            !Array.isArray(payload.batches) ||
            payload.batches.length > 200 ||
            !payload.batches.every(
              (batch: BatchData) =>
                batch &&
                Array.isArray(batch.items) &&
                batch.items.length <= 200 &&
                batch.items.every((item) => item.file instanceof File),
            ) ||
            !Array.isArray(raw.workspace.selected) ||
            !raw.workspace.selected.every(
              (id: unknown) =>
                typeof id === "string" &&
                payload.batches.some((batch: BatchData) => batch.id === id),
            ) ||
            !Number.isInteger(raw.workspace.saved) ||
            raw.workspace.saved < 0 ||
            raw.workspace.saved > 200
          )
            throw new Error("invalid-payload");
          workspace = {
            ...payload,
            selected: raw.workspace.selected,
            saved: raw.workspace.saved,
          };
        }
        savedPayload = workspace;
        blocked = false;
        const receipt =
          raw.receipt?.request?.id === raw.request?.id &&
          [
            "queued",
            "running",
            "committing",
            "done",
            "cancelled",
            "error",
            "unconfirmed",
          ].includes(raw.receipt?.phase) &&
          (raw.receipt.error == null ||
            typeof raw.receipt.error === "string") &&
          (raw.receipt.warning == null ||
            typeof raw.receipt.warning === "string")
            ? ({
                ...raw.receipt,
                result: savedResult(raw.receipt.result) ?? null,
              } as BackupImportReceipt)
            : undefined;
        if (receipt?.phase === "done" && !receipt.result) {
          receipt.phase = "unconfirmed";
          receipt.error = "保存的导入摘要不完整，可以继续读取原请求。";
          receipt.cancellable = false;
        }
        state = {
          ...initial(),
          selection: raw.selection,
          summary: raw.summary ?? null,
          workspace,
          policy: raw.policy,
          request: raw.request,
          historyClaim: raw.historyClaim,
          receipt,
          result:
            receipt?.phase === "done"
              ? (receipt.result ?? undefined)
              : savedResult(raw.result),
          refreshPending: raw.refreshPending === true,
          legacyPending: raw.legacyPending === true,
          message:
            typeof raw.message === "string" ? raw.message.slice(0, 65536) : "",
          loading: false,
        };
      } else {
        blocked = false;
        state = { ...state, loading: false };
      }
    } catch {
      if (revision === expectedRevision) {
        blocked = true;
        state = {
          ...state,
          loading: false,
          storageError:
            "上次备份预览无法读取，原记录保留。重新选择备份后可替换预览。",
        };
      }
    } finally {
      db?.close();
      if (state.loading) state = { ...state, loading: false };
      notify();
    }
  };
  const load = () => {
    if (initialized) return;
    initialized = true;
    void hydrate();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    load,
    claim: () => {
      if (state.busy || state.loading) return false;
      update({ busy: true, error: "", progress: "", message: "" });
      return true;
    },
    retrySave: () => {
      if (blocked) {
        state = { ...state, loading: true };
        notify();
        void hydrate();
        return;
      }
      save();
    },
    flush: async () => {
      for (;;) {
        const waiting = queue;
        await waiting;
        if (waiting === queue && !state.saving) break;
      }
      await settleBackupDraftLeases();
      if (state.storageError)
        throw new Error(
          "备份工作进度尚未保存。请重试保存进度后再导入，原有练习资料保留。",
        );
    },
  };
}
export type BackupSessionStore = ReturnType<typeof createBackupSessionStore>;
