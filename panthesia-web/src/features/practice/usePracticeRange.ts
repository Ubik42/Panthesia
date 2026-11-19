import { useEffect, useMemo, useState } from "react";
import type { LoadedSong, Note, Snapshot } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./PlaybackView";
const fields = ["passage", "contentId", "scoreRevision"] as const;
type Draft = {
  source: string;
  a: number | null;
  b: number | null;
  picking: boolean;
  anchor: { start: number; end: number } | null;
};
export type PracticeRange = NonNullable<Snapshot["passage"]>;
/** UI selection is a draft; only the engine's passage is an active practice loop. */
export function usePracticeRange(
  song: LoadedSong | null,
  store: PlaybackStore,
) {
  const state = usePlaybackFields(store, fields);
  const source = `${song?.engineId}:${song?.contentId}:${song?.scoreRevision}`;
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(
    () => setDraft(null),
    [source, state.passage?.start, state.passage?.end],
  );
  const current = draft?.source === source ? draft : null;
  const matches = () => {
    const s = store.getSnapshot();
    return (
      !!song &&
      s.contentId === song.contentId &&
      s.scoreRevision === song.scoreRevision &&
      s.stateOrder?.engineId === song.engineId
    );
  };
  const empty = (): Draft => ({
    source,
    a: null,
    b: null,
    picking: false,
    anchor: null,
  });
  const clip = (position: number) =>
    Math.max(0, Math.min(song?.duration ?? 0, position));
  const markers = current
    ? { a: current.a, b: current.b }
    : { a: state.passage?.start ?? null, b: state.passage?.end ?? null };
  const range = useMemo(
    () =>
      markers.a !== null && markers.b !== null && markers.b - markers.a >= 0.1
        ? { start: markers.a, end: markers.b }
        : null,
    [markers.a, markers.b],
  );
  const pick = (note: Note) => {
    if (!matches()) return;
    const start = clip(note.start),
      end = clip(note.start + note.duration);
    setDraft((previous) => {
      if (previous?.source === source && previous.picking && previous.anchor) {
        return {
          source,
          a: Math.min(start, previous.anchor.start),
          b: Math.max(end, previous.anchor.end),
          picking: false,
          anchor: null,
        };
      }
      return {
        source,
        a: start,
        b: null,
        picking: true,
        anchor: { start, end },
      };
    });
  };
  return {
    markers,
    range,
    picking: current?.picking ?? false,
    hasAnchor: !!current?.anchor,
    dirty: !!current,
    matches,
    pick,
    toggle: () => {
      if (matches())
        setDraft((previous) =>
          previous?.source === source && previous.picking
            ? null
            : { ...empty(), picking: true },
        );
    },
    cancelPicking: () =>
      setDraft((previous) => (previous?.picking ? null : previous)),
    mark: (endpoint: "a" | "b") => {
      if (!matches()) return;
      const position = clip(store.getSnapshot().position);
      setDraft((previous) => ({
        ...empty(),
        ...(previous?.source === source
          ? previous
          : { a: state.passage?.start ?? null, b: state.passage?.end ?? null }),
        [endpoint]: position,
        picking: false,
        anchor: null,
      }));
    },
    reset: () => setDraft(null),
  };
}
export type PracticeRangeController = ReturnType<typeof usePracticeRange>;
