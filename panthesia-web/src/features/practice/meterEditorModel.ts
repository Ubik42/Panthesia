import type { LoadedSong, MeterMap } from "../../api";
export interface MeterSegmentInput {
  key: string;
  measure: string;
  numerator: string;
  denominator: string;
  display: string;
}
export interface MeterLengthInput {
  key: string;
  measure: string;
  beats: string;
}
export interface MeterForm {
  pickup: string;
  segments: MeterSegmentInput[];
  lengths: MeterLengthInput[];
}
export const meterDenominators = [1, 2, 4, 8, 16, 32, 64, 128];
function segmentAt<Row extends { measure: number }>(
  segments: Row[],
  measure: number,
): Row {
  let low = 0,
    high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle].measure <= measure) low = middle + 1;
    else high = middle;
  }
  return segments[Math.max(0, low - 1)];
}
export function meterFromSong(song: LoadedSong): MeterMap {
  if (song.meterMap)
    return {
      ...structuredClone(song.meterMap),
      measure_lengths: song.meterMap.measure_lengths ?? [],
    };
  const measure_lengths = song.measures
    .filter(
      (row, index) =>
        index > 0 && index < song.measures.length - 1 && row.partial,
    )
    .map((row) => ({
      measure: row.number,
      ticks: row.endTick - row.startTick,
    }));
  if (song.meterCorrection)
    return {
      pickup_ticks: song.meterCorrection.pickup_ticks,
      measure_lengths,
      segments: [
        {
          measure: 1,
          numerator: song.meterCorrection.numerator,
          denominator: song.meterCorrection.denominator,
          display_start: 1,
        },
      ],
    };
  const first = song.measures[0],
    segments = song.measures
      .filter(
        (row, index, all) =>
          !index ||
          row.numerator !== all[index - 1].numerator ||
          row.denominator !== all[index - 1].denominator,
      )
      .map((row) => ({
        measure: row.number,
        numerator: row.numerator,
        denominator: row.denominator,
        display_start: null,
      }));
  return {
    measure_lengths,
    pickup_ticks:
      first?.partial &&
      first.endTick - first.startTick <
        (song.ppq * 4 * first.numerator) / first.denominator
        ? first.endTick - first.startTick
        : 0,
    segments: segments.length
      ? segments
      : [{ measure: 1, numerator: 4, denominator: 4, display_start: null }],
  };
}
export const nativeMeterValue = (song: LoadedSong) =>
  song.meterMap || song.meterCorrection ? meterFromSong(song) : null;
export const meterValueKey = (map: MeterMap | null) =>
  JSON.stringify(
    map && {
      pickup_ticks: map.pickup_ticks,
      segments: map.segments,
      measure_lengths: map.measure_lengths ?? [],
    },
  );
export function meterForm(map: MeterMap, ppq: number): MeterForm {
  const unit = (measure: number) =>
    (ppq * 4) / segmentAt(map.segments, measure).denominator;
  return {
    pickup: String(map.pickup_ticks / unit(1)),
    segments: map.segments.map((row) => ({
      key: crypto.randomUUID(),
      measure: String(row.measure),
      numerator: String(row.numerator),
      denominator: String(row.denominator),
      display: row.display_start === null ? "" : String(row.display_start),
    })),
    lengths: (map.measure_lengths ?? []).map((row) => ({
      key: crypto.randomUUID(),
      measure: String(row.measure),
      beats: String(row.ticks / unit(row.measure)),
    })),
  };
}
export const meterFormKey = (form: MeterForm) =>
  JSON.stringify({
    pickup: form.pickup,
    segments: form.segments.map(({ key: _key, ...row }) => row),
    lengths: form.lengths.map(({ key: _key, ...row }) => row),
  });
const integer = (text: string) =>
  /^-?\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : NaN;
const decimal = (text: string) =>
  /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
export function parseMeterForm(
  form: MeterForm,
  ppq: number,
): { value: MeterMap | null; error: string } {
  const fail = (error: string) => ({ value: null, error });
  if (
    !form.segments.length ||
    form.segments.length > 1024 ||
    form.lengths.length > 1024
  )
    return fail("拍号变化和不完整小节各最多 1024 项。");
  const segments: MeterMap["segments"] = [];
  for (const [index, row] of form.segments.entries()) {
    const measure = integer(row.measure),
      numerator = integer(row.numerator),
      denominator = integer(row.denominator),
      display_start = row.display === "" ? null : integer(row.display);
    if (
      !Number.isInteger(measure) ||
      measure < 1 ||
      measure > 1_000_000 ||
      (!index && measure !== 1) ||
      (index > 0 && measure <= segments[index - 1].measure)
    )
      return fail("拍号从第 1 小节开始，后续位置需按小节递增。");
    if (
      !Number.isInteger(numerator) ||
      numerator < 1 ||
      numerator > 32 ||
      !meterDenominators.includes(denominator) ||
      (ppq * 4) % denominator !== 0
    )
      return fail("请填写 1–32 的每小节拍数，并选择当前文件可表达的单位音符。");
    if (
      display_start !== null &&
      (!Number.isInteger(display_start) ||
        display_start < -9999 ||
        display_start > 999999)
    )
      return fail("显示编号可留空，或填写 -9999 至 999999 的整数。");
    segments.push({ measure, numerator, denominator, display_start });
  }
  const pickup = decimal(form.pickup),
    firstUnit = (ppq * 4) / segments[0].denominator;
  if (!Number.isFinite(pickup) || pickup < 0 || pickup >= segments[0].numerator)
    return fail("弱起拍数可填 0；弱起长度需短于完整首小节。");
  const pickup_ticks = Math.round(pickup * firstUnit);
  if (
    !Number.isSafeInteger(pickup_ticks) ||
    (pickup > 0 &&
      (pickup_ticks < 1 || pickup_ticks >= firstUnit * segments[0].numerator))
  )
    return fail("请按文件精度调整弱起拍数，使长度大于 0 并短于完整首小节。");
  const seen = new Set<number>(),
    measure_lengths: MeterMap["measure_lengths"] = [];
  for (const row of form.lengths) {
    const measure = integer(row.measure),
      beats = decimal(row.beats);
    if (
      !Number.isInteger(measure) ||
      measure < 2 ||
      measure > 1_000_000 ||
      seen.has(measure)
    )
      return fail("不完整小节从第 2 小节起填写，每个位置只设置一次。");
    const active = segmentAt(segments, measure),
      ticks = Math.round((beats * ppq * 4) / active.denominator);
    if (
      !Number.isFinite(beats) ||
      beats <= 0 ||
      beats >= active.numerator ||
      !Number.isSafeInteger(ticks) ||
      ticks < 1 ||
      ticks >= (active.numerator * ppq * 4) / active.denominator
    )
      return fail("不完整小节的实际拍数需大于 0，并短于该小节的完整长度。");
    seen.add(measure);
    measure_lengths.push({ measure, ticks });
  }
  return { value: { pickup_ticks, segments, measure_lengths }, error: "" };
}
