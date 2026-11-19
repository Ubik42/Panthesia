import { useCallback, useEffect, useRef } from "react";
import { api, type PracticeEditScope, type PracticeReadCommand } from "../api";
export type CatalogReadCommand = Extract<
  PracticeReadCommand,
  {
    type:
      | "passages"
      | "ladderPresets"
      | "exercisePresets"
      | "previewTickRange"
      | "previewScoreRange"
      | "previewScoreRangeTrim";
  }
>;

export const capturePracticeScope = (
  source: PracticeEditScope,
): PracticeEditScope => ({
  engineId: source.engineId,
  contentId: source.contentId,
  scoreRevision: source.scoreRevision,
  annotationRevision: source.annotationRevision,
});
export const samePracticeScope = (
  left: PracticeEditScope,
  right: PracticeEditScope,
) =>
  left.engineId === right.engineId &&
  left.contentId === right.contentId &&
  left.scoreRevision === right.scoreRevision &&
  left.annotationRevision === right.annotationRevision;

// A catalog request owns one source snapshot and one sequence. Late successes,
// failures and loading completions cannot replace a newer editor view.
export function useCatalogRead(
  scope: PracticeEditScope,
  visibleSource: PracticeEditScope = scope,
) {
  const current = useRef(scope);
  current.current = scope;
  const identity = JSON.stringify([
    visibleSource.engineId,
    visibleSource.contentId,
    visibleSource.scoreRevision,
    visibleSource.annotationRevision,
  ]);
  const state = useRef({ identity, generation: 0, sequence: 0, alive: true });
  if (state.current.identity !== identity) {
    state.current.identity = identity;
    state.current.generation++;
  }
  useEffect(() => {
    state.current.alive = true;
    return () => {
      state.current.alive = false;
      state.current.sequence++;
    };
  }, []);
  return useCallback(<T>(command: CatalogReadCommand) => {
    const source = capturePracticeScope(current.current),
      generation = state.current.generation;
    const sequence = ++state.current.sequence;
    return {
      result: api.readPractice<T>(source, command),
      isCurrent: () =>
        state.current.alive &&
        generation === state.current.generation &&
        sequence === state.current.sequence,
    };
  }, []);
}
