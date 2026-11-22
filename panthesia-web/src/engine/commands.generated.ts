// Generated from panthesia-engine/src/protocol.rs. Do not edit.
// Migrated domains follow Rust serde names and input defaults; remaining domains use unknown.
export interface Variant {
  "transpose"?: number;
  "quantize"?: number;
  "durations"?: boolean;
  "tonic"?: number | null;
  "minor"?: boolean | null;
}

export interface NotationGeneration {
  "id": string;
  "generator": string;
  "generatorIdentity": string;
  "sourceContentId": string;
  "inputKind": string;
  "directory": string;
  "notesPath": string;
  "reportPath": string;
}

export interface PracticeEdition {
  "id": string;
  "performanceId": string;
  "transform": Variant;
}

export interface NotationCapabilities {
  "fingerprint": string;
  "format": string;
  "title": string | null;
  "exporter": string | null;
  "writtenNotes": number;
  "parts": number;
  "display": string;
  "analysis": string;
  "playback": string;
  "editing": string;
  "export": string;
  "issues": Array<string>;
  "identity": string;
  "preservedOnly": Array<string>;
  "formatChanges": Array<string>;
}

export interface StartupStatus {
  "stage": string;
  "active": boolean;
  "ready": boolean;
  "canSkip": boolean;
  "error": string | null;
  "warnings": Array<StartupWarning>;
}

export interface StartupWarning {
  "id": string;
  "kind": StartupWarningKind;
  "title": string;
  "detail": string;
  "source": SongSource | null;
}

export const StartupWarningKindValues = ["song", "skippedSong", "songAssets", "songLocation", "soundfont", "input", "output", "history", "settings"] as const;
export type StartupWarningKind = typeof StartupWarningKindValues[number];

export type SongSource =
  | { "kind": "file"; "path": string; "title": string; "contentId": string | null; }
  | { "kind": "recent"; "contentId": string; };

export const StorageOperationValues = ["recording", "asset", "song", "practice", "closing", "other"] as const;
export type StorageOperation = typeof StorageOperationValues[number];

export interface StorageStatus {
  "operation": StorageOperation | null;
  "pending": boolean;
  "error": string | null;
}

export interface LocatedPaperSaved {
  "active": string;
  "alreadySaved": boolean;
}

export interface LocatedNoteDraft {
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "page": number;
  "rendererId": string;
  "region": PageRegion;
}

export interface LocatedPaperUpload {
  "content_id": string;
  "score_revision": number;
  "source_fingerprint": string;
  "mapping_token": string;
  "name": string;
  "page_count": number;
  "anchors": Array<LocatedNoteDraft>;
}

export const ProgramSourceValues = ["selected", "environment", "installed"] as const;
export type ProgramSource = typeof ProgramSourceValues[number];

export interface MuseScoreProgramStatus {
  "available": boolean;
  "supported": boolean;
  "path": string | null;
  "source": ProgramSource | null;
  "message": string;
  "cancelled": boolean;
}

export const DesktopClosePhaseValues = ["preparing", "saving", "finalizing", "reviewing", "returning"] as const;
export type DesktopClosePhase = typeof DesktopClosePhaseValues[number];

export interface DesktopCloseStatus {
  "id": string;
  "pass": number;
  "phase": DesktopClosePhase;
  "message": string;
}

export const DesktopCloseIssueKindValues = ["temporary", "recovery", "problem"] as const;
export type DesktopCloseIssueKind = typeof DesktopCloseIssueKindValues[number];

export interface DesktopCloseIssue {
  "key": string;
  "label": string;
  "detail": string;
  "kind"?: DesktopCloseIssueKind;
}

export interface DesktopCloseReport {
  "issues": Array<DesktopCloseIssue>;
  "checked": Array<string>;
}

export interface DesktopCloseReview {
  "id": string;
  "report": DesktopCloseReport;
}

export interface PaperPracticeSnapshot {
  "contentId": string | null;
  "grid": string;
  "measures": number;
  "measure": number;
  "scoreRevision": number;
}

export interface PaperPracticeRequest {
  "contentId": string;
  "book": string;
  "measure": number;
  "proof": string;
  "start": number;
  "end": number;
  "name": string;
  "notes": string;
  "speed": number;
  "rounds": number;
  "confirmOnly"?: boolean;
}

export interface ScoreReviewExpectation {
  "contentId": string;
  "fingerprint": string;
  "scoreRevision": number;
}

export interface PaperPracticeReview {
  "proof": string;
  "contentId": string;
  "book": string;
  "measure": number;
  "page": number;
  "measures": number;
  "start": number;
  "end": number;
  "name": string;
  "speed": number;
  "rounds": number;
  "settings": SessionSettings;
}

export interface FileLocationPath {
  "path": string;
  "available": boolean;
}

export interface FileLocationKind {
  "id": string;
  "label": string;
  "paths": Array<FileLocationPath>;
  "revision": string;
  "checked": boolean;
}

export interface FileLocationListing {
  "kinds": Array<FileLocationKind>;
  "conflict"?: string;
}

export interface View {
  "page": number;
  "zoom": number;
  "fit": boolean;
  "rotation": number;
}

export interface PaperViewState {
  "contentId": string;
  "book": string;
  "view": View;
  "format": string;
  "imagePages": number;
}

export interface PaperViewSaved {
  "saved": boolean;
  "state": PaperViewState;
}

export interface PageRegion {
  "x": number;
  "y": number;
  "width": number;
  "height": number;
}

export interface PageAnchor {
  "measure": number;
  "page": number;
  "region"?: PageRegion;
}

export interface Mapping {
  "grid": string;
  "enabled": boolean;
  "anchors": Array<PageAnchor>;
}

export interface NoteAnchor {
  "grid": string;
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "assetId": string;
  "page": number;
  "region": PageRegion;
}

export interface NoteAnchorDraft {
  "pitch": number;
  "measure": number;
  "assetId": string;
  "page": number;
  "region": PageRegion;
}

export interface NoteAnchorEdit {
  "track": number;
  "index": number;
  "draft": NoteAnchorDraft;
  "expected"?: NoteAnchor | null;
}

export interface MappingExpectation {
  "mapping"?: Mapping | null;
  "pages": Array<string>;
}

export interface ReadScope {
  "channel": string;
  "sequence": number;
}

export const PracticeHandsValues = ["Both", "Right", "Left", "Custom", "Unspecified"] as const;
export type PracticeHands = typeof PracticeHandsValues[number];

export interface PracticeSnapshot {
  "matched_notes": number;
  "on_time_notes": number;
  "early_notes": number;
  "late_notes": number;
  "wrong_notes": number;
  "missed_notes": number;
  "required_notes": number;
}

export interface PracticeAnnotation {
  "note": string;
  "teacher": string;
  "next": string;
  "updated_at_unix_ms": number;
}

export interface ReplayClip {
  "id": string;
  "name": string;
  "start": number;
  "end": number;
  "notes": string;
  "updatedAtUnixMs": number;
  "performanceRevision"?: string;
}

export const MediaExportKindValues = ["midi", "practiceMidi"] as const;
export type MediaExportKind = typeof MediaExportKindValues[number];

export interface MediaExportInput {
  "contentId": string;
  "kind": MediaExportKind;
}

export interface MediaExportSummary {
  "performances": number;
  "scores": number;
  "paperBooks": number;
  "paperPages": number;
  "fingerings": number;
  "fingerActions": number;
  "hands": number;
  "passages": number;
  "ladders": number;
}

export interface MediaExportDraft {
  "id": string;
  "contentId": string;
  "requestId": string;
  "kind": MediaExportKind;
  "title": string;
  "name": string;
  "size": number;
  "createdAtMs": number;
  "summary": MediaExportSummary;
  "savedPath": string | null;
  "savePendingPath": string | null;
  "previousPendingPaths": Array<string>;
  "warning": string | null;
}

export interface MediaExportListing {
  "drafts": Array<MediaExportDraft>;
  "issues": Array<string>;
  "totalSize": number;
  "capacity": number;
}

export interface ScoreExportOptions {
  "fingers": boolean;
  "hands": boolean;
  "substitutions"?: boolean;
  "repeatPolicy": RepeatPolicy;
}

export const RepeatPolicyValues = ["consistent", "first"] as const;
export type RepeatPolicy = typeof RepeatPolicyValues[number];

export interface ScoreExportInput {
  "contentId": string;
  "scoreRevision": number;
  "annotationRevision"?: number | null;
  "fingerActionRevision"?: string | null;
  "options": ScoreExportOptions;
}

export interface ScoreExportChange {
  "offsetTick": number;
  "from": number;
  "to": number;
  "hand": PracticePart;
}

export interface ScoreExportPosition {
  "track": number;
  "index": number;
  "seconds": number;
  "finger": number | null;
  "hand": string | null;
  "changes": Array<ScoreExportChange> | null;
}

export interface ScoreExportConflict {
  "part": string;
  "measure": number;
  "note": number;
  "fingers": boolean;
  "hands": boolean;
  "substitutions": boolean;
  "positions": Array<ScoreExportPosition>;
}

export interface ScoreExportPreview {
  "name": string;
  "fingerprint": string;
  "fingerNotes": number;
  "handNotes": number;
  "substitutionNotes": number;
  "substitutionActions": number;
  "invalidActions": number;
  "ppq": number;
  "writtenNotes": number;
  "unmappedNotes": number;
  "conflicts": Array<ScoreExportConflict>;
}

export interface PreparedScoreExport {
  "id": string;
  "contentId": string;
  "scoreRevision": number;
  "annotationRevision": number | null;
  "fingerActionRevision": string | null;
  "options": ScoreExportOptions;
  "createdAtMs": number;
  "size": number;
  "preview": ScoreExportPreview;
  "savedPath": string | null;
}

export interface ScoreExportCacheItem {
  "id": string;
  "contentId": string;
  "name": string;
  "size": number;
  "createdAtMs": number;
  "savedPath": string | null;
}

export interface ScoreExportCacheListing {
  "revision": number;
  "items": Array<ScoreExportCacheItem>;
}

export interface ScoreExportResult {
  "input": ScoreExportInput;
  "prepared": ScoreExportCacheItem | null;
  "preview": ScoreExportPreview | null;
  "warning": string | null;
}

export interface PdfDraft {
  "id": string;
  "contentId": string;
  "versionId": string;
  "sourceTitle": string | null;
  "name": string;
  "size": number;
  "createdAtMs": number;
  "warning": string | null;
  "paperId": string | null;
  "adoptionPending": boolean;
}

export interface PdfListing {
  "drafts": Array<PdfDraft>;
  "issues": Array<string>;
  "total": number;
}

export interface DraftSaved {
  "versionId": string | null;
  "path": string;
  "linked": boolean;
  "opened": boolean;
  "warning": string | null;
  "alreadySaved": boolean;
}

export interface DraftSummary {
  "id": string;
  "contentId": string;
  "name": string;
  "fingerprint": string;
  "kind": string;
  "size": number;
  "createdAtMs": number;
  "saved": boolean;
  "savePending": boolean;
  "savedPath": string | null;
  "sourceWarning": string | null;
  "generation": NotationGeneration | null;
}

export interface DraftListing {
  "drafts": Array<DraftSummary>;
  "issues": Array<string>;
}

export interface DraftSelection {
  "engineId": string;
  "contentId": string;
  "id": string;
}

export interface ImportedNotationDraft {
  "engineId": string;
  "contentId": string;
  "name": string;
  "bytes": Array<number>;
}

export interface RetainedNotationFile {
  "id": string;
  "contentId": string;
  "name": string;
  "size": number;
}

export const ScoreJobKindValues = ["midiToNotation", "paperToNotation", "notationToPdf", "annotatedScore", "midiExport", "packageExport", "mediaSave"] as const;
export type ScoreJobKind = typeof ScoreJobKindValues[number];

export interface ScoreJobRequest {
  "id": string;
  "engineId": string;
  "contentId": string;
  "kind": ScoreJobKind;
  "createdAtMs": number;
}

export interface ScoreSubmitted {
  "jobId": string;
}

export interface ScoreDraft {
  "name": string;
  "bytes": Array<number>;
  "previewToken": string;
  "warning": string | null;
  "saved": DraftSaved | null;
  "cached": boolean;
}

export const ScoreJobPhaseValues = ["preparing", "running", "ready", "cancelled", "error"] as const;
export type ScoreJobPhase = typeof ScoreJobPhaseValues[number];

export interface ScoreJobStatus {
  "request": ScoreJobRequest;
  "phase": ScoreJobPhase;
  "stage": string;
  "error": string | null;
  "draft": ScoreDraft | null;
  "pdf": PdfDraft | null;
  "preparedExport": ScoreExportResult | null;
  "mediaExport": MediaExportDraft | null;
  "cancellable": boolean;
}

export interface StateOrder {
  "engineId": string;
  "sequence": number;
}

export const DemoKindValues = ["held"] as const;
export type DemoKind = typeof DemoKindValues[number];

export interface DemoLoop {
  "start": number;
  "end": number;
}

export interface DemoFingerNote {
  "track": number;
  "index": number;
  "pitch": number;
  "part": string;
  "finger": number | null;
  "held": boolean;
  "changed": boolean;
}

export interface DemoState {
  "id": string | null;
  "active": boolean;
  "position"?: number;
  "start"?: number;
  "end"?: number;
  "rate"?: number;
  "paused"?: boolean;
  "history"?: boolean;
  "loop"?: DemoLoop | null;
  "loopRounds"?: number;
  "kind"?: DemoKind;
  "fingerNotes"?: Array<DemoFingerNote>;
  "actionsCompleted"?: number;
  "actionsTotal"?: number;
}

export interface HeldContext {
  "baseline": string;
  "contentId": string;
  "sourceTrack": number;
  "sourceIndex": number;
  "start": number;
  "end": number;
  "notes": Array<HeldNote>;
  "actions": Array<HeldChange>;
}

export interface HeldNote {
  "track": number;
  "index": number;
  "pitch": number;
  "part": string;
  "onset": number;
  "end": number;
  "finger": number | null;
}

export interface HeldChange {
  "track": number;
  "index": number;
  "at": number;
  "atTick": number;
  "from": number;
  "to": number;
}

export const InteractionKindValues = ["sameKeyHandoff", "crossedRange"] as const;
export type InteractionKind = typeof InteractionKindValues[number];

export interface Interaction {
  "kind": InteractionKind;
  "measure": number;
  "fromMeasure": number;
  "leftTrack": number;
  "leftIndex": number;
  "rightTrack": number;
  "rightIndex": number;
  "leftPitch": number;
  "rightPitch": number;
  "at": number;
  "end": number;
  "overlapMs": number;
  "leftStartedBeforeRange": boolean;
  "rightStartedBeforeRange": boolean;
}

export interface Analysis {
  "items": Array<Interaction>;
  "sameKey": number;
  "crossedRange": number;
  "truncated": boolean;
}

export interface PlanRequest {
  "content_id": string;
  "track": number;
  "index": number;
  "profile": HandSpanProfile;
  "hand": PracticePart;
  "range"?: [number, number] | null;
  "keep_saved": boolean;
  "practice_rate"?: number;
  "pins"?: Array<Pin>;
  "target_tracks"?: Array<number>;
}

export interface Pin {
  "track"?: number | null;
  "index": number;
  "finger": number;
}

export interface Edit {
  "track_id": number;
  "note_index": number;
  "finger"?: number | null;
}

export interface Proposal {
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "finger": number;
  "saved": number | null;
  "confidence": number;
  "reason": string;
}

export interface Position {
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "saved": number | null;
  "target": boolean;
  "onset": number;
  "end": number;
}

export interface PairPart {
  "request": PlanRequest;
  "fingerprint": string;
  "edits": Array<Edit>;
}

export interface ActionInput {
  "track": number;
  "index": number;
  "beforeTrack": number;
  "beforeIndex": number;
  "at": number;
  "from": number;
  "to": number;
}

export interface ActionEdit {
  "contentId": string;
  "track": number;
  "index": number;
  "originalTick": number;
  "atTick": number;
  "to": number;
  "baseline": string;
  "rate": number;
}

export const FingeringReviewKindValues = ["wideReach", "rapidTurn", "rapidShift", "sameFingerMove"] as const;
export type FingeringReviewKind = typeof FingeringReviewKindValues[number];

export const CrossHandReviewKindValues = ["sameKey", "crossedRange"] as const;
export type CrossHandReviewKind = typeof CrossHandReviewKindValues[number];

export interface ScoreArticulations {
  "paired": boolean;
  "slurLinks": number;
  "staccatoNotes": number;
}

export interface MotionReview {
  "contextIndex": number;
  "index": number;
  "fromIndex": number;
  "track": number;
  "fromTrack": number;
  "measure": number;
  "fromMeasure": number;
  "pitch": number;
  "fromPitch": number;
  "kind": FingeringReviewKind;
  "semitones": number;
  "comfortableSemitones": number;
  "intervalMs": number | null;
}

export interface CrossHandPlanReview {
  "contextIndex": number;
  "track": number;
  "index": number;
  "measure": number;
  "pitch": number;
  "finger": number;
  "oppositeTrack": number;
  "oppositeIndex": number;
  "oppositeMeasure": number;
  "oppositePitch": number;
  "oppositeFinger": number;
  "oppositeSaved": boolean;
  "kind": CrossHandReviewKind;
  "overlapMs": number;
}

export interface FingeringPlan {
  "rank": number;
  "cost": number;
  "primaryCost": number;
  "oppositeCost": number;
  "jointCost": number;
  "proposals": Array<Proposal>;
  "contextFingers": Array<number>;
  "oppositeContextFingers": Array<number | null>;
  "review": Array<MotionReview>;
  "crossHandReview": Array<CrossHandPlanReview>;
  "practiceRate": number;
  "crossings": number;
  "shifts": number;
  "wide": number;
  "changed": number;
}

export interface PlanResult {
  "targetTracks": Array<number>;
  "contextTracks": Array<number>;
  "contentId": string;
  "fingerprint": string;
  "request": PlanRequest;
  "plans": Array<FingeringPlan>;
  "context": Array<Position>;
  "oppositeContext": Array<Position>;
  "jointStatus": string;
  "scoreArticulations": ScoreArticulations;
}

export interface HeldSubstitution {
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "beforeTrack": number;
  "beforeIndex": number;
  "beforeMeasure": number;
  "at": number;
  "from": number;
  "to": number;
}

export interface HeldPlan {
  "rank": number;
  "cost": number;
  "proposals": Array<Proposal>;
  "substitutions": Array<HeldSubstitution>;
  "contextFingers": Array<number>;
}

export interface HeldPlanResult {
  "contentId": string;
  "request": PlanRequest;
  "fingerprint": string;
  "context": Array<Position>;
  "plans": Array<HeldPlan>;
  "readOnly": boolean;
  "scoreArticulations": ScoreArticulations;
}

export interface MarkedNeighbor {
  "track": number;
  "index": number;
  "measure": number;
  "pitch": number;
  "finger": number;
  "contextIndex": number;
}

export interface CoverageNote {
  "track": number;
  "index": number;
  "measure": number;
  "pitch": number;
  "contextIndex": number;
  "target": boolean;
  "before": MarkedNeighbor | null;
  "after": MarkedNeighbor | null;
}

export interface AcceptanceConflict {
  "contextIndex": number;
  "fromContextIndex": number;
  "index": number;
  "fromIndex": number;
  "track": number;
  "fromTrack": number;
  "measure": number;
  "fromMeasure": number;
  "pitch": number;
  "fromPitch": number;
  "finger": number;
  "fromFinger": number;
  "reason": string;
}

export interface AcceptanceMotionReview {
  "contextIndex": number;
  "track": number;
  "fromTrack": number;
  "measure": number;
  "fromMeasure": number;
  "pitch": number;
  "fromPitch": number;
  "kind": FingeringReviewKind;
  "semitones": number;
  "comfortableSemitones": number;
  "intervalMs": number | null;
}

export interface ExpressionReview {
  "contextIndex": number;
  "fromContextIndex": number;
  "track": number;
  "index": number;
  "measure": number;
  "pitch": number;
  "finger": number;
  "fromTrack": number;
  "fromIndex": number;
  "fromMeasure": number;
  "fromPitch": number;
  "fromFinger": number;
  "reason": string;
}

export interface TrackAcceptance {
  "track": number;
  "total": number;
  "selected": number;
  "retained": number;
  "unmarked": number;
  "changed": number;
  "new": number;
}

export interface AcceptanceReview {
  "contextUnmarked": number;
  "valid": boolean;
  "markedSubsetValid": boolean;
  "fullPassageValidated": boolean;
  "coverage": Array<CoverageNote>;
  "coverageTotal": number;
  "coverageTruncated": boolean;
  "conflicts": Array<AcceptanceConflict>;
  "truncated": boolean;
  "review": Array<AcceptanceMotionReview>;
  "expressionReview": Array<ExpressionReview>;
  "expressionReviewTruncated": boolean;
  "crossHandReview": Array<CrossHandPlanReview>;
  "tracks": Array<TrackAcceptance>;
  "contextFingers": Array<number | null>;
  "reviewTruncated": boolean;
  "selected": number;
  "retained": number;
  "unmarked": number;
  "total": number;
}

export interface SharedKey {
  "measure": number;
  "pitch": number;
  "leftTrack": number;
  "rightTrack": number;
}

export interface PairReview {
  "proof": string;
  "reviews": Array<AcceptanceReview>;
  "valid": boolean;
  "needsAck": boolean;
  "unassigned": number;
  "shared": Array<SharedKey>;
  "selected": number;
  "interactions": Analysis;
}

export interface PairSaved {
  "saved": boolean;
  "hands": number;
}

export const ExercisePatternValues = ["Scale", "Arpeggio", "PrimaryChords"] as const;
export type ExercisePattern = typeof ExercisePatternValues[number];

export const ExerciseTonalityValues = ["Major", "Minor"] as const;
export type ExerciseTonality = typeof ExerciseTonalityValues[number];

export const ExerciseMinorFormValues = ["Natural", "Harmonic", "Melodic"] as const;
export type ExerciseMinorForm = typeof ExerciseMinorFormValues[number];

export const ExerciseDirectionValues = ["Ascending", "Descending", "UpAndDown"] as const;
export type ExerciseDirection = typeof ExerciseDirectionValues[number];

export const ExerciseHandsValues = ["Right", "Left", "Both"] as const;
export type ExerciseHands = typeof ExerciseHandsValues[number];

export interface ExerciseSpec {
  "tonic": number;
  "tonality": ExerciseTonality;
  "minor_form"?: ExerciseMinorForm;
  "pattern": ExercisePattern;
  "direction": ExerciseDirection;
  "hands": ExerciseHands;
  "octaves": number;
  "repetitions"?: number;
  "tempo_bpm": number;
}

export const PracticePartValues = ["LeftHand", "RightHand", "Other"] as const;
export type PracticePart = typeof PracticePartValues[number];

export const HandSpanProfileValues = ["Compact", "Standard", "Large"] as const;
export type HandSpanProfile = typeof HandSpanProfileValues[number];

export const PlayerConfigValues = ["Mute", "Auto", "Human"] as const;
export type PlayerConfig = typeof PlayerConfigValues[number];

export interface NotePlaybackRule {
  "track_id": number;
  "note_index": number;
  "mode": PlayerConfig;
}

export interface PlaybackNote {
  "index": number;
  "pitch": number;
  "start": number;
  "measure": number;
  "mode": PlayerConfig | null;
}

export interface PlaybackPage {
  "track": number;
  "total": number;
  "offset": number;
  "revision": string;
  "notes": Array<PlaybackNote>;
}

export interface SongMetadata {
  "title"?: string | null;
  "subtitle"?: string | null;
  "arranger"?: string | null;
  "copyright"?: string | null;
  "license"?: string | null;
  "artist"?: string | null;
  "composer"?: string | null;
  "collection"?: string | null;
  "difficulty"?: string | null;
  "tags"?: Array<string>;
  "notes"?: string | null;
}

export interface FingerHint {
  "track_id": number;
  "note_index": number;
  "finger": number;
}

export interface NoteHandHint {
  "track_id": number;
  "note_index": number;
  "part": PracticePart;
}

export interface FingerAction {
  "track_id": number;
  "note_index": number;
  "before_track": number;
  "before_index": number;
  "at_tick": number;
  "from": number;
  "to": number;
  "hand": PracticePart;
  "rate_milli"?: number;
}

export interface MeterCorrection {
  "numerator": number;
  "denominator": number;
  "pickup_ticks": number;
}

export interface MeterSegment {
  "measure": number;
  "numerator": number;
  "denominator": number;
  "display_start"?: number | null;
}

export interface MeasureLength {
  "measure": number;
  "ticks": number;
}

export interface MeterMap {
  "pickup_ticks": number;
  "segments": Array<MeterSegment>;
  "measure_lengths"?: Array<MeasureLength>;
}

export interface TrackAppearance {
  "name"?: string | null;
  "color"?: string | null;
  "handColors"?: Record<string, PartColor> | null;
}

export interface PartColor {
  "color"?: string | null;
  "visible": boolean;
}

export interface TrackSound {
  "volume": number;
  "pan"?: number | null;
  "program"?: number | null;
}

export const PracticeTrackModeValues = ["Mute", "Auto", "Human"] as const;
export type PracticeTrackMode = typeof PracticeTrackModeValues[number];

export interface PracticeTrackSetup {
  "track_id": number;
  "mode": PracticeTrackMode;
  "visible": boolean;
}

export interface TickRange {
  "description": string;
  "contentId": string;
  "grid": string;
  "startTick": number;
  "endTick": number;
}

export interface BeatPoint {
  "measure": number;
  "beat": number;
}

export interface ScoreRange {
  "startTrim"?: number;
  "endTrim"?: number;
  "scoreIdentity": string;
  "routeIdentity": string;
  "firstVisit": number;
  "lastVisit": number;
  "startTick": number;
  "endTick": number;
  "description": string;
}

export interface Bookmark {
  "id": string;
  "name": string;
  "tick": number;
}

export interface BookmarkEntry {
  "id": string;
  "name": string;
  "tick": number;
  "seconds": number;
  "midi": boolean;
  "available": boolean;
}

export interface BookmarkCatalog {
  "contentId": string;
  "bookmarks": Array<BookmarkEntry>;
  "catalogRevision": string;
}

export interface SessionSettings {
  "tracks": Array<PracticeTrackSetup>;
  "parts": Record<number, PracticePart>;
  "mode": string | null;
  "countIn": number;
  "metronome": boolean;
  "latency": number;
  "rounds": number;
  "hands": string;
}

export interface PassagePreset {
  "practice"?: PracticeEdition;
  "preciseRange"?: TickRange;
  "scoreRange"?: ScoreRange;
  "grid": string | null;
  "id": string;
  "name": string;
  "start": number;
  "end": number;
  "notes": string;
  "speed": number;
  "settings": SessionSettings;
}

export interface ExercisePreset {
  "id": string;
  "name": string;
  "spec": ExerciseSpec;
}

export interface Passage {
  "start": number;
  "end": number;
}

export interface SoundStatus {
  "ready": boolean;
  "changing": boolean;
  "error": string | null;
  "lateNotes": number;
  "device": string;
  "deviceId": string | null;
  "pluginStatePath": string | null;
  "pluginStateRestored": boolean;
  "pluginStateWarning": string | null;
}

export interface AudioPerformance {
  "callbacks": number;
  "maxRenderUs": number;
  "overBudgetCallbacks": number;
  "maxFrames": number;
}

export interface PlaybackPerformance {
  "maxGapMs": number;
  "lateTicks": number;
  "maxTickMs": number;
  "maxPublishMs": number;
}

export interface LiveKey {
  "velocity": number;
  "serial": number;
}

export interface Snapshot {
  "playbackPerformance": PlaybackPerformance;
  "stateOrder"?: StateOrder;
  "startup": StartupStatus;
  "recordingUnsaved": boolean;
  "recordingPath": string | null;
  "storage": StorageStatus;
  "contentId": string | null;
  "scoreRevision": number;
  "annotationRevision": number;
  "status": string;
  "position": number;
  "duration": number;
  "practiceMs": number;
  "speed": number;
  "wait": boolean;
  "hands": string;
  "required": Array<number>;
  "pressed": Array<number>;
  "pressedKeys": Record<number, LiveKey>;
  "input": string | null;
  "output": string;
  "outputId": string | null;
  "soundfont": string;
  "soundfontStatus": string;
  "sound": SoundStatus;
  "audioLevel": number | null;
  "audioPerformance": AudioPerformance | null;
  "soundfontWarning": string | null;
  "error": string | null;
  "passage": Passage | null;
  "repetitions": number;
  "volume": number;
  "mode": string;
  "measure": number;
  "beat": number;
  "tick": number;
  "bpm": number;
  "countIn": number;
  "countRemaining": number;
  "metronome": boolean;
  "latency": number;
  "recording": boolean;
  "recordDuration": number;
  "inputConnected": boolean;
  "midiEvents": number;
  "noteEpoch": number;
  "pedal": number;
  "rounds": number;
}

export interface TimedText {
  "tick": number;
  "seconds": number;
  "text": string;
}

export interface KeyChange {
  "tick": number;
  "seconds": number;
  "fifths": number;
  "minor": boolean;
}

export interface ImportedLayers {
  "lyrics": Array<TimedText>;
  "keys": Array<KeyChange>;
}

export interface Harmony {
  "chords": Array<ChordItem>;
  "origin": string;
  "tool": string;
  "saved": boolean;
}

export interface ChordItem {
  "tick": number;
  "endTick": number;
  "seconds": number;
  "endSeconds": number;
  "harte": string | null;
  "name": string;
  "degree": string;
}

export interface ChordEdit {
  "tick": number;
  "label": string;
}

export interface Sections {
  "items": Array<SectionItem>;
  "origin": string;
}

export interface SectionItem {
  "tick": number;
  "seconds": number;
  "label": string;
}

export interface PassageCatalog {
  "contentId": string;
  "grid": string;
  "passages": Array<PassagePreset>;
  "catalogRevision": string;
  "writeSettled"?: boolean;
}

export interface ExerciseCatalog {
  "presets": Array<ExercisePreset>;
  "catalogRevision": string;
}

export interface FingerProfileCatalog {
  "contentId": string | null;
  "profiles": Record<number, HandSpanProfile> | null;
  "profilesByHand": Record<string, HandSpanProfile> | null;
  "defaults": Record<PracticePart, HandSpanProfile>;
  "catalogRevision": string;
  "writeSettled"?: boolean;
}

export interface HandProposal {
  "track": number;
  "index": number;
  "pitch": number;
  "start": number;
  "measure": number;
  "part": PracticePart;
  "saved": PracticePart;
  "confidence": number;
  "reason": string;
}

export interface MeterEditorState {
  "contentId": string;
  "grid": string;
  "scoreRevision": number;
  "annotationRevision": number;
  "writeSettled"?: boolean;
}

export interface HandUndoState {
  "contentId": string;
  "undoAvailable": boolean;
  "revision": string;
  "proof": string;
  "profileRevision": string;
  "writeSettled"?: boolean;
}

export interface HandAssignmentValue {
  "index": number;
  "pitch": number;
  "start": number;
  "manual": PracticePart | null;
}

export interface HandAssignmentRead {
  "contentId": string;
  "track": number;
  "revision": string;
  "assignments": Array<HandAssignmentValue>;
  "writeSettled"?: boolean;
}

export interface HandSuggestionRead {
  "contentId": string;
  "proposals": Array<HandProposal>;
  "proof": string;
  "undoAvailable": boolean;
}

export type EngineCommand =
  | { type: "practiceVariant"; "content_id": string; "score_revision": number; "value": Variant }
  | { type: "exportPracticeVariant" }
  | { type: "audioDevices" }
  | { type: "audioDevice"; "name"?: string | null }
  | { type: "startInstrumentPreview"; "id": string; "content_id": string; "track": number; "program"?: number | null }
  | { type: "stopSongAudition"; "id": string }
  | { type: "songAuditionState"; "id": string }
  | { type: "fileLocations" }
  | { type: "fileLocationsFor"; "kind": string }
  | { type: "updateFileLocation"; "kind": string; "path"?: string | null; "clear": boolean; "expected"?: string | null }
  | { type: "trackAppearance"; "id": number; "appearance"?: TrackAppearance | null }
  | { type: "trackSound"; "id": number; "sound"?: TrackSound | null }
  | { type: "soundFont"; "path": string }
  | { type: "mode"; "value": string }
  | { type: "track"; "id": number; "mode": string; "part": string; "visible": boolean }
  | { type: "measureLoop"; "start": number; "end": number; "enabled": boolean }
  | { type: "prepareMeasurePart"; "contentId": string; "measure": number; "part": PracticePart; "trackId": number }
  | { type: "seekMeasure"; "measure": number }
  | { type: "seekBeat"; "measure": number; "beat": number }
  | { type: "stepBeat"; "direction": number }
  | { type: "countIn"; "bars": number }
  | { type: "rounds"; "count": number }
  | { type: "calibration" }
  | { type: "metronome"; "enabled": boolean }
  | { type: "latency"; "milliseconds": number }
  | { type: "generate"; "spec": ExerciseSpec }
  | { type: "panic" }
  | { type: "recording"; "active": boolean }
  | { type: "exportMidi" }
  | { type: "vstEditor" }
  | { type: "score" }
  | { type: "sourceScore" }
  | { type: "scoreView"; "content_id": string; "score_revision": number; "first_measure"?: number | null; "position"?: number | null; "source"?: boolean }
  | { type: "scoreSources"; "content_id"?: string | null }
  | { type: "previewScoreSource"; "id": string; "fingerprint": string }
  | { type: "linkScoreSource"; "midi_path": string; "content_id": string; "version_id": string; "path": string; "default_bpm": number }
  | { type: "acknowledgeScoreSource"; "id": string; "fingerprint": string }
  | { type: "unlinkScoreSource"; "id": string; "path": string }
  | { type: "applyScoreSource"; "id": string; "fingerprint": string; "mode": string }
  | { type: "importScoreOriginal"; "path": string; "default_bpm": number }
  | { type: "scoreVersions" }
  | { type: "previewScoreVersionRoute"; "id": string; "content_id": string; "include_document"?: boolean }
  | { type: "previewScoreBytesRoute"; "bytes": Array<number>; "name": string; "content_id": string }
  | { type: "saveScoreVersion"; "bytes": Array<number>; "name": string; "content_id": string }
  | { type: "scoreAttachments"; "content_id": string }
  | { type: "linkPaperSource"; "content_id": string; "book": string; "asset": string; "path"?: string | null; "baseline"?: string | null }
  | { type: "paperSourceUpdates" }
  | { type: "inspectPaperSources"; "content_id": string; "book": string }
  | { type: "previewPaperSource"; "content_id": string; "book": string; "asset": string; "fingerprint": string }
  | { type: "applyPaperSource"; "content_id": string; "book": string; "asset": string; "fingerprint": string; "baseline": string; "action": string }
  | { type: "paperTransferSources"; "content_id": string }
  | { type: "previewCrossPaperTransfer"; "content_id": string; "source_content_id": string; "source": string; "target": string }
  | { type: "applyCrossPaperTransfer"; "content_id": string; "request": unknown }
  | { type: "previewPaperTransfer"; "content_id": string; "source": string; "target": string }
  | { type: "applyPaperTransfer"; "content_id": string; "request": unknown }
  | { type: "paperPracticeContext" }
  | { type: "editPaperInk"; "content_id": string; "book": string; "asset_id": string; "page": number; "expected": Array<unknown>; "strokes": Array<unknown> }
  | { type: "seekPaperMeasure"; "content_id": string; "id": string; "measure": number; "scope"?: ReadScope | null }
  | { type: "readPaperView"; "content_id": string; "book": string }
  | { type: "savePaperView"; "content_id": string; "book": string; "view": View; "expected": View }
  | { type: "seekPaperNote"; "content_id": string; "book": string; "expected": NoteAnchor; "scope"?: ReadScope | null }
  | { type: "previewPaperPractice"; "content_id": string; "book": string; "measure": number }
  | { type: "savePaperPractice"; "request": PaperPracticeRequest }
  | { type: "editPaperAnnotation"; "content_id": string; "book": string; "id"?: string | null; "draft"?: unknown | null; "expected"?: unknown | null }
  | { type: "editPaperNoteAnchor"; "score_revision"?: number | null; "content_id": string; "book": string; "track": number; "index": number; "draft"?: NoteAnchorDraft | null; "expected"?: NoteAnchor | null }
  | { type: "batchPaperNoteAnchors"; "content_id": string; "book": string; "edits": Array<NoteAnchorEdit> }
  | { type: "createLocatedScorePaper"; "content_id": string; "score_revision": number; "source_fingerprint": string; "mapping_token": string; "name": string; "pages": Array<Array<number>>; "anchors": Array<LocatedNoteDraft> }
  | { type: "setPaperMapping"; "score_revision"?: number | null; "content_id": string; "id": string; "mapping"?: Mapping | null; "expected"?: MappingExpectation | null }
  | { type: "addScoreAttachment"; "content_id": string; "name": string; "bytes": Array<number>; "append"?: string | null }
  | { type: "updateScoreAttachment"; "content_id": string; "id"?: string | null; "action": string; "name"?: string | null; "view"?: View | null; "page"?: number; "direction"?: number; "expected_pages"?: Array<string> | null }
  | { type: "activateScore"; "expected"?: ScoreReviewExpectation | null; "id": string; "content_id": string }
  | { type: "detachScore"; "content_id": string }
  | { type: "removeScoreVersion"; "id": string; "content_id": string }
  | { type: "renameScoreVersion"; "expected_name"?: string | null; "id": string; "content_id": string; "name": string }
  | { type: "pairScore"; "expected"?: ScoreReviewExpectation | null; "bytes": Array<number>; "name": string; "content_id": string }
  | { type: "pairScoreFile"; "path": string; "content_id": string }
  | { type: "saveChords"; "content_id": string; "chords": Array<ChordEdit> }
  | { type: "adoptChords"; "content_id": string }
  | { type: "exportAnnotatedScore"; "content_id": string; "score_revision": number; "options": ScoreExportOptions; "download"?: boolean; "fingerprint"?: string | null }
  | { type: "scoreMap"; "score_revision"?: number | null; "midi": Array<number>; "notes": Array<unknown>; "content_id": string }
  | { type: "finger"; "track": number; "index": number; "finger"?: number | null }
  | { type: "startFingerDemo"; "request": PlanRequest; "fingerprint": string; "rate": number }
  | { type: "heldFingerDemoContext"; "content_id": string; "track": number; "index": number; "rate": number }
  | { type: "startHeldFingerDemo"; "content_id": string; "track": number; "index": number; "baseline": string; "rate": number }
  | { type: "fingerDemoState" }
  | { type: "stopFingerDemo"; "id"?: string | null }
  | { type: "suggestFingerPlans"; "request": PlanRequest }
  | { type: "suggestHeldFingerPlans"; "request": PlanRequest }
  | { type: "acceptHeldFingerPlan"; "request": PlanRequest; "fingerprint": string; "edits": Array<Edit>; "actions": Array<ActionInput> }
  | { type: "clearHeldFingerActions"; "content_id": string }
  | { type: "clearNoteHeldFingerActions"; "content_id": string; "track": number; "index": number }
  | { type: "reviewHeldActionEdit"; "request": ActionEdit }
  | { type: "saveHeldActionEdit"; "request": ActionEdit; "review": string }
  | { type: "fingerPlanContext"; "request": PlanRequest }
  | { type: "acceptFingerPlan"; "request": PlanRequest; "fingerprint": string; "edits": Array<Edit> }
  | { type: "fingerDemoControl"; "id": string; "action": string; "position"?: number | null }
  | { type: "startPairFingerDemo"; "parts": Array<PairPart>; "proof": string; "acknowledged": boolean; "rate": number }
  | { type: "savePairFingerPractice"; "parts": Array<PairPart>; "proof": string; "acknowledged": boolean; "ranges": Array<unknown> }
  | { type: "fingerPair"; "parts": Array<PairPart>; "proof"?: string | null; "acknowledged": boolean }
  | { type: "reviewFingerAcceptance"; "request": PlanRequest; "fingerprint": string; "edits": Array<Edit> }
  | { type: "saveFingerPractice"; "request": PlanRequest; "fingerprint": string; "ranges": Array<unknown> }
  | { type: "suggestFingers"; "hand"?: PracticePart | null; "track": number; "index": number; "profile"?: HandSpanProfile; "range"?: [number, number] | null }
  | { type: "applyFingers"; "content_id": string; "hints": Array<FingerHint> }
  | { type: "suggestHands"; "track": number; "range": [number, number]; "reference": number }
  | { type: "resetPartSettings"; "content_id": string; "track": number; "proof": string }
  | { type: "setPartHands"; "content_id": string; "track": number; "part"?: PracticePart | null; "split_pitch"?: number | null; "proof": string; "hints"?: Array<NoteHandHint>; "clear"?: Array<number> }
  | { type: "applyHands"; "content_id": string; "hints": Array<NoteHandHint>; "clear"?: Array<[number, number]>; "proof"?: string | null }
  | { type: "noteHand"; "track": number; "index": number; "part"?: PracticePart | null }
  | { type: "undoHands" }
  | { type: "undoHandsFor"; "expected": string }
  | { type: "handUndoState" }
  | { type: "readHandAssignments"; "track": number; "indices": Array<number> }
  | { type: "readNotePlayback"; "track": number; "offset": number; "limit": number }
  | { type: "editNotePlayback"; "track": number; "indices": Array<number>; "mode"?: PlayerConfig | null; "expected": string }
  | { type: "previewMeterMap"; "content_id": string; "value"?: MeterMap | null }
  | { type: "readMeterEditorState" }
  | { type: "saveMeterMap"; "content_id": string; "value"?: MeterMap | null; "proof": string }
  | { type: "meter"; "value"?: MeterCorrection | null }
  | { type: "undoFingers" }
  | { type: "editFingersFor"; "content_id": string; "edits": Array<Edit> }
  | { type: "undoFingersFor"; "content_id": string }
  | { type: "fingerProfiles" }
  | { type: "handSpanDefault"; "hand": PracticePart; "profile": HandSpanProfile }
  | { type: "handSpanFor"; "content_id": string; "track": number; "hand": PracticePart; "profile"?: HandSpanProfile | null }
  | { type: "passages" }
  | { type: "previewScoreRangeTrim"; "content_id": string; "score_revision": number; "first": number; "last": number; "start_trim": number; "end_trim": number }
  | { type: "previewScoreRange"; "content_id": string; "score_revision": number; "first": number; "last": number }
  | { type: "applyScoreRange"; "content_id": string; "score_revision": number; "range": ScoreRange }
  | { type: "saveScorePassage"; "content_id": string; "score_revision": number; "id"?: string | null; "name": string; "notes": string; "range": ScoreRange }
  | { type: "previewTickRange"; "content_id": string; "grid": string; "start": BeatPoint; "end": BeatPoint }
  | { type: "applyTickRange"; "range": TickRange }
  | { type: "saveTickPassage"; "id"?: string | null; "name": string; "notes": string; "range": TickRange }
  | { type: "savePassage"; "content_id"?: string | null; "id"?: string | null; "name": string; "start": number; "end": number; "notes": string }
  | { type: "updatePassageDetails"; "content_id": string; "id": string; "name": string; "notes": string }
  | { type: "openPassage"; "id": string }
  | { type: "removePassage"; "content_id"?: string | null; "id": string }
  | { type: "editExercisePreset"; "name": string; "spec": ExerciseSpec; "expected": string }
  | { type: "deleteExercisePreset"; "id": string; "expected": string }
  | { type: "exercisePresets" }
  | { type: "saveExercisePreset"; "name": string; "spec": ExerciseSpec }
  | { type: "removeExercisePreset"; "id": string }
  | { type: "metadata" }
  | { type: "editMetadata"; "value": SongMetadata; "expected": SongMetadata }
  | { type: "setMetadata"; "value": SongMetadata }
  | { type: "openFile"; "path": string }
  | { type: "songFiles" }
  | { type: "recentFiles" }
  | { type: "forgetRecentFile"; "path": string }
  | { type: "editSongFile"; "action": string; "path"?: string | null; "id"?: string | null; "role"?: string | null; "stem"?: string | null; "label"?: string | null }
  | { type: "currentSong" }
  | { type: "session" }
  | { type: "tasks" }
  | { type: "skipStartupSong" }
  | { type: "retryStartup" }
  | { type: "dismissStartupWarning"; "id": string }
  | { type: "cancelTask"; "id": string }
  | { type: "cancelHistoryRead"; "channel": string; "sequence": number }
  | { type: "bookmarks" }
  | { type: "saveBookmark"; "content_id": string; "id"?: string | null; "name": string; "tick": number }
  | { type: "removeBookmark"; "content_id": string; "id": string }
  | { type: "practiceTime"; "content_id": string; "from": number; "to": number }
  | { type: "volume"; "value": number }
  | { type: "loop"; "start": number; "end": number; "enabled": boolean }
  | { type: "play" }
  | { type: "pause" }
  | { type: "restart" }
  | { type: "seek"; "position": number }
  | { type: "speed"; "value": number }
  | { type: "wait"; "enabled": boolean }
  | { type: "hands"; "value": string }
  | { type: "input"; "name"?: string | null }
  | { type: "output"; "name"?: string | null }
  | { type: "note"; "pitch": number; "active": boolean; "velocity": number };

export type CommandName = EngineCommand["type"];
export type CommandOf<Name extends CommandName> = Extract<EngineCommand, { type: Name }>;
