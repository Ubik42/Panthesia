import type { ReviewSource } from "./reviewSources";
import type { HistoryEntry } from "./historyTypes";
import type { SongWorkspaceTarget } from "../../app/songWorkspaceVisit";
import type { Workspace } from "../../app/useWorkspaceNavigation";

export interface HistoryFilters {
  query: string;
  mode: string;
  hands: string;
  range: string;
  days: number;
  from: number | null;
  to: number | null;
}
export interface HistorySelection {
  contentId: string;
  id: string;
}
export interface HistoryBrowse {
  barReview?: HistoryBarReview;
  barReviews?: HistoryBarReview[];
  detailSection?: HistoryDetailSection;
  pane?: import("../../app/useBrowsePane").BrowsePane;
  filtersOpen?: boolean;
  calendar?: HistoryCalendarBrowse;
  song?: SongWorkspaceTarget | null;
  visitFrom?: Workspace;
  returnTo?: Omit<HistoryBrowse, "sources" | "returnTo"> | null;
  sources?: ReviewSource[];
  filters: HistoryFilters;
  offset: number;
  selected: HistoryEntry | null;
  selection?: HistorySelection | null;
  order: string;
  listTop: number;
  listTopKey?: string;
  detailTop: number;
  detailTopKey?: string;
}

export type HistoryDetailSection =
  "results" | "performance" | "comparison" | "annotation";
export interface HistoryBarReview {
  contentId: string;
  id: string;
  page: number;
  errorsOnly: boolean;
  order?: string;
}
export interface HistoryCalendarBrowse {
  expanded: boolean;
  month: number;
  trendOpen: boolean;
}
export const historyFilters: HistoryFilters = {
  query: "",
  mode: "",
  hands: "",
  range: "",
  days: 0,
  from: null,
  to: null,
};
