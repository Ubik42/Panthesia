import { getInterfaceSettings } from "../features/settings/interfaceSettingsStore";
import { getInterfaceWorkbench, hasInterfaceInput } from "../features/settings/interfaceWorkbenchStore";
import { createWorkProgressStore } from "../features/activity/workProgressStore";
import { createFingeringWorkbenchStore } from "../features/fingering/fingeringWorkbenchStore";
import { createEditDraftStore } from "../features/editing/editDraftStore";
import { createExerciseSessionStore } from "../features/practice/exerciseSessionStore";
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
import { useEffect, useState } from "react";

/** Navigation owns durable cursors and session caches; drafts keep their own save rules. */
export function useWorkspaceSessions() {
  const desktopClose = useDesktopClose();
  const [edits] = useState(createEditDraftStore);
  const [exercise] = useState(createExerciseSessionStore);
  const [fingeringWorkbench] = useState(createFingeringWorkbenchStore);
  const [scores] = useState(createScoreWorkspaceStore);
  const [workProgress] = useState(() => createWorkProgressStore({ scores, exercise, edits }));
  useEffect(() => {
    const interfaceSettings = getInterfaceSettings(), interfaceWorkbench = getInterfaceWorkbench();
    const releases = [
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
      registerCloseParticipant("fingering-workbench", { label: "指法输入", pending: () => fingeringWorkbench.getSnapshot().error || null }),
      registerCloseParticipant("paper-location-drafts", { label: "谱页位置草稿", prepare: flushPaperLocationDrafts, pending: pendingPaperLocationDrafts }),
      registerCloseParticipant("paper-practice-drafts", { label: "纸谱练习段输入", prepare: flushPaperPracticeDrafts, pending: pendingPaperPracticeDrafts }),
      registerCloseParticipant("score-manager-drafts", { label: "谱面管理输入", prepare: flushScoreManagerDrafts, pending: pendingScoreManagerDrafts }),
      registerCloseParticipant("practice-editor-drafts", { label: "练习段输入", prepare: flushPracticeEditorDrafts, pending: pendingPracticeEditorDrafts }),
      registerCloseParticipant("meter-editor-drafts", { label: "小节网格输入", prepare: flushMeterEditors, pending: pendingMeterEditors }),
      registerCloseParticipant("hand-editor-drafts", { label: "逐音分手输入", prepare: flushHandEditors, pending: pendingHandEditors }),
      registerCloseParticipant("exercise-workbench", { label: "技术练习输入", pending: () => {
        const state = exercise.getSnapshot(); return state.storageError && (state.dirty || state.receipt || state.result) ? state.storageError : null;
      } }),
      registerCloseParticipant("score-workbench", { label: "谱面工作台", pending: scores.closeSummary }),
      registerCloseParticipant("score-exports", { label: "个人标记谱", pending: () => hasUnsavedScoreExports() ? "还有尚未另存的标记谱或未结束的导出，当前成品缓存会在退出后释放。" : null }),
      registerCloseParticipant("media-exports", { label: "曲目导出", pending: () => hasWorkingMediaExports() ? "MIDI 或曲目包导出尚未结束，请返回查看原任务。已保留的成品会继续保存。" : null }),
      registerCloseParticipant("paper-reading", { label: "谱页阅读位置", prepare: flushPaperViewDrafts, pending: () => hasUnstoredPaperViews() ? "当前阅读位置尚未暂存，可返回谱页重试或复制输入。" : null }),
    ];
    return () => releases.forEach((release) => release());
  }, [edits, fingeringWorkbench, exercise, scores]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (edits.getSnapshot().pending) edits.flush();
      const editStatus = edits.getSnapshot();
      if (
        editStatus.busy ||
        hasUnstoredPaperViews() ||
        !!pendingPracticeEditorDrafts() ||
        (!!editStatus.error && editStatus.count > 0) ||
        exercise.getSnapshot().busy ||
        exercise.getSnapshot().phase === "review" ||
        (!!exercise.getSnapshot().storageError &&
          (exercise.getSnapshot().dirty || exercise.getSnapshot().receipt || exercise.getSnapshot().result)) ||
        scores.hasWorking() ||
        hasUnsavedScoreExports() ||
        hasWorkingMediaExports()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [
    exercise,
    scores,
    edits,
  ]);
  return {
    desktopClose,
    workProgress,
    edits,
    exercise,
    scores,
    fingeringWorkbench,
    metadata: edits.metadata,
  };
}
