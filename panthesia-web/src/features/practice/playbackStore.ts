import { olderState } from "../../engine/stateOrder";
import type { Snapshot } from "../../engine/sessionTypes";
import { shareWireValue } from "../../engine/wireValues";

// These fields belong to live readouts. The application shell cannot read a
// delayed copy of them: event handlers must ask getSnapshot() for current data.
const liveFields = [
  "stateOrder",
  "position",
  "practiceMs",
  "required",
  "pressed",
  "pressedKeys",
  "midiEvents",
  "audioLevel",
  "audioPerformance",
  "playbackPerformance",
  "pedal",
  "recordDuration",
  "measure",
  "beat",
  "tick",
  "countRemaining",
] as const satisfies readonly (keyof Snapshot)[];
const liveFieldSet = new Set<string>(liveFields);
export type ControlSnapshot = Omit<Snapshot, (typeof liveFields)[number]>;

function controls(snapshot: Snapshot): ControlSnapshot {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !liveFieldSet.has(key)),
  ) as ControlSnapshot;
}
function view(snapshot: Snapshot): Snapshot {
  const { stateOrder: _order, ...visible } = snapshot;
  return visible;
}
function sameFields(a: object, b: object): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([key, value]) =>
      Object.is(value, (b as Record<string, unknown>)[key]),
    )
  );
}

export function createPlaybackStore(initial: Snapshot) {
  let snapshot = initial,
    control = controls(initial),
    visible = view(initial);
  const listeners = new Set<() => void>();
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    getSnapshot,
    getViewSnapshot: () => visible,
    getEngineId: () => snapshot.stateOrder?.engineId,
    getControls: () => control,
    subscribe,
    update(next: Snapshot | ((previous: Snapshot) => Snapshot)) {
      const value = typeof next === "function" ? next(snapshot) : next;
      if (olderState(value, snapshot)) return;
      // The wire format is JSON. Retain equal nested objects so selective
      // subscribers do not update solely because a new response was decoded.
      const shared = shareWireValue(snapshot, value);
      if (Object.is(snapshot, shared)) return;
      snapshot = shared;
      const nextView = view(shared);
      if (!sameFields(visible, nextView)) visible = nextView;
      const nextControls = controls(shared);
      if (!sameFields(control, nextControls)) control = nextControls;
      for (const listener of [...listeners]) listener();
    },
    select<K extends keyof Snapshot>(keys: readonly K[]) {
      let input: Snapshot | undefined, selected: Pick<Snapshot, K>;
      return () => {
        if (input !== snapshot) {
          const value = Object.fromEntries(
            keys.map((key) => [key, snapshot[key]]),
          ) as Pick<Snapshot, K>;
          if (!input || !sameFields(selected, value)) selected = value;
          input = snapshot;
        }
        return selected;
      };
    },
  };
}
export type PlaybackStore = ReturnType<typeof createPlaybackStore>;
