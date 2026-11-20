import type { Feedback } from "../../api";
import type {
  NoteVelocityEvidence,
  NotePedalEvidence,
} from "../../ExpressionGoalControl";

export type Annotation =
  import("../../engine/commands.generated").PracticeAnnotation;
export interface HistoryAnnotationRequest {
  engineId?: string;
  contentId: string;
  id: string;
  note: string;
  teacher: string;
  next: string;
  expected: Annotation | null;
}
export interface HistoryAnnotationSaved {
  contentId: string;
  id: string;
  annotation: Annotation;
}

export type HistoryEntry = Pick<
  import("../../engine/commands.generated").HistoryListEntry,
  | "annotation"
  | "id"
  | "contentId"
  | "title"
  | "path"
  | "recordedAt"
  | "playingMs"
  | "speed"
  | "hands"
  | "mode"
  | "coverage"
  | "range"
  | "exactPassage"
  | "score"
  | "restorable"
  | "tempo"
>;
export interface SavedExpressionCondition {
  velocity_difference: number | null;
  note_velocity_difference?: number | null;
  note_pedal_mismatch_count?: number | null;
  contour_percent: number | null;
  pedal_offset_ms: number | null;
}

export interface HistoryDetail extends HistoryEntry {
  source?: import("./historySource").HistorySource;
  performanceAvailable?: boolean;
  summary: Feedback;
  expressionGoalResult?: {
    passed: boolean;
    message: string;
    noteVelocity?: NoteVelocityEvidence;
    notePedal?: NotePedalEvidence;
  };
  context: {
    loop_restart?:number|null;
    expression?: SavedExpressionCondition | null;
    routine?: {
      expression?: SavedExpressionCondition | null;
      item_notes?: string;
      consecutive?: boolean;
      accuracy_percent: number;
      on_time_percent: number | null;
      routine_name: string;
      day: string;
      item_title: string;
      passes_required: number;
    } | null;
    ladder?: {
      plan_name: string;
      stage: number;
      speed_percent: number;
      target_percent: number;
    } | null;
    tracks: { track_id: number; mode: string; visible: boolean }[];
    count_in: number;
    metronome: boolean;
    latency: number;
    pedal_latency_ms?: number | null;
    rounds: number;
    adaptive: boolean;
  } | null;
  comparison: {
    count: number;
    bestAccuracy: number | null;
    previous: HistoryEntry | null;
    recent: HistoryEntry[];
    reasonCode?: string | null;
    reason?: string | null;
    excludedRecent?: { entry: HistoryEntry; reasons: string[] }[];
    conditions?: {
      complete: boolean;
      range: [number, number] | null;
      passageBounds?: { start_tick: number; end_tick: number } | null;
      passageLocation?: string | null;
      mode: string | null;
      hands: string;
      speed: number;
      effectiveTempoBpm: number | null;
      scope: string | null;
      targetNotes?: number;
      judgedNotes?: number;
      countIn?: number;
      metronome?: boolean;
      inputLatencyMs?: number;
      pedalLatencyMs?: number;
      pedalLatencySource?: string;
      rounds?: number;
      adaptive?: boolean;
      grid?: string;
      tracks?: { track_id: number; mode: string; visible: boolean }[];
      parts?: Record<string, string>;
      assignedHands?: string;
      exerciseSpec?:
        import("../../engine/commands.generated").ExerciseSpec | null;
      expressionGoal?: SavedExpressionCondition | null;
    };
  };
}

export type PracticeCalendarData =
  import("../../engine/commands.generated").HistoryCalendar;

export interface PracticeTimeTotals {
  legacySessions: number;
  legacyTimedSessions: number;
  legacyTimedMs: number;
  periodLegacySessions: number;
  untrackedMs: number;
  earliestIntervalAt?: number | null;
  coverage: string;
  totalMs: number;
  periodMs: number;
  timedSessions: number;
  unknownSessions: number;
  periodUnknownSessions: number;
  retainedSessions: number;
  from: number;
  to: number;
}

export type ReplayClip = import("../../engine/commands.generated").ReplayClip;
export type ReplayClipRows = Pick<
  import("../../engine/commands.generated").ReplayClipRead,
  "clips" | "revision"
>;

export type HistoryPaperTarget = {
  contentId: string;
  measure: number;
  historyId: string;
  reference: number;
  pitch: number;
  track: number;
  songTime: number;
  index?: number | null;
  startMeasure: number;
  endMeasure: number;
};
