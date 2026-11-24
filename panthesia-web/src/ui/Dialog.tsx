import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { isComposingKey, ownsInputLayer } from "../lib/inputOwnership";
import "./controls.css";
import "./forms.css";
import "./dialog.css";

/** The application's one dialog (interface-design.md §6): title, close button, content drawn
 * with the shared form styles. Escape and a click outside close it. */
export function Dialog({
  title,
  close,
  children,
  footer,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const dismiss = useRef(close);
  dismiss.current = close;
  useEffect(() => {
    ref.current?.focus();
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
    <div className="ui-dialog-backdrop" onClick={close}>
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`ui-dialog${wide ? " ui-dialog--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ui-dialog-header">
          <h2>{title}</h2>
          <button className="ui-icon-button" aria-label="关闭" onClick={close}>
            <X />
          </button>
        </header>
        <div className="ui-dialog-body ui-form">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </section>
    </div>
  );
}
