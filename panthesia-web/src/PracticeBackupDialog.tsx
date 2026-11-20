import { BackupPreviewList } from "./features/backups/BackupPreviewList";
import {
  createBackupSessionStore,
  type BackupSessionStore,
  type BackupWorkspace,
  type HistoryClaimSession,
} from "./features/backups/backupSessionStore";
import {
  advancesBackupReceipt,
  sameBackupRequest,
  awaitBackupImport,
  backupImportMessage,
  CancelledBackupImport,
  PendingBackupImport,
} from "./features/backups/backupImportClient";
import type {
  BackupImportReceipt,
  BackupImportRequest,
  BackupImportResult,
  BackupPolicy,
  BackupSelection,
  MetadataHistoryClaim,
  PendingMetadataRow,
  PendingMetadataPage,
} from "./engine/commands.generated";
import type { BackupSummary as Summary } from "./features/backups/backupTypes";
import {
  encodeWorkspaceInBackground as encodeWorkspaceBackup,
  decodeWorkspaceInBackground as decodeWorkspaceBackup,
} from "./features/backups/workspaceBackupClient";
import { downloadWorkspaceBackup } from "./workspaceDownload";
import {
  listBatches,
  loadBatch,
  saveImportedBatches,
  type BatchData,
  type BatchSummary,
} from "./batchImportStore";
import "./workspaceBackupDialog.css";
import { templateFields, modes } from "./metadataTemplates";
import {
  useRef,
  useState,
  useEffect,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { X, Download, FolderOpen } from "lucide-react";
import { api } from "./api";
import { TaskActivity } from "./engine/TaskActivity";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import { scheduleText } from "./RoutineScheduleEditor";
const conflictText = (row: Summary["conflictRows"][number]) =>
  `${row.kind} ${row.local} ${row.incoming}`;
const templateText = (
  row: NonNullable<Summary["metadataTemplateRows"]>[number],
) => row.name;
const planText = (row: Summary["plans"][number]) => `${row.name} ${row.notes}`;
const referenceText = (row: Summary["references"][number]) =>
  `${row.title} ${row.generated ? "可重新生成" : row.indexed ? "已有索引" : "尚无本机索引"}`;
const backupTasks = [
  "导出练习资料",
  "预览练习备份",
  "导入练习资料",
  "读取待认领资料历史",
  "认领资料修改历史",
  "读取资料历史认领结果",
] as const;
function timeText(value: number) {
  const ms = Math.max(0, Math.floor(value));
  const seconds = Math.floor(ms / 1000) % 60;
  return `${Math.floor(ms / 3600000)} 小时 ${Math.floor(ms / 60000) % 60} 分 ${seconds}${ms % 1000 ? `.${String(ms % 1000).padStart(3, "0")}` : ""} 秒`;
}
export function PracticeBackupDialog({
  close,
  changed,
  session,
}: {
  close: () => void;
  changed: () => Promise<void>;
  session?: BackupSessionStore;
}) {
  const [local] = useState(() => session ?? createBackupSessionStore());
  const store = session ?? local;
  useEffect(() => {
    store.load();
  }, [store]);
  const current = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const {
    selection,
    summary,
    workspace,
    policy,
    error,
    message,
    progress,
    request,
    receipt,
    result,
    refreshPending,
    storageError,
    preparedExport,
    legacyPending,
    historyClaim,
  } = current;
  const busy = current.busy || current.loading;
  const pending =
    legacyPending ||
    (!!request &&
      !result &&
      !["error", "cancelled"].includes(receipt?.phase ?? ""));
  const setSelection = (value: SetStateAction<BackupSelection>) =>
    store.update({
      selection:
        typeof value === "function"
          ? value(store.getSnapshot().selection)
          : value,
    });
  const setSummary = (summary: Summary | null) =>
    store.update({
      summary,
      ...(summary
        ? {
            request: undefined,
            receipt: undefined,
            result: undefined,
            refreshPending: false,
          }
        : {}),
    });
  const setWorkspace = (workspace: BackupWorkspace | null) =>
    store.update({ workspace });
  const setPolicy = (policy: BackupPolicy) => store.update({ policy });
  const setError = (error: string) => store.update({ error });
  const setMessage = (message: string) => store.update({ message });
  const setProgress = (progress: string) => store.update({ progress });
  const waiting = useRef<AbortController | null>(null);
  const [canCancelFiles, setCanCancelFiles] = useState(false);
  const [localBatches, setLocalBatches] = useState<BatchSummary[]>([]);
  const [batchError, setBatchError] = useState("");
  const [pendingHistory, setPendingHistory] = useState<PendingMetadataRow[]>(
    [],
  );
  const [pendingQuery, setPendingQuery] = useState(""),
    [pendingOffset, setPendingOffset] = useState(0),
    [pendingTotal, setPendingTotal] = useState(0),
    [pendingLoading, setPendingLoading] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<Record<string, string>>(
    {},
  );
  const [pendingError, setPendingError] = useState("");
  const pendingRead = useRef(0);
  const workspaceInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void refreshPendingHistory();
    void listBatches()
      .then((rows) => {
        if (alive.current) setLocalBatches(rows);
      })
      .catch((e) => {
        if (alive.current) setBatchError(String(e));
      });
    return () => {
      alive.current = false;
      waiting.current?.abort("windowClosed");
    };
  }, []);
  const refreshPendingHistory = async () => {
    const generation = ++pendingRead.current;
    setPendingLoading(true);
    try {
      const result = await api.command<PendingMetadataPage>({
        type: "pendingMetadataHistoryPage",
        query: pendingQuery,
        offset: pendingOffset,
        limit: 20,
      });
      if (alive.current && generation === pendingRead.current) {
        setPendingHistory(result.rows);
        setPendingTotal(result.total);
        setPendingOffset(result.offset);
        setPendingError("");
        return true;
      }
    } catch (e) {
      if (alive.current && generation === pendingRead.current)
        setPendingError(String(e));
    } finally {
      if (alive.current && generation === pendingRead.current)
        setPendingLoading(false);
    }
    return false;
  };
  const acceptClaim = async (
    intent: HistoryClaimSession,
    receipt: MetadataHistoryClaim,
  ) => {
    if (
      !receipt ||
      receipt.version !== 1 ||
      receipt.requestId !== intent.requestId ||
      receipt.sourcePath !== intent.sourcePath ||
      receipt.targetPath !== intent.targetPath ||
      receipt.contentId !== intent.contentId ||
      receipt.fingerprint !== intent.fingerprint ||
      !Number.isSafeInteger(receipt.records) ||
      receipt.records < 0 ||
      receipt.records > 200 ||
      !Number.isSafeInteger(receipt.added) ||
      receipt.added < 0 ||
      receipt.added > receipt.records
    )
      throw new Error("认领回执与原请求不一致，原请求继续保留。");
    store.update({ historyClaim: { ...intent, receipt } });
    setMessage(
      `已认领 ${receipt.records} 条修改历史，新增 ${receipt.added} 条。`,
    );
    if (!(await refreshPendingHistory()))
      throw new Error("认领已保存，待认领列表尚未刷新，可重试读取原结果。");
    await changed();
    if (store.getSnapshot().historyClaim?.requestId === intent.requestId)
      store.update({ historyClaim: undefined });
  };
  const submitClaim = async (intent: HistoryClaimSession) => {
    store.update({ historyClaim: intent });
    await store.flush();
    const receipt = await api.command<MetadataHistoryClaim>({
      type: "claimPendingMetadataHistory",
      source_path: intent.sourcePath,
      content_id: intent.contentId,
      target_path: intent.targetPath,
      request_id: intent.requestId,
      expected: intent.fingerprint,
    });
    await acceptClaim(intent, receipt);
  };
  const readClaim = async () => {
    const intent = store.getSnapshot().historyClaim;
    if (!intent) return;
    if (intent.receipt) {
      await acceptClaim(intent, intent.receipt);
      return;
    }
    const receipt = await api.command<MetadataHistoryClaim | null>({
      type: "readMetadataHistoryClaim",
      request_id: intent.requestId,
    });
    if (!receipt)
      throw new Error(
        "尚未读取到原认领回执。原来源、目标和提交条件已保留，可稍后重读或按原请求重试。",
      );
    await acceptClaim(intent, receipt);
  };
  const claimPending = (row: (typeof pendingHistory)[number]) =>
    work(async () => {
      if (store.getSnapshot().historyClaim)
        throw new Error("已有认领请求需要继续处理，请读取原结果。");
      const target =
        pendingTargets[`${row.contentId}:${row.sourcePath}`] ||
        (row.candidates.length === 1 ? row.candidates[0] : "");
      if (!target) throw new Error("请先选择要接收资料修改历史的曲目");
      if (!/^[a-f\d]{64}$/i.test(row.fingerprint))
        throw new Error("待认领记录尚未读齐，请刷新后再认领。");
      await submitClaim({
        requestId: crypto.randomUUID(),
        sourcePath: row.sourcePath,
        contentId: row.contentId,
        targetPath: target,
        fingerprint: row.fingerprint,
      });
    });
  useEffect(() => {
    const timer = setTimeout(() => void refreshPendingHistory(), 180);
    return () => {
      clearTimeout(timer);
      pendingRead.current++;
    };
  }, [result, pendingQuery, pendingOffset]);
  const work = async (job: () => Promise<void>) => {
    if (!store.claim()) return;
    const controller = new AbortController();
    waiting.current = controller;
    try {
      await job();
    } catch (error) {
      if (
        error instanceof CancelledBackupImport ||
        controller.signal.reason === "cancelled" ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        setMessage(
          error instanceof Error
            ? error.message
            : "本次处理已停止，原资料保留。",
        );
      else setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (waiting.current === controller) waiting.current = null;
      store.update({ busy: false });
      if (alive.current) setCanCancelFiles(false);
    }
  };
  const pick = () => {
    if (api.desktop)
      void work(async () => {
        const data = await api.pickPracticeBackup();
        if (data && !waiting.current?.signal.aborted)
          store.update({
            workspace: null,
            summary: data as Summary,
            request: undefined,
            receipt: undefined,
            result: undefined,
            refreshPending: false,
          });
      });
    else input.current?.click();
  };
  const exportFile = () =>
    void work(async () => {
      if (api.desktop) {
        const path = await api.exportPracticeBackup(selection);
        setMessage(
          path ? `备份已保存：${path}` : "保存已取消，原练习资料保留。",
        );
      } else {
        setCanCancelFiles(true);
        const blob = await api.downloadPracticeBackup(selection, {
          signal: waiting.current?.signal,
          progress: reportProgress,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Panthesia-练习资料-${new Date().toISOString().slice(0, 10)}.neopractice`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("练习资料备份已导出");
      }
    });
  const reportProgress = (text: string) => {
    if (alive.current) setProgress(text);
  };
  const exportWorkspace = () =>
    void work(async () => {
      setCanCancelFiles(true);
      reportProgress("正在读取已保存整理批次…");
      const listed = await listBatches();
      const batches: BatchData[] = [];
      for (const [index, row] of listed.entries()) {
        reportProgress(
          `正在读取批次 ${index + 1}/${listed.length}：${row.name}`,
        );
        if (waiting.current?.signal.aborted)
          throw new DOMException(
            "完整备份制作已取消，原始批次保留。",
            "AbortError",
          );
        const value = await loadBatch(row.id);
        if (value.revision !== row.revision)
          throw new Error("整理批次在导出期间发生了变化，请重新导出。");
        batches.push(value);
      }
      const after = await listBatches();
      if (
        JSON.stringify(after.map((b) => [b.id, b.revision]).sort()) !==
        JSON.stringify(listed.map((b) => [b.id, b.revision]).sort())
      )
        throw new Error("整理批次在导出期间发生了变化，请重新导出。");
      setLocalBatches(after);
      setBatchError("");
      reportProgress("正在导出所选练习资料…");
      const practice = await api.downloadPracticeBackup(selection, {
        signal: waiting.current?.signal,
        progress: reportProgress,
      });
      const file = await encodeWorkspaceBackup(
        practice,
        batches,
        reportProgress,
        waiting.current?.signal,
      );
      const prepared = {
        file,
        name: `Panthesia-完整资料-${new Date().toISOString().slice(0, 10)}.neoworkspace`,
        createdAt: Date.now(),
        batches: batches.length,
        selection: { ...selection },
        items: batches.reduce((n, b) => n + b.items.length, 0),
      };
      store.update({ preparedExport: prepared });
      const path = await downloadWorkspaceBackup(
        file,
        `Panthesia-完整资料-${new Date().toISOString().slice(0, 10)}.neoworkspace`,
        reportProgress,
        () => !!waiting.current?.signal.aborted,
        (phase) => setCanCancelFiles(phase !== "committing"),
      );
      if (path)
        store.update({
          preparedExport: {
            ...prepared,
            ...(api.desktop ? { savedPath: path } : { downloaded: true }),
          },
        });
      setMessage(
        path === null
          ? "完整备份已制作，尚未另存。可以直接另存这份成品。"
          : api.desktop
            ? `完整资料备份已保存：${batches.length} 个整理批次、${batches.reduce((n, b) => n + b.items.length, 0)} 个文件。位置：${path}`
            : "完整备份已生成，请在浏览器下载中确认本地文件。",
      );
    });
  const savePrepared = () =>
    void work(async () => {
      const prepared = store.getSnapshot().preparedExport;
      if (!prepared) return;
      setCanCancelFiles(true);
      const path = await downloadWorkspaceBackup(
        prepared.file,
        prepared.name,
        reportProgress,
        () => !!waiting.current?.signal.aborted,
        (phase) => setCanCancelFiles(phase !== "committing"),
      );
      if (path)
        store.update({
          preparedExport: {
            ...prepared,
            ...(api.desktop ? { savedPath: path } : { downloaded: true }),
          },
        });
      setMessage(
        path === null
          ? "保存已取消，已制作的完整备份保留，可以再次另存。"
          : api.desktop
            ? `完整备份已另存：${path}`
            : "完整备份已交给浏览器下载，请确认本地文件。",
      );
    });
  const applyResult = async (result: BackupImportResult) => {
    store.update({
      result,
      legacyPending: false,
      refreshPending: true,
      error: "",
      message: `练习资料已导入：新增 ${result.addedRecords} 条成绩，跳过 ${result.duplicateRecords} 条重复成绩；新增 ${result.importedPerformances} 份演奏回放、${result.addedTimeEntries} 条时长记录。曲目资料修改历史新增 ${result.metadataHistoryAdded} 条，另存待认领 ${result.metadataHistoryPendingAdded} 条。导入前副本：${result.restorePoint}`,
    });
    try {
      await refreshPendingHistory();
      await changed();
      store.update({ refreshPending: false });
    } catch (error) {
      setError(
        `资料已导入，练习室尚未更新：${error instanceof Error ? error.message : String(error)}。可以重读结果。`,
      );
    }
  };
  const observed = (receipt: BackupImportReceipt) => {
    const current = store.getSnapshot();
    if (
      !current.request ||
      !sameBackupRequest(current.request, receipt.request) ||
      !advancesBackupReceipt(current.receipt, receipt)
    )
      return;
    store.update({ receipt, progress: backupImportMessage(receipt) });
  };
  const resumeImport = () =>
    void work(async () => {
      const saved = store.getSnapshot();
      if (saved.result) {
        await applyResult(saved.result);
        return;
      }
      if (!saved.request) return;
      const result = await awaitBackupImport(saved.request, {
        signal: waiting.current?.signal,
        changed: observed,
      });
      await applyResult(result);
    });
  const cancelImport = async () => {
    const saved = store.getSnapshot().request;
    if (!saved) return;
    try {
      const engineId = (await api.state()).stateOrder?.engineId;
      if (!engineId) throw new Error("练习室尚未连接，原请求保留。");
      const value = await api.cancelBackupImport({ engineId, id: saved.id });
      if (value) {
        observed(value);
        if (value.phase === "done" && value.result)
          await applyResult(value.result);
        if (value.phase === "cancelled") waiting.current?.abort("cancelled");
      } else {
        observed({
          request: saved,
          phase: "cancelled",
          stage: "cancelled",
          taskId: null,
          result: null,
          error: null,
          warning: null,
          cancellable: false,
        });
        waiting.current?.abort("cancelled");
        setMessage("尚未开始的导入已取消，原有练习资料保留。");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const requeue = () =>
    void work(async () => {
      const saved = store.getSnapshot();
      if (!saved.request) return;
      const engineId = (await api.state()).stateOrder?.engineId;
      if (!engineId) throw new Error("请先连接练习室。");
      const value = await api.readBackupImport({
        engineId,
        id: saved.request.id,
      });
      if (value?.phase === "done" && value.result) {
        observed(value);
        await applyResult(value.result);
        return;
      }
      if (value && ["queued", "running", "committing"].includes(value.phase)) {
        observed(value);
        throw new PendingBackupImport(
          "原导入仍在处理，请继续读取或取消原请求。",
        );
      }
      store.update({
        request: undefined,
        receipt: undefined,
        result: undefined,
        refreshPending: false,
        message:
          "已重新准备，原导入记录和导入前副本保留。请重新核对预览后导入。",
      });
    });
  const importFile = () =>
    void work(async () => {
      if (!summary) return;
      if (store.getSnapshot().request)
        throw new PendingBackupImport("请先读取原导入结果，再准备新的导入。");
      let savedCount = workspace?.saved ?? 0;
      if (workspace && !workspace.saved) {
        setCanCancelFiles(true);
        const batches = workspace.batches.filter((batch) =>
          workspace.selected.includes(batch.id),
        );
        if (batches.length) {
          reportProgress(`正在保存 ${batches.length} 个整理批次及原始文件…`);
          await saveImportedBatches(batches, {
            reconcile: true,
            signal: waiting.current?.signal,
            progress: reportProgress,
          });
          savedCount = batches.length;
          setWorkspace({ ...workspace, saved: savedCount });
          void listBatches()
            .then((rows) => {
              if (alive.current) setLocalBatches(rows);
            })
            .catch(() => {});
        }
      }
      if (waiting.current?.signal.aborted)
        throw new DOMException("已停止，已保存的整理批次保留。", "AbortError");
      if (!available) {
        setMessage(
          `已保留 ${savedCount} 个整理批次及原始文件，可以从批量配对继续整理。`,
        );
        return;
      }
      setCanCancelFiles(false);
      reportProgress("正在合并所选练习资料…");
      if ((await api.backupImportProtocol()) < 1) {
        store.update({ legacyPending: true });
        await store.flush();
        const result = await api.command<BackupImportResult>({
          type: "importStagedPracticeBackup",
          token: summary.token,
          selection: { ...selection, days: 0 },
          policy,
        });
        await applyResult(result);
        return;
      }
      const state = await api.state(),
        engineId = state.stateOrder?.engineId;
      if (!engineId) throw new Error("练习室尚未连接，预览和已保存批次保留。");
      // Large retained files finish saving before the short admission timestamp starts.
      await store.flush();
      const request: BackupImportRequest = {
        id: crypto.randomUUID(),
        engineId,
        createdAtMs: Date.now(),
        token: summary.token,
        selection: { ...selection, days: 0 },
        policy,
      };
      store.update({ request, receipt: undefined, result: undefined });
      await store.flush();
      if (waiting.current?.signal.aborted)
        throw new PendingBackupImport(
          "已停止，导入请求保留。可以继续读取或重新核对后准备。 ",
        );
      const result = await awaitBackupImport(request, {
        submit: true,
        signal: waiting.current?.signal,
        changed: observed,
      });
      await applyResult(result);
    });
  const any = selection.plans || selection.records || selection.presets;
  const available =
    summary &&
    ((selection.plans &&
      (summary.plans.length || summary.days || summary.learning)) ||
      (selection.records && (summary.records || summary.timeLedgerEntries)) ||
      (selection.presets &&
        (summary.bookmarks ?? 0) + summary.passages +
          summary.ladders +
          summary.exercises +
          (summary.trackSounds ?? 0) +
          (summary.trackAppearances ?? 0) +
          (summary.songExpressionGoals ?? 0) +
          (summary.metadataTemplates ?? 0) +
          (summary.metadataHistory ?? 0)));
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy || request || legacyPending) close();
      }}
    >
      <section
        className="settings-dialog practice-backup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="practice-backup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="practice-backup-title">练习资料备份</h2>
            <p>计划、要求、日期进度和个人成绩</p>
          </div>
          <button
            autoFocus
            disabled={busy && !request && !legacyPending}
            aria-label="关闭练习资料备份"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {current.loading && (
          <p role="status" className="backup-progress">
            正在恢复上次备份预览与文件…
          </p>
        )}
        {current.saving && (
          <p className="backup-draft-saving" role="status">
            正在保存备份工作进度…
          </p>
        )}
        {storageError && (
          <div role="alert" className="backup-recovery">
            <p>{storageError}</p>
            <button disabled={busy} onClick={() => store.retrySave()}>
              {storageError.startsWith("上次备份预览")
                ? "重新读取上次预览"
                : "重试保存工作进度"}
            </button>
          </div>
        )}
        {legacyPending && (
          <section className="backup-recovery" aria-label="旧版备份导入结果">
            <strong>旧版服务中的导入结果待确认</strong>
            <p>原备份预览和范围保留。请先核对本机资料，避免重复导入。</p>
            <button
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const tasks = await api.command<
                    { label: string; state: string }[]
                  >({ type: "tasks" });
                  if (
                    !Array.isArray(tasks) ||
                    tasks.some(
                      (task) =>
                        task.label === "导入练习资料" &&
                        ["queued", "running", "committing"].includes(
                          task.state,
                        ),
                    )
                  )
                    throw new Error("原导入仍在处理，请等待结果或取消原任务。");
                  store.update({
                    legacyPending: false,
                    message:
                      "已核对旧版导入结果，原文件和已保存资料保留。请重新核对预览后再准备导入。",
                  });
                })
              }
            >
              已核对本机资料，重新准备
            </button>
          </section>
        )}
        {request && (
          <section className="backup-recovery" aria-label="备份导入请求">
            <strong>{result ? "原导入已完成" : "继续处理原备份"}</strong>
            <p>
              {receipt
                ? backupImportMessage(receipt)
                : "已保留原请求。可以继续读取结果；开始新的导入前请先核对本机资料。"}
            </p>
            <p>
              固定范围：{request.selection.plans ? "计划与日课 " : ""}
              {request.selection.records ? "成绩与回放 " : ""}
              {request.selection.presets ? "要求与方案 " : ""} ·{" "}
              {request.policy === "keep"
                ? "冲突时保留本机版本"
                : "冲突时使用备份版本"}
            </p>
            <div className="workspace-backup-actions">
              <button disabled={busy} onClick={resumeImport}>
                {result
                  ? refreshPending
                    ? "重读已导入资料"
                    : "重新读取练习室"
                  : "继续读取原导入结果"}
              </button>
              {!result && receipt?.cancellable !== false && (
                <button onClick={() => void cancelImport()}>取消原导入</button>
              )}
              {!result && (
                <button disabled={busy} onClick={requeue}>
                  已核对本机资料，重新准备
                </button>
              )}
              {busy && (
                <button onClick={() => waiting.current?.abort("stopWaiting")}>
                  停止等待，保留原请求
                </button>
              )}
            </div>
            {receipt?.warning && (
              <p className="backup-warning">{receipt.warning}</p>
            )}
          </section>
        )}
        {result && (
          <section className="backup-outcome" aria-label="已保存的备份导入结果">
            <h3>资料已导入</h3>
            <dl>
              <div>
                <dt>练习成绩</dt>
                <dd>
                  新增 {result.addedRecords} · 重复 {result.duplicateRecords} ·
                  同编号另存 {result.renamedRecords} · 淘汰最早{" "}
                  {result.trimmedRecords}
                </dd>
              </div>
              <div>
                <dt>演奏回放</dt>
                <dd>
                  新增 {result.importedPerformances} · 恢复或替换{" "}
                  {result.replacedPerformances} · 保留本机{" "}
                  {result.keptPerformances} · 重复{" "}
                  {result.duplicatePerformances} · 随成绩淘汰{" "}
                  {result.trimmedPerformances}
                </dd>
              </div>
              <div>
                <dt>累计时长与学习安排</dt>
                <dd>
                  时长新增 {result.addedTimeEntries} · 学习资料更新{" "}
                  {result.learningChanged}
                </dd>
              </div>
              <div>
                <dt>资料修改历史</dt>
                <dd>
                  新增 {result.metadataHistoryAdded} · 重复{" "}
                  {result.metadataHistoryDuplicates} · 来源未匹配{" "}
                  {result.metadataHistoryUnmatched} · 来源不唯一{" "}
                  {result.metadataHistoryAmbiguous} · 待认领{" "}
                  {result.metadataHistoryPendingAdded}
                </dd>
              </div>
            </dl>
            <p>导入前副本：{result.restorePoint}</p>
            {api.desktop && (
              <button
                disabled={busy}
                onClick={() =>
                  void api
                    .openDataFolder()
                    .catch((error) =>
                      setError(
                        `资料文件夹尚未打开：${error instanceof Error ? error.message : String(error)}`,
                      ),
                    )
                }
              >
                打开本机资料文件夹
              </button>
            )}
            {refreshPending && (
              <button disabled={busy} onClick={resumeImport}>
                重读已保存结果
              </button>
            )}
          </section>
        )}
        {preparedExport && (
          <section className="backup-outcome" aria-label="已制作的完整备份">
            <h3>完整备份成品</h3>
            <p>
              {new Date(preparedExport.createdAt).toLocaleString("zh-CN")} 制作
              · {preparedExport.batches} 个整理批次 · {preparedExport.items}{" "}
              个文件 · {(preparedExport.file.size / 1_048_576).toFixed(1)} MB
            </p>
            <p>
              这份成品保留在当前软件会话中；再次另存使用同一份文件。
              {preparedExport.savedPath
                ? `上次另存：${preparedExport.savedPath}`
                : preparedExport.downloaded
                  ? "已交给浏览器下载，请确认本地文件。"
                  : "退出软件前请另存。"}
            </p>
            <p>
              练习资料范围：
              {preparedExport.selection.plans ? "计划与日课 " : ""}
              {preparedExport.selection.records ? "成绩与回放 " : ""}
              {preparedExport.selection.presets ? "要求与方案" : ""}
            </p>
            <div className="workspace-backup-actions">
              <button disabled={busy || pending} onClick={savePrepared}>
                另存这份完整备份
              </button>
              <button
                disabled={busy || pending}
                onClick={() => store.update({ preparedExport: null })}
              >
                释放成品
              </button>
            </div>
          </section>
        )}
        <p className="parameter-help">
          备份按曲目内容身份关联。MIDI、谱面、指法、逐音分手及拍号修正请通过曲目包迁移；这里保留练习计划、日期安排、曲目学习资料、单曲力度与踏板目标、资料修改历史、片段、阶梯、资料模板、成绩历史和已有演奏回放。设备选择与设备校准保留本机设置。
        </p>
        <div className="practice-backup-selection">
          {[
            ["plans", "计划、日课与曲目学习"],
            ["records", "个人成绩与演奏回放"],
            [
              "presets",
              "片段、阶梯、技术练习、音轨、单曲目标、资料模板与修改历史",
            ],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                disabled={busy || pending}
                checked={selection[key as "plans" | "records" | "presets"]}
                onChange={(e) =>
                  setSelection((s) => ({ ...s, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <section
          className="practice-backup-export"
          aria-label="待认领资料修改历史"
          aria-busy={pendingLoading}
        >
          <h3>待认领的资料修改历史</h3>
          {historyClaim && (
            <section
              className="practice-backup-pending-row"
              aria-label="保留的资料历史认领请求"
            >
              <h4>
                {historyClaim.receipt
                  ? "认领已保存，继续刷新"
                  : "认领结果待核对"}
              </h4>
              <p className="parameter-help">
                原来源：{historyClaim.sourcePath}
                <br />
                目标：{historyClaim.targetPath}
              </p>
              <button disabled={busy} onClick={() => void work(readClaim)}>
                {historyClaim.receipt ? "重试刷新认领结果" : "读取原认领结果"}
              </button>
              {!historyClaim.receipt && (
                <button
                  disabled={busy}
                  onClick={() => void work(() => submitClaim(historyClaim))}
                >
                  按原请求重试认领
                </button>
              )}
              <CopyPracticeDraft
                value={historyClaim}
                label="复制原认领请求与回执"
              />
              <button
                disabled={busy}
                onClick={() => store.update({ historyClaim: undefined })}
              >
                移除这份暂存输入
              </button>
            </section>
          )}
          <p className="parameter-help">
            备份中无法确定归属的记录会保存在本机。曲目入库后，请在这里选择内容相同的
            MIDI
            路径。选择前请核对来源与目标；认领只增加修改历史，不会改写曲目资料。
          </p>
          <label>
            查找待认领记录
            <input
              value={pendingQuery}
              disabled={busy}
              placeholder="曲名、来源路径或内容编号"
              onChange={(e) => {
                setPendingQuery(e.target.value);
                setPendingOffset(0);
                setPendingHistory([]);
              }}
            />
          </label>
          {pendingLoading && <p role="status">正在核对本页记录与可用曲目…</p>}
          {pendingError && (
            <p role="alert">待认领记录无法读取：{pendingError}</p>
          )}
          {pendingHistory.length === 0 && !pendingError && !pendingLoading && (
            <p className="parameter-help">
              {pendingQuery ? "没有匹配的待认领记录。" : "目前没有待认领记录。"}
            </p>
          )}
          {pendingHistory.map((row) => {
            const key = `${row.contentId}:${row.sourcePath}`;
            return (
              <div key={key} className="practice-backup-pending-row">
                <p>
                  <strong>{row.title || "未命名曲目"}</strong> · {row.records}{" "}
                  条记录
                </p>
                <p className="parameter-help">原路径：{row.sourcePath}</p>
                <p className="parameter-help">内容身份：{row.contentId}</p>
                {row.candidates.length ? (
                  <>
                    <select
                      aria-label={`认领目标 ${row.sourcePath}`}
                      disabled={busy || pending}
                      value={
                        pendingTargets[key] ??
                        (row.candidates.length === 1 ? row.candidates[0] : "")
                      }
                      onChange={(e) =>
                        setPendingTargets((old) => ({
                          ...old,
                          [key]: e.target.value,
                        }))
                      }
                    >
                      {row.candidates.length > 1 && (
                        <option value="">选择目标 MIDI</option>
                      )}
                      {row.candidates.map((path) => (
                        <option key={path} value={path}>
                          {path}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        pending ||
                        !!historyClaim ||
                        (row.candidates.length > 1 && !pendingTargets[key])
                      }
                      onClick={() => void claimPending(row)}
                    >
                      认领到所选曲目
                    </button>
                  </>
                ) : (
                  <p className="parameter-help">
                    曲库中还没有内容相同的
                    MIDI。请先导入或索引曲目，再重新打开此窗口。
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            disabled={busy || pending || pendingLoading}
            onClick={() => void refreshPendingHistory()}
          >
            刷新待认领记录
          </button>
          <div className="metadata-batch-controls">
            <button
              disabled={busy || pendingLoading || pendingOffset === 0}
              onClick={() => {
                setPendingOffset(Math.max(0, pendingOffset - 20));
                setPendingHistory([]);
              }}
            >
              上一页待认领记录
            </button>
            <span>
              {Math.floor(pendingOffset / 20) + 1} /{" "}
              {Math.max(1, Math.ceil(pendingTotal / 20))} · {pendingTotal} 项
            </span>
            <button
              disabled={
                busy || pendingLoading || pendingOffset + 20 >= pendingTotal
              }
              onClick={() => {
                setPendingOffset(pendingOffset + 20);
                setPendingHistory([]);
              }}
            >
              下一页待认领记录
            </button>
          </div>
        </section>
        <div className="practice-backup-export">
          <h3>保存本机资料</h3>
          <p className="parameter-help">
            成绩日期范围只筛选单次成绩和演奏回放。勾选个人成绩时，备份同时保留全部累计练习时长，包含已超出单曲
            200 条成绩保留上限的运行时间。
          </p>
          <label>
            导出成绩范围
            <select
              aria-label="备份成绩日期范围"
              disabled={busy || pending}
              value={selection.days}
              onChange={(e) =>
                setSelection((s) => ({ ...s, days: Number(e.target.value) }))
              }
            >
              <option value={0}>全部保留记录</option>
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
              <option value={365}>最近一年</option>
            </select>
          </label>
          <button disabled={busy || pending || !any} onClick={exportFile}>
            <Download size={14} />
            导出练习备份
          </button>
        </div>
        <section className="workspace-backup-section" aria-label="完整资料备份">
          <h3>完整资料备份</h3>
          <p>
            完整资料文件会合并上方勾选的练习资料，以及全部已保存整理批次。每个整理批次携带原始文件、配对选择、图片页序和整理进度。
          </p>
          <p>
            这份文件覆盖所选练习资料和已保存整理批次的原文件副本。曲库内其他
            MIDI、谱面原件及各曲的指法和批注，需要保留原文件路径或另行导出曲目包。
          </p>
          <p>
            本机已保存 {localBatches.length} 个整理批次，共{" "}
            {localBatches.reduce((n, b) => n + b.total, 0)} 个文件，
            {(
              localBatches.reduce((n, b) => n + b.bytes, 0) /
              1024 /
              1024
            ).toFixed(1)}{" "}
            MB。
            {!localBatches.length &&
              "您尚未保存整理批次，完整资料备份将只包含所选练习资料。"}
          </p>
          {batchError && (
            <p role="alert">
              整理批次目录读取失败：{batchError}
              。您可以重试导出，系统会重新读取目录。
            </p>
          )}
          {!any && (
            <p>导出需要至少勾选一类练习资料。导入时，您可以只恢复整理批次。</p>
          )}
          <div className="workspace-backup-actions">
            <button
              disabled={busy || pending || !any}
              onClick={exportWorkspace}
            >
              <Download size={14} />
              导出完整资料备份
            </button>
            <button
              disabled={busy || pending}
              onClick={() => workspaceInput.current?.click()}
            >
              <FolderOpen size={14} />
              导入完整资料备份
            </button>
          </div>
          <input
            hidden
            ref={workspaceInput}
            type="file"
            accept=".neoworkspace"
            aria-label="完整资料备份文件"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void work(async () => {
                  setCanCancelFiles(true);
                  const decoded = await decodeWorkspaceBackup(
                    file,
                    reportProgress,
                    waiting.current?.signal,
                  );
                  reportProgress("文件校验完成，正在核对练习资料…");
                  const staged = (await api.stagePracticeBackup(
                    decoded.practice,
                    {
                      signal: waiting.current?.signal,
                      progress: reportProgress,
                    },
                  )) as Summary;
                  store.update({
                    workspace: {
                      ...decoded,
                      selected: decoded.batches.map((batch) => batch.id),
                      saved: 0,
                    },
                    summary: staged,
                    request: undefined,
                    receipt: undefined,
                    result: undefined,
                    refreshPending: false,
                    message:
                      "备份已校验。请核对下方练习资料和整理批次，然后执行导入。",
                  });
                });
            }}
          />
        </section>
        <div className="practice-backup-import">
          <h3>导入已有备份</h3>
          {(summary || workspace) && (
            <button
              disabled={busy || pending}
              onClick={() =>
                store.update({
                  summary: null,
                  workspace: null,
                  ...(!result
                    ? { request: undefined, receipt: undefined }
                    : {}),
                  message:
                    "备份预览已清除，本机练习资料、已恢复批次和原备份文件保留。",
                })
              }
            >
              清除这份备份预览
            </button>
          )}
          <button disabled={busy || pending} onClick={pick}>
            <FolderOpen size={14} />
            选择练习备份
          </button>
          <input
            hidden
            ref={input}
            type="file"
            accept=".neopractice"
            aria-label="练习备份文件"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void work(async () => {
                  setCanCancelFiles(true);
                  const next = await api.stagePracticeBackup(file, {
                    signal: waiting.current?.signal,
                    progress: reportProgress,
                  });
                  store.update({
                    workspace: null,
                    summary: next as Summary,
                    request: undefined,
                    receipt: undefined,
                    result: undefined,
                    refreshPending: false,
                  });
                });
            }}
          />
          {summary && (
            <>
              {workspace && (
                <section
                  className="workspace-backup-preview"
                  aria-label="整理批次恢复预览"
                >
                  <h3>整理批次 · {workspace.batches.length} 个</h3>
                  <p>
                    恢复的批次会成为新的本机待核对版本，现有批次保留。再次恢复同一份备份时，会核对已有批次和原始文件，保留完全相同的版本；已经修改的批次需要保留本机版本并取消勾选。
                  </p>
                  {!workspace.batches.length && <p>这份备份没有整理批次。</p>}
                  {!!workspace.batches.length && !workspace.saved && (
                    <div className="workspace-backup-actions">
                      <span>
                        已选择 {workspace.selected.length} /{" "}
                        {workspace.batches.length} 个批次
                      </span>
                      <button
                        disabled={busy || pending}
                        onClick={() =>
                          setWorkspace({
                            ...workspace,
                            selected: workspace.batches.map(
                              (batch) => batch.id,
                            ),
                          })
                        }
                      >
                        全选批次
                      </button>
                      <button
                        disabled={busy || pending}
                        onClick={() =>
                          setWorkspace({ ...workspace, selected: [] })
                        }
                      >
                        本次不恢复整理批次
                      </button>
                    </div>
                  )}
                  {!!workspace.saved && (
                    <p className="backup-message">
                      本次已保存 {workspace.saved}{" "}
                      个整理批次。后续重试只处理练习资料。
                    </p>
                  )}
                  <div className="workspace-batch-list">
                    {workspace.batches.map((batch) => (
                      <label key={batch.id}>
                        <input
                          type="checkbox"
                          aria-label={`恢复整理批次 ${batch.name}`}
                          checked={workspace.selected.includes(batch.id)}
                          disabled={busy || pending || !!workspace.saved}
                          onChange={(e) =>
                            setWorkspace({
                              ...workspace,
                              selected: e.target.checked
                                ? [...workspace.selected, batch.id]
                                : workspace.selected.filter(
                                    (id) => id !== batch.id,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>{batch.name}</strong>
                          <small>
                            {batch.items.length} 个文件 ·{" "}
                            {(
                              batch.items.reduce(
                                (n, item) => n + item.file.size,
                                0,
                              ) /
                              1024 /
                              1024
                            ).toFixed(1)}{" "}
                            MB · 待处理{" "}
                            {
                              batch.items.filter((i) => i.state !== "done")
                                .length
                            }{" "}
                            项
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {workspace && (
                    <button
                      disabled={busy || pending}
                      onClick={() =>
                        void work(async () => {
                          setSummary(
                            (await api.stagePracticeBackup(
                              workspace.practice,
                            )) as Summary,
                          );
                          setMessage(
                            "练习资料已重新核对，已保存的整理批次保留。请核对后重试导入。",
                          );
                        })
                      }
                    >
                      重新核对练习资料
                    </button>
                  )}
                </section>
              )}
              <p>
                备份日期：{new Date(summary.createdAt).toLocaleString("zh-CN")}
              </p>
              <dl className="practice-backup-counts">
                <div>
                  <dt>累计时长条目 / 已有相同条目</dt>
                  <dd>
                    {summary.timeLedgerEntries ?? 0} /{" "}
                    {summary.timeLedgerDuplicates ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>可按日期统计的运行时长</dt>
                  <dd>{timeText(summary.timeLedgerRunningMs ?? 0)}</dd>
                </div>
                <div>
                  <dt>日期不明的运行时长</dt>
                  <dd>{timeText(summary.timeLedgerUntrackedMs ?? 0)}</dd>
                </div>
                <div>
                  <dt>演奏回放 / 内容冲突</dt>
                  <dd>
                    {summary.performances ?? 0} /{" "}
                    {summary.performanceConflicts ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>回放资料大小</dt>
                  <dd>
                    {((summary.performanceBytes ?? 0) / 1024 / 1024).toFixed(1)}{" "}
                    MB
                  </dd>
                </div>
                <div>
                  <dt>曲目学习资料 / 冲突</dt>
                  <dd>
                    {summary.learning ?? 0} / {summary.learningConflicts ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>常用计划 / 日期安排</dt>
                  <dd>
                    {summary.plans.length} / {summary.days}
                  </dd>
                </div>
                <div>
                  <dt>曲目 / 成绩记录</dt>
                  <dd>
                    {summary.songs} / {summary.records}
                  </dd>
                </div>
                <div>
                  <dt>作品 / 演奏版本 / 谱面版本</dt>
                  <dd>{summary.works ?? 0} / {summary.performanceEditions ?? 0} / {summary.notationEditions ?? 0}</dd>
                </div>
                <div>
                  <dt>片段 / 书签 / 阶梯 / 技术方案 / 资料模板</dt>
                  <dd>
                    {summary.passages} / {summary.bookmarks ?? 0} / {summary.ladders} / {summary.exercises}{" "}
                    / {summary.metadataTemplates ?? 0}
                    {summary.trackAppearances
                      ? ` · ${summary.trackAppearances} 个音轨名称/颜色`
                      : ""}
                    {summary.trackSounds
                      ? ` · ${summary.trackSounds} 个音轨声音设置`
                      : ""}
                    {summary.songExpressionGoals
                      ? ` · ${summary.songExpressionGoals} 首曲目的力度与踏板目标`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>曲目资料修改历史 / 曲目数</dt>
                  <dd>
                    {summary.metadataHistory ?? 0} /{" "}
                    {summary.metadataHistorySongs ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>资料修改历史预计新增 / 重复 / 未定位 / 多路径待核对</dt>
                  <dd>
                    {summary.metadataHistoryAdded ?? 0} /{" "}
                    {summary.metadataHistoryDuplicates ?? 0} /{" "}
                    {summary.metadataHistoryUnmatched ?? 0} /{" "}
                    {summary.metadataHistoryAmbiguous ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>同编号内容冲突 · 计划 / 日期 / 方案</dt>
                  <dd>
                    {summary.conflicts} / {summary.dayConflicts} /{" "}
                    {summary.presetConflicts}
                  </dd>
                </div>
              </dl>
              <p className="parameter-help">
                累计时长按曲目和保存编号合并，相同条目只计算一次。旧版本备份没有累计时长条目时，现有累计时长保留。
              </p>
              {!!summary.timeLedgerConflicts && (
                <p role="alert">
                  本机与备份有 {summary.timeLedgerConflicts}{" "}
                  条同编号累计时长不同。系统会拒绝导入这部分成绩资料，以免重复计算。您可以取消“个人成绩与演奏回放”，先导入其他资料。
                </p>
              )}
              {!!summary.metadataHistoryError && selection.presets && (
                <p role="alert">
                  本机资料修改历史无法安全合并：{summary.metadataHistoryError}
                  。请先修复本机历史，或取消“片段、阶梯、技术练习、音轨、单曲目标、资料模板与修改历史”。
                </p>
              )}
              {!!summary.metadataHistoryUnmatched && selection.presets && (
                <p className="parameter-help">
                  有 {summary.metadataHistoryUnmatched}{" "}
                  条资料修改历史没有找到已索引的同内容
                  MIDI。导入后，这些记录会保存在上方的待认领列表。
                </p>
              )}
              {!!summary.metadataHistoryAmbiguous && selection.presets && (
                <p className="parameter-help">
                  有 {summary.metadataHistoryAmbiguous}{" "}
                  条资料修改历史对应本机多个相同内容路径。导入后，请在上方明确选择接收路径。
                </p>
              )}
              <p className="parameter-help">
                本机已有相同成绩 {summary.duplicateRecords} 条，合并时跳过。
              </p>
              <p className="parameter-help">
                回放随对应成绩一起迁移；旧备份没有回放时仍能导入成绩。已有相同回放{" "}
                {summary.duplicatePerformances ?? 0}{" "}
                次，合并时跳过。回放内容冲突按下方策略处理。
              </p>
              {!!summary.performanceErrors?.length && (
                <p role="alert">
                  本地有 {summary.performanceErrors.length}{" "}
                  次回放无法读取。选择“使用备份版本”可用已校验的备份恢复；保留本地时导入会中止，不会覆盖损坏资料。
                </p>
              )}
              <p>
                收藏的回放片段：{summary.replayClips ?? 0} 个。同编号片段冲突{" "}
                {summary.replayClipConflicts ?? 0}{" "}
                个，按所选策略保留本地或采用备份；双方各自新增的片段都会保留。
              </p>
              {!!summary.annotationConflicts && (
                <p className="parameter-help">
                  有 {summary.annotationConflicts}{" "}
                  条同次成绩的评语不同，按所选保留/采用备份策略处理；成绩不重复登记。
                </p>
              )}
              {!!summary.conflictRows.length && (
                <BackupPreviewList
                  key={`conflicts-${summary.token}`}
                  title="资料与回放冲突"
                  rows={summary.conflictRows}
                  text={conflictText}
                  render={(row) => (
                    <>
                      <span>
                        {row.kind} · 本地：{row.local}
                      </span>
                      <span>备份：{row.incoming}</span>
                    </>
                  )}
                />
              )}
              {summary.templateError && (
                <p role="alert">
                  本地模板读取失败：{summary.templateError}
                  。导入模板前请修复本地记录。
                </p>
              )}
              {!!summary.metadataTemplateRows?.length && (
                <BackupPreviewList
                  key={`templates-${summary.token}`}
                  title="备份中的资料模板"
                  rows={summary.metadataTemplateRows}
                  text={templateText}
                  render={(template) => (
                    <div>
                      <h4>{template.name}</h4>
                      <table className="backup-template-table">
                        <thead>
                          <tr>
                            <th>字段</th>
                            <th>操作</th>
                            <th>内容</th>
                          </tr>
                        </thead>
                        <tbody>
                          {templateFields
                            .filter(
                              ([field]) =>
                                template.rules[field] &&
                                template.rules[field]!.mode !== "keep",
                            )
                            .map(([field, label]) => (
                              <tr key={field}>
                                <th>{label}</th>
                                <td>
                                  {
                                    modes(field).find(
                                      ([mode]) =>
                                        mode === template.rules[field]!.mode,
                                    )?.[1]
                                  }
                                </td>
                                <td>
                                  {template.rules[field]!.value || "（空）"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                />
              )}
              {!!summary.plans.length && (
                <BackupPreviewList
                  key={`plans-${summary.token}`}
                  title="计划与项目数量"
                  initialOpen
                  rows={summary.plans}
                  text={planText}
                  render={(row) => (
                    <>
                      <span>
                        {row.name}
                        {row.notes && (
                          <small className="backup-plan-notes">
                            {row.notes}
                          </small>
                        )}
                      </span>
                      <span>
                        {row.items} 项
                        {row.schedule && (
                          <small className="backup-plan-notes">
                            {scheduleText(row.schedule)}
                          </small>
                        )}
                      </span>
                    </>
                  )}
                />
              )}
              {!!summary.references.length && (
                <BackupPreviewList
                  key={`references-${summary.token}`}
                  title="计划与学习曲目定位"
                  rows={summary.references}
                  text={referenceText}
                  render={(row) => (
                    <>
                      <span>{row.title}</span>
                      <small>
                        {row.generated
                          ? "可重新生成"
                          : row.indexed
                            ? "已有索引，打开时核对内容"
                            : "尚无本机索引，打开时核对原位置；也可添加曲目包"}
                      </small>
                    </>
                  )}
                />
              )}
              <label className="backup-policy">
                同编号的计划、日期安排、曲目学习资料、方案与回放
                <select
                  aria-label="练习备份冲突策略"
                  disabled={busy || pending}
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as BackupPolicy)}
                >
                  <option value="keep">保留本地版本，加入不存在的条目</option>
                  <option value="backup">使用备份版本，保留其他本地条目</option>
                </select>
              </label>
              <p className="parameter-help">
                成绩合并去重；同编号而内容不同的成绩保留为两条。每曲保留最近 200
                条，合并可能淘汰最早记录。历史计分条件原样保存，导入的计划改用本机延迟校准。导入前请暂停演奏并结束活动计划或阶梯。
              </p>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  !!request ||
                  !!result ||
                  (selection.records && !!summary.timeLedgerConflicts) ||
                  (selection.presets && !!summary.metadataHistoryError) ||
                  (!available &&
                    !(
                      workspace &&
                      !workspace.saved &&
                      workspace.selected.length
                    ))
                }
                onClick={importFile}
              >
                {workspace
                  ? workspace.saved
                    ? "重试练习资料导入"
                    : "导入所选完整资料"
                  : "按所选范围导入"}
              </button>
            </>
          )}
        </div>
        {busy && !message && (
          <p role="status">{progress || "正在处理练习资料…"}</p>
        )}
        {busy && !message && !request && (
          <TaskActivity label={backupTasks} cancelLabel="取消本次备份" />
        )}
        {busy && !request && canCancelFiles && (
          <button
            onClick={() => {
              waiting.current?.abort("cancelled");
              setCanCancelFiles(false);
              setProgress(
                "已请求停止，正在结束当前步骤；原文件和已保存资料保留。 ",
              );
            }}
          >
            停止文件处理
          </button>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="backup-message" role="status" aria-label="备份结果">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
