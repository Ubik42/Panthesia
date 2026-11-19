import type { LiveNoteEvent, LiveNoteReceipt } from "../../api";

type Pending = LiveNoteEvent & {
  epoch: number | undefined;
  engineId: string | undefined;
  queued: number;
  createdAt: number;
};
type Options = {
  epoch: () => number | undefined;
  engineId?: () => string | undefined;
  available: () => boolean;
  send: (
    epoch: number | undefined,
    createdAt: number,
    events: LiveNoteEvent[],
    engineId?: string,
  ) => Promise<LiveNoteReceipt>;
  silence: (engineId?: string) => Promise<number | undefined>;
  error: (message: string) => void;
};

/** One batch can be in flight. Old attacks expire; releases keep their original order. */
export function createLiveNoteQueue(options: Options) {
  let pending: Pending[] = [];
  let observed = options.epoch(),
    acknowledged = observed;
  let observedEngine = options.engineId?.();
  let revision = 0,
    running = false,
    scheduled = false,
    disposed = false;
  let needsSilence = false,
    resumeRequested = false;
  const possibleNotes = new Set<number>();

  const clear = () => {
    pending = [];
  };
  const synchronize = () => {
    const currentEngine = options.engineId?.();
    const current = options.epoch();
    if (currentEngine !== observedEngine) {
      observedEngine = currentEngine;
      observed = current;
      acknowledged = current;
      revision++;
      needsSilence = false;
      possibleNotes.clear();
      clear();
    }
    if (current !== observed) {
      observed = current;
      if (current !== acknowledged) {
        acknowledged = current;
        revision++;
        needsSilence = false;
        possibleNotes.clear();
        // An in-flight batch may itself have taken over a demonstration. Keep releases
        // until its acknowledgement tells us whether those attacks were accepted.
        pending = pending.filter((event) => !event.active);
      }
    }
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void drain();
    });
  };
  const drain = async () => {
    if (running || disposed || (!options.available() && !needsSilence)) return;
    running = true;
    resumeRequested = false;
    let sendingEngine = observedEngine;
    try {
      if (needsSilence) {
        clear();
        sendingEngine = observedEngine;
        const epoch = await options.silence(sendingEngine);
        synchronize();
        if (disposed) return;
        if (sendingEngine === observedEngine) {
          acknowledged = epoch;
          observed = options.epoch();
          needsSilence = false;
          possibleNotes.clear();
          clear();
        }
        if (!options.available()) return;
      }
      while (pending.length && !disposed && options.available()) {
        synchronize();
        const now = performance.now();
        pending = pending.filter(
          (event) =>
            event.engineId === observedEngine &&
            event.epoch === acknowledged &&
            (!event.active || now - event.queued <= 200),
        );
        const batch = pending.splice(0, acknowledged === undefined ? 1 : 128);
        if (!batch.length) break;
        const request = revision;
        const sentEpoch = acknowledged;
        sendingEngine = observedEngine;
        const attacks = batch.filter((event) => event.active);
        const createdAt = attacks.length
          ? Math.min(...attacks.map((event) => event.createdAt))
          : Date.now();
        const notesBefore = new Set(possibleNotes);
        // A failed response can still mean that an attack reached the engine.
        for (const event of attacks) possibleNotes.add(event.pitch);
        const receipt = await options.send(
          acknowledged,
          createdAt,
          batch.map(({ pitch, velocity, active }) => ({
            pitch,
            velocity,
            active,
          })),
          sendingEngine,
        );
        if (disposed) return;
        synchronize();
        if (sendingEngine !== observedEngine) continue;
        if (receipt.engineId != null && receipt.engineId !== observedEngine) {
          clear();
          needsSilence = false;
          possibleNotes.clear();
          options.error(
            "练习室已重新启动，正在等待读取当前练习；请松键后继续。",
          );
          break;
        }
        if (request === revision || receipt.epoch === acknowledged) {
          possibleNotes.clear();
          if (receipt.epoch === sentEpoch)
            for (const pitch of notesBefore) possibleNotes.add(pitch);
          if (receipt.accepted > 0)
            for (const event of batch) {
              if (!event.active) possibleNotes.delete(event.pitch);
              else if (!receipt.expired) possibleNotes.add(event.pitch);
            }
        }
        if (
          receipt.epoch !== undefined &&
          (request === revision || receipt.epoch === acknowledged)
        ) {
          if (receipt.accepted > 0 && receipt.epoch !== sentEpoch) {
            for (const event of pending) {
              if (
                event.epoch === sentEpoch &&
                (!event.active || request === revision)
              )
                event.epoch = receipt.epoch;
            }
          }
          if (request === revision) acknowledged = receipt.epoch;
        }
      }
    } catch (failure) {
      synchronize();
      if (!disposed && sendingEngine === observedEngine) {
        clear();
        needsSilence = true;
        options.error(
          failure instanceof Error ? failure.message : String(failure),
        );
      }
    } finally {
      running = false;
      if (
        !disposed &&
        ((options.available() && (pending.length || resumeRequested)) ||
          (needsSilence && resumeRequested))
      )
        schedule();
    }
  };
  return {
    enqueue(pitch: number, active: boolean) {
      if (disposed || !options.available()) return false;
      synchronize();
      if (active && needsSilence) {
        options.error("键盘输入正在恢复，请松键后继续。");
        return false;
      }
      if (pending.length >= 256) {
        clear();
        needsSilence = true;
        resumeRequested = true;
        options.error("键盘输入积压，正在止音；请松键后继续。");
        schedule();
        return false;
      }
      pending.push({
        pitch,
        active,
        velocity: active ? 95 : 0,
        epoch: acknowledged,
        engineId: observedEngine,
        queued: performance.now(),
        createdAt: Date.now(),
      });
      schedule();
      return true;
    },
    clear,
    discardAttacks() {
      synchronize();
      // Releases may be waiting behind an in-flight batch. A second UI clear
      // must retain them even after the corresponding held-key set was emptied.
      pending = pending.filter((event) => !event.active);
      if (pending.length || needsSilence) {
        resumeRequested = true;
        schedule();
      }
    },
    resume() {
      synchronize();
      if (pending.length || needsSilence) {
        resumeRequested = true;
        schedule();
      }
    },
    suspend() {
      clear();
      needsSilence ||= possibleNotes.size > 0;
      if (needsSilence) {
        resumeRequested = true;
        schedule();
      }
    },
    dispose() {
      disposed = true;
      clear();
      if (possibleNotes.size || needsSilence)
        void options.silence(observedEngine).catch(() => {});
    },
  };
}
