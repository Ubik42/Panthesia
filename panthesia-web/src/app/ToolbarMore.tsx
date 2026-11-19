import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import "./toolbarMore.css";
import { dismissInputPopup, isComposingKey, isTextEntry, ownsInputLayer } from "./inputOwnership";

/** Secondary actions remain in the toolbar's tab order and use ordinary buttons. */
export function ToolbarMore({
  label = "更多工具",
  disabled,
  scale,
  status,
  attention = false,
  children,
}: {
  label?: string;
  disabled: boolean;
  scale?: number;
  status?: string;
  attention?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({
    visibility: "hidden",
  });
  const close = (focus = false) => {
    if (!root.current?.open) return;
    root.current.open = false;
    setPosition({ visibility: "hidden" });
    if (
      focus &&
      document.hasFocus() &&
      trigger.current?.getClientRects().length
    )
      trigger.current.focus({ preventScroll: true });
  };
  const place = () => {
    if (!trigger.current) return;
    const zoom =
      scale ?? (Number.parseFloat(document.documentElement.style.zoom) || 1);
    const rect = trigger.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth / zoom,
      viewportHeight = window.innerHeight / zoom;
    const top = rect.top / zoom,
      bottom = rect.bottom / zoom,
      right = rect.right / zoom;
    const width = Math.min(340, viewportWidth - 24);
    const above = viewportHeight - bottom < 230 && top > viewportHeight / 2;
    setPosition({
      width,
      left: Math.max(12, Math.min(right - width, viewportWidth - width - 12)),
      ...(above ? { bottom: viewportHeight - top + 8 } : { top: bottom + 8 }),
      maxHeight: Math.max(100, (above ? top : viewportHeight - bottom) - 20),
    });
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !root.current?.open) return;
      if (event.defaultPrevented || isComposingKey(event) || event.ctrlKey || event.altKey || event.metaKey || !ownsInputLayer(root.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    };
    const resize = () => close();
    const scroll = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    const node = root.current;
    const dismiss = () => close();
    node?.addEventListener(dismissInputPopup, dismiss);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      node?.removeEventListener(dismissInputPopup, dismiss);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);
  useEffect(() => {
    close();
  }, [disabled, scale]);
  useEffect(() => {
    if (scale !== undefined) return;
    const observer = new MutationObserver(() => close());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [scale]);
  return (
    <details
      ref={root}
      className="toolbar-more"
      data-input-popup=""
      onToggle={() => {
        if (!root.current?.open || !trigger.current) return;
        if (disabled) {
          close();
          return;
        }
        place();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          close();
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || isComposingKey(event.nativeEvent) || isTextEntry(event.target)) return;
        if (
          disabled ||
          !ownsInputLayer(root.current) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        )
          return;
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>(
            ".toolbar-more-actions button:not(:disabled)",
          ) ?? []),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        if (root.current && !root.current.open) {
          place();
          root.current.open = true;
        }
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : index < 0
                ? event.key === "ArrowUp"
                  ? buttons.length - 1
                  : 0
                : (index +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
        // The newly opened details needs a layout before a child can receive focus.
        requestAnimationFrame(() => {
          if (root.current?.open) buttons[next]?.focus();
        });
      }}
    >
      <summary
        ref={trigger}
        aria-label={label}
        aria-description={status}
        title={status ? `${label} · ${status}` : label}
        aria-controls={id}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          else if (!root.current?.open) place();
        }}
      >
        <MoreHorizontal size={17} />
        <span>{label}</span>
        {status && (
          <small
            aria-hidden="true"
            className={`toolbar-more-status${attention ? " needs-attention" : ""}`}
          >
            {status}
          </small>
        )}
        <ChevronDown size={13} />
      </summary>
      <div
        id={id}
        className="toolbar-more-actions"
        role="group"
        aria-label={label}
        style={position}
        onClick={(event) => {
          const button = (event.target as Element).closest<HTMLButtonElement>(
            "button",
          );
          if (button && !button.disabled) close(true);
        }}
      >
        {children}
      </div>
    </details>
  );
}
