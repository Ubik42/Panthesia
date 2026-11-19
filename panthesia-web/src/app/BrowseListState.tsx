import { FileSearch, LoaderCircle, Music2, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import "./browseListState.css";

export function BrowseListState({
  kind,
  title,
  detail,
  children,
}: {
  kind: "loading" | "failed" | "filtered" | "empty";
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  const Icon =
    kind === "loading"
      ? LoaderCircle
      : kind === "failed"
        ? FileSearch
        : kind === "filtered"
          ? SearchX
          : Music2;
  return (
    <div className="browse-list-state" data-state={kind}>
      <span className="browse-list-state-icon">
        <Icon size={25} aria-hidden="true" />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {children && <div className="browse-list-state-actions">{children}</div>}
    </div>
  );
}
