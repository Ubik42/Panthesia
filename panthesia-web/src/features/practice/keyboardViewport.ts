export type KeyboardRange = { low: number; high: number };
export type KeyboardRangeMode = 49 | 88 | "song" | "device" | "custom";
export const isBlackKey = (pitch: number) =>
  [1, 3, 6, 8, 10].includes(pitch % 12);
const pitch = (value: number) => Math.max(0, Math.min(127, Math.round(value)));

/** Include full white keys at both edges so the keyboard and falling notes share one geometry. */
export function normalizeKeyboardRange(
  low: number,
  high: number,
): KeyboardRange {
  low = pitch(Number.isFinite(low) ? low : 36);
  high = pitch(Number.isFinite(high) ? high : 84);
  if (low > high) [low, high] = [high, low];
  if (high - low < 11) {
    const center = (low + high) / 2;
    low = Math.max(0, Math.min(116, Math.round(center - 5.5)));
    high = low + 11;
  }
  if (isBlackKey(low)) low--;
  if (isBlackKey(high)) high++;
  return { low, high };
}

export function normalizeDeviceRanges(
  value: unknown,
): Record<string, KeyboardRange> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 128)
      .flatMap(([name, range]) => {
        if (!name || name.length > 512 || !range || typeof range !== "object")
          return [];
        const { low, high } = range as KeyboardRange;
        if (
          !Number.isInteger(low) ||
          !Number.isInteger(high) ||
          low < 0 ||
          high > 127 ||
          high - low < 11
        )
          return [];
        // Device limits describe the real hardware, including black-key endpoints.
        return [[name, { low, high }]];
      }),
  );
}

export function songKeyboardRange(
  notes: readonly { pitch: number }[],
): KeyboardRange {
  if (!notes.length) return { low: 36, high: 84 };
  let low = 127,
    high = 0;
  for (const note of notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  const width = Math.max(24, high - low + 6);
  const first = Math.max(
    0,
    Math.min(127 - width, Math.floor((low + high - width) / 2)),
  );
  return normalizeKeyboardRange(first, first + width);
}

export function resolveKeyboardRange(
  settings: {
    range: KeyboardRangeMode;
    keyboardLow: number;
    keyboardHigh: number;
    keyboardDeviceRanges: Record<string, KeyboardRange>;
  },
  notes: readonly { pitch: number }[],
  input: string | null,
): KeyboardRange {
  switch (settings.range) {
    case "song":
      return songKeyboardRange(notes);
    case "custom":
      return normalizeKeyboardRange(
        settings.keyboardLow,
        settings.keyboardHigh,
      );
    case "device": {
      const saved = input ? settings.keyboardDeviceRanges[input] : undefined;
      return saved
        ? normalizeKeyboardRange(saved.low, saved.high)
        : { low: 21, high: 108 };
    }
    case 88:
      return { low: 21, high: 108 };
    default:
      return { low: 36, high: 84 };
  }
}

const whitePitches = Array.from({ length: 128 }, (_, n) => n).filter(
  (n) => !isBlackKey(n),
);
export function zoomKeyboardRange(
  range: KeyboardRange,
  direction: number,
  anchor = 0.5,
): KeyboardRange {
  const first = whitePitches.indexOf(range.low),
    last = whitePitches.indexOf(range.high);
  const count = last - first + 1;
  const size = Math.max(
    8,
    Math.min(whitePitches.length, count + (direction > 0 ? -2 : 2)),
  );
  const start = Math.max(
    0,
    Math.min(
      whitePitches.length - size,
      Math.round(first + (count - size) * Math.max(0, Math.min(1, anchor))),
    ),
  );
  return { low: whitePitches[start], high: whitePitches[start + size - 1] };
}
export function panKeyboardRange(
  range: KeyboardRange,
  steps: number,
): KeyboardRange {
  const first = whitePitches.indexOf(range.low),
    last = whitePitches.indexOf(range.high);
  const start = Math.max(
    0,
    Math.min(
      whitePitches.length - (last - first + 1),
      first + Math.round(steps),
    ),
  );
  return { low: whitePitches[start], high: whitePitches[start + last - first] };
}
