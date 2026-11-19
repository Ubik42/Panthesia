import type {
  Suggestion,
  RecommendationAccepted,
} from "../../engine/commands.generated";
export type {
  Suggestion,
  RecommendationPage,
  RecommendationAccepted,
  WeakPracticeEdit,
} from "../../engine/commands.generated";
import type { WeakPracticeEdit } from "../../engine/commands.generated";
export interface RecommendationSubmission {
  ids: string[];
  edits: WeakPracticeEdit[];
  routineId: string | null;
  day: string | null;
  name: string;
  requestId: string | null;
}

export type ReviewEdit = {
  speedPercent: number;
  passes: number;
  accuracy: number;
  onTime: number | null;
};
export interface RecommendationDraft {
  rows: Suggestion[];
  retired: { row: Suggestion; chosen: boolean }[];
  chosen: string[];
  edits: Record<string, ReviewEdit>;
  note: string;
  duePage: {
    dueTotal: number;
    eligibleTotal: number;
    missingTotal: number;
    revision: string;
    nextOffset: number;
    hasMore: boolean;
  } | null;
  passageAvailability: { due: number; missing: number } | null;
  name: string;
  message: string;
  stale: boolean;
  edited: boolean;
  receipt: RecommendationAccepted | null;
  filter: "all" | "notes" | "expression" | "due";
}
