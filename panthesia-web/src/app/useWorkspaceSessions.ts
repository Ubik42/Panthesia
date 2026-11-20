import { createWorkspaceBrowseStore } from "./workspaceBrowseStore";
import { getInterfaceSettings } from "../features/settings/interfaceSettingsStore";
import { getHistoryOperations, historyOperationPending } from "../features/review/historyOperationStore";
import { flushReplayEditors, pendingReplayEditors } from "../features/review/replayEditorStore";
import { getInterfaceWorkbench, hasInterfaceInput } from "../features/settings/interfaceWorkbenchStore";
import { createWorkProgressStore } from "../features/activity/workProgressStore";
import { createBackupSessionStore } from "../features/backups/backupSessionStore";
import { createRoutineWorkbenchStore } from "../features/routines/routineWorkbenchStore";
import { createFingeringWorkbenchStore } from "../features/fingering/fingeringWorkbenchStore";
import { createEditDraftStore } from "../features/editing/editDraftStore";
import { createImportQueueStore } from "../features/imports/importQueueStore";
import { createExerciseSessionStore } from "../features/practice/exerciseSessionStore";
import { createPackageSessionStore } from "../features/imports/packageSessionStore";
import { createScoreWorkspaceStore } from "../features/scores/scoreWorkspaceStore";
import { hasUnsavedScoreExports } from "../features/scores/scoreExportStore";
import { hasWorkingMediaExports } from "../features/exports/mediaExportStore";
import { hasUnstoredPaperViews, flushPaperViewDrafts } from "../features/scores/paperViewStore";
import { pendingPaperLocationDrafts, flushPaperLocationDrafts } from "../features/scores/paperLocationDraftStore";
import { pendingPaperPracticeDrafts, flushPaperPracticeDrafts } from "../features/scores/paperPracticeDraftStore";
import { pendingScoreManagerDrafts, flushScoreManagerDrafts } from "../features/scores/scoreManagerDraftStore";
import { pendingPracticeEditorDrafts, flushPracticeEditorDrafts } from "../features/practice/practiceEditorStore";
import { pendingMeterEditors, flushMeterEditors } from "../features/practice/meterEditorStore";
import { pendingHandEditors, flushHandEditors } from "../features/practice/handEditorStore";
import { registerCloseParticipant } from "./closePreparation";
import { useDesktopClose } from "./useDesktopClose";
import { createLibraryCache } from "../features/library/useLibraryReads";
import { createHistoryCache } from "../features/review/useHistoryBrowser";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryBrowse } from "../features/library/libraryBrowse";
import type { HistoryBrowse } from "../features/review/historyBrowse";

/** Navigation owns durable cursors and session caches; drafts keep their own save rules. */
export function useWorkspaceSessions() {
  const desktopClose = useDesktopClose();
  const [browse] = useState(createWorkspaceBrowseStore);
  useEffect(() => {
    const unload = () => browse.flush();
    const visibility = () => {
      if (document.visibilityState === "hidden") browse.flush();
    };
    window.addEventListener("pagehide", unload);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", visibility);
    const release = registerCloseParticipant("workspace-browsing", {
      label: "浏览位置", prepare: browse.flush, pending: () => null,
    });
    return () => {
      unload();
      release();
      window.removeEventListener("pagehide", unload);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [browse]);
  const [edits] = useState(createEditDraftStore);
  const [historyReads] = useState(() => {
    const cache = createHistoryCache();
    const initial = browse.initialHistory();
    if (initial?.listTopKey) cache.listPositions.set(initial.listTopKey, initial.listTop);
    if (initial?.detailTopKey) cache.detailPositions.set(initial.detailTopKey, initial.detailTop);
    return cache;
  });
  const [imports] = useState(createImportQueueStore);
  const [exercise] = useState(createExerciseSessionStore);
  const [piecePackage] = useState(createPackageSessionStore);
  const [practiceBackup] = useState(createBackupSessionStore);
  const [routineWorkbench] = useState(createRoutineWorkbenchStore);
  const [fingeringWorkbench] = useState(createFingeringWorkbenchStore);
  const [scores] = useState(createScoreWorkspaceStore);
  const [libraryReads] = useState(() => {
    const cache = createLibraryCache();
    const initial = browse.initialLibrary();
    if (initial?.topKey) cache.positions.set(initial.topKey, initial.top);
    if (initial?.detailTopKey) cache.positions.set(initial.detailTopKey, initial.detailTop ?? 0);
    return cache;
  });
  const [workProgress] = useState(() => createWorkProgressStore({ scores, imports, piecePackage, practiceBackup, exercise, routineWorkbench, edits }));
  useEffect(() => { practiceBackup.load(); }, [practiceBackup]);
  useEffect(() => {
    const interfaceSettings = getInterfaceSettings(), interfaceWorkbench = getInterfaceWorkbench();
    const releases = [
      registerCloseParticipant("history-operation-progress", { label: "历史操作进度", prepare: () => getHistoryOperations().retrySave(), pending: historyOperationPending }),
      registerCloseParticipant("replay-editor-drafts", { label: "回放片段输入", prepare: flushReplayEditors, pending: pendingReplayEditors }),
      registerCloseParticipant("interface-settings", {
        label: "界面设置",
        prepare: interfaceSettings.prepareClose,
        pending: interfaceSettings.closeSummary,
      }),
      registerCloseParticipant("interface-workbench", {
        label: "设置窗口输入",
        prepare: () => {
          const state = interfaceWorkbench.getSnapshot();
          if (state.storageError && hasInterfaceInput(state)) interfaceWorkbench.retrySave();
        },
        pending: () => {
          const state = interfaceWorkbench.getSnapshot();
          if (state.busy) return "界面设置文件仍在读写，请返回查看原任务。";
          return hasInterfaceInput(state) ? state.storageError || null : null;
        },
      }),
      registerCloseParticipant("editing-drafts", { label: "编辑输入", prepare: edits.flush, pending: () => {
        const state = edits.getSnapshot(); return state.error && state.count > 0 ? state.error : null;
      } }),
      registerCloseParticipant("backup-workbench", { label: "备份工作进度", prepare: () => practiceBackup.flush(), pending: () => {
        const state = practiceBackup.getSnapshot();
        if (state.storageError) return state.storageError;
        if (state.saving) return "备份工作进度仍在写入本机，请等待保存完成。";
        if (state.preparedExport && !state.preparedExport.savedPath) return "制作好的完整备份尚未另存，当前文件只保留在本次运行中。";
        if (state.busy) return "备份读取或导入尚未结束，原请求与处理结果需要核对。";
        return null;
      } }),
      registerCloseParticipant("routine-workbench", { label: "计划草稿", pending: () => {
        const state = routineWorkbench.getSnapshot();
        return state.storageError && [state.metadata, state.items, state.schedules, state.pending].some((rows) => Object.keys(rows).length) ? state.storageError : null;
      } }),
      registerCloseParticipant("fingering-workbench", { label: "指法输入", pending: () => fingeringWorkbench.getSnapshot().error || null }),
      registerCloseParticipant("paper-location-drafts", { label: "谱页位置草稿", prepare: flushPaperLocationDrafts, pending: pendingPaperLocationDrafts }),
      registerCloseParticipant("paper-practice-drafts", { label: "纸谱练习段输入", prepare: flushPaperPracticeDrafts, pending: pendingPaperPracticeDrafts }),
      registerCloseParticipant("score-manager-drafts", { label: "谱面管理输入", prepare: flushScoreManagerDrafts, pending: pendingScoreManagerDrafts }),
      registerCloseParticipant("practice-editor-drafts", { label: "练习段与速度阶梯输入", prepare: flushPracticeEditorDrafts, pending: pendingPracticeEditorDrafts }),
      registerCloseParticipant("meter-editor-drafts", { label: "小节网格输入", prepare: flushMeterEditors, pending: pendingMeterEditors }),
      registerCloseParticipant("hand-editor-drafts", { label: "逐音分手输入", prepare: flushHandEditors, pending: pendingHandEditors }),
      registerCloseParticipant("exercise-workbench", { label: "技术练习输入", pending: () => {
        const state = exercise.getSnapshot(); return state.storageError && (state.dirty || state.receipt || state.result) ? state.storageError : null;
      } }),
      registerCloseParticipant("package-workbench", { label: "曲目包工作进度", pending: () => {
        const state = piecePackage.getSnapshot(); return state.storageError && (state.summary || state.receipt || state.result) ? state.storageError : null;
      } }),
      registerCloseParticipant("ordinary-imports", { label: "导入队列", prepare: () => imports.retrySave(), pending: () => {
        const state = imports.getSnapshot();
        if (state.storageError) return state.storageError;
        if (state.busy) return "当前文件仍在导入。返回队列可暂停；已保存的队列和原文件继续保留。";
        return null;
      } }),
      registerCloseParticipant("score-workbench", { label: "谱面工作台", pending: scores.closeSummary }),
      registerCloseParticipant("score-exports", { label: "个人标记谱", pending: () => hasUnsavedScoreExports() ? "还有尚未另存的标记谱或未结束的导出，当前成品缓存会在退出后释放。" : null }),
      registerCloseParticipant("media-exports", { label: "曲目导出", pending: () => hasWorkingMediaExports() ? "MIDI 或曲目包导出尚未结束，请返回查看原任务。已保留的成品会继续保存。" : null }),
      registerCloseParticipant("paper-reading", { label: "谱页阅读位置", prepare: flushPaperViewDrafts, pending: () => hasUnstoredPaperViews() ? "当前阅读位置尚未暂存，可返回谱页重试或复制输入。" : null }),
      registerCloseParticipant("library-repairs", { label: "文件位置修复", pending: () => {
        const state = libraryReads.repairDraftStatus();
        return state?.storageError && (Object.keys(state.selected).length || Object.keys(state.unconfirmed).length || state.refreshPending) ? state.storageError : null;
      } }),
    ];
    return () => releases.forEach((release) => release());
  }, [edits, practiceBackup, routineWorkbench, fingeringWorkbench, exercise, piecePackage, imports, scores, libraryReads]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (edits.getSnapshot().pending) edits.flush();
      const editStatus = edits.getSnapshot();
      if (
        editStatus.busy ||
        hasUnstoredPaperViews() ||
        !!pendingPracticeEditorDrafts() ||
        (!!editStatus.error && editStatus.count > 0) ||
        routineWorkbench.getSnapshot().busy ||
        (!!routineWorkbench.getSnapshot().storageError &&
          (Object.keys(routineWorkbench.getSnapshot().metadata).length > 0 ||
            Object.keys(routineWorkbench.getSnapshot().items).length > 0 ||
            Object.keys(routineWorkbench.getSnapshot().schedules).length > 0 ||
            Object.keys(routineWorkbench.getSnapshot().pending).length > 0)) ||
        imports.getSnapshot().busy ||
        !!imports.getSnapshot().storageError ||
        exercise.getSnapshot().busy ||
        exercise.getSnapshot().phase === "review" ||
        (!!exercise.getSnapshot().storageError &&
          (exercise.getSnapshot().dirty || exercise.getSnapshot().receipt || exercise.getSnapshot().result)) ||
        piecePackage.getSnapshot().busy ||
        practiceBackup.getSnapshot().busy ||
        practiceBackup.getSnapshot().saving ||
        (!!practiceBackup.getSnapshot().preparedExport &&
          !practiceBackup.getSnapshot().preparedExport?.savedPath) ||
        (!!practiceBackup.getSnapshot().storageError &&
          (!!practiceBackup.getSnapshot().summary ||
            !!practiceBackup.getSnapshot().request)) ||
        scores.hasWorking() ||
        hasUnsavedScoreExports() ||
        hasWorkingMediaExports() ||
        piecePackage.getSnapshot().phase === "review" ||
        (!!piecePackage.getSnapshot().storageError &&
          (!!piecePackage.getSnapshot().summary || !!piecePackage.getSnapshot().receipt || !!piecePackage.getSnapshot().result))
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [
    imports,
    exercise,
    piecePackage,
    practiceBackup,
    scores,
    routineWorkbench,
    edits,
  ]);
  const library = useRef<LibraryBrowse | undefined>(browse.initialLibrary()),
    history = useRef<HistoryBrowse | undefined>(browse.initialHistory());
  const rememberLibrary = useCallback((value: LibraryBrowse) => {
    library.current = value;
    browse.rememberLibrary(value);
  }, [browse]);
  const rememberHistory = useCallback((value: HistoryBrowse) => {
    history.current = value;
    browse.rememberHistory(value);
  }, [browse]);
  return {
    desktopClose,
    browse,
    workProgress,
    edits,
    learning: edits.learning,
    imports,
    exercise,
    piecePackage,
    practiceBackup,
    routineWorkbench,
    scores,
    fingeringWorkbench,
    expressions: edits.expressions,
    historyReads,
    libraryReads,
    annotations: edits.annotations,
    metadata: edits.metadata,
    library: library.current,
    history: history.current,
    rememberLibrary,
    rememberHistory,
  };
}
