import type { PaperReadingTicket } from "./paperViewStore";
import type { PaperAnnotation } from "./PaperAnnotations";

export type PaperView = import("../../engine/commands.generated").View;
export interface PaperAttachment {
  id: string;
  name: string;
  format: "pdf" | "images";
  pages: {
    id: string;
    name: string;
    kind: string;
    size: number;
    available: boolean;
    status?: string;
  }[];
  view: PaperView;
  readingTicket?: PaperReadingTicket;
  mapping?: PaperMapping | null;
  noteAnchors?: PaperNoteAnchor[];
  annotations?: PaperAnnotation[];
  sources?: Record<string, { path: string; ignored: string | null }>;
}
export type PageAnchor = import("../../engine/commands.generated").PageAnchor;
export type PaperMapping = import("../../engine/commands.generated").Mapping;
export type PracticeContext =
  import("../../engine/commands.generated").PaperPracticeSnapshot;
export interface Papers {
  contentId: string;
  active: string | null;
  attachments: PaperAttachment[];
}
export type PaperNoteAnchor =
  import("../../engine/commands.generated").NoteAnchor;
