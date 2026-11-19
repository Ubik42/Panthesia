import type { SongMetadata } from "../../engine/commands.generated";

export type Metadata = Required<SongMetadata>;
export type MetadataField = keyof Metadata;
export interface MetadataHistory {
  records: {
    id: string;
    contentId: string;
    timeMs: number;
    before: Metadata;
    after: Metadata;
    state: "prepared" | "applied" | "failed";
    restoredFrom: string | null;
    fields: MetadataField[];
    matchesCurrent: boolean;
  }[];
  retention: number;
  available: boolean;
  error: string | null;
}
export interface MetadataRestorePreview {
  base: Metadata;
  value: Metadata;
  after: Metadata;
  fields: MetadataField[];
  conflicts: MetadataField[];
}
export interface MetadataDraft {
  base: Metadata;
  draft: Metadata;
  tagsText?: string;
  refresh?: { warnings?: string[] };
  source?: "practice" | "library";
  batchId?: string;
  submission?: "unconfirmed";
}
export interface MetadataSaveReply {
  status: "saved" | "conflict";
  warnings?: string[];
  value?: Metadata;
  current?: Metadata;
}
export interface MetadataService {
  read: () => Promise<Metadata>;
  save: (value: Metadata, expected: Metadata) => Promise<MetadataSaveReply>;
}
