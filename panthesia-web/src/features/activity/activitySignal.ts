// Inventory changes are batched so progress updates never notify another component during render.
const listeners = new Set<() => void>();
let queued = false;
export const activitySignal = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  changed() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of [...listeners]) listener();
    });
  },
};
