import { useEffect } from "react";
import { api } from "../api";
import { isComposingKey, isVisibleInput, topInputScope, topPopup } from "../lib/inputOwnership";

/** Window-wide keys and leave guards. Escape outside dialogs presses the page's back button
 * (`data-dialog-escape`, else `data-workspace-close`); the browser build warns before leaving
 * while practice data is still being saved. */
export function useWindowGuards(savePending: boolean) {
  useEffect(() => {
    const escapeWorkspace = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isComposingKey(event) ||
          event.ctrlKey || event.altKey || event.metaKey || topInputScope() || topPopup(null)) return;
      const back = [...document.querySelectorAll<HTMLButtonElement>("button[data-dialog-escape]")].find(isVisibleInput);
      const close = back ?? [...document.querySelectorAll<HTMLButtonElement>("button[data-workspace-close]")].find(isVisibleInput);
      if (!close) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!close.matches(":disabled") && close.getAttribute("aria-disabled") !== "true") close.click();
    };
    window.addEventListener("keydown", escapeWorkspace);
    return () => window.removeEventListener("keydown", escapeWorkspace);
  }, []);
  useEffect(() => {
    if (api.desktop || !savePending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [savePending]);
}
