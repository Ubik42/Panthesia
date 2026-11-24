import { useCallback, useLayoutEffect, useRef, type UIEvent } from "react";

/** Keep list positions through reloads and temporary subviews, without storing DOM nodes in app state. */
export function useBrowseScroll<T extends HTMLElement>(
  key: string,
  ready: boolean,
  initial: number,
  save: (top: number) => void,
  memory?: Map<string, number>,
) {
  const positions = useRef(memory ?? new Map<string, number>());
  const seeded = useRef(false);
  if (!seeded.current) {
    if (key && !positions.current.has(key)) {
      positions.current.set(key, Math.max(0, initial));
      if (positions.current.size > 32)
        positions.current.delete(positions.current.keys().next().value!);
    }
    seeded.current = true;
  }
  const remember = useCallback((id: string, top: number) => {
    positions.current.delete(id);
    positions.current.set(id, top);
    if (positions.current.size > 32)
      positions.current.delete(positions.current.keys().next().value!);
  }, []);
  const element = useRef<T | null>(null);
  const disconnect = useRef<(() => void) | null>(null);
  const applied = useRef<{
    key: string;
    node: T;
    desired: number;
    pending: boolean;
  } | null>(null);
  const current = useRef({ key, ready, save });
  current.current = { key, ready, save };
  const apply = useRef(() => {});
  apply.current = () => {
    const node = element.current,
      state = current.current;
    if (!state.ready || (node && !node.getClientRects().length)) {
      applied.current = null;
      return;
    }
    if (!node) return;
    let restore = applied.current;
    if (!restore || restore.node !== node || restore.key !== state.key) {
      restore = {
        key: state.key,
        node,
        desired: positions.current.get(state.key) ?? 0,
        pending: true,
      };
      applied.current = restore;
    }
    if (!restore.pending) return;
    node.scrollTop = restore.desired;
    const appliedTop = node.scrollTop;
    // Async score/source sections may not have their final height yet. Keep the
    // requested position until content arrives or the user takes over scrolling.
    if (Math.abs(appliedTop - restore.desired) <= 1) {
      restore.pending = false;
      remember(state.key, appliedTop);
      state.save(appliedTop);
    }
  };
  const ref = useCallback(
    (node: T | null) => {
      disconnect.current?.();
      disconnect.current = null;
      element.current = node;
      if (!node) applied.current = null;
      else {
        apply.current();
        let frame: number | null = null;
        const update = () => {
          if (frame !== null) return;
          frame = requestAnimationFrame(() => {
            frame = null;
            apply.current();
          });
        };
        const resize = new ResizeObserver(update);
        resize.observe(node);
        const children = new Set<Element>();
        const observeChildren = () => {
          for (const child of children)
            if (child.parentElement !== node) {
              resize.unobserve(child);
              children.delete(child);
            }
          for (const child of node.children)
            if (!children.has(child)) {
              children.add(child);
              resize.observe(child);
            }
        };
        observeChildren();
        const content = new MutationObserver(() => {
          observeChildren();
          update();
        });
        content.observe(node, { childList: true, subtree: true });
        const takeOver = (event: Event) => {
          if (
            event instanceof KeyboardEvent &&
            ![
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
              " ",
            ].includes(event.key)
          )
            return;
          const restore = applied.current,
            state = current.current;
          if (
            !restore?.pending ||
            restore.node !== node ||
            restore.key !== state.key ||
            !state.ready
          )
            return;
          restore.pending = false;
          remember(state.key, node.scrollTop);
          state.save(node.scrollTop);
        };
        node.addEventListener("wheel", takeOver, {
          capture: true,
          passive: true,
        });
        node.addEventListener("touchstart", takeOver, {
          capture: true,
          passive: true,
        });
        node.addEventListener("pointerdown", takeOver, true);
        node.addEventListener("keydown", takeOver, true);
        node.addEventListener("load", update, true);
        disconnect.current = () => {
          resize.disconnect();
          content.disconnect();
          if (frame !== null) cancelAnimationFrame(frame);
          node.removeEventListener("wheel", takeOver, true);
          node.removeEventListener("touchstart", takeOver, true);
          node.removeEventListener("pointerdown", takeOver, true);
          node.removeEventListener("keydown", takeOver, true);
          node.removeEventListener("load", update, true);
        };
      }
    },
    [remember],
  );
  useLayoutEffect(() => {
    apply.current();
  }, [key, ready]);
  const onScroll = useCallback(
    (event: UIEvent<T>) => {
      const state = current.current;
      if (
        !state.ready ||
        !event.currentTarget.getClientRects().length ||
        applied.current?.node !== event.currentTarget ||
        applied.current.key !== state.key
      )
        return;
      const top = event.currentTarget.scrollTop;
      const restore = applied.current;
      // Scroll anchoring and a clamped programmatic restore also emit scroll.
      // Explicit input above gives ownership to the user before recording it.
      if (restore.pending) return;
      remember(state.key, top);
      state.save(top);
    },
    [remember],
  );
  return { ref, onScroll };
}
