import { useMemo } from "react";
import type { DisplayPreferences } from "../settings/displayPreferences";
import { resolveKeyboardViewport, viewportRange, type KeyboardViewport } from "./keyboardViewport";

/** The stage's keyboard viewport from the display settings, the song and the input device, and
 * how many song notes fall outside it. */
export function useKeyboardViewport(
  display: DisplayPreferences,
  setDisplay: (update: (previous: DisplayPreferences) => DisplayPreferences) => void,
  notes: readonly { pitch: number }[] | undefined,
  input: string | null,
) {
  const { range, keyboardViewport, keyboardLow, keyboardHigh, keyboardDeviceRanges } = display;
  const pianoViewport = useMemo(
    () => resolveKeyboardViewport({ range, keyboardViewport, keyboardLow, keyboardHigh, keyboardDeviceRanges }, notes ?? [], input),
    [range, keyboardViewport, keyboardLow, keyboardHigh, keyboardDeviceRanges, notes, input],
  );
  const pianoRange = useMemo(() => viewportRange(pianoViewport), [pianoViewport]);
  const changePianoViewport = (viewport: KeyboardViewport) => {
    const next = viewportRange(viewport);
    setDisplay((previous) => ({ ...previous, range: "custom", keyboardViewport: viewport, keyboardLow: next.low, keyboardHigh: next.high }));
  };
  // Prefix counts of note pitches: notes below the range plus notes above it.
  const pitchCounts = useMemo(() => {
    const counts = Array<number>(129).fill(0);
    for (const note of notes ?? []) counts[note.pitch + 1]++;
    for (let pitch = 1; pitch < counts.length; pitch++) counts[pitch] += counts[pitch - 1];
    return counts;
  }, [notes]);
  const outsidePianoRange = pitchCounts[pianoRange.low] + pitchCounts[128] - pitchCounts[pianoRange.high + 1];
  return { pianoViewport, pianoRange, changePianoViewport, outsidePianoRange };
}
