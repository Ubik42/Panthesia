/** Content identity follows a piece across names, copies and workspace visits. */
import type { Workspace } from "../stores/route";
export interface SongWorkspaceTarget {
  contentId: string;
  title: string;
  path: string | null;
}

export interface SongWorkspaceRequest {
  id: string;
  song: SongWorkspaceTarget;
  from?: Workspace;
}
