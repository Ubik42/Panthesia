import { useEffect, useMemo, useRef } from "react";
import { api } from "../../api";
import type { CommandOf } from "../../engine/commands.generated";
type NavigationCommand =
  CommandOf<"seekPaperMeasure"> | CommandOf<"seekPaperNote">;

export function usePaperNavigator(
  contentId: string,
  book: string,
  engineId?: string,
  sourceKey?: string,
) {
  const identity = JSON.stringify([contentId, book, engineId, sourceKey]),
    owner = useRef(identity);
  owner.current = identity;
  const navigator = useMemo(() => {
    const channel = `paper-${crypto.randomUUID()}`;
    let sequence = 0;
    const pending = new Set<number>();
    return {
      request: (command: NavigationCommand) => {
        const current = ++sequence;
        pending.add(current);
        const result = api.commandForEngine(engineId, {
          ...command,
          scope: { channel, sequence: current },
        });
        void result.then(
          () => pending.delete(current),
          () => pending.delete(current),
        );
        return {
          result,
          isCurrent: () => current === sequence && owner.current === identity,
        };
      },
      cancel: () => {
        sequence++;
        if (pending.size)
          void api
            .commandForEngine(engineId, {
              type: "cancelHistoryRead",
              channel,
              sequence,
            })
            .catch(() => {});
      },
    };
  }, [contentId, book, engineId, sourceKey]);
  useEffect(() => () => navigator.cancel(), [navigator]);
  return navigator;
}
