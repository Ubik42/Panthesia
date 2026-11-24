import { useEffect, useRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { X } from "lucide-react";
import { isComposingKey, ownsInputLayer } from "../app/inputOwnership";
import "./controls.css";
import "./components.css";

type Icon = ComponentType<{ "aria-hidden"?: boolean }>;

/** A button; `primary` for the one main action of a view, `ghost` for quiet actions. */
export function Button({
  variant = "default",
  size = "md",
  icon: Glyph,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost"; size?: "md" | "lg"; icon?: Icon }) {
  const classes = ["ui-button", variant !== "default" && `ui-button--${variant}`, size === "lg" && "ui-button--large", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {Glyph && <Glyph aria-hidden />}
      {children}
    </button>
  );
}

/** A square icon-only button with a tooltip and an accessible name. */
export function IconButton({ label, icon: Glyph, active, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: Icon; active?: boolean }) {
  return (
    <button type="button" className={`ui-icon-button ${className}`} aria-label={label} title={label} aria-pressed={active} {...rest}>
      <Glyph aria-hidden />
    </button>
  );
}

/** Two to five mutually exclusive choices. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`ui-segmented ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} disabled={disabled || o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small label: a material a song has, a tag, a state. */
export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "accent" | "ok" | "warn" | "generated"; children: ReactNode; title?: string }) {
  return (
    <span className="ui-badge" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/** Nothing to show: one icon and one line. */
export function Empty({ icon: Glyph, children }: { icon: Icon; children: ReactNode }) {
  return (
    <div className="ui-empty">
      <Glyph aria-hidden />
      <p>{children}</p>
    </div>
  );
}

/** A panel sliding in from the right over the page, without hiding it (song details). Escape
 * closes it; the page behind stays usable. */
export function Sheet({ title, close, children, footer, width = 560 }: { title: ReactNode; close: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLElement>(null);
  const dismiss = useRef(close);
  dismiss.current = close;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !isComposingKey(event) && ownsInputLayer(ref.current)) {
        event.preventDefault();
        dismiss.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <aside ref={ref} className="ui-sheet" style={{ width }} aria-label={typeof title === "string" ? title : undefined}>
      <header className="ui-sheet-header">
        <div className="ui-sheet-title">{title}</div>
        <IconButton label="关闭" icon={X} onClick={close} />
      </header>
      <div className="ui-sheet-body">{children}</div>
      {footer && <footer className="ui-sheet-footer">{footer}</footer>}
    </aside>
  );
}
