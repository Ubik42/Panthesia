import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { HistoryEntry } from "./historyTypes";

const entryKey = (entry: HistoryEntry) =>
  JSON.stringify([entry.contentId, entry.id]);

export function useHistoryListNavigation({
  entries,
  selected,
  select,
  offset,
  setOffset,
  total,
  ready,
  blocked,
  scope,
}: {
  entries: HistoryEntry[];
  selected: HistoryEntry | null;
  select: (entry: HistoryEntry) => void;
  offset: number;
  setOffset: (offset: number) => void;
  total: number;
  ready: boolean;
  blocked: boolean;
  scope: string;
}) {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const pending = useRef<{
    scope: string;
    offset: number;
    index: number;
    focus: boolean;
    owner: Element | null;
  } | null>(null);
  const choose = (entry: HistoryEntry, focus = false) => {
    pending.current = null;
    select(entry);
    if (focus && document.hasFocus()) {
      const node = nodes.current.get(entryKey(entry));
      node?.focus({ preventScroll: true });
      node?.scrollIntoView({ block: "nearest" });
    }
  };
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    if (target.scope !== scope || blocked) {
      pending.current = null;
      return;
    }
    if (!ready) return;
    if (target.offset !== offset) {
      pending.current = null;
      return;
    }
    const entry = entries[Math.min(target.index, entries.length - 1)];
    if (!entry) {
      if (total > 0) {
        const last = Math.floor((total - 1) / 50) * 50;
        if (last !== offset) {
          pending.current = {
            ...target,
            offset: last,
            index: Math.min(target.index, total - last - 1),
          };
          setOffset(last);
          return;
        }
      }
      pending.current = null;
      return;
    }
    const node = nodes.current.get(entryKey(entry));
    const focused = document.activeElement;
    if (!target.focus) {
      if (
        (focused && focused !== document.body && focused !== target.owner) ||
        [...document.querySelectorAll('[role="dialog"]')].some(
          (dialog) =>
            dialog.getClientRects().length && !dialog.contains(target.owner),
        )
      ) {
        pending.current = null;
        return;
      }
      choose(entry);
      return;
    }
    if (
      (focused &&
        focused !== document.body &&
        ![...nodes.current.values()].some(
          (candidate) => candidate === focused,
        )) ||
      [...document.querySelectorAll('[role="dialog"]')].some(
        (dialog) =>
          dialog.getClientRects().length && !dialog.contains(node ?? null),
      )
    ) {
      pending.current = null;
      return;
    }
    choose(entry, true);
  }, [entries, offset, ready, blocked, scope, total]);
  const selectedKey = selected ? entryKey(selected) : null;
  const tabEntry =
    entries.find((entry) => entryKey(entry) === selectedKey) ?? entries[0];
  const selectedIndex = entries.findIndex(
    (entry) => entryKey(entry) === selectedKey,
  );
  return {
    selectedIndex,
    canPrevious: ready && selectedIndex >= 0 && offset + selectedIndex > 0,
    canNext: ready && selectedIndex >= 0 && offset + selectedIndex + 1 < total,
    step: (direction: -1 | 1) => {
      if (blocked || !ready || selectedIndex < 0 || pending.current) return;
      const target = offset + selectedIndex + direction;
      if (target < 0 || target >= total) return;
      const pageOffset = Math.floor(target / 50) * 50;
      if (pageOffset === offset) choose(entries[target - offset]);
      else {
        pending.current = {
          scope,
          offset: pageOffset,
          index: target - pageOffset,
          focus: false,
          owner: document.activeElement,
        };
        setOffset(pageOffset);
      }
    },
    cancel: () => {
      pending.current = null;
    },
    choose: (entry: HistoryEntry) => {
      if (!blocked) choose(entry);
    },
    row: (entry: HistoryEntry) => ({
      ref: (node: HTMLButtonElement | null) => {
        const key = entryKey(entry);
        if (node) nodes.current.set(key, node);
        else nodes.current.delete(key);
      },
      tabIndex: tabEntry && entryKey(tabEntry) === entryKey(entry) ? 0 : -1,
      "aria-current":
        entryKey(entry) === selectedKey ? (true as const) : undefined,
    }),
    onBlurCapture: (event: FocusEvent<HTMLDivElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        !event.currentTarget.contains(event.relatedTarget)
      )
        pending.current = null;
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (blocked || !ready || event.altKey || event.metaKey || event.shiftKey)
        return;
      const node = event.target;
      if (!(node instanceof HTMLButtonElement)) return;
      const index = entries.findIndex(
        (entry) => nodes.current.get(entryKey(entry)) === node,
      );
      if (index < 0) return;
      let target: number;
      switch (event.key) {
        case "ArrowDown":
          target = offset + Math.min(entries.length - 1, index + 1);
          break;
        case "ArrowUp":
          target = offset + Math.max(0, index - 1);
          break;
        case "Home":
          target = event.ctrlKey ? 0 : offset;
          break;
        case "End":
          target = event.ctrlKey ? total - 1 : offset + entries.length - 1;
          break;
        case "PageDown":
          target = Math.min(total - 1, offset + index + 50);
          break;
        case "PageUp":
          target = Math.max(0, offset + index - 50);
          break;
        default:
          return;
      }
      event.preventDefault();
      if (target < 0) return;
      const pageOffset = Math.floor(target / 50) * 50;
      if (pageOffset === offset) choose(entries[target - offset], true);
      else {
        pending.current = {
          scope,
          offset: pageOffset,
          index: target - pageOffset,
          focus: true,
          owner: null,
        };
        setOffset(pageOffset);
      }
    },
  };
}
