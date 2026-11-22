// Shared engine data contracts. This module has no UI or transport dependency.
import type { EngineCommand } from "./commands.generated";

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
  importedLayers: import("./commands.generated").ImportedLayers;
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
export type { Snapshot, StorageStatus } from "./commands.generated";
import type { Snapshot } from "./commands.generated";
export const emptyState: Snapshot = {
  playbackPerformance: { maxGapMs: 0, lateTicks: 0, maxTickMs: 0, maxPublishMs: 0 },
  startup: { stage: "connecting", active: true, ready: false, canSkip: false, error: null, warnings: [] },
  recordingUnsaved: false,
  recordingPath: null,
  storage: { operation: null, pending: false, error: null },
  pressedKeys: {},
  outputId: null,
  soundfont: "",
  soundfontStatus: "",
  sound: { ready: false, changing: false, error: null, lateNotes: 0, device: "", deviceId: null, pluginStatePath: null, pluginStateRestored: false, pluginStateWarning: null },
  audioLevel: null,
  audioPerformance: null,
  soundfontWarning: null,
  noteEpoch: 0,
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
