import { useMemo, useSyncExternalStore } from "react";
import type { Snapshot } from "../../api";
import type { PlaybackStore } from "./playbackStore";

export function usePlaybackFields<K extends keyof Snapshot>(
  store: PlaybackStore,
  keys: readonly K[],
) {
  const read = useMemo(() => store.select(keys), [store, keys]);
  return useSyncExternalStore(store.subscribe, read, read);
}
