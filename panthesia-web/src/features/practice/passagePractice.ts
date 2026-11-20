import type { PassagePreset } from "../../engine/commands.generated";
import type { LoadedSong } from "../../api";
import { secondsAtTick } from "./practicePresentation";

export function passageNeedsReview(row: PassagePreset, grid?: string) {
  // A snapshot is restored and validated on the worker; the currently displayed grid may differ.
  return !row.practice && !!grid && !!row.grid && row.grid !== grid;
}
export function passageTransformLabel(row: Pick<PassagePreset, "practice">) {
  const value = row.practice?.transform;
  if (!value) return "保存时条件";
  return [
    value.transpose
      ? `${value.transpose > 0 ? "+" : ""}${value.transpose} 半音`
      : "原调",
    value.quantize ? `1/${value.quantize} 量化` : "原始时序",
  ].join(" · ");
}

export function passageInitialBpm(song: LoadedSong, row: PassagePreset) {
  const range = row.preciseRange ?? row.scoreRange;
  const start = range
    ? secondsAtTick(song, range.startTick)
    : (song.measures[row.start - 1]?.start ?? 0);
  let bpm = 120;
  for (let i = song.tempo.length - 1; i >= 0; i--) {
    if (song.tempo[i].seconds <= start) {
      bpm = song.tempo[i].bpm;
      break;
    }
  }
  return Math.round(bpm * row.speed);
}

export function measureBpm(song: LoadedSong | undefined, measure: number) {
  const start = song?.measures[measure - 1]?.start ?? 0;
  let bpm = 120;
  for (let i = (song?.tempo.length ?? 0) - 1; i >= 0; i--) {
    if (song!.tempo[i].seconds <= start) {
      bpm = song!.tempo[i].bpm;
      break;
    }
  }
  return bpm;
}
export function ladderBpm(
  song: LoadedSong | undefined,
  measure: number,
  percent: number,
) {
  return Math.round(measureBpm(song, measure) * percent) / 100;
}
