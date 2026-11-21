import type { LoadedSong } from "../../api";
import type { ScoreRouteEvidence } from "./ScoreRoutePreview";
export type SourceStatus =
  "ready" | "changed" | "acknowledged" | "missing" | "unreadable";
export interface ScoreSource {
  id: string;
  contentId: string;
  versionId: string;
  name: string;
  songTitle: string;
  midiPath: string;
  path: string;
  status: SourceStatus;
  pending: boolean;
  active: boolean;
  defaultBpm: number;
  fingerprint: string | null;
  error: string | null;
}
export interface ScoreSourcePreview {
  id: string;
  fingerprint: string;
  name: string;
  title: string | null;
  newContentId: string | null;
  performanceReady: boolean;
  performanceError: string | null;
  writtenNotes: number;
  samePerformance: boolean | null;
  notes: number | null;
  duration: number | null;
  oldAvailable: boolean;
  pairing: {
    coverage: number;
    readiness: "Ready" | "Review" | "Poor" | "Blocked";
    diagnostics: string[];
  } | null;
  warnings: string[];
  routePreview: ScoreRouteEvidence | null;
}
export type SourceApplyMode = "notation" | "performance";
export interface AppliedSource {
  contentId: string;
  versionId: string;
  mode: SourceApplyMode;
  song: LoadedSong | null;
  warnings: string[];
}
