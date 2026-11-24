import { useEffect, useRef, useState } from "react";
import { inputScopeSelector as dialogSelector, popupSelector, dialogTabStops, dismissInputPopup, isVisibleInput as visible, visibleInputScopes as visibleDialogs, visiblePopups, topPopup, isComposingKey, focusReturnKey, findReturnFocus } from "../lib/inputOwnership";
interface Frame {
  returnTo: HTMLElement | null;
  last: HTMLElement | null;
  returnKey: string | null;
  lastKey: string | null;
}
/** Modal ownership follows actual DOM lifetimes, including nested dialogs and drawers. */
export function useDialogFocus(changed?: () => void) {
  const change = useRef(changed);
  change.current = changed;
  const [ownership, setOwnership] = useState({ modal: false, popup: false, revision: 0 });
  const outsideFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement &&
      !document.activeElement.closest(dialogSelector)
      ? document.activeElement
      : null,
  );
  const retainedFrames = useRef(new Map<HTMLElement, Frame>());
  useEffect(() => {
    let top: HTMLElement | null = null,
      popup: HTMLElement | null = null,
      scheduled = false,
      stopped = false;
    let outside = outsideFocus.current;
    let outsideKey = focusReturnKey(outside);
    const frames = retainedFrames.current;
    const popupReturns = new Map<HTMLElement, HTMLElement | null>();
    const enter = (dialog: HTMLElement, preferred?: HTMLElement | null, key?: string | null) => {
      const retained = preferred && dialog.contains(preferred) && visible(preferred) && !preferred.matches(":disabled") ? preferred : findReturnFocus(dialog, key);
      const initial =
        retained
          ? retained
          : [...dialog.querySelectorAll<HTMLElement>("[autofocus],[data-dialog-initial-focus]")]
            .find((node) => visible(node) && !node.matches(":disabled"));
      const target =
        initial && visible(initial) && !initial.matches(":disabled")
          ? initial
          : dialogTabStops(dialog)[0];
      if (target) target.focus({ preventScroll: true });
      else {
        if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
        dialog.focus({ preventScroll: true });
      }
    };
    const reconcile = () => {
      scheduled = false;
      if (stopped) return;
      const dialogs = visibleDialogs();
      const next = dialogs.at(-1) ?? null;
      const nextPopup = topPopup(next);
      const popupReturn = popup ? popupReturns.get(popup) ?? null : null;
      if (nextPopup && !popupReturns.has(nextPopup)) {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const parentFocus = top ? frames.get(top)?.last : outside;
        popupReturns.set(nextPopup, active && !nextPopup.contains(active) ? active : parentFocus && !nextPopup.contains(parentFocus) ? parentFocus : outside);
      }
      if (next !== top || nextPopup !== popup) {
        if (top && popup && (!nextPopup || !popup.contains(nextPopup))) {
          const frame = frames.get(top);
          if (frame?.last && popup.contains(frame.last) && visible(popupReturn) && top.contains(popupReturn)) { frame.last = popupReturn; frame.lastKey = focusReturnKey(popupReturn); }
        }
        change.current?.();
        setOwnership((state) => ({ modal: !!next, popup: !!nextPopup, revision: state.revision + 1 }));
        popup = nextPopup;
        // Closing a displaced popup belongs to its component, without returning focus behind the new window.
        for (const other of visiblePopups())
          if (other !== nextPopup && !other.contains(nextPopup) && !other.contains(next))
            other.dispatchEvent(new Event(dismissInputPopup));
      }
      const openPopups = visiblePopups();
      for (const node of popupReturns.keys()) if (!openPopups.includes(node)) popupReturns.delete(node);
      if (next === top) {
        for (const node of frames.keys())
          if (!dialogs.includes(node)) frames.delete(node);
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (next && document.hasFocus() && (!next.contains(active) || !visible(active) || active.matches(":disabled")))
          enter(next, frames.get(next)?.last, frames.get(next)?.lastKey);
        return;
      }
      const previous = top,
        previousFrame = previous ? frames.get(previous) : undefined;
      const previousRemoved = previous && !dialogs.includes(previous);
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (next && !frames.has(next)) {
        const returnTo = previousRemoved
          ? visible(active) &&
            active !== document.body &&
            !next.contains(active)
            ? active
            : (visible(popupReturn) ? popupReturn : previousFrame?.returnTo ?? outside)
          : active && !next.contains(active) && active !== document.body
            ? active
            : (visible(popupReturn) ? popupReturn : previousFrame?.last ?? outside);
        frames.set(next, {
          returnTo,
          last: next.contains(active) ? active : null,
          returnKey: focusReturnKey(returnTo),
          lastKey: next.contains(active) ? focusReturnKey(active) : null,
        });
      }
      top = next;
      for (const node of frames.keys())
        if (!dialogs.includes(node)) frames.delete(node);
      if (next) {
        if (!next.contains(active))
          enter(
            next,
            previousRemoved ? previousFrame?.returnTo : frames.get(next)?.last,
            previousRemoved ? previousFrame?.returnKey : frames.get(next)?.lastKey,
          );
      } else if (previous) {
        // A newly focused editor can own the handoff. Avoid stealing its focus.
        if (
          visible(active) &&
          active !== document.body &&
          active !== document.documentElement
        )
          return;
        const target = visible(previousFrame?.returnTo ?? null) && !previousFrame!.returnTo!.matches(":disabled")
          ? previousFrame!.returnTo
          : findReturnFocus(document, previousFrame?.returnKey) ?? (visible(outside) && !outside.matches(":disabled")
            ? outside
            : findReturnFocus(document, outsideKey) ?? document.querySelector<HTMLElement>(
                '.workspace-navigation [aria-current="page"]',
              ));
        if (target && !target.matches(":disabled"))
          target.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>(
              '.workspace-navigation [aria-current="page"]',
            )
            ?.focus({ preventScroll: true });
      }
    };
    const schedule = () => {
      if (scheduled || stopped) return;
      scheduled = true;
      queueMicrotask(reconcile);
    };
    const hasLayer = (node: Node) =>
      node instanceof HTMLElement &&
      (node.matches(`${dialogSelector},${popupSelector}`) || !!node.querySelector(`${dialogSelector},${popupSelector}`));
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) =>
          record.type === "attributes"
            ? ["role", "open"].includes(record.attributeName ?? "") || hasLayer(record.target)
            : [...record.addedNodes, ...record.removedNodes].some(hasLayer),
        ) || (top && frames.get(top)?.last && (!visible(frames.get(top)!.last) || frames.get(top)!.last!.matches(":disabled")))
      )
        schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "role",
        "hidden",
        "inert",
        "aria-hidden",
        "style",
        "class",
        "open",
        "disabled",
        "tabindex",
      ],
    });
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const owner = target.closest<HTMLElement>(dialogSelector);
      const ownerPopup = target.closest<HTMLElement>(popupSelector);
      if ((owner && owner !== top) || ownerPopup && ownerPopup !== popup || (top && (!top.isConnected || !top.contains(target)))) reconcile();
      if (top?.contains(target)) {
        const frame = frames.get(top);
        if (frame) { frame.last = target; frame.lastKey = focusReturnKey(target); }
      } else if (
        !top &&
        !owner &&
        !popup?.contains(target) &&
        target !== document.body &&
        target !== document.documentElement
      ) {
        outside = target;
        outsideKey = focusReturnKey(target);
        outsideFocus.current = target;
      }
    };
    const trap = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isComposingKey(event) ||
        !["Tab", "Escape"].includes(event.key)
        || event.ctrlKey || event.altKey || event.metaKey
      )
        return;
      reconcile();
      if (!top) return;
      if (event.key === "Escape") {
        if (topPopup(top)) return;
        const escapeAction = [...top.querySelectorAll<HTMLButtonElement>('button[data-dialog-escape]')]
          .find((node) => node.closest(dialogSelector) === top && visible(node));
        const close = escapeAction ?? [
          ...top.querySelectorAll<HTMLButtonElement>(
            'button[data-dialog-close],button[aria-label^="关闭"]',
          ),
        ].find(
          (node) =>
            node.closest(dialogSelector) === top &&
            visible(node),
        );
        if (close) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (
            !close.matches(":disabled") &&
            close.getAttribute("aria-disabled") !== "true"
          )
            close.click();
        }
        return;
      }
      const items = dialogTabStops(top),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        enter(top);
        return;
      }
      if (!top.contains(document.activeElement) || !items.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", focus);
    window.addEventListener("keydown", trap);
    window.addEventListener("resize", schedule);
    window.addEventListener("focus", schedule);
    reconcile();
    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener("focusin", focus);
      window.removeEventListener("keydown", trap);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, []);
  return ownership;
}
