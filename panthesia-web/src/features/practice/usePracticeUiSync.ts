import { useEffect, useRef } from "react";
import type { LoadedSong, Snapshot } from "../../api";
import { practiceUi } from "../../stores/practiceUi";

/** Keeps the practice interface state (stores/practiceUi) consistent with the open song:
 * the selected note follows its song across revisions, the fingering draft ends with its
 * dialog, and the loop fields follow the engine's passage. */
export function usePracticeUiSync(song: LoadedSong | null, passage: Snapshot["passage"], fingeringDialog: boolean) {
  const selectionSong = useRef(song?.contentId ?? null);
  useEffect(() => {
    const previousSong = selectionSong.current;
    selectionSong.current = song?.contentId ?? null;
    practiceUi.setSelectedNote((previous) => {
      if (!previous || !song) return null;
      // History navigation can install a new song and select its note in one action.
      if (song.notes.includes(previous)) return previous;
      if (previousSong !== song.contentId) return null;
      return song.notes.find((note) => note.track === previous.track && note.index === previous.index
        && note.pitch === previous.pitch && Math.abs(note.start - previous.start) < 0.000001
        && Math.abs(note.duration - previous.duration) < 0.000001) ?? null;
    });
  }, [song?.contentId, song?.scoreRevision, song?.annotationRevision, song?.notes]);
  useEffect(() => {
    if (!fingeringDialog) practiceUi.setFingeringDraft(null);
  }, [fingeringDialog]);
  useEffect(() => {
    practiceUi.setLoopStart(song?.measures.find((m) => m.start === passage?.start)?.number ?? 1);
    practiceUi.setLoopEnd(passage ? (song?.measures.find((m) => m.end >= passage.end)?.number ?? 1) : (song?.measures.length ?? 1));
  }, [song?.contentId, song?.duration, passage?.start, passage?.end]);
}
