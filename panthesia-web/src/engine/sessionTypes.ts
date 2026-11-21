// Shared engine data contracts. This module has no UI or transport dependency.
import type { EngineCommand, StorageStatus as EngineStorageStatus } from "./commands.generated";

export type PracticeEditCommand = Extract<EngineCommand, { type:
  | "finger" | "editFingersFor" | "undoFingers" | "undoFingersFor" | "applyFingers"
  | "acceptFingerPlan" | "acceptHeldFingerPlan" | "clearHeldFingerActions"
  | "clearNoteHeldFingerActions" | "saveHeldActionEdit"
  | "track" | "editNotePlayback" | "noteHand" | "applyHands" | "setPartHands" | "resetPartSettings" | "undoHands" | "undoHandsFor" | "meter" | "saveMeterMap"
  | "handSpanFor" | "handSpanDefault"
  | "openPassage" | "applyTickRange" | "applyScoreRange"
  | "saveBookmark" | "removeBookmark"
  | "savePassage" | "removePassage" | "updatePassageDetails" | "saveScorePassage" | "saveTickPassage"
  | "saveExercisePreset" | "removeExercisePreset" | "editExercisePreset" | "deleteExercisePreset"
  | "resetMetadataDefaults" | "saveFingerPractice" | "savePairFingerPractice" | "trackSound" | "trackAppearance" | "setMetadata" | "editMetadata"
}> | (Extract<EngineCommand, { type: "fingerPair" }> & { proof: string });
export type PracticeDemoCommand = Extract<EngineCommand, { type: "startFingerDemo" | "startHeldFingerDemo" | "startPairFingerDemo" }>;
export type PracticeReadCommand = Extract<EngineCommand, { type:
  | "bookmarks" | "passages" | "exercisePresets" | "previewTickRange" | "previewScoreRange" | "previewScoreRangeTrim"
  | "readMetadataDefaults" | "metadata" | "suggestHands" | "previewMeterMap" | "fingerPlanContext" | "reviewFingerAcceptance"
  | "reviewHeldActionEdit" | "fingerProfiles" | "handUndoState"
  | "readHandAssignments" | "readNotePlayback"
  | "readMeterEditorState"
  | "suggestFingerPlans" | "suggestHeldFingerPlans" | "heldFingerDemoContext"
}> | (Extract<EngineCommand, { type: "fingerPair" }> & { proof?: null });
export type PracticeEditScope = Pick<LoadedSong, "contentId" | "scoreRevision" | "annotationRevision" | "engineId">;


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
  practiceVariant?: {editionId?:string|null; settings: import("./commands.generated").Variant; tonic: number; effectiveTonic?:number; effectiveFifths?:number; keyChanges?:{tick:number;at:number;tonic:number;fifths:number;minor:boolean}[]; minor: boolean; keySource: "manual" | "midi" | "score" | "estimate"; sourceHasScore: boolean; minPitch: number | null; maxPitch: number | null; active: boolean};
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
export interface LiveNoteEvent { pitch: number; velocity: number; active: boolean }
export interface LiveNoteReceipt {
  engineId?: string | null; epoch?: number; accepted: number; expired: number }
// Existing saved UI sessions can omit newly added storage observations.
export type StorageStatus = Pick<EngineStorageStatus, "pending" | "error" | "canRetry"> &
  Partial<Pick<EngineStorageStatus, "version" | "operation" | "writing" | "unsavedChanges" | "recovery" | "recoveryError">>;
export interface Snapshot {
  stateOrder?: import("./commands.generated").StateOrder;
  noteEpoch?: number;
  scoreRevision?: number;
  annotationRevision?: number;
  startup?: Omit<import("./commands.generated").StartupStatus, "warnings"> & { warnings?: import("./commands.generated").StartupWarning[] };
  recordingUnsaved?: boolean;
  recordingPath?: string | null;
  soundfontWarning?: string | null;
  storage?: StorageStatus;
  contentId: string | null;
  status: string;
  position: number;
  duration: number;
  practiceMs: number;
  speed: number;
  wait: boolean;
  hands: string;
  required: number[];
  pressed: number[];
  pressedKeys?: Record<number,{velocity:number;serial:number}>;
  input: string | null;
  output: string;
  outputId?: string | null;
  sound?: {ready:boolean;changing:boolean;error:string|null;lateNotes?:number;device?:string;deviceId?:string|null;pluginStatePath?:string|null;pluginStateRestored?:boolean;pluginStateWarning?:string|null};
  audioLevel?:number|null;
  audioPerformance?:{callbacks:number;maxRenderUs:number;overBudgetCallbacks:number;maxFrames:number}|null;
  playbackPerformance?:{maxGapMs:number;lateTicks:number;maxTickMs:number;maxPublishMs:number};
  soundfont?: string;
  error: string | null;
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
}
export const emptyState: Snapshot = {
  startup: {stage:"connecting",active:true,ready:false,canSkip:false,error:null},
  contentId: null,
  scoreRevision: 0,
  annotationRevision: 0,
  status: "idle",
  position: 0,
  duration: 0,
  practiceMs: 0,
  speed: 1,
  wait: true,
  hands: "both",
  required: [],
  pressed: [],
  input: null,
  output: "内置钢琴",
  error: null,
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
};
export interface EngineSession {
  readSequence?: number;
  song: LoadedSong | null;
  state: Snapshot;
}
