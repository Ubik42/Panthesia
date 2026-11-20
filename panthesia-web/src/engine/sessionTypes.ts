// Shared engine data contracts. This module has no UI or transport dependency.
import type { EngineCommand, StorageStatus as EngineStorageStatus, RoutineState } from "./commands.generated";

export type PracticeEditCommand = Extract<EngineCommand, { type:
  | "finger" | "editFingersFor" | "undoFingers" | "undoFingersFor" | "applyFingers"
  | "acceptFingerPlan" | "acceptHeldFingerPlan" | "clearHeldFingerActions"
  | "clearNoteHeldFingerActions" | "saveHeldActionEdit"
  | "track" | "editNotePlayback" | "noteHand" | "applyHands" | "setPartHands" | "resetPartSettings" | "undoHands" | "undoHandsFor" | "meter" | "saveMeterMap"
  | "setSongExpressionGoal" | "editSongExpressionGoal"
  | "handSpanFor" | "handSpanDefault"
  | "openPassage" | "startLadder" | "applyTickRange" | "applyScoreRange"
  | "loopRestartErrors"
  | "saveBookmark" | "removeBookmark"
  | "savePassage" | "removePassage" | "updatePassageDetails" | "saveScorePassage" | "saveTickPassage"
  | "saveLadder" | "updateLadderName" | "removeLadder" | "saveExercisePreset" | "removeExercisePreset" | "editExercisePreset" | "deleteExercisePreset"
  | "resetMetadataDefaults" | "saveFingerPractice" | "savePairFingerPractice" | "trackSound" | "trackAppearance" | "setMetadata" | "editMetadata"
}> | (Extract<EngineCommand, { type: "fingerPair" }> & { proof: string });
export interface HistoryReadScope { channel: string; sequence: number }
export type HistoryReadCommand = Extract<EngineCommand, {type:
  "weakPractice" | "dueReview" | "collection" | "history" | "historyQuery" | "readHistoryPage" | "historyDetail" | "practiceTime" | "practiceCalendar"
  | "readHistoryDetail" | "readHistoryPerformance" | "historyProblemNotes" | "historyReplayClips" | "readHistoryReplayClips" | "historyPerformance" | "songLearningEvidence" | "readSongExpressionGoal" | "readHistoryAnnotation" | "libraryRepairs"
}>;
export type PracticeDemoCommand = Extract<EngineCommand, { type: "startFingerDemo" | "startHeldFingerDemo" | "startPairFingerDemo" }>;
export type PracticeReadCommand = Extract<EngineCommand, { type:
  | "bookmarks" | "passages" | "ladderPresets" | "exercisePresets" | "previewTickRange" | "previewScoreRange" | "previewScoreRangeTrim"
  | "readMetadataDefaults" | "metadata" | "suggestHands" | "previewMeterMap" | "fingerPlanContext" | "reviewFingerAcceptance"
  | "reviewHeldActionEdit" | "fingerProfiles" | "handUndoState"
  | "readHandAssignments" | "readNotePlayback"
  | "readMeterEditorState"
  | "suggestFingerPlans" | "suggestHeldFingerPlans" | "heldFingerDemoContext"
}> | (Extract<EngineCommand, { type: "fingerPair" }> & { proof?: null });
export type PracticeEditScope = Pick<LoadedSong, "contentId" | "scoreRevision" | "annotationRevision" | "engineId">;


export interface SongRow {
  id: string;
  title: string;
  composer: string;
  arranger?: string | null;
  source: string;
  category: string;
  license: string;
  sourceUrl: string;
  path: string;
  contentId?: string | null;
  tags?: string[];
  difficulty?: string | null;
  rating?: number;
}
export interface LibraryMonitorStatus {
  enabled: boolean;
  phase: string;
  revision: number;
  lastScan: number;
  pending: number;
  files: number;
  updated: number;
  errors: string[];
  current: string;
  paperUpdates?: number;
  paperUnavailable?: number;
  scoreUpdates?: number;
  scoreUnavailable?: number;
  metadataFiles?: number;
  metadataPending?: number;
}
export interface Note {
  index: number;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  track: number;
  tick: number;
  endTick: number;
  finger: number | null;
  part: "left" | "right" | "other";
  manualHand: boolean;
  playbackMode?: import("./commands.generated").PlayerConfig;
}
export interface LibraryAttempt {
  id: string;
  recordedAt: number;
  kind: "whole" | "passage" | "exercise";
  range: [number, number] | null;
  mode: string | null;
  hands: string;
  bpm: number | null;
  accuracy: number | null;
  judged: number | null;
  target: number | null;
  restorable: boolean;
  errorRestart: boolean;
}
export interface LibraryPracticeProgress {
  last: LibraryAttempt | null;
  whole: LibraryAttempt | null;
  wholeCount: number;
  comparableWholeCount: number;
}
export interface CollectionSong {
  contentId: string;
  title: string;
  path: string | null;
  favorite: boolean;
  queuePosition: number | null;
  lastUsed: number;
  lastPracticed?: number | null;
  practice?: LibraryPracticeProgress;
  sessions: number;
  accuracy: number | null;
  generated: boolean;
  available: boolean;
  recommended: [number, number] | null;
  review: { due: boolean; dueAt?: number; sourceAt?: number; sourceIsWholeSong?: boolean; days: number; streak: number; intervalDays?: number; reason?: "NeedsEvidence" | "IncompleteConditions" | "NeedsReinforcement" | "FirstMastery" | "Consolidating" | "Stable" } | null;
}
export type TrackSound = Required<import("./commands.generated").TrackSound>;
export interface SoundFontStatus {
  path: string | null;
  label: string;
  isDefault: boolean;
  warning?: string | null;
}
export interface AudiverisProgramStatus {
  available: boolean;
  path: string | null;
  source: "selected" | "environment" | "installed" | null;
  message: string;
  cancelled?: boolean;
}
export interface MeterMapSegment {
  measure: number;
  numerator: number;
  denominator: number;
  display_start: number | null;
}
export interface MeterMap {
  pickup_ticks: number;
  segments: MeterMapSegment[];
  measure_lengths: { measure: number; ticks: number }[];
}
export interface MeterMapPreview {
  proof: string;
  value: MeterMap | null;
  measures: LoadedSong["measures"];
}
export interface LoadedSong {
  practiceVariant?: {editionId?:string|null; settings: import("./commands.generated").Variant; tonic: number; effectiveTonic?:number; effectiveFifths?:number; minor: boolean; keySource: "manual" | "midi" | "estimate"; sourceHasScore: boolean; minPitch: number | null; maxPitch: number | null; active: boolean};
  engineId?: string | null;
  grid?: string;
  meterMap?: MeterMap | null;
  fingerActionRevision?: string;
  fingerActions?: {
    track: number;
    index: number;
    beforeTrack: number;
    beforeIndex: number;
    atTick: number;
    at: number;
    from: number;
    to: number;
    valid: boolean;
    practiceRate: number;
    validationRate: number;
  }[];
  trackSounds?: Record<string, TrackSound>;
  soundPresets?: { program: number; name: string }[];
  importWarnings?: string[];
  meterCorrection: {
    numerator: number;
    denominator: number;
    pickup_ticks: number;
  } | null;
  title: string;
  contentId: string;
  sourcePath: string;
  duration: number;
  notes: Note[];
  ppq: number;
  generated: boolean;
  hasScore: boolean;
  fingerUndoAvailable?: boolean;
  scoreRevision: number;
  annotationRevision?: number;
  measures: {
    displayNumber?: number;
    number: number;
    start: number;
    end: number;
    startTick: number;
    endTick: number;
    numerator: number;
    denominator: number;
    explicit: boolean;
    partial: boolean;
  }[];
  tempo: { tick: number; seconds: number; bpm: number }[];
  tracks: {
    id: number;
    name: string;
    sourceName: string;
    sourceProgram?: number;
    sourceInstrument?: string;
    color?: string | null;
    appearanceCustom?: boolean;
    notes: number;
    mode: string;
    part: string;
    visible: boolean;
    inferred: boolean;
  }[];
}
export type { SpeedLadderPlan, LadderPreset, LadderRun } from "./commands.generated";
import type { LadderRun } from "./commands.generated";
export interface LiveNoteEvent { pitch: number; velocity: number; active: boolean }
export interface LiveNoteReceipt {
  engineId?: string | null; epoch?: number; accepted: number; expired: number }
// Existing saved UI sessions can omit newly added storage observations.
export type StorageStatus = Pick<EngineStorageStatus, "pending" | "error" | "canRetry"> &
  Partial<Pick<EngineStorageStatus, "version" | "operation" | "writing" | "unsavedChanges" | "recovery" | "recoveryError">>;
export interface Snapshot {
  stateOrder?: import("./commands.generated").StateOrder;
  musicImportVersion?: number;
  exerciseGenerationVersion?: number;
  packageImportVersion?: number;
  noteEpoch?: number;
  summaryVersion?: string;
  scoreRevision?: number;
  annotationRevision?: number;
  startup?: Omit<import("./commands.generated").StartupStatus, "warnings"> & { warnings?: import("./commands.generated").StartupWarning[] };
  recordingUnsaved?: boolean;
  recordingPath?: string | null;
  soundfontWarning?: string | null;
  storage?: StorageStatus;
  contentId: string | null;
  songExpressionGoal: import("./commands.generated").ExpressionGoal | null;
  songExpressionGoalResult: { passed: boolean; message: string; noteVelocity?: import("./commands.generated").NoteVelocityEvidence; notePedal?: import("./commands.generated").NotePedalEvidence } | null;
  songExpressionGoalState?: "ready" | "pending" | "unavailable" | null;
  routine: RoutineState | null;
  ladder: LadderRun | null;
  status: string;
  position: number;
  duration: number;
  practiceMs: number;
  speed: number;
  wait: boolean;
  hands: string;
  required: number[];
  pressed: number[];
  score: {
    matched_notes: number;
    wrong_notes: number;
    missed_notes: number;
    on_time_notes: number;
    required_notes: number;
  };
  input: string | null;
  output: string;
  outputId?: string | null;
  sound?: {ready:boolean;changing:boolean;error:string|null;lateNotes?:number;device?:string;deviceId?:string|null;pluginStatePath?:string|null;pluginStateRestored?:boolean;pluginStateWarning?:string|null};
  audioLevel?:number|null;
  audioPerformance?:{callbacks:number;maxRenderUs:number;overBudgetCallbacks:number;maxFrames:number}|null;
  playbackPerformance?:{maxGapMs:number;lateTicks:number;maxTickMs:number;maxPublishMs:number};
  soundfont?: string;
  error: string | null;
  saved: boolean;
  currentHistoryId: string | null;
  passage: { start: number; end: number } | null;
  repetitions: number;
  volume: number;
  rounds: number;
  inputConnected: boolean;
  midiEvents: number;
  pedal: number;
  recording: boolean;
  recordDuration: number;
  mode: string;
  measure: number;
  beat: number;
  tick: number;
  bpm: number;
  countIn: number;
  countRemaining: number;
  metronome: boolean;
  latency: number;
  adaptive: boolean;
  loopRestartErrors:number;
  loopRestarts:number;
  loopAbortLimit:number;
  summary: Feedback | null;
}
export const emptyState: Snapshot = {
  startup: {stage:"connecting",active:true,ready:false,canSkip:false,error:null},
  contentId: null,
  scoreRevision: 0,
  annotationRevision: 0,
  songExpressionGoal: null,
  songExpressionGoalResult: null,
  songExpressionGoalState: null,
  routine: null,
  ladder: null,
  status: "idle",
  position: 0,
  duration: 0,
  practiceMs: 0,
  speed: 1,
  wait: true,
  hands: "both",
  required: [],
  pressed: [],
  score: {
    matched_notes: 0,
    wrong_notes: 0,
    missed_notes: 0,
    on_time_notes: 0,
    required_notes: 0,
  },
  input: null,
  output: "内置钢琴",
  error: null,
  saved: false,
  currentHistoryId: null,
  passage: null,
  repetitions: 0,
  volume: 0.8,
  recording: false,
  recordDuration: 0,
  inputConnected: false,
  midiEvents: 0,
  pedal: 0,
  rounds: 0,
  mode: "wait",
  measure: 1,
  beat: 1,
  tick: 0,
  bpm: 120,
  countIn: 1,
  countRemaining: 0,
  metronome: false,
  latency: 0,
  adaptive: false,
  loopRestartErrors:0,
  loopRestarts:0,
  loopAbortLimit:0,
  summary: null,
};
export interface EngineSession {
  readSequence?: number;
  song: LoadedSong | null;
  state: Snapshot;
}
export interface Feedback {
  source?: {
    contentId: string | null;
    historyId: string | null;
    summaryVersion: string;
    scoreRevision: number;
    annotationRevision: number;
  };
  mode?: string;
  trend?: {
    attempts: number;
    accuracyDelta: number | null;
    speedDelta: number | null;
    tempoDelta: number | null;
  };
  overall: Snapshot["score"];
  measures: {
    measure: number;
    breakdown: {
      matched_notes: number;
      wrong_notes: number;
      missed_notes: number;
      early_notes?: number;
      late_notes?: number;
    };
    timing: {
      median_offset_ms: number | null;
      median_deviation_ms: number | null;
    };
  }[];
  measure_parts?: {
    measure: number;
    part: "LeftHand" | "RightHand" | "Other";
    track_id: number;
    breakdown: {
      target_notes: number;
      matched_notes: number;
      on_time_notes: number;
      early_notes: number;
      late_notes: number;
      wrong_notes: number;
      missed_notes: number;
    };
    timing: {
      matched_samples: number;
      median_offset_ms: number | null;
      median_deviation_ms: number | null;
    };
  }[];
  parts: {
    part: string;
    breakdown: {
      matched_notes: number;
      wrong_notes: number;
      missed_notes: number;
    };
  }[];
  timing: {
    median_offset_ms: number | null;
    median_deviation_ms: number | null;
  };
  chords: {
    eligible_chords: number;
    complete_chords: number;
    incomplete_chords: number;
    median_attack_span_ms: number | null;
  };
  expression: {
    velocity: {
      matched_samples: number;
      mean_abs_difference: number | null;
      contour_steps: number;
      contour_aligned: number;
    };
    pedal: {
      user_used: boolean;
      target_present: boolean;
      timing_samples: number;
      median_offset_ms: number | null;
    };
    articulation: {
      matched_samples: number;
      median_duration_ratio_percent: number | null;
    };
  };
}
