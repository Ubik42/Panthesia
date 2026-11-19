import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Snapshot } from "../../api";
import type { PlaybackStore } from "./playbackStore";

export function usePlaybackFields<K extends keyof Snapshot>(
  store: PlaybackStore,
  keys: readonly K[],
) {
  const read = useMemo(() => store.select(keys), [store, keys]);
  return useSyncExternalStore(store.subscribe, read, read);
}

// A render boundary subscribes only its own subtree. The parent owns navigation
// and commands, while the playback store owns the incoming snapshots.
export function PlaybackView({
  store,
  contentId,
  children,
}: {
  store: PlaybackStore;
  contentId?: string | null;
  children: (state: Snapshot) => ReactNode;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getViewSnapshot,
    store.getViewSnapshot,
  );
  if (contentId !== undefined && state.contentId !== contentId) return null;
  return children(state);
}
