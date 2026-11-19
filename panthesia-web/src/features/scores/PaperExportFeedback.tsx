import { useSyncExternalStore } from "react";

export function createPaperExportFeedback() {
  let message = "";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => message,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (value: string) => {
      if (value === message) return;
      message = value;
      for (const listener of [...listeners]) listener();
    },
  };
}
/** Chunk progress updates this small live region without redrawing the score and ink. */
export function PaperExportFeedback({
  feedback,
}: {
  feedback: ReturnType<typeof createPaperExportFeedback>;
}) {
  const message = useSyncExternalStore(
    feedback.subscribe,
    feedback.getSnapshot,
    feedback.getSnapshot,
  );
  return message ? (
    <p className="parameter-help paper-export-feedback" role="status">
      {message}
    </p>
  ) : null;
}
