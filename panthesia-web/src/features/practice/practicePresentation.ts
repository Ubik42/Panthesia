import type { CollectionSong, LoadedSong, Snapshot } from "../../api";

export const practiceModes = [
  {
    value: "wait",
    label: "弹对后继续",
    detail: "弹对后继续，按自己的速度熟悉音符。",
  },
  {
    value: "flow",
    label: "连续播放",
    detail: "曲目持续发声，可跟弹并记录错音、漏音和节奏。",
  },
  {
    value: "listen",
    label: "聆听",
    detail: "自动演奏已启用的音轨，先熟悉曲目。",
  },
  {
    value: "recital",
    label: "完整演奏",
    detail: "从曲首演奏一遍，完成后查看评分。",
  },
  {
    value: "memory",
    label: "背谱",
    detail: "隐藏谱面、目标音符与指法，完成后查看评分。",
  },
] as const;

export function practiceMode(mode: string) {
  return practiceModes.find((item) => item.value === mode);
}

export function handLabel(hands: string) {
  switch (hands) {
    case "left":
      return "左手";
    case "right":
      return "右手";
    case "both":
      return "双手";
    case "other":
      return "未分手";
    default:
      return "自定义音轨";
  }
}

export function practiceStatus(
  state: Pick<Snapshot, "status" | "recording" | "wait" | "required" | "mode">,
  connected: boolean,
) {
  if (!connected) return "引擎未连接";
  if (state.recording) return "正在录制";
  if (state.status === "countIn") return "预备拍";
  if (state.status === "finished")
    return state.mode === "listen" ? "聆听完成" : "本轮完成";
  if (state.status === "playing")
    return state.wait && state.required.length
      ? "等待你弹奏"
      : state.mode === "listen"
        ? "正在聆听"
        : "正在练习";
  return state.status === "paused" ? "已暂停" : "准备开始";
}

/** The active engine passage uses seconds; selection inputs are only drafts. */
export function activeMeasures(
  song: LoadedSong | null,
  passage: Snapshot["passage"],
) {
  return measureRange(song, passage, false);
}

/** A measure can overlap a cut without its beginning being a valid seek target. */
export function seekableMeasures(
  song: LoadedSong | null,
  passage: Snapshot["passage"],
) {
  return measureRange(song, passage, true);
}

function measureRange(
  song: LoadedSong | null,
  passage: Snapshot["passage"],
  startsOnly: boolean,
) {
  const measures = song?.measures;
  if (!measures?.length) return null;
  if (!passage)
    return {
      first: measures[0].number,
      last: measures[measures.length - 1].number,
    };
  // Measure times are ordered. Keep the frequently updated timeline independent
  // of song length, including imported scores with thousands of measures.
  let low = 0,
    high = measures.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (
      startsOnly
        ? measures[middle].start < passage.start
        : measures[middle].end <= passage.start
    )
      low = middle + 1;
    else high = middle;
  }
  const first = measures[low];
  low = 0;
  high = measures.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (measures[middle].start < passage.end) low = middle + 1;
    else high = middle;
  }
  const last = measures[low - 1];
  return first &&
    last &&
    first.number <= last.number &&
    first.start < passage.end &&
    last.end > passage.start
    ? { first: first.number, last: last.number }
    : null;
}

export function noteResult(score: Snapshot["score"]) {
  const judged = score.matched_notes + score.wrong_notes + score.missed_notes;
  return {
    judged,
    accuracy: judged ? Math.round((score.matched_notes / judged) * 100) : null,
  };
}

export function nextAvailableQueueSong(
  queue: readonly CollectionSong[],
  contentId: string | null | undefined,
) {
  let skipped = 0;
  for (
    let index = queue.findIndex((row) => row.contentId === contentId) + 1;
    index < queue.length;
    index++
  ) {
    if (queue[index].available) return { song: queue[index], skipped };
    skipped++;
  }
  return { song: undefined, skipped };
}

export function measureBeatLength(
  song: LoadedSong,
  measure: LoadedSong["measures"][number],
) {
  const group =
    measure.denominator === 8 &&
    measure.numerator >= 6 &&
    measure.numerator % 3 === 0
      ? 3
      : 1;
  return ((song.ppq * 4) / measure.denominator) * group;
}

export function secondsAtTick(song: LoadedSong, tick: number) {
  let low = 0,
    high = song.tempo.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (song.tempo[middle].tick <= tick) low = middle + 1;
    else high = middle;
  }
  const tempo = song.tempo[low - 1];
  return tempo
    ? tempo.seconds + ((tick - tempo.tick) * 60) / (tempo.bpm * song.ppq)
    : (tick * 60) / (120 * song.ppq);
}

export function tickAtSeconds(song: LoadedSong, seconds: number) {
  let low = 0, high = song.tempo.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (song.tempo[middle].seconds <= seconds) low = middle + 1;
    else high = middle;
  }
  const tempo = song.tempo[low - 1];
  return Math.max(0, Math.round(tempo
    ? tempo.tick + (seconds - tempo.seconds) * tempo.bpm * song.ppq / 60
    : seconds * 120 * song.ppq / 60));
}
