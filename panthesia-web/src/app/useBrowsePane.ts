import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type BrowsePane = "list" | "detail";

/** Keep both panes mounted so editing and read requests survive a compact view. */
export function useBrowsePane(initial: BrowsePane = "list") {
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 1000px)").matches,
  );
  const [view, setView] = useState({ pane: initial, focus: 0 });
  const root = useRef<HTMLElement>(null);
  const resize = useRef<ResizeObserver | null>(null);
  const requested = useRef(false);
  // A file-repair subview temporarily replaces the entire browse region.
  const attach = useCallback((region: HTMLElement | null) => {
    resize.current?.disconnect();
    resize.current = null;
    root.current = region;
    if (!region) return;
    const update = () => {
      if (root.current === region && region.clientWidth > 0)
        setCompact(region.clientWidth <= 1000);
    };
    resize.current = new ResizeObserver(update);
    resize.current.observe(region);
    update();
  }, []);
  useLayoutEffect(() => {
    if (root.current && !resize.current) attach(root.current);
    return () => {
      resize.current?.disconnect();
      resize.current = null;
    };
  }, [attach]);
  useLayoutEffect(() => {
    const region = root.current;
    const active = document.activeElement;
    const explicit = requested.current;
    requested.current = false;
    if (!region || !document.hasFocus()) return;
    // A later dialog or a different workspace owns focus once the user leaves.
    if (active && active !== document.body && !region.contains(active)) return;
    const lostFocus =
      active instanceof HTMLElement &&
      region.contains(active) &&
      !active.getClientRects().length;
    if (!explicit && !lostFocus) return;
    const visible = (node: HTMLElement) =>
      node.getClientRects().length > 0 &&
      !node.matches(":disabled") &&
      !node.closest("[hidden], [inert]");
    const selected = [
      ...region.querySelectorAll<HTMLElement>('[data-browse-selected="true"]'),
    ].find(visible);
    const target =
      view.pane === "detail"
        ? region.querySelector<HTMLElement>("[data-browse-detail-heading]")
        : (selected ??
          region.querySelector<HTMLElement>("[data-browse-list-heading]"));
    if (target && visible(target)) target.focus({ preventScroll: true });
  }, [compact, view]);
  const show = (pane: BrowsePane, focus = true) => {
    requested.current = focus;
    setView((old) => ({ pane, focus: old.focus + 1 }));
  };
  return {
    root,
    attach,
    compact,
    pane: view.pane,
    listVisible: !compact || view.pane === "list",
    detailVisible: !compact || view.pane === "detail",
    showList: (focus = true) => show("list", focus),
    showDetails: (focus = true) => show("detail", focus),
  };
}
