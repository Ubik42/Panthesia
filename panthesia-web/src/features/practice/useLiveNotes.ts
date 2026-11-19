import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { api } from "../../api";
import type { PlaybackStore } from "./playbackStore";
import { createLiveNoteQueue } from "./liveNoteQueue";

export function useLiveNotes(
  store: PlaybackStore,
  connected: boolean,
  reportError: (message: string) => void,
  canAttack?: () => boolean,
) {
  const engineId = useSyncExternalStore(
    store.subscribe,
    store.getEngineId,
    store.getEngineId,
  );
  const latest = useRef({ connected, reportError, canAttack });
  latest.current = { connected, reportError, canAttack };
  const queue = useRef<ReturnType<typeof createLiveNoteQueue> | null>(null);
  const held = useRef({
    keyboard: new Set<number>(),
    pointer: new Set<number>(),
  });
  useEffect(() => {
    const current = createLiveNoteQueue({
      epoch: () => store.getSnapshot().noteEpoch,
      engineId: () => store.getSnapshot().stateOrder?.engineId,
      available: () =>
        latest.current.connected && store.getEngineId() === engineId,
      send: api.liveNotes,
      silence: async (expectedEngine) => {
        await api.commandForEngine(expectedEngine, { type: "panic" });
        return (await api.state()).noteEpoch;
      },
      error: (message) => latest.current.reportError(message),
    });
    queue.current = current;
    return () => {
      queue.current = null;
      held.current.keyboard.clear();
      held.current.pointer.clear();
      current.dispose();
    };
  }, [store, engineId]);
  useEffect(() => {
    if (connected) queue.current?.resume();
    else {
      held.current.keyboard.clear();
      held.current.pointer.clear();
      queue.current?.suspend();
    }
  }, [connected]);
  const update = useCallback(
    (source: "keyboard" | "pointer", pitch: number, active: boolean) => {
      const current = store.getSnapshot();
      const own = held.current[source];
      const other =
        held.current[source === "keyboard" ? "pointer" : "keyboard"];
      if (active) {
        if (
          !queue.current ||
          !latest.current.connected ||
          latest.current.canAttack?.() === false ||
          current.storage?.operation ||
          current.sound?.changing ||
          current.startup?.ready === false ||
          own.has(pitch)
        )
          return;
        if (other.has(pitch) || queue.current.enqueue(pitch, true))
          own.add(pitch);
      } else if (own.delete(pitch) && !other.has(pitch)) {
        queue.current?.enqueue(pitch, false);
      }
    },
    [store],
  );
  const onNote = useCallback(
    (pitch: number, active: boolean) => update("keyboard", pitch, active),
    [update],
  );
  const pointerNote = useCallback(
    (pitch: number, active: boolean) => update("pointer", pitch, active),
    [update],
  );
  const clear = useCallback(() => {
    const pitches = new Set([
      ...held.current.keyboard,
      ...held.current.pointer,
    ]);
    held.current.keyboard.clear();
    held.current.pointer.clear();
    queue.current?.discardAttacks();
    // A rejected song switch still releases UI-held keys. A successful stop invalidates these releases by epoch.
    for (const pitch of pitches) queue.current?.enqueue(pitch, false);
  }, []);
  return { onNote, pointerNote, clear };
}
