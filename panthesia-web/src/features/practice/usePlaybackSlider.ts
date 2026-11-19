import { useEffect, useRef, useState } from "react";
import {
  capturePlaybackSource,
  samePlaybackSource,
  type PlaybackAdjustmentSource,
} from "./playbackCommands";
import type { PlaybackStore } from "./playbackStore";

type Draft = {
  value: number;
  source: PlaybackAdjustmentSource;
  revision: number;
};

/** Keep the handle under the pointer, then send one adjustment on release. */
export function usePlaybackSlider({
  store,
  value,
  disabled,
  commit,
}: {
  store: PlaybackStore;
  value: number;
  disabled: boolean;
  commit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef<Draft | null>(null);
  const revision = useRef(0);
  const sending = useRef<number | null>(null);
  const gesture = useRef<PlaybackAdjustmentSource | null>(null);
  const alive = useRef(true);
  const live = useRef({ disabled, commit });
  live.current = { disabled, commit };
  const clear = () => {
    current.current = null;
    setDraft(null);
  };
  useEffect(() => {
    alive.current = true;
    const stop = store.subscribe(() => {
      if (
        current.current &&
        !samePlaybackSource(current.current.source, store.getSnapshot())
      )
        clear();
    });
    return () => {
      alive.current = false;
      stop();
    };
  }, [store]);
  const stage = (next: number) => {
    if (live.current.disabled || !Number.isFinite(next)) return;
    const source =
      gesture.current ?? capturePlaybackSource(store.getSnapshot());
    if (!samePlaybackSource(source, store.getSnapshot())) {
      clear();
      return;
    }
    const value = { value: next, source, revision: ++revision.current };
    current.current = value;
    setDraft(value);
  };
  const apply = async () => {
    gesture.current = null;
    const pending = current.current;
    if (!pending || sending.current === pending.revision) return;
    if (
      live.current.disabled ||
      !samePlaybackSource(pending.source, store.getSnapshot())
    ) {
      clear();
      return;
    }
    sending.current = pending.revision;
    try {
      await live.current.commit(pending.value);
    } finally {
      if (sending.current === pending.revision) sending.current = null;
      if (alive.current && current.current?.revision === pending.revision)
        clear();
    }
  };
  return {
    value: draft?.value ?? value,
    editing: !!draft,
    pending: sending.current !== null,
    stage,
    begin: () => {
      gesture.current = capturePlaybackSource(store.getSnapshot());
    },
    apply: () => {
      void apply().catch(() => {});
    },
    cancel: () => {
      gesture.current = null;
      clear();
    },
    keyDown: (key: string, repeat: boolean) => {
      if (
        !repeat &&
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(key)
      )
        gesture.current = capturePlaybackSource(store.getSnapshot());
    },
    keyUp: (key: string) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(key)
      )
        void apply().catch(() => {});
    },
  };
}
