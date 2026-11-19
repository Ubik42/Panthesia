import { useLayoutEffect, useRef } from "react";

/** Keep navigation-key focus; restore a selected row or heading after contextual return. */
export function useWorkspaceFocus(
  presentation: "workspace" | "dialog",
  headingId: string,
) {
  const previous = useRef<Element | null>(null);
  const awaitingRow = useRef(false);
  useLayoutEffect(() => {
    if (presentation !== "workspace") return;
    const heading = document.getElementById(headingId);
    const region = heading?.closest('[role="region"]') ?? null;
    if (region === previous.current && !awaitingRow.current) return;
    if (region !== previous.current) awaitingRow.current = true;
    previous.current = region;
    if (!region || !document.hasFocus()) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      !active.closest('[inert], [hidden], [aria-hidden="true"]') &&
      active.getClientRects().length > 0 &&
      active !== heading
    ) {
      awaitingRow.current = false;
      return;
    }
    const selected = region?.querySelector<HTMLElement>(
      ".history-record.selected, .library-manager-table tr.active",
    );
    const detail = region?.querySelector<HTMLElement>(
      "[data-browse-detail-heading]",
    );
    const visibleSelected =
      selected &&
      selected.getClientRects().length > 0 &&
      !selected.closest("[inert]")
        ? selected
        : null;
    const target =
      visibleSelected && !visibleSelected.matches(":disabled")
        ? visibleSelected
        : region?.getAttribute("data-browse-pane") === "detail" &&
            detail?.getClientRects().length
          ? detail
          : heading;
    target?.focus({ preventScroll: true });
    awaitingRow.current =
      !!visibleSelected &&
      visibleSelected.matches(":disabled") &&
      target === heading;
  });
}
