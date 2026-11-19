import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListMusic,
} from "lucide-react";
import type { BrowsePane } from "./useBrowsePane";
import "./browsePanes.css";

export function BrowsePaneNavigation({
  compact,
  pane,
  title,
  available,
  blocked,
  listLabel,
  detailLabel,
  showList,
  showDetails,
  children,
  neighbors,
}: {
  compact: boolean;
  pane: BrowsePane;
  title?: string;
  available: boolean;
  blocked: boolean;
  listLabel: string;
  detailLabel: string;
  showList: () => void;
  showDetails: () => void;
  children?: React.ReactNode;
  neighbors?: {
    position: string;
    previousLabel: string;
    nextLabel: string;
    canPrevious: boolean;
    canNext: boolean;
    previous: () => void;
    next: () => void;
  };
}) {
  if (!compact) return null;
  return (
    <div
      className="browse-pane-navigation"
      role="group"
      aria-label="列表与详情"
    >
      <button
        disabled={blocked || pane === "list"}
        onClick={showList}
        aria-pressed={pane === "list"}
        data-dialog-escape={pane === "detail" ? "" : undefined}
        aria-label={pane === "detail" ? `返回${listLabel}` : listLabel}
      >
        {pane === "detail" ? <ArrowLeft size={16} /> : <ListMusic size={16} />}
        {listLabel}
      </button>
      <div className="browse-pane-current">
        <span>{pane === "detail" ? detailLabel : "当前选择"}</span>
        <strong title={title}>{title || "选择一项以查看详情"}</strong>
      </div>
      {pane === "list" && (
        <button disabled={blocked || !available} onClick={showDetails}>
          <FileText size={16} />
          {detailLabel}
        </button>
      )}
      {pane === "list" && children}
      {pane === "detail" && neighbors && (
        <div className="browse-pane-neighbors">
          <span>{neighbors.position}</span>
          <button
            disabled={blocked || !neighbors.canPrevious}
            onClick={neighbors.previous}
          >
            <ChevronLeft size={15} />
            {neighbors.previousLabel}
          </button>
          <button
            disabled={blocked || !neighbors.canNext}
            onClick={neighbors.next}
          >
            {neighbors.nextLabel}
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
