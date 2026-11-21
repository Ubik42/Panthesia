import type { View } from "./libraryQueryModel";
import type { SongWorkspaceTarget } from "../../app/songWorkspaceVisit";
import type { Workspace } from "../../app/useWorkspaceNavigation";

export interface LibraryBrowse {
  detailSection?: LibraryDetailSection;
  pane?: import("../../app/useBrowsePane").BrowsePane;
  groupsOpen?: boolean;
  filtersOpen?: boolean;
  batchOpen?: boolean;
  transient?: boolean;
  selectionReview?: LibrarySelectionReview;
  song?: SongWorkspaceTarget | null;
  visitFrom?: Workspace;
  visitReturn?: LibraryVisitReturn | null;
  view: View;
  page: number;
  group: string;
  recordings: boolean;
  active: string | null;
  editing?: {
    path: string;
    contentId: string;
    value: import("./metadataTypes").Metadata;
  } | null;
  selected: string[];
  selectionOnly?: boolean;
  advancedOpen?: boolean;
  top: number;
  topKey?: string;
  detailTop?: number;
  detailTopKey?: string;
}
export interface LibrarySelectionReview {
  query: string;
  page: number;
  expanded: boolean;
  top: number;
  topKey?: string;
}

export interface LibraryVisitReturn {
  focus?: "missing" | "review";
  song?: SongWorkspaceTarget | null;
  visitFrom?: Workspace;
  detailSection?: LibraryDetailSection;
  editing?: LibraryBrowse["editing"];
  pane?: import("../../app/useBrowsePane").BrowsePane;
  groupsOpen?: boolean;
  filtersOpen?: boolean;
  batchOpen?: boolean;
  query: string;
  view: View;
  page: number;
  group: string;
  recordings: boolean;
  selectionOnly: boolean;
  transient: boolean;
  active: string | null;
  advancedOpen: boolean;
  top: number;
  topKey?: string;
  detailTop?: number;
  detailTopKey?: string;
}

export function libraryVisitReturn(
  browse: LibraryBrowse,
  query = "",
  focus?: LibraryVisitReturn["focus"],
): LibraryVisitReturn {
  return {
    focus,
    query,
    view: browse.view,
    page: browse.page,
    group: browse.group,
    recordings: browse.recordings,
    active: browse.active,
    editing: browse.editing,
    selectionOnly: browse.selectionOnly ?? false,
    transient: browse.transient ?? false,
    advancedOpen: browse.advancedOpen ?? false,
    pane: browse.pane,
    detailSection: browse.detailSection,
    groupsOpen: browse.groupsOpen,
    filtersOpen: browse.filtersOpen,
    batchOpen: browse.batchOpen,
    top: browse.top,
    topKey: browse.topKey,
    detailTop: browse.detailTop,
    detailTopKey: browse.detailTopKey,
    song: browse.song,
    visitFrom: browse.visitFrom,
  };
}

export type LibraryDetailSection = "overview" | "scores" | "files";

export type LibrarySearchRequest = { id: string } & (
  | { query: string; song?: never }
  | { song: SongWorkspaceTarget; query?: never; from?: Workspace }
);
