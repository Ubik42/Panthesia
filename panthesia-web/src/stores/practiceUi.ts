import { create } from "zustand";
import type { LoadedSong } from "../api";
import type { FingeringDraft } from "../features/fingering/fingeringWorkbenchStore";
import type { ScoreToolRequest } from "../features/scores/scoreToolRequest";

type PracticeUi = {
  /** Finger numbers are edited on the stage keyboard. */
  editFingers: boolean;
  selectedNote: LoadedSong["notes"][number] | null;
  fingeringDraft: FingeringDraft | null;
  /** Bumped when paper annotations change, so paper views reload. */
  paperRevision: number;
  /** One-line message under the stage (not an error). */
  notice: string;
  /** Loop range in measure numbers. */
  loopStart: number;
  loopEnd: number;
  /** Command ids (app/applicationCommands), newest first. */
  recentCommands: string[];
  /** A score tool opened from elsewhere (work progress), for the score view to pick up. */
  scoreToolRequest: ScoreToolRequest | null;
};

/** Interface state of the open song that is not engine state: selection, drafts, loop
 * fields and messages (frontend-architecture.md §1, stores). */
export const usePracticeUi = create<PracticeUi>()(() => ({
  editFingers: false,
  selectedNote: null,
  fingeringDraft: null,
  paperRevision: 0,
  notice: "",
  loopStart: 1,
  loopEnd: 0,
  recentCommands: [],
  scoreToolRequest: null,
}));

type Update<T> = T | ((previous: T) => T);
const setter =
  <K extends keyof PracticeUi>(key: K) =>
  (value: Update<PracticeUi[K]>) =>
    usePracticeUi.setState((s) => ({ [key]: typeof value === "function" ? (value as (p: PracticeUi[K]) => PracticeUi[K])(s[key]) : value }) as Partial<PracticeUi>);

export const practiceUi = {
  setEditFingers: setter("editFingers"),
  setSelectedNote: setter("selectedNote"),
  setFingeringDraft: setter("fingeringDraft"),
  setPaperRevision: setter("paperRevision"),
  setNotice: setter("notice"),
  setLoopStart: setter("loopStart"),
  setLoopEnd: setter("loopEnd"),
  setRecentCommands: setter("recentCommands"),
  setScoreToolRequest: setter("scoreToolRequest"),
  clearScoreToolRequest: () => usePracticeUi.setState({ scoreToolRequest: null }),
};
