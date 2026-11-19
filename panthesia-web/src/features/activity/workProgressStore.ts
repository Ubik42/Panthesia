import { getLibraryOpens, libraryOpenLabel, libraryOpenProgress } from "../library/libraryOpenStore";
import { collectInterfaceWork } from "../settings/interfaceWork";
import { getHistoryOperations, historyIntentLabel } from "../review/historyOperationStore";
import { historyFailure } from "../review/historySource";
import { hasClipInput, replayEditors } from "../review/replayEditorStore";
import {
  pendingWorkJobs,
  cancelBackgroundJob,
  startBackgroundJobs,
  isBackgroundJobLive,
} from "./backgroundJobs";
import { activitySignal } from "./activitySignal";
import { scoreExportSessions } from "../scores/scoreExportStore";
import { mediaExportSessions } from "../exports/mediaExportStore";
import { locatedPaperSessions } from "../scores/locatedPaperSession";
import { practiceEditorSessions, practiceDraftDirty } from "../practice/practiceEditorStore";
import { meterEditorSessions, meterHasInput } from "../practice/meterEditorStore";
import { handEditorSessions, handHasInput } from "../practice/handEditorStore";
import type { createScoreWorkspaceStore } from "../scores/scoreWorkspaceStore";
import type { createImportQueueStore } from "../imports/importQueueStore";
import type { createPackageSessionStore } from "../imports/packageSessionStore";
import type { createBackupSessionStore } from "../backups/backupSessionStore";
import type { createExerciseSessionStore } from "../practice/exerciseSessionStore";
import type { createRoutineWorkbenchStore } from "../routines/routineWorkbenchStore";
import type { createEditDraftStore } from "../editing/editDraftStore";
import type { MediaExportKind } from "../../engine/commands.generated";
import {
  createDeviceTaskStore,
  deviceTaskMessage,
  type DeviceWork,
} from "../devices/deviceTaskStore";

export type WorkPhase = "running" | "attention" | "waiting" | "completed";
export type WorkTarget =
  | "imports"
  | "package"
  | "backup"
  | "scores"
  | "score"
  | "media"
  | "exercise"
  | "routine"
  | "devices"
  | "passage"
  | "ladder"
  | "hands"
  | "meter"
  | "interface-settings"
  | "replay"
  | "library-open"
  | "history-action"
  | "drafts";
export interface WorkSource {
  contentId: string;
  title?: string;
  path?: string;
  engineId?: string | null;
}
export interface WorkProblem {
  kind: "input" | "refresh" | "processing";
  detail: string;
}
export interface WorkEntry {
  libraryOpenId?: string;
  libraryOpenWorkspace?: "library" | "practice" | "review";
  historyOperationId?: string;
  historyId?: string;
  dismissible?: boolean;
  problem?: WorkProblem;
  id: string;
  version: string;
  keywords?: string;
  title: string;
  subject: string;
  phase: WorkPhase;
  detail: string;
  target: WorkTarget;
  source?: WorkSource;
  restoreScoreKey?: string;
  scoreTool?: "export" | "located";
  sourceFingerprint?: string;
  copy?: () => string;
  mediaKind?: MediaExportKind;
  stale?: boolean;
  cancel?: () => void | Promise<void>;
  requestEngineIds?: string[];
  cancelNeedsEngine?: boolean;
}
export interface WorkSources {
  scores: ReturnType<typeof createScoreWorkspaceStore>;
  imports: ReturnType<typeof createImportQueueStore>;
  piecePackage: ReturnType<typeof createPackageSessionStore>;
  practiceBackup: ReturnType<typeof createBackupSessionStore>;
  exercise: ReturnType<typeof createExerciseSessionStore>;
  routineWorkbench: ReturnType<typeof createRoutineWorkbenchStore>;
  edits: ReturnType<typeof createEditDraftStore>;
}
export interface ProgressContext {
  engineId?: string;
  connected: boolean;
  closing: boolean;
}
export interface WorkSnapshot {
  connected: boolean;
  rows: readonly WorkEntry[];
  pending: number;
  attention: number;
  running: number;
  waiting: number;
  completed: number;
}
export const phaseOrder: Record<WorkPhase, number> = {
  attention: 0,
  running: 1,
  waiting: 2,
  completed: 3,
};
const preparationRunning = (
  id: string | undefined,
  phase: string | undefined,
) =>
  isBackgroundJobLive(id) &&
  !!phase &&
  ["queued", "running", "committing"].includes(phase);
const active = (phase?: string) =>
  !!phase && ["preparing", "running", "queued", "committing"].includes(phase);

export function collectWork(
  sources: WorkSources,
  deviceWork: readonly DeviceWork[] = [],
  cancelDevice?: (record: DeviceWork) => Promise<void>,
): WorkEntry[] {
  const problem = (
    detail: string | null | undefined,
    kind: WorkProblem["kind"] = "processing",
  ): WorkProblem | undefined => (detail ? { kind, detail } : undefined);
  const rows: WorkEntry[] = [];
  const add = (entry: Omit<WorkEntry, "version"> & { version?: string }) =>
    rows.push({
      ...entry,
      version:
        entry.version ??
        JSON.stringify([entry.phase, entry.subject, entry.detail]),
    });
  const imports = sources.imports.getSnapshot();
  if (imports.items.length || imports.error || imports.storageError || imports.refreshPending) {
    const done = imports.items.filter((item) => item.state === "done").length;
    const review = imports.items.filter(
      (item) => item.state === "review" || item.state === "error",
    ).length;
    add({
      id: "imports",
      problem: problem(
        imports.storageError || imports.error ||
          imports.items.find((item) => item.state === "error")?.message ||
          (imports.refreshPending ? "文件已处理，曲库列表仍需重新读取。" : ""),
        imports.refreshPending ? "refresh" : "processing",
      ),
      keywords: imports.items
        .map(
          (item) =>
            `${item.source.name} ${item.song?.title ?? ""} ${item.message}`,
        )
        .join("\n"),
      title: "导入曲目",
      target: "imports",
      subject: `${imports.items.length} 份文件`,
      phase:
        imports.busy ||
        imports.items.some((item) =>
          preparationRunning(item.receipt?.id, item.receipt?.phase),
        )
          ? "running"
          : imports.storageError || imports.error || review || imports.refreshPending
            ? "attention"
            : done < imports.items.length
              ? "waiting"
              : "completed",
      detail:
        imports.storageError || imports.error ||
        (imports.refreshPending
          ? "文件已处理，曲库列表还需重新读取。"
          : `已完成 ${done} 份${review ? `，${review} 份需要核对` : ""}${done < imports.items.length ? "。打开队列可继续剩余文件。" : "，可查看导入结果。"}`),
      requestEngineIds: [
        ...new Set(
          imports.items
            .filter((item) => item.state !== "done")
            .flatMap((item) => (item.receipt ? [item.receipt.engineId] : [])),
        ),
      ],
      version: JSON.stringify([
        imports.items.map((item) => [item.id, item.state, item.receipt?.id]),
        imports.refreshPending,
        imports.error,
        imports.storageError,
      ]),
    });
  }
  const piece = sources.piecePackage.getSnapshot();
  if (
    piece.summary ||
    piece.receipt ||
    piece.error ||
    piece.storageError ||
    piece.busy
  )
    add({
      requestEngineIds: piece.receipt ? [piece.receipt.engineId] : [],
      id: "package",
      problem: piece.storageError
        ? problem(piece.storageError, "input")
        : problem(
            piece.error ||
              (piece.refreshPending ? "曲目包已保存，界面列表仍需更新。" : ""),
            piece.result ? "refresh" : "processing",
          ),
      title: "曲目包",
      target: "package",
      subject: piece.fileName || piece.summary?.title || "曲目与练习资料",
      phase:
        piece.busy ||
        preparationRunning(piece.receipt?.id, piece.receipt?.phase)
          ? "running"
          : piece.storageError ||
              piece.error ||
              piece.refreshPending ||
              piece.phase === "review"
            ? "attention"
            : piece.result
              ? "completed"
              : "waiting",
      detail:
        piece.storageError ||
        piece.error ||
        piece.message ||
        (piece.refreshPending
          ? "曲目包已处理，界面列表待更新。"
          : "预览与原提交记录保留，可继续导入或核对结果。"),
      version: JSON.stringify([
        piece.summary?.token,
        piece.receipt?.id,
        piece.phase,
        piece.result?.contentId,
        piece.error,
        piece.storageError,
        piece.refreshPending,
      ]),
    });
  const backup = sources.practiceBackup.getSnapshot();
  if (
    backup.historyClaim ||
    backup.summary ||
    backup.request ||
    backup.result ||
    backup.preparedExport ||
    backup.workspace ||
    backup.error ||
    backup.storageError ||
    backup.busy ||
    backup.saving
  )
    add({
      id: "backup",
      problem: backup.storageError
        ? problem(backup.storageError, "input")
        : problem(
            backup.error ||
              (backup.refreshPending
                ? "资料已处理，练习室与回顾列表仍需更新。"
                : ""),
            backup.result ? "refresh" : "processing",
          ),
      title: "练习资料备份",
      target: "backup",
      subject: backup.preparedExport?.name || "备份与恢复工作台",
      phase:
        backup.busy ||
        backup.saving ||
        preparationRunning(
          backup.request ? `backup:${backup.request.id}` : undefined,
          backup.receipt?.phase,
        )
          ? "running"
          : backup.storageError ||
              backup.error ||
              backup.refreshPending ||
              backup.legacyPending ||
              (backup.historyClaim && !backup.historyClaim.receipt) ||
              backup.receipt?.phase === "unconfirmed"
            ? "attention"
            : (backup.preparedExport &&
                  !backup.preparedExport.savedPath &&
                  !backup.preparedExport.downloaded) ||
                (backup.request && !backup.result) ||
                (backup.summary && !backup.result)
              ? "waiting"
              : "completed",
      detail:
        backup.storageError ||
        backup.error ||
        backup.progress ||
        backup.message ||
        (backup.preparedExport && !backup.preparedExport.savedPath
          ? "完整备份已制作，等待另存。"
          : backup.refreshPending
            ? "资料已处理，等待重新读取界面。"
            : "打开后可继续预览、保存或核对原导入结果。"),
      version: JSON.stringify([
        backup.historyClaim?.requestId,
        backup.historyClaim?.receipt?.added,
        backup.request?.id,
        backup.receipt?.phase,
        backup.preparedExport?.createdAt,
        backup.preparedExport?.savedPath,
        backup.result,
        backup.error,
        backup.storageError,
      ]),
    });
  const exercise = sources.exercise.getSnapshot();
  if (
    exercise.busy ||
    exercise.dirty ||
    exercise.result ||
    exercise.receipt ||
    exercise.error ||
    exercise.storageError
  )
    add({
      requestEngineIds: exercise.receipt ? [exercise.receipt.engineId] : [],
      id: "exercise",
      problem: exercise.storageError
        ? problem(exercise.storageError, "input")
        : problem(
            exercise.error ||
              (exercise.refreshPending
                ? "技术练习已生成，练习室仍需更新。"
                : ""),
            exercise.result ? "refresh" : "processing",
          ),
      title: "技术练习",
      target: "exercise",
      subject: exercise.presetName || "练习参数与制作结果",
      phase:
        exercise.busy ||
        preparationRunning(exercise.receipt?.id, exercise.receipt?.phase)
          ? "running"
          : exercise.error ||
              exercise.storageError ||
              exercise.refreshPending ||
              exercise.phase === "review"
            ? "attention"
            : exercise.result
              ? "completed"
              : "waiting",
      detail:
        exercise.storageError ||
        exercise.error ||
        exercise.message ||
        (exercise.refreshPending
          ? "练习已生成，曲库列表待更新。"
          : "参数和原提交记录保留，可继续制作或核对。"),
      version: JSON.stringify([
        exercise.receipt?.id,
        exercise.phase,
        exercise.result?.contentId,
        exercise.error,
        exercise.storageError,
      ]),
    });
  const routines = sources.routineWorkbench.getSnapshot();
  const routineCount = [
    routines.metadata,
    routines.items,
    routines.schedules,
    routines.pending,
  ].reduce((sum, group) => sum + Object.keys(group).length, 0);
  if (routineCount || routines.busy || routines.storageError)
    add({
      id: "routines",
      problem: problem(routines.storageError, "input"),
      keywords: [
        ...Object.values(routines.metadata).map((row) => row.name),
        ...Object.values(routines.items).map((row) => row.title),
        ...Object.values(routines.schedules).map((row) => row.title),
      ].join("\n"),
      title: "练习计划",
      target: "routine",
      subject: `${routineCount} 项编排输入`,
      phase: routines.busy
        ? "running"
        : routines.storageError
          ? "attention"
          : "waiting",
      detail:
        routines.storageError ||
        "计划名称、项目与待核对请求保留，可从草稿入口继续编排。",
    });
  for (const { key, store, state } of practiceEditorSessions()) {
    const count = state.drafts.filter(practiceDraftDirty).length;
    if (!count && !state.receipt && !state.storageError && !state.busy) continue;
    const detail = state.storageError || (state.receipt
      ? state.receipt.phase === "acknowledged"
        ? "保存回复已收到，返回窗口读取结果后继续。"
        : "原输入和保存编号已保留，返回窗口核对保存结果。"
      : "输入已暂存，可以返回来源曲目继续编辑。");
    add({
      id: "practice-editor:" + key,
      title: state.kind === "ladder" ? "速度阶梯输入" : "练习段落输入",
      subject: state.title || "原曲目",
      target: state.kind === "ladder" ? "ladder" : "passage",
      phase: state.busy ? "running" : state.storageError || state.receipt ? "attention" : "waiting",
      detail: count + " 份待保存输入。" + detail,
      problem: problem(state.storageError || (state.receipt ? detail : ""), state.storageError ? "input" : "refresh"),
      source: { contentId: state.contentId, title: state.title, path: state.path || undefined, engineId: state.engineId },
      copy: store.copyInput,
      keywords: state.drafts.map((row) => row.form.name).join("\n"),
      version: String(store.revision()),
    });
  }
  for (const { key, store, state } of meterEditorSessions()) {
    if (!meterHasInput(state) && !state.receipt && !state.storageError && !state.busy) continue;
    const detail = state.storageError || (state.receipt ? "原小节网格提交内容已保留，请返回读取实际网格后继续。" : "拍号、弱起、短小节与浏览位置已暂存，可返回来源曲目继续。");
    add({ id: "meter-editor:" + key, title: "小节网格输入", subject: state.title, target: "meter", phase: state.busy ? "running" : state.receipt || state.storageError ? "attention" : "waiting", detail, problem: problem(state.storageError || (state.receipt ? detail : ""), state.storageError ? "input" : "refresh"), source: { contentId: state.contentId, title: state.title, path: state.path }, copy: store.copyInput });
  }
  for (const { key, store, state } of handEditorSessions()) {
    if (!handHasInput(state) && !state.receipt && !state.storageError && !state.busy) continue;
    const detail = state.storageError || (state.receipt ? "原分手、撤销或跨度操作已保留，请读取实际资料后继续。" : "手工分手、所选音符和各个选段的浏览位置已暂存。");
    add({ id: "hand-editor:" + key, title: "逐音分手输入", subject: state.title, target: "hands", phase: state.busy ? "running" : state.receipt || state.storageError ? "attention" : "waiting", detail, problem: problem(state.storageError || (state.receipt ? detail : ""), state.storageError ? "input" : "refresh"), source: { contentId: state.contentId, title: state.title, path: state.path }, copy: store.copyInput });
  }
  const interfaceWork = collectInterfaceWork();
  if (interfaceWork) add(interfaceWork);
  const libraryOpens = getLibraryOpens(),
    libraryState = libraryOpens.getSnapshot();
  for (const intent of libraryState.entries) {
    if (intent.disposition === "presented" && !intent.releasePending) continue;
    const id = intent.request.id,
      receipt = libraryState.receipts[id],
      phase = receipt?.phase ?? intent.lastPhase;
    const running =
      libraryState.working.includes(id) ||
      ["queued", "running", "committing"].includes(phase);
    const error =
      libraryState.storageError ||
      libraryState.errors[id] ||
      intent.error ||
      receipt?.error ||
      receipt?.warning ||
      "";
    add({
      id: `library-open:${id}`,
      libraryOpenId: id,
      libraryOpenWorkspace: intent.workspace ?? "library",
      title: libraryOpenLabel(intent.request.source),
      subject: intent.title || "原曲目",
      target: "library-open",
      phase: running
        ? "running"
        : error || ["error", "unknown", "unconfirmed"].includes(phase)
          ? "attention"
          : "waiting",
      detail: error || libraryOpenProgress(phase, receipt?.stage),
      problem: problem(error, libraryState.storageError ? "input" : "refresh"),
      version: JSON.stringify([intent, phase, receipt?.stage, running, error]),
      copy: libraryOpens.copyInput,
      requestEngineIds: [intent.request.engineId],
      cancel: receipt?.cancellable
        ? () => {
            libraryOpens.keep(id);
            return libraryOpens
              .cancel(id, intent.request.engineId)
              .then(() => {});
          }
        : undefined,
    });
  }
  if (libraryState.storageError && !libraryState.entries.length)
    add({
      id: "library-open-recovery",
      title: "曲库打开进度",
      subject: "保留的原请求",
      target: "library-open",
      phase: "attention",
      detail: libraryState.storageError,
      problem: problem(libraryState.storageError, "input"),
      copy: libraryOpens.copyInput,
    });
  const historyOperations = getHistoryOperations(), historyState = historyOperations.getSnapshot();
  for (const intent of historyState.entries) {
    if (intent.disposition === "presented" && !intent.releasePending) continue;
    const receipt = historyState.receipts[intent.request.id], phase = receipt?.phase ?? intent.lastPhase;
    const running = historyState.working.includes(intent.request.id) || !!receipt && ["queued", "running", "committing"].includes(phase);
    const rawError = historyState.errors[intent.request.id] || receipt?.error || intent.error || receipt?.warning;
    const error = historyState.storageError || (rawError ? historyFailure(rawError).message : "");
    const detail = error || (phase === "done" ? "曲目和范围已准备，返回原记录后可接续所选界面。" : running ? "后台继续准备历史练习，原请求及所选入口已暂存。" : phase === "cancelled" ? "这次准备已取消，原演奏和当前练习继续保留。" : "原请求及所选入口已保留，可返回原记录读取结果。");
    add({ id: `history-operation:${intent.request.id}`, historyOperationId: intent.request.id, historyId: intent.request.operation.source.id, title: historyIntentLabel(intent), subject: intent.title || "原演奏记录", target: "history-action", phase: running ? "running" : error || ["error", "unconfirmed", "unknown"].includes(phase) ? "attention" : "waiting", detail, dismissible: intent.disposition === "kept" && !running, problem: problem(error, historyState.storageError ? "input" : "refresh"), source: { contentId: intent.request.operation.source.contentId, title: intent.title, engineId: intent.request.engineId }, version: JSON.stringify([intent, phase, receipt?.stage, receipt?.warning, running, error]), copy: historyOperations.copyInput, cancel: receipt?.cancellable ? () => historyOperations.cancel(intent.request.id, intent.request.engineId).then(() => {}) : undefined });
  }
  if (historyState.storageError && !historyState.entries.length) add({ id: "history-operation-recovery", title: "历史操作进度", subject: "保留的原请求", target: "history-action", phase: "attention", detail: historyState.storageError, problem: problem(historyState.storageError, "input"), copy: historyOperations.copyInput });
  for (const store of replayEditors()) {
    const state = store.getSnapshot();
    if (!hasClipInput(state) && !state.storageError && !state.busy) continue;
    const detail = state.storageError || state.error || (state.receipt ? "原收藏提交和范围已保留，可返回原演奏核对结果。" : "片段名称、备注和范围已暂存，可返回继续编辑。");
    add({ id: `replay-editor:${state.contentId}:${state.historyId}`, title: "回放片段输入", subject: state.title || state.draft.name || "原演奏记录", target: "replay", historyId: state.historyId, phase: state.busy ? "running" : state.receipt || state.error || state.storageError ? "attention" : "waiting", detail, source: { contentId: state.contentId, title: state.title, engineId: state.receipt?.engineId }, problem: problem(state.storageError || state.error || (state.receipt ? detail : ""), state.storageError ? "input" : "refresh"), version: JSON.stringify([state.draft, state.range, state.receipt, state.busy, detail]), copy: store.copyInput });
  }
  const edits = sources.edits.getSnapshot();
  if (edits.count || edits.busy || edits.error)
    add({
      id: "edit-drafts",
      problem: problem(edits.error, "input"),
      title: "编辑草稿",
      target: "drafts",
      subject: `${edits.count} 份输入`,
      phase:
        edits.busy || edits.pending
          ? "running"
          : edits.error
            ? "attention"
            : "waiting",
      detail:
        edits.error ||
        "曲目信息、学习目标、回顾批注与专项要求的输入可在草稿中心继续处理。",
    });

  for (const { key, state } of sources.scores.sessions()) {
    const pending = state.pendingDraft || state.filePreview;
    const waiting =
      pending ||
      state.job ||
      Object.keys(state.names).length ||
      state.drafts.some((draft) => !draft.saved || draft.savePending);
    const error = state.error || state.catalogError || state.draftIssues[0];
    const running =
      state.localBusy ||
      state.catalogReading ||
      state.jobBusy ||
      state.submissionPending ||
      (isBackgroundJobLive(state.job?.id) && active(state.jobStatus?.phase));
    if (
      waiting ||
      error ||
      running ||
      state.refreshPending ||
      state.editMessage ||
      state.message
    )
      add({
        id: `scores:${key}`,
        problem: problem(
          error ||
            (state.refreshPending
              ? "谱面已保存，版本或原谱列表仍需更新。"
              : ""),
          state.refreshPending ? "refresh" : "processing",
        ),
        title: "谱面初稿与版本",
        target: "scores",
        source: state.source,
        subject: state.source.title || pending?.name || "来源曲目",
        restoreScoreKey: pending ? key : undefined,
        copy: () =>
          JSON.stringify(
            {
              source: state.source,
              names: state.names,
              notationRequest: state.job,
              initialDraft: pending
                ? { name: pending.name, warning: pending.warning }
                : undefined,
            },
            null,
            2,
          ),
        phase: running
          ? "running"
          : error || state.refreshPending
            ? "attention"
            : waiting
              ? "waiting"
              : "completed",
        detail:
          error ||
          (running
            ? state.localBusy
              ? `${state.localAction || "更新谱面资料"}…`
              : state.catalogReading
                ? "正在读取谱面版本与原谱资料…"
                : state.message || "正在处理谱面初稿…"
            : state.refreshPending
              ? "谱面已保存，列表仍需更新。"
              : pending
                ? `${pending.name} 已保留，等待核对或另存。`
                : state.job
                  ? "原请求保留，打开后可读取实际进度和处理结果。"
                  : state.editMessage ||
                    state.message ||
                    "本机初稿与名称输入保留，可继续处理。"),
        version: JSON.stringify([
          state.job?.id,
          state.localBusy,
          state.localAction,
          state.catalogReading,
          pending?.previewToken,
          pending?.name,
          pending?.warning,
          pending?.cached,
          state.editMessage,
          state.message,
          error,
          state.refreshPending,
          state.names,
          state.drafts.map((draft) => [
            draft.id,
            draft.saved,
            draft.savePending,
          ]),
        ]),
      });
    const pdfWaiting =
      state.pdfJob ||
      (state.pdfLast &&
        (!state.pdfLast.paperId || state.pdfLast.adoptionPending)) ||
      state.pdfDrafts.some(
        (draft) => !draft.paperId && draft.contentId === state.source.contentId,
      );
    const pdfError = state.pdfError || state.pdfIssues[0];
    const pdfRunning =
      state.pdfBusy ||
      state.pdfSubmission ||
      state.pdfAdopting ||
      (isBackgroundJobLive(state.pdfJob?.id) && active(state.pdfStatus?.phase));
    if (pdfWaiting || pdfError || pdfRunning || state.pdfMessage)
      add({
        id: `pdf:${key}`,
        problem: problem(pdfError),
        title: "PDF 排版",
        target: "scores",
        source: state.source,
        subject: state.source.title || state.pdfLast?.name || "来源曲目",
        phase: pdfRunning
          ? "running"
          : pdfError
            ? "attention"
            : pdfWaiting
              ? "waiting"
              : "completed",
        detail:
          pdfError ||
          state.pdfMessage ||
          (state.pdfJob
            ? "原排版请求保留，可继续读取结果。"
            : "排版 PDF 保留，可查看、加入谱页或另存。"),
        copy: () =>
          JSON.stringify(
            {
              source: state.source,
              pdfRequest: state.pdfJob,
              latestPdf: state.pdfLast,
            },
            null,
            2,
          ),
        version: JSON.stringify([
          state.pdfJob?.id,
          state.pdfLast?.id,
          state.pdfLast?.paperId,
          state.pdfLast?.adoptionPending,
          state.pdfMessage,
          pdfError,
          state.pdfDrafts.map((draft) => [
            draft.id,
            draft.paperId,
            draft.adoptionPending,
          ]),
        ]),
      });
  }
  for (const { key, source, state } of scoreExportSessions()) {
    const pending =
      (state.legacyPreview && state.legacyKey !== state.legacySavedKey) ||
      (state.artifact && !state.artifact.savedPath) ||
      state.items.some(
        (item) => item.contentId === source.contentId && !item.savedPath,
      ) ||
      state.job;
    if (
      !pending &&
      !state.error &&
      !state.busy &&
      !state.saving &&
      !state.submitting &&
      !state.message
    )
      continue;
    add({
      id: `score-export:${key}`,
      problem: problem(state.error),
      title: "个人标记谱",
      target: "score",
      scoreTool: "export",
      source,
      subject: source.title || state.artifact?.preview.name || "来源曲目",
      phase:
        state.busy ||
        state.saving ||
        state.submitting ||
        (isBackgroundJobLive(state.job?.id) && active(state.status?.phase))
          ? "running"
          : state.error
            ? "attention"
            : pending
              ? "waiting"
              : "completed",
      detail:
        state.error ||
        state.message ||
        "返回原谱后，可从个人标记谱入口继续查看或另存。",
      version: JSON.stringify([
        state.job?.id,
        state.artifact?.id,
        state.artifact?.savedPath,
        state.legacyKey,
        state.legacySavedKey,
        state.error,
        state.message,
      ]),
    });
  }
  for (const { key, source, kind, state } of mediaExportSessions()) {
    const pending =
      state.job ||
      (state.artifact &&
        (!state.artifact.savedPath || state.artifact.savePendingPath)) ||
      state.listing.drafts.some(
        (draft) =>
          draft.contentId === source.contentId &&
          draft.kind === kind &&
          (!draft.savedPath || draft.savePendingPath),
      );
    if (
      !pending &&
      !state.error &&
      !state.busy &&
      !state.submitting &&
      !state.message
    )
      continue;
    add({
      id: `media:${key}`,
      problem: problem(
        state.error ||
          (state.artifact?.savePendingPath
            ? `另存结果尚待核对：${state.artifact.savePendingPath}`
            : ""),
      ),
      title: kind === "midi" ? "MIDI 导出" : "曲目包导出",
      target: "media",
      mediaKind: kind,
      source,
      subject: source.title,
      phase:
        state.busy ||
        state.submitting ||
        (isBackgroundJobLive(state.job?.id) && active(state.status?.phase))
          ? "running"
          : state.error || state.artifact?.savePendingPath
            ? "attention"
            : pending
              ? "waiting"
              : "completed",
      detail:
        state.error ||
        state.message ||
        "成品与原导出请求保留，可打开继续读取或另存。",
      version: JSON.stringify([
        state.job?.id,
        state.artifact?.id,
        state.artifact?.savedPath,
        state.error,
        state.message,
      ]),
    });
  }
  for (const {
    key,
    source,
    sourceFingerprint,
    state,
    session,
  } of locatedPaperSessions()) {
    if (
      !state.busy &&
      !state.dirty &&
      !state.preparedPages &&
      !state.error &&
      !state.storageError &&
      !state.saved
    )
      continue;
    add({
      id: `located:${key}`,
      problem: state.storageError
        ? problem(state.storageError, "input")
        : problem(state.error),
      title: "可定位纸谱",
      target: "score",
      scoreTool: "located",
      sourceFingerprint,
      source,
      subject: source.title || state.name,
      phase: state.busy
        ? "running"
        : state.storageError || state.error
          ? "attention"
          : state.saved
            ? "completed"
            : "waiting",
      detail:
        state.storageError ||
        state.error ||
        state.progress ||
        "返回原谱后点“生成可定位纸谱”，可继续名称、音符选择与已生成图片。",
      copy: session.copy,
      cancel: state.busy && !state.committing ? session.cancel : undefined,
      cancelNeedsEngine: false,
      version: JSON.stringify([
        state.saved?.active,
        state.preparedPages,
        state.error,
        state.storageError,
        state.name,
        state.excluded.size,
      ]),
    });
  }
  const jobs = pendingWorkJobs(sources);
  for (const record of deviceWork) {
    const { engineId, task, lost, readError } = record;
    const active = ["queued", "running", "committing"].includes(task.state);
    const issue = lost
      ? "后台清单中已找不到这次任务，请打开设备设置核对当前连接。"
      : readError
        ? `进度暂未读齐：${readError}`
        : task.error ||
          (task.state === "failed"
            ? "设备操作未完成，请打开设置核对当前连接。"
            : null);
    add({
      id: `device:${engineId}:${task.id}`,
      title: "设备与声音",
      subject: task.label,
      target: "devices",
      phase:
        issue || task.state === "failed"
          ? "attention"
          : active
            ? "running"
            : "completed",
      detail:
        issue ||
        (task.state === "succeeded"
          ? "设备操作已完成，可打开设置核对当前连接。"
          : task.state === "cancelled"
            ? "本次选择已取消，连接清理完成后可继续更换设备。"
            : task.state === "committing"
              ? "正在安装连接并保存选择，请等待完成。"
              : deviceTaskMessage(task)),
      requestEngineIds: [engineId],
      problem: problem(issue),
      dismissible: !active || !!lost,
      cancel:
        active && task.state !== "committing" && !lost && cancelDevice
          ? () => cancelDevice(record)
          : undefined,
      copy: () =>
        [
          `Panthesia · ${task.label}`,
          `连接：${engineId}`,
          `任务：${task.id}`,
          `状态：${task.state}`,
          `阶段：${task.stage}`,
          issue || "",
        ]
          .filter(Boolean)
          .join("\n"),
      version: JSON.stringify([task, lost, readError]),
    });
  }
  return rows.map((row) => {
    const ref = jobs.find((ref) => ref.row === row.id && ref.cancellable);
    return ref ? { ...row, cancel: () => cancelBackgroundJob(ref) } : row;
  });
}

export function createWorkProgressStore(sources: WorkSources) {
  const deviceTasks = createDeviceTaskStore();
  let context: ProgressContext = { connected: false, closing: false };
  let snapshot: WorkSnapshot = {
    connected: false,
    rows: [],
    pending: 0,
    attention: 0,
    running: 0,
    waiting: 0,
    completed: 0,
  };
  let signature = "",
    queued = false;
  const hidden = new Map<string, string>(),
    listeners = new Set<() => void>();
  let releases: (() => void)[] = [];
  let background: ReturnType<typeof startBackgroundJobs> | undefined;
  const rebuild = () => {
    const rows = collectWork(
      sources,
      deviceTasks.getSnapshot(),
      deviceTasks.cancel,
    )
      .map((entry) => {
        const stale =
          !!context.engineId &&
          [entry.source?.engineId, ...(entry.requestEngineIds ?? [])].some(
            (engineId) => !!engineId && engineId !== context.engineId,
          );
        if (stale)
          return {
            ...entry,
            stale,
            dismissible: entry.target === "devices" || entry.dismissible,
            phase:
              entry.phase === "completed"
                ? entry.phase
                : ("attention" as WorkPhase),
            cancel:
              entry.cancelNeedsEngine === false ? entry.cancel : undefined,
            detail:
              entry.target === "devices"
                ? `这项设备工作来自上次连接，仅保留此前读取的结果。${entry.problem?.detail ?? ""}可打开设备设置核对当前选择。`
                : `${entry.detail}\n${entry.target === "imports" ? "队列中有上次连接的请求。" : "这项工作来自上次连接。"}${entry.restoreScoreKey ? "可取回初稿并重新核对；" : ""}已保留文件可从来源曲目核对。`,
          };
        if (
          (entry.source || entry.requestEngineIds?.length) &&
          !context.connected &&
          entry.phase !== "completed"
        )
          return {
            ...entry,
            phase: "attention" as WorkPhase,
            cancel:
              entry.cancelNeedsEngine === false ? entry.cancel : undefined,
            detail: `${entry.detail}\n练习室连接中断，重新连接后可读取原任务。`,
          };
        return entry;
      })
      .filter(
        (entry) =>
          !(entry.phase === "completed" || entry.dismissible) ||
          hidden.get(entry.id) !== entry.version,
      )
      .sort(
        (a, b) =>
          phaseOrder[a.phase] - phaseOrder[b.phase] ||
          a.title.localeCompare(b.title, "zh-CN") ||
          a.id.localeCompare(b.id),
      );
    const next = JSON.stringify([
      context.connected,
      context.engineId,
      context.closing,
      rows.map((row) => [
        row.id,
        row.version,
        row.problem,
        row.keywords,
        row.phase,
        row.detail,
        row.subject,
        row.source,
        row.stale,
        !!row.cancel,
        row.restoreScoreKey,
        row.scoreTool,
        row.sourceFingerprint,
        !!row.copy,
        !!row.dismissible,
      ]),
    ]);
    if (next === signature) return;
    signature = next;
    const count = (phase: WorkPhase) =>
      rows.filter((row) => row.phase === phase).length;
    snapshot = {
      connected: context.connected,
      rows,
      pending: rows.filter((row) => row.phase !== "completed").length,
      attention: count("attention"),
      running: count("running"),
      waiting: count("waiting"),
      completed: count("completed"),
    };
    for (const listener of [...listeners]) listener();
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        queued = false;
        rebuild();
      });
    }
  };
  rebuild();
  return {
    sources,
    getContext: () => context,
    setContext: (next: ProgressContext) => {
      if (JSON.stringify(context) !== JSON.stringify(next)) {
        if (next.connected && next.engineId && (!context.connected || context.engineId !== next.engineId)) void Promise.all([getHistoryOperations().refreshPending(next.engineId), getLibraryOpens().refreshPending(next.engineId)]);
        context = next;
        deviceTasks.setContext(next);
        schedule();
        background?.wake();
      }
    },
    getSnapshot: () => snapshot,
    refresh: schedule,
    readNow: async () => {
      await Promise.all([background?.refresh(), deviceTasks.refresh(), context.engineId ? Promise.all([getHistoryOperations().refreshPending(context.engineId), getLibraryOpens().refreshPending(context.engineId)]) : Promise.resolve()]);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        releases = [
          activitySignal.subscribe(schedule),
          deviceTasks.subscribe(schedule),
          ...[
            sources.imports,
            sources.piecePackage,
            sources.practiceBackup,
            sources.exercise,
            sources.routineWorkbench,
            sources.edits,
          ].map((source) => source.subscribe(schedule)),
        ];
        background = startBackgroundJobs(sources, () => context);
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          releases.forEach((release) => release());
          releases = [];
          background?.stop();
          background = undefined;
        }
      };
    },
    hideCompleted: () => {
      for (const row of snapshot.rows)
        if (row.phase === "completed") hidden.set(row.id, row.version);
      while (hidden.size > 512) hidden.delete(hidden.keys().next().value!);
      schedule();
    },
    dismiss: (entry: WorkEntry) => {
      const current = snapshot.rows.find(
        (row) => row.id === entry.id && row.version === entry.version,
      );
      if (!current?.dismissible) return;
      hidden.set(current.id, current.version);
      while (hidden.size > 512) hidden.delete(hidden.keys().next().value!);
      schedule();
    },
  };
}
export type WorkProgressStore = ReturnType<typeof createWorkProgressStore>;
