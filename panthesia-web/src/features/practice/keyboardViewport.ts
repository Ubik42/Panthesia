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
    keyboardViewport?: KeyboardViewport | null;
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
      if (settings.keyboardViewport)
        return viewportRange(settings.keyboardViewport);
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

/** Fractional white-key coordinates keep notes and pointer hit-testing on one camera. */
export type KeyboardViewport = { start: number; span: number };
export const keyboardWhitePitches = Array.from(
  { length: 128 },
  (_, n) => n,
).filter((n) => !isBlackKey(n));
export const keyboardUnits = (() => {
  let white = 0;
  return Array.from({ length: 128 }, (_, pitch) => {
    const black = isBlackKey(pitch);
    const unit = {
      pitch,
      black,
      x: black ? white - 0.31 : white,
      w: black ? 0.62 : 1,
    };
    if (!black) white++;
    return unit;
  });
})();
export function clampKeyboardViewport(
  start: number,
  span: number,
): KeyboardViewport {
  span = Math.max(
    8,
    Math.min(keyboardWhitePitches.length, Number.isFinite(span) ? span : 29),
  );
  start = Math.max(
    0,
    Math.min(
      keyboardWhitePitches.length - span,
      Number.isFinite(start) ? start : 0,
    ),
  );
  return { start, span };
}
export function normalizeKeyboardViewport(
  value: unknown,
): KeyboardViewport | null {
  if (!value || typeof value !== "object") return null;
  const { start, span } = value as KeyboardViewport;
  if (!Number.isFinite(start) || !Number.isFinite(span)) return null;
  return clampKeyboardViewport(start, span);
}
export function viewportFromRange(range: KeyboardRange): KeyboardViewport {
  const full = normalizeKeyboardRange(range.low, range.high);
  const first = keyboardWhitePitches.indexOf(full.low),
    last = keyboardWhitePitches.indexOf(full.high);
  return clampKeyboardViewport(first, last - first + 1);
}
export function keyboardLayout(viewport: KeyboardViewport) {
  const { start, span } = clampKeyboardViewport(viewport.start, viewport.span);
  return keyboardUnits
    .filter(
      (key) => key.x + key.w > start + 1e-7 && key.x < start + span - 1e-7,
    )
    .map((key) => ({ ...key, x: (key.x - start) / span, w: key.w / span }));
}
export function viewportRange(viewport: KeyboardViewport): KeyboardRange {
  const keys = keyboardLayout(viewport);
  return { low: keys[0].pitch, high: keys[keys.length - 1].pitch };
}
export function resolveKeyboardViewport(
  settings: Parameters<typeof resolveKeyboardRange>[0],
  notes: readonly { pitch: number }[],
  input: string | null,
): KeyboardViewport {
  const saved =
    settings.range === "custom"
      ? normalizeKeyboardViewport(settings.keyboardViewport)
      : null;
  return (
    saved ??
    viewportFromRange(
      resolveKeyboardRange(
        { ...settings, keyboardViewport: null },
        notes,
        input,
      ),
    )
  );
}
export function zoomKeyboardViewport(
  view: KeyboardViewport,
  factor: number,
  anchor = 0.5,
): KeyboardViewport {
  const span = clampKeyboardViewport(0, view.span * factor).span;
  anchor = Math.max(0, Math.min(1, anchor));
  return clampKeyboardViewport(view.start + (view.span - span) * anchor, span);
}
export function panKeyboardViewport(
  view: KeyboardViewport,
  delta: number,
): KeyboardViewport {
  return clampKeyboardViewport(view.start + delta, view.span);
}
export const normalizePreviewBars = (value: number) =>
  Math.max(
    0.5,
    Math.min(16, Math.round((Number.isFinite(value) ? value : 4) * 4) / 4),
  );
export const previewBarsLabel = (value: number) =>
  `${normalizePreviewBars(value)} 小节`;
export function previewTickSpan(
  measures: readonly { startTick: number; endTick: number }[],
  index: number,
  bars: number,
  fallback = 1920,
): number {
  bars = normalizePreviewBars(bars);
  const whole = Math.floor(bars),
    fraction = bars - whole;
  let span = 0;
  for (let n = 0; n < whole; n++) {
    const bar = measures[index + n] ?? measures.at(-1);
    span += bar ? bar.endTick - bar.startTick : fallback;
  }
  const bar = measures[index + whole] ?? measures.at(-1);
  return Math.max(
    1,
    span + fraction * (bar ? bar.endTick - bar.startTick : fallback),
  );
}
