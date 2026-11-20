import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import {
  clampKeyboardViewport,
  normalizePreviewBars,
  panKeyboardViewport,
  zoomKeyboardViewport,
  type KeyboardViewport,
} from "./keyboardViewport";

type Point = { x: number; y: number; falling: boolean };
type Options = {
  canvas: RefObject<HTMLCanvasElement | null>;
  viewport: KeyboardViewport;
  previewBars: number;
  keyboardHeight: number;
  onViewportChange?: (viewport: KeyboardViewport) => void;
  onPreviewBarsChange?: (bars: number) => void;
  canInteract?: () => boolean;
  release: (pointer?: number) => void;
};
/** Coalesce camera updates; musical input remains owned by the keyboard. */
export function usePianoViewportGestures(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef<{ view?: KeyboardViewport; bars?: number }>({});
  const frame = useRef(0);
  const touches = useRef(new Map<number, Point>());
  const consumed = useRef(new Set<number>());
  const selection = useRef(
    new Map<number, { point: Point; action: () => void }>(),
  );
  const pan = useRef<{ id: number; x: number; view: KeyboardViewport } | null>(
    null,
  );
  const pinch = useRef<{
    ids: number[];
    dx: number;
    dy: number;
    center: number;
    view: KeyboardViewport;
    bars: number;
    axis: "horizontal" | "vertical" | null;
  } | null>(null);
  const currentView = () => pending.current.view ?? latest.current.viewport;
  const currentBars = () => pending.current.bars ?? latest.current.previewBars;
  const flush = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    const { view, bars } = pending.current;
    pending.current = {};
    if (view) latest.current.onViewportChange?.(view);
    if (bars !== undefined) latest.current.onPreviewBarsChange?.(bars);
  };
  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  const view = (value: KeyboardViewport) => {
    const before = currentView();
    if (
      Math.abs(before.start - value.start) < 1e-7 &&
      Math.abs(before.span - value.span) < 1e-7
    )
      return;
    pending.current.view = value;
    schedule();
  };
  const bars = (value: number) => {
    value = normalizePreviewBars(value);
    if (currentBars() === value) return;
    pending.current.bars = value;
    schedule();
  };
  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const element = e.currentTarget,
      bounds = element.getBoundingClientRect();
    const y = (e.clientY - bounds.top) / Math.max(1, bounds.height);
    return {
      x: (e.clientX - bounds.left) / Math.max(1, bounds.width),
      y,
      falling:
        y <
        1 -
          Math.min(latest.current.keyboardHeight, element.clientHeight * 0.45) /
            Math.max(1, element.clientHeight),
    };
  };
  useEffect(() => {
    const element = options.canvas.current!;
    const wheel = (event: WheelEvent) => {
      const current = latest.current;
      if (
        (!event.ctrlKey && !event.shiftKey) ||
        !current.onViewportChange ||
        current.canInteract?.() === false
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const delta =
        (event.deltaY || event.deltaX) *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      const camera = currentView(),
        bounds = element.getBoundingClientRect();
      view(
        event.ctrlKey
          ? zoomKeyboardViewport(
              camera,
              Math.exp(Math.max(-600, Math.min(600, delta)) * 0.002),
              (event.clientX - bounds.left) / Math.max(1, bounds.width),
            )
          : panKeyboardViewport(
              camera,
              (delta / Math.max(1, bounds.width)) * camera.span,
            ),
      );
    };
    const clear = () => {
      pan.current = null;
      pinch.current = null;
      touches.current.clear();
      consumed.current.clear();
      selection.current.clear();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", clear);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", clear);
      clear();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = {};
    };
  }, []);
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (latest.current.canInteract?.() === false) return true;
    if (
      e.pointerType === "mouse" &&
      (e.button === 1 || (e.button === 0 && e.altKey)) &&
      latest.current.onViewportChange
    ) {
      e.preventDefault();
      pan.current = { id: e.pointerId, x: point(e).x, view: currentView() };
      e.currentTarget.setPointerCapture(e.pointerId);
      return true;
    }
    if (e.pointerType !== "touch") return false;
    const p = point(e);
    touches.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    const falling = [...touches.current.entries()].filter(([, p]) => p.falling);
    if (!p.falling || falling.length < 2) return false;
    e.preventDefault();
    if (!pinch.current) {
      const [[idA, a], [idB, b]] = falling;
      for (const id of [idA, idB]) {
        latest.current.release(id);
        selection.current.delete(id);
        consumed.current.add(id);
      }
      pinch.current = {
        ids: [idA, idB],
        dx: Math.max(0.02, Math.abs(a.x - b.x)),
        dy: Math.max(0.02, Math.abs(a.y - b.y)),
        center: (a.x + b.x) / 2,
        view: currentView(),
        bars: currentBars(),
        axis: null,
      };
    }
    consumed.current.add(e.pointerId);
    return true;
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (latest.current.canInteract?.() === false) return;
    const p = point(e),
      drag = pan.current;
    if (drag?.id === e.pointerId) {
      e.preventDefault();
      view(panKeyboardViewport(drag.view, (drag.x - p.x) * drag.view.span));
      return;
    }
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, p);
    const tap = selection.current.get(e.pointerId);
    if (tap && Math.hypot(p.x - tap.point.x, p.y - tap.point.y) > 0.015)
      selection.current.delete(e.pointerId);
    const gesture = pinch.current;
    if (!gesture) return;
    const [a, b] = gesture.ids.map((id) => touches.current.get(id));
    if (!a || !b) return;
    e.preventDefault();
    const dx = Math.max(0.02, Math.abs(a.x - b.x)),
      dy = Math.max(0.02, Math.abs(a.y - b.y));
    if (!gesture.axis) {
      const x = Math.abs(Math.log(dx / gesture.dx)),
        y = Math.abs(Math.log(dy / gesture.dy));
      if (Math.max(x, y) < 0.02) return;
      gesture.axis = x >= y ? "horizontal" : "vertical";
    }
    if (gesture.axis === "horizontal") {
      const span = clampKeyboardViewport(
        0,
        (gesture.view.span * gesture.dx) / dx,
      ).span;
      view(
        clampKeyboardViewport(
          gesture.view.start +
            gesture.view.span * gesture.center -
            (span * (a.x + b.x)) / 2,
          span,
        ),
      );
    } else bars((gesture.bars * gesture.dy) / dy);
  };
  const finish = (e: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const tap = selection.current.get(e.pointerId);
    selection.current.delete(e.pointerId);
    if (
      tap &&
      !cancel &&
      !consumed.current.has(e.pointerId) &&
      latest.current.canInteract?.() !== false
    )
      tap.action();
    touches.current.delete(e.pointerId);
    consumed.current.delete(e.pointerId);
    if (pan.current?.id === e.pointerId) pan.current = null;
    if (pinch.current?.ids.includes(e.pointerId)) pinch.current = null;
    if (!cancel) flush();
  };
  return {
    down,
    move,
    up: (e: PointerEvent<HTMLCanvasElement>) => finish(e),
    cancel: (e: PointerEvent<HTMLCanvasElement>) => finish(e, true),
    deferSelection: (e: PointerEvent<HTMLCanvasElement>, action: () => void) =>
      selection.current.set(e.pointerId, { point: point(e), action }),
  };
}
