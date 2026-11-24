import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import "./controls.css";
import "./forms.css";
import "./dialog.css";

/** The application's one dialog (interface-design.md §6): title, close button, content drawn
 * with the shared form styles. Escape closes it (see below); so does a click outside unless the dialog holds
 * choices that would be lost (`keepOnBackdrop`). */
export function Dialog({
  title,
  subtitle,
  close,
  closeLabel = "关闭",
  children,
  footer,
  wide = false,
  keepOnBackdrop = false,
  closeDisabled = false,
  className,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  close: () => void;
  closeLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  keepOnBackdrop?: boolean;
  /** While true (saving), neither the close button, Escape nor the backdrop closes it. */
  closeDisabled?: boolean;
  /** Extra class on the dialog, for its own content styles. */
  className?: string;
  /** Main actions in the title row, before the close button. */
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  // Escape and Tab are handled for every dialog by the window's focus manager (useDialogFocus):
  // Escape presses the button marked data-dialog-escape, else the close button.
  useEffect(() => {
    // A control marked data-dialog-initial-focus (a search box) takes focus, else the dialog.
    (ref.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? ref.current)?.focus();
  }, []);
  return (
    <div className="ui-dialog-backdrop" onClick={keepOnBackdrop || closeDisabled ? undefined : close}>
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={["ui-dialog", wide && "ui-dialog--wide", className].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ui-dialog-header">
          <div className="ui-dialog-title">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="ui-dialog-actions">{actions}</div>}
          <button className="ui-icon-button" aria-label={closeLabel} data-dialog-close disabled={closeDisabled} onClick={close}>
            <X />
          </button>
        </header>
        <div className="ui-dialog-body ui-form">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </section>
    </div>
  );
}
