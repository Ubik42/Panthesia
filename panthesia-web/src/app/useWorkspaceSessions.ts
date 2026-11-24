import { createWorkProgressStore } from "../features/activity/workProgressStore";
import { createFingeringWorkbenchStore } from "../features/fingering/fingeringWorkbenchStore";
import { createEditDraftStore } from "../features/editing/editDraftStore";
import { createExerciseSessionStore } from "../features/practice/exerciseSessionStore";
import { createScoreWorkspaceStore } from "../features/scores/scoreWorkspaceStore";
import { hasUnsavedScoreExports } from "../features/scores/scoreExportStore";
import { hasWorkingMediaExports } from "../features/exports/mediaExportStore";
import { hasUnstoredPaperViews } from "../features/scores/paperViewStore";
import { pendingPracticeEditorDrafts } from "../features/practice/practiceEditorStore";
import { useEffect, useState } from "react";

/** Navigation owns durable cursors and session caches; drafts keep their own save rules. */
export function useWorkspaceSessions() {
  const [edits] = useState(createEditDraftStore);
  const [exercise] = useState(createExerciseSessionStore);
  const [fingeringWorkbench] = useState(createFingeringWorkbenchStore);
  const [scores] = useState(createScoreWorkspaceStore);
  const [workProgress] = useState(() => createWorkProgressStore({ scores, exercise, edits }));
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
    workProgress,
    edits,
    exercise,
    scores,
    fingeringWorkbench,
    metadata: edits.metadata,
  };
}
