import { isComposingKey, ownsInputLayer } from "./inputOwnership";
import { useEffect, useRef, type RefObject } from "react";

/** Search the active workspace, including when its compact detail pane is open. */
export function useBrowseSearch(
  root: RefObject<HTMLElement | null>,
  disabled: boolean,
  prepare: () => void,
) {
  const latest = useRef({ disabled, prepare });
  latest.current = { disabled, prepare };
  useEffect(() => {
    let frame: number | null = null;
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isComposingKey(event) ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f"
      )
        return;
      const region = root.current;
      if (latest.current.disabled || !region?.getClientRects().length) return;
      if (!ownsInputLayer(region)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const origin = document.activeElement;
      latest.current.prepare();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (
          !document.hasFocus() ||
          latest.current.disabled ||
          !region.isConnected
        )
          return;
        const active = document.activeElement;
        if (active !== origin && active !== document.body) return;
        if (!ownsInputLayer(region)) return;
        const input = region.querySelector<HTMLInputElement>(
          ".browse-search-input input:not(:disabled)",
        );
        if (input?.getClientRects().length) {
          input.focus({ preventScroll: true });
          input.select();
        }
      });
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [root]);
}
