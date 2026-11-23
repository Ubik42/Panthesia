import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import "./controls.css";
import "./page.css";

/** Header of a page below the start page: back to where it came from, title, page actions. */
export function PageHeader({
  title,
  subtitle,
  back,
  backLabel = "返回",
  backDisabled = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <button className="ui-button ui-button--ghost" data-workspace-close disabled={backDisabled} onClick={back}>
        <ArrowLeft />
        {backLabel}
      </button>
      <div className="ui-page-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="ui-page-actions">{children}</div>
    </header>
  );
}
