import type { ComponentProps } from "react";
import type { LoadedSong, Snapshot } from "../../api";
import type { ExpressionDraft } from "./expressionDraft";
import { SongExpressionGoals } from "./SongExpressionGoals";
import { useSongExpressionGoal } from "./useSongExpressionGoal";

/** Editing and persistence notifications stay within the inspector. */
export function SongExpressionEditor({
  song,
  state,
  drafts,
  synchronize,
  busy,
  locked,
  planActive,
  reveal,
  sourceReady,
  revealHandled,
}: {
  song: LoadedSong;
  state: ComponentProps<typeof SongExpressionGoals>["state"];
  drafts: Map<string, ExpressionDraft>;
  synchronize: () => Promise<Snapshot>;
  busy: boolean;
  locked: boolean;
  planActive: boolean;
  reveal?: string;
  sourceReady: boolean;
  revealHandled?: (id: string) => void;
}) {
  const editor = useSongExpressionGoal(
    song,
    state.songExpressionGoal ?? null,
    drafts,
    synchronize,
    sourceReady,
  );
  return (
    <SongExpressionGoals
      contentId={song.contentId}
      state={{ ...state, songExpressionGoal: editor.savedGoal }}
      draft={editor.draft}
      inputs={editor.inputs}
      changeInputs={editor.changeInputs}
      base={editor.base}
      dirty={editor.dirty}
      conflict={editor.conflict}
      change={editor.change}
      save={() => void editor.save()}
      reset={editor.undo}
      resolveConflict={editor.resolveConflict}
      resolveConflictInputs={editor.resolveConflictInputs}
      pendingRefresh={editor.pendingRefresh}
      pendingPhase={editor.pendingPhase}
      retrySave={() => void editor.retrySave()}
      continueEditing={editor.continueEditing}
      inputError={editor.inputError}
      drafts={drafts}
      reveal={reveal}
      revealHandled={revealHandled}
      refresh={() => void editor.retryRefresh()}
      error={editor.error}
      notice={editor.notice}
      busy={busy || !sourceReady || editor.busy}
      locked={locked}
      planActive={planActive}
    />
  );
}
