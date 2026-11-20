import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { DisplayPreferences } from "../../displayPreferences";
import type { PracticeInspectorTab } from "./PracticeInspectorTabs";
import { isComposingKey, ownsInputLayer } from "../../app/inputOwnership";

/** Compact windows use one temporary drawer; desktop layout preferences survive. */
export function usePracticePanels(
  display: DisplayPreferences,
  setDisplay: Dispatch<SetStateAction<DisplayPreferences>>,
) {
  const [compact, setCompact] = useState(
    () => window.innerWidth / (display.uiScale / 100) <= 1100,
  );
  const [drawer, setDrawer] = useState<"library" | "inspector" | null>(null);
  const [short, setShort] = useState(false);
  const [inspectorTab, setInspectorTab] =
    useState<PracticeInspectorTab>("setup");
  const [focusRequest, requestFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const compactRef = useRef(compact);
  const inspector = drawer === "inspector";
  const setInspector = (open: boolean) => {
    if (!open) requestFocus(0);
    setDrawer((old) => (open ? "inspector" : old === "inspector" ? null : old));
  };
  useLayoutEffect(() => {
    if (!focusRequest || !inspector) return;
    const frame = requestAnimationFrame(() => {
      requestFocus((request) => (request === focusRequest ? 0 : request));
      if (!document.hasFocus()) return;
      const target = root.current?.querySelector<HTMLElement>(
        `#practice-inspector [data-practice-tab="${inspectorTab}"]`,
      );
      if (
        !target?.getClientRects().length ||
        target.closest("[hidden], [inert]")
      )
        return;
      if (!ownsInputLayer(target)) return;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, inspector, inspectorTab]);
  useLayoutEffect(() => {
    const region = root.current;
    if (!region) return;
    const update = () => {
      if (region.clientWidth <= 0) return;
      setShort(region.clientHeight < 560);
      const next = region.clientWidth <= 1100;
      if (compactRef.current === next) return;
      compactRef.current = next;
      setCompact(next);
      requestFocus(0);
      setDrawer(null);
    };
    const observer = new ResizeObserver(update);
    observer.observe(region);
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!drawer) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        isComposingKey(event) ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof HTMLInputElement &&
          event.target.hasAttribute("data-practice-library-search") &&
          !!event.target.value) ||
        !ownsInputLayer(
          root.current?.querySelector<HTMLElement>("[data-practice-drawer]") ??
            null,
        )
      )
        return;
      event.preventDefault();
      requestFocus(0);
      setDrawer(null);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [compact, drawer]);
  return {
    root,
    compact,
    short,
    drawer,
    closeDrawer: () => {
      requestFocus(0);
      setDrawer(null);
    },
    libraryOpen: compact ? drawer === "library" : display.libraryOpen,
    inspector,
    inspectorTab,
    setInspectorTab,
    revealInspector: (tab: PracticeInspectorTab) => {
      setInspectorTab(tab);
      setInspector(true);
      requestFocus((request) => request + 1);
    },
    setLibraryOpen: (open: boolean) =>
      compact
        ? setDrawer((old) =>
            open ? "library" : old === "library" ? null : old,
          )
        : setDisplay((old) => ({ ...old, libraryOpen: open })),
    setInspector,
  };
}
