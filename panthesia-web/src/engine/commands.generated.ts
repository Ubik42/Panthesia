// Generated from panthesia-engine/src/protocol.rs. Do not edit.
// Migrated domains follow Rust serde names and input defaults; remaining domains use unknown.
export interface CatalogPerformance {
  "contentId": string;
  "workId": string;
  "title": string;
  "composer": string;
  "label": string;
  "notationCount": number;
}

export interface SongCatalog {
  "revision": string;
  "performances": Array<CatalogPerformance>;
}

export interface MetadataSourceCandidate {
  "path": string;
  "name": string;
  "sourceId": string | null;
  "size": number;
  "songs": number;
  "matchedPaths": Array<string>;
  "applied": number;
  "updates": number;
  "pending": boolean;
  "error": string | null;
}

export interface MetadataDiscovery {
  "updatedAt": number;
  "files": Array<MetadataSourceCandidate>;
  "errors": Array<string>;
}

export interface ImportOptions {
  "overwrite": boolean;
  "fingers": boolean;
  "hands": boolean;
  "groups": boolean;
}

export interface ImportRow {
  "path": string;
  "contentId": string;
  "title": string;
  "matched": boolean;
  "fields": Array<string>;
  "fingers": number;
  "hands": number;
  "groups": Array<Array<string>>;
  "warnings": Array<string>;
  "blocked": boolean;
  "sourceUpdated": boolean;
}

export interface ImportPreview {
  "proof": string;
  "sourceSongs": number;
  "matched": number;
  "rows": Array<ImportRow>;
}

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

export interface ProjectNotation {
  "edition": NotationEdition;
  "active": boolean;
  "status": string;
  "generation": NotationGeneration | null;
}

export interface SongProject {
  "work": MusicalWork;
  "performance": PerformanceEdition;
  "practice": PracticeEdition;
  "notations": Array<ProjectNotation>;
  "generations": Array<NotationGeneration>;
  "issues": Array<string>;
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

export const ScoreQualityValues = ["original", "proofread", "automaticDraft", "unreviewed"] as const;
export type ScoreQuality = typeof ScoreQualityValues[number];

export interface MusicalWork {
  "id": string;
  "title": string;
  "composer": string;
  "catalogue": string;
}

export interface PerformanceEdition {
  "contentId": string;
  "workId": string;
  "label": string;
  "locations": Array<string>;
}

export interface NotationEdition {
  "id": string;
  "contentId": string;
  "performanceId": string;
  "versionId": string;
  "name": string;
  "path": string;
  "quality": ScoreQuality;
  "source": string;
  "registered": boolean;
}

export interface RepertoireRegistry {
  "version": number;
  "works": Record<string, MusicalWork>;
  "performances": Record<string, PerformanceEdition>;
  "notations": Record<string, NotationEdition>;
}

export interface RepertoireEdit {
  "expected": string;
  "contentId": string;
  "workId"?: string | null;
  "independent"?: boolean | null;
  "title"?: string | null;
  "composer"?: string | null;
  "catalogue"?: string | null;
  "notationId"?: string | null;
  "quality"?: ScoreQuality | null;
  "source"?: string | null;
}

export interface RepertoireView {
  "registry": RepertoireRegistry;
  "revision": string;
  "notationStatuses": Record<string, string>;
  "project": SongProject | null;
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
  "source": LibraryOpenSource | null;
}

export const StartupWarningKindValues = ["song", "skippedSong", "songAssets", "songLocation", "soundfont", "input", "output", "history", "settings"] as const;
export type StartupWarningKind = typeof StartupWarningKindValues[number];

export interface PreparationOrigin {
  "contentId"?: string | null;
  "scoreRevision": number;
  "midiEvents": number;
  "status": string;
}

export const PreparationPhaseValues = ["queued", "running", "committing", "done", "released", "cancelled", "error", "unconfirmed"] as const;
export type PreparationPhase = typeof PreparationPhaseValues[number];

export interface HistoryOperationRequest {
  "engineId": string;
  "id": string;
  "createdAtMs": number;
  "operation": HistoryActionRequest;
  "origin": PreparationOrigin;
  "measure"?: number | null;
}

export interface LibraryOpenRequest {
  "engineId": string;
  "id": string;
  "createdAtMs": number;
  "origin": PreparationOrigin;
  "source": LibraryOpenSource;
}

export type LibraryOpenSource =
  | { "kind": "originalScore"; "path": string; "defaultBpm": number; }
  | { "kind": "file"; "path": string; "title": string; "contentId"?: string | null; }
  | { "kind": "recent"; "contentId": string; }
  | { "kind": "relocated"; "path": string; "title": string; "contentId": string; "from"?: string | null; }
  | { "kind": "recording"; "path": string; }
  | { "kind": "score"; "path": string; "contentId": string; "scoreKind": LibraryScoreKind; "id": string; "selection"?: LibraryScoreSelection | null; };

export const LibraryScoreKindValues = ["notation", "paper"] as const;
export type LibraryScoreKind = typeof LibraryScoreKindValues[number];

export const LibraryRangeModeValues = ["loop", "range"] as const;
export type LibraryRangeMode = typeof LibraryRangeModeValues[number];

export interface LibraryRouteVisit {
  "ordinal": number;
  "measure": number;
  "start": number;
  "end": number;
}

export interface LibraryScoreSelection {
  "first": LibraryRouteVisit;
  "last": LibraryRouteVisit;
  "mode": LibraryRangeMode;
  "fingerprint": string;
}

export const LibraryOpenViewValues = ["practice", "notation", "paper", "range"] as const;
export type LibraryOpenView = typeof LibraryOpenViewValues[number];

export interface LibraryPrepared {
  "source": LibraryOpenSource;
  "contentId": string;
  "scoreRevision": number;
  "sourcePath": string | null;
  "view": LibraryOpenView;
  "importWarnings": Array<string>;
}

export interface LibraryOpenResult {
  "libraryPrepared": LibraryPrepared;
}

export interface LibraryOpenReceipt {
  "request": LibraryOpenRequest;
  "phase": PreparationPhase;
  "stage": string;
  "taskId": string | null;
  "result": LibraryOpenResult | null;
  "hasResult": boolean;
  "error": string | null;
  "warning": string | null;
  "cancellable": boolean;
}

export interface HistoryOperationResult {
  "historyPrepared": HistoryPrepared;
  "restoreWarning": string | null;
  "scoreReview": HistoryScoreReview | null;
  "scoreFocus": HistoryScoreTarget | null;
  "paperFocus": HistoryPaperTarget | null;
}

export interface HistoryOperationReceipt {
  "request": HistoryOperationRequest;
  "phase": PreparationPhase;
  "stage": string;
  "taskId": string | null;
  "result": HistoryOperationResult | null;
  "hasResult": boolean;
  "error": string | null;
  "warning": string | null;
  "cancellable": boolean;
}

export interface HistoryScoreTarget {
  "contentId": string;
  "scoreRevision": number;
  "historyId": string;
  "reference": number;
  "track": number;
  "index": number;
  "pitch": number;
  "measure": number;
  "kind": string;
}

export interface HistoryReviewNote {
  "reference": number;
  "track": number;
  "index": number | null;
  "pitch": number;
  "measure": number;
  "songTime": number;
  "at": number;
  "end": number;
  "kind": string;
  "timingKind": string | null;
  "velocityDifference": number | null;
  "velocityLimit": number | null;
  "offsetMs": number | null;
  "referenceVelocity": number;
  "actualVelocity": number | null;
}

export interface HistoryScoreReview {
  "source"?: HistorySource;
  "contentId": string;
  "historyId": string;
  "scoreRevision": number;
  "duration": number;
  "recordedAt": number;
  "title": string;
  "truncated": boolean;
  "exact": boolean;
  "wrongNotes": number | null;
  "notes": Array<HistoryReviewNote>;
  "measures": Array<PerformanceMeasureSpan> | null;
}

export interface HistoryPaperTarget {
  "contentId": string;
  "historyId": string;
  "reference": number;
  "measure": number;
  "track": number;
  "pitch": number;
  "songTime": number;
  "startMeasure": number;
  "endMeasure": number;
  "index"?: number;
  "noteAnchor"?: NoteAnchor;
}

export interface PerformanceInput {
  "at": number;
  "judgedAt": number;
  "songTime": number;
  "bytes": [number, number, number];
  "synthetic": boolean;
}

export interface PerformanceReference {
  "at": number;
  "end": number;
  "pitch": number;
  "velocity": number;
  "measure": number;
  "songTime": number;
  "track": number;
}

export interface PerformanceMeasureSpan {
  "measure": number;
  "occurrence": number;
  "at": number;
  "end": number;
  "songStart": number;
  "songEnd": number;
  "measureStart": number;
  "measureEnd": number;
}

export interface PerformanceDecision {
  "reference": number | null;
  "input": number | null;
  "kind": string;
  "offsetMs": number | null;
  "measure": number | null;
}

export interface PerformanceArchive {
  "version": number;
  "contentId": string;
  "id": string;
  "duration": number;
  "inputs": Array<PerformanceInput>;
  "references": Array<PerformanceReference>;
  "referencePedals": Array<PerformanceInput>;
  "truncated": boolean;
  "judgments"?: Array<PerformanceDecision>;
  "measures"?: Array<PerformanceMeasureSpan>;
}

export const PerformancePedalEvidenceValues = ["paired", "noReferenceEvents", "noActualEvents", "beforeReferenceEvent", "beforeActualEvent"] as const;
export type PerformancePedalEvidence = typeof PerformancePedalEvidenceValues[number];

export interface PerformanceNoteExpression {
  "velocityDelta": number;
  "referencePedalDown": boolean | null;
  "actualPedalDown": boolean | null;
  "pedalSame": boolean | null;
  "pedalEvidence": PerformancePedalEvidence;
}

export interface HistoryPerformanceRead extends PerformanceArchive {
  "source": HistorySource;
  "expressionReview": Array<PerformanceNoteExpression | null>;
}

export interface HistorySource {
  "contentId": string;
  "id": string;
  "conditionsRevision": string;
  "performanceRevision"?: string | null;
}

export type HistoryActionKind =
  | { "kind": "open"; "restore": boolean; }
  | { "kind": "scoreReview" }
  | { "kind": "practiceRange"; "reference": number; "before": number; "after": number; };

export interface HistoryActionRequest {
  "source": HistorySource;
  "action": HistoryActionKind;
}

export interface HistoryPrepared {
  "source": HistorySource;
  "contentId": string;
  "scoreRevision": number;
}

export interface ReplaySelection {
  "start": number;
  "end": number;
}

export const ReplaySoundValues = ["actual", "reference"] as const;
export type ReplaySound = typeof ReplaySoundValues[number];

export interface HistoryReplayRequest {
  "source": HistorySource;
  "sound": ReplaySound;
  "rate": number;
  "selection"?: ReplaySelection | null;
  "requestId": string;
}

export interface StorageRecovery {
  "checked": boolean;
  "backupImport": boolean;
  "round": boolean;
  "settings": boolean;
  "assets": boolean;
  "readError": boolean;
}

export const StorageOperationValues = ["round", "import", "recording", "asset", "library", "song", "practice", "closing"] as const;
export type StorageOperation = typeof StorageOperationValues[number];

export interface StorageStatus {
  "version": string;
  "operation": StorageOperation | null;
  "pending": boolean;
  "writing": boolean;
  "unsavedChanges": boolean;
  "error": string | null;
  "canRetry": boolean;
  "recovery": StorageRecovery;
  "recoveryError": string | null;
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

export interface LibraryPathState {
  "contentId": string;
  "path": string;
  "linkedTo": string | null;
  "ignored": boolean;
  "preferredPath": string | null;
  "known": boolean;
  "revision": number;
}

export interface RelinkItem {
  "contentId": string;
  "from": string;
  "to": string;
}

export interface ReplacementReview {
  "oldContentId": string;
  "newContentId": string;
  "action": string;
  "target": string | null;
}

export interface MidiReplacementRow {
  "path": string;
  "title": string;
  "oldContentId": string;
  "newContentId": string;
  "oldNotes": number;
  "newNotes": number;
  "oldDuration": number;
  "newDuration": number;
  "oldTracks": number;
  "newTracks": number;
  "candidates": Array<string>;
  "review": ReplacementReview | null;
  "reviewed": boolean;
  "available": boolean;
  "error": string | null;
}

export interface MidiReplacementPage {
  "rows": Array<MidiReplacementRow>;
  "total": number;
  "offset": number;
  "limit": number;
  "revision": number;
}

export interface ReplacementComparison {
  "matched": number;
  "oldOnly": number;
  "newOnly": number;
}

export interface MidiReplacementPreview {
  "path": string;
  "oldContentId": string;
  "newContentId": string;
  "oldNotes": number;
  "newNotes": number;
  "oldDuration": number;
  "newDuration": number;
  "oldTracks": number;
  "newTracks": number;
  "candidates": Array<string>;
  "exact": ReplacementComparison | null;
  "oldSource": string | null;
  "token": string;
  "revision": number;
  "review": ReplacementReview | null;
}

export interface RepairLocation {
  "path": string;
  "present": boolean;
  "available": boolean;
  "verified": boolean;
  "reason": string;
  "resolved": boolean;
  "ignored": boolean;
  "relinkedTo": string | null;
  "primary": boolean;
  "rating": number;
  "hasScore": boolean;
}

export interface RepairGroup {
  "contentId": string;
  "title": string;
  "primaryPath": string | null;
  "preferredPath": string | null;
  "paths": Array<RepairLocation>;
  "candidates": Array<string>;
  "missing": number;
  "unverified": number;
  "available": number;
  "resolved": number;
}

export interface RepairInventory {
  "groups": Array<RepairGroup>;
  "total": number;
  "missingFiles": number;
  "duplicateGroups": number;
  "unverifiedFiles": number;
  "resolvedFiles": number;
  "replacementCount": number;
  "offset": number;
  "limit": number;
  "revision": number;
}

export interface LibraryRepairResult {
  "contentId": string;
  "from": string;
  "to": string;
  "ok": boolean;
  "error"?: string;
  "warnings"?: Array<string>;
}

export interface LibraryRelinkResult {
  "results": Array<LibraryRepairResult>;
  "revision": number;
}

export interface MetadataHistoryClaim {
  "version": number;
  "requestId": string;
  "sourcePath": string;
  "contentId": string;
  "targetPath": string;
  "fingerprint": string;
  "records": number;
  "added": number;
}

export interface PendingMetadataRow {
  "sourcePath": string;
  "contentId": string;
  "title": string | null;
  "records": number;
  "fingerprint": string;
  "candidates": Array<string>;
}

export interface PendingMetadataPage {
  "rows": Array<PendingMetadataRow>;
  "total": number;
  "offset": number;
  "limit": number;
}

export interface RoutineVersion {
  "id": string;
  "day": string | null;
  "revision": string;
}

export interface RoutineEditRequest {
  "routineId": string;
  "day"?: string | null;
  "expected": string;
  "change": RoutineChange;
}

export type RoutineChange =
  | { "kind": "metadata"; "name": string; "notes": string; }
  | { "kind": "item"; "id": string; "contentId"?: string | null; "source"?: string | null; "sourceId"?: string | null; "title": string; "notes": string; "goal": RoutineGoal; }
  | { "kind": "moveItem"; "itemId": string; "direction": number; }
  | { "kind": "removeItem"; "itemId": string; }
  | { "kind": "schedule"; "schedule"?: RoutineSchedule | null; }
  | { "kind": "remove" }
  | { "kind": "copy"; "requestId": string; "name": string; "notes": string; };

export interface HistoryPageRequest {
  "contentId"?: string | null;
  "query"?: string;
  "mode"?: string;
  "hands"?: string;
  "range"?: string;
  "days"?: number;
  "from"?: number | null;
  "to"?: number | null;
  "offset"?: number;
  "limit"?: number;
}

export interface ReadScope {
  "channel": string;
  "sequence": number;
}

export interface HistoryCalendar {
  "from": number;
  "to": number;
  "contentId"?: string;
  "intervals": Array<CalendarInterval>;
  "saves": Array<CalendarSave>;
  "totalMs": number;
  "legacySessions": number;
  "legacyTimedMs": number;
  "untrackedMs": number;
  "earliestIntervalAt": number | null;
  "coverage": string;
}

export interface CalendarInterval {
  "contentId": string;
  "title": string;
  "saveId": string;
  "from": number;
  "to": number;
  "runningMs": number;
}

export interface CalendarSave {
  "contentId": string;
  "saveId": string;
  "savedAt": number;
}

export interface HistoryPage {
  "entries": Array<HistoryListEntry>;
  "total": number;
  "offset": number;
  "contentId"?: string;
}

export interface HistoryListEntry {
  "id": string;
  "contentId": string;
  "title": string;
  "path": string | null;
  "recordedAt": number;
  "playingMs": number | null;
  "speed": number;
  "hands": PracticeHands;
  "annotation": PracticeAnnotation | null;
  "mode": string | null;
  "scope": string | null;
  "range": [number, number] | null;
  "loop": boolean;
  "exactPassage": boolean;
  "score": PracticeSnapshot;
  "tempo": number | null;
  "restorable": boolean;
  "coverage": HistoryCoverage | null;
}

export interface HistoryCoverage {
  "target": number;
  "judged": number;
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

export interface ReplayClipRead {
  "source": HistorySource;
  "contentId": string;
  "id": string;
  "clips": Array<ReplayClip>;
  "revision": string;
  "writeSettled": boolean;
}

export interface BackupImportRequest {
  "engineId": string;
  "id": string;
  "createdAtMs": number;
  "token": string;
  "selection": BackupSelection;
  "policy": BackupPolicy;
}

export interface BackupImportQuery {
  "engineId": string;
  "id": string;
}

export const BackupPolicyValues = ["keep", "backup"] as const;
export type BackupPolicy = typeof BackupPolicyValues[number];

export interface BackupSelection {
  "plans": boolean;
  "records": boolean;
  "presets": boolean;
  "days": number;
}

export interface BackupImportResult {
  "metadataHistoryAdded": number;
  "metadataHistoryDuplicates": number;
  "metadataHistoryUnmatched": number;
  "metadataHistoryAmbiguous": number;
  "metadataHistoryPendingAdded": number;
  "addedTimeEntries": number;
  "importedPerformances": number;
  "duplicatePerformances": number;
  "keptPerformances": number;
  "replacedPerformances": number;
  "trimmedPerformances": number;
  "learningChanged": number;
  "addedRecords": number;
  "duplicateRecords": number;
  "renamedRecords": number;
  "trimmedRecords": number;
  "restorePoint": string;
}

export interface BackupImportReceipt {
  "request": BackupImportRequest;
  "phase": BackupImportPhase;
  "stage": string;
  "taskId": string | null;
  "result": BackupImportResult | null;
  "error": string | null;
  "warning": string | null;
  "cancellable": boolean;
}

export const BackupImportPhaseValues = ["queued", "running", "committing", "done", "cancelled", "error", "unconfirmed"] as const;
export type BackupImportPhase = typeof BackupImportPhaseValues[number];

export const MediaExportKindValues = ["midi", "practiceMidi", "package"] as const;
export type MediaExportKind = typeof MediaExportKindValues[number];

export interface MediaExportInput {
  "contentId": string;
  "kind": MediaExportKind;
}

export interface MediaExportSummary {
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

export interface PackagePreviewRequest {
  "engineId": string;
  "token": string;
}

export interface PackagePaperPreview {
  "name": string;
  "format": string;
  "pages": number;
  "mappingPoints": number;
  "autoTurn": boolean;
  "annotations": number;
}

export interface PackageTrackPreview {
  "id": number;
  "name": string;
  "color": string | null;
}

export interface PackageMetadataPreview {
  "composer": string | null;
  "notes": string | null;
  "tags": Array<string>;
}

export interface PackageProvenancePreview {
  "source": string | null;
  "license": string | null;
  "sourceUrl": string | null;
}

export interface PackagePreview {
  "token": string;
  "engineId": string;
  "fileName": string | null;
  "papers": Array<PackagePaperPreview>;
  "ladders": Array<string>;
  "title": string;
  "contentId": string;
  "metadata": PackageMetadataPreview;
  "scores": Array<string>;
  "fingerings": number;
  "fingerActions": number;
  "trackSounds": number;
  "trackAppearances": Array<PackageTrackPreview>;
  "hands": number;
  "notePlayback": number;
  "passages": Array<string>;
  "bookmarks": Array<string>;
  "groups": Array<Array<string>>;
  "rating": number;
  "existing": boolean;
  "provenance": PackageProvenancePreview | null;
}

export interface ExerciseRequest {
  "engineId": string;
  "requestId": string;
  "createdAtMs"?: number | null;
  "spec": ExerciseSpec;
}

export const PackagePolicyValues = ["merge", "keep", "replace"] as const;
export type PackagePolicy = typeof PackagePolicyValues[number];

export interface PackageRequest {
  "engineId": string;
  "requestId": string;
  "createdAtMs"?: number | null;
  "token": string;
  "policy": PackagePolicy;
}

export const MusicKindValues = ["midi", "score", "exercise", "package"] as const;
export type MusicKind = typeof MusicKindValues[number];

export const MusicPhaseValues = ["uploading", "queued", "running", "committing", "done", "cancelled", "error", "unconfirmed"] as const;
export type MusicPhase = typeof MusicPhaseValues[number];

export interface ImportedSong {
  "contentId": string;
  "title": string;
  "sourcePath": string;
  "importWarnings": Array<string>;
  "catalogOnly": boolean;
}

export interface MusicReceipt {
  "id": string;
  "engineId": string;
  "name": string;
  "kind": MusicKind;
  "phase": MusicPhase;
  "received": number;
  "size": number;
  "taskId": string | null;
  "song": ImportedSong | null;
  "error": string | null;
  "cancellable": boolean;
  "catalogOnly": boolean;
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

export interface MetadataLayers {
  "sourceFormat": string;
  "sourceId": string;
  "defaults": SongMetadata;
  "overridden": Array<string>;
}

export interface MetadataDefaultsView {
  "contentId": string;
  "value": SongMetadata;
  "layers": MetadataLayers | null;
  "proof": string;
}

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
}

export interface TrackSound {
  "volume": number;
  "pan"?: number | null;
  "program"?: number | null;
}

export interface SpeedLadderPlan {
  "startPercent": number;
  "targetPercent": number;
  "stepPercent": number;
  "passesRequired": number;
  "accuracyPercent": number;
  "onTimePercent": number | null;
  "failuresBeforeStepBack": number;
  "attemptLimit": number;
}

export interface SpeedLadderProgress {
  "stage": number;
  "successStreak": number;
  "failureStreak": number;
  "totalRounds": number;
  "batchRounds": number;
  "completed": boolean;
  "limited": boolean;
  "lastResult": string;
  "lastAccuracy": number | null;
  "lastOnTime": number | null;
}

export const PracticeTrackModeValues = ["Mute", "Auto", "Human"] as const;
export type PracticeTrackMode = typeof PracticeTrackModeValues[number];

export interface PracticeTrackSetup {
  "track_id": number;
  "mode": PracticeTrackMode;
  "visible": boolean;
}

export interface ExpressionGoal {
  "velocityDifference"?: number | null;
  "noteVelocityDifference"?: number | null;
  "notePedalMismatchCount"?: number | null;
  "contourPercent"?: number | null;
  "pedalOffsetMs"?: number | null;
}

export interface ExpressionGoalSnapshot {
  "contentId": string;
  "goal": ExpressionGoal | null;
  "writeSettled": boolean;
}

export interface AnnotationRead {
  "contentId": string;
  "id": string;
  "annotation": PracticeAnnotation | null;
  "writeSettled": boolean;
}

export interface Draft {
  "stage": string;
  "goal": string;
  "due": string | null;
  "weeklyMinutes": number | null;
  "targetBpm": number | null;
}

export interface Learning extends Draft {
  "updatedAt": number;
  "title": string;
  "transitions": Array<Transition>;
}

export interface Transition {
  "stage": string;
  "at": number;
  "plan"?: Draft;
  "evidence"?: Evidence;
}

export interface LearningRead {
  "contentId": string;
  "value": Learning | null;
  "writeSettled": boolean;
}

export interface NoteVelocityEvidence {
  "referenceNotes": number;
  "matchedNotes": number;
  "missingNotes": number;
  "maxAbsDifference": number | null;
}

export interface NotePedalEvidence {
  "referenceNotes": number;
  "matchedNotes": number;
  "pairedStateNotes": number;
  "missingNotes": number;
  "unknownStateNotes": number;
  "mismatchCount": number;
}

export interface WeekEvidence {
  "from": number;
  "to": number;
  "runningMs": number;
  "targetMinutes": number | null;
  "met": boolean;
  "reasons": Array<string>;
}

export interface WholeAttempt {
  "sessionId": string;
  "recordedAt": number;
  "scope": string;
  "accuracyPercent": number;
  "effectiveBpm": number | null;
  "meetsTargetBpm": boolean;
  "readable": boolean;
}

export interface WholeEvidence {
  "recent": Array<WholeAttempt>;
  "comparableCount": number;
  "targetBpmMet": boolean;
  "reasons": Array<string>;
}

export interface RoutineItemEvidence {
  "routineId": string;
  "day": string;
  "itemId": string;
  "title": string;
  "targetKind": string;
  "completed": boolean;
  "skipped": boolean;
  "sessionIds": Array<string>;
  "readableSessionIds": Array<string>;
}

export interface RoutineEvidence {
  "items": Array<RoutineItemEvidence>;
  "totalCount": number;
  "completedCount": number;
  "reasons": Array<string>;
}

export interface HistoricalRef {
  "sessionId": string;
  "readable": boolean;
}

export interface Evidence {
  "contentId": string;
  "generatedAt": number;
  "targetBpm": number | null;
  "week": WeekEvidence;
  "wholeSong": WholeEvidence;
  "routines": RoutineEvidence;
  "historicalRefs"?: Array<HistoricalRef>;
  "reasons": Array<string>;
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
  "adaptive": boolean;
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

export interface LadderPreset {
  "practice"?: PracticeEdition;
  "id": string;
  "name": string;
  "start": number;
  "end": number;
  "grid": string;
  "scope": string;
  "exerciseSpec": ExerciseSpec | null;
  "settings": SessionSettings;
  "plan": SpeedLadderPlan;
  "expression"?: ExpressionGoal;
}

export interface LadderRun {
  "preset": LadderPreset;
  "progress": SpeedLadderProgress;
  "active": boolean;
}

export interface PassageCatalog {
  "contentId": string;
  "grid": string;
  "passages": Array<PassagePreset>;
  "catalogRevision": string;
  "writeSettled"?: boolean;
}

export interface LadderCatalog {
  "presets": Array<LadderPreset>;
  "runs": Array<LadderRun>;
  "current": LadderRun | null;
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

export interface RoutineGoal {
  "expression"?: ExpressionGoal | null;
  "passes": number;
  "accuracy": number;
  "onTime"?: number | null;
  "consecutive": boolean;
  "attemptLimit": number;
}

export interface PassageSequenceEntry {
  "id": string;
  "copies": number;
  "contentId"?: string | null;
}

export interface RoutineSchedule {
  "enabled": boolean;
  "weekdays": Array<number>;
  "start": string;
  "end"?: string | null;
  "skipDates"?: Array<string>;
  "extraDates"?: Array<string>;
}

export type RoutineTarget =
  | { "kind": "whole" }
  | { "kind": "passage"; "start": number; "end": number; }
  | { "kind": "precisePassage"; "range": TickRange; }
  | { "kind": "scorePassage"; "range": ScoreRange; }
  | { "kind": "ladder"; "preset": LadderPreset; };

export interface RoutineItem {
  "practice"?: PracticeEdition;
  "id": string;
  "title": string;
  "notes": string;
  "contentId": string;
  "songTitle": string;
  "path": string | null;
  "exercise": ExerciseSpec | null;
  "grid": string;
  "scope": string;
  "settings": SessionSettings;
  "speed": number;
  "target": RoutineTarget;
  "goal": RoutineGoal;
}

export interface PracticeRoutine {
  "schedule"?: RoutineSchedule;
  "id": string;
  "name": string;
  "notes": string;
  "items": Array<RoutineItem>;
}

export interface RoutineProgress {
  "passed": number;
  "attempts": number;
  "batchAttempts": number;
  "streak": number;
  "completed": boolean;
  "skipped": boolean;
  "limited": boolean;
  "lastResult": string;
  "bestAccuracy": number | null;
  "sessionIds": Array<string>;
  "ladder": SpeedLadderProgress | null;
}

export interface RoutineRun {
  "day": string;
  "routine": PracticeRoutine;
  "progress": Record<string, RoutineProgress>;
  "lastItem": string | null;
}

export const RoutineKindValues = ["whole", "passage", "ladder"] as const;
export type RoutineKind = typeof RoutineKindValues[number];

export interface RoutineState {
  "routineId": string;
  "day": string;
  "itemId": string;
  "title": string;
  "itemTitle": string;
  "notes": string;
  "index": number;
  "total": number;
  "kind": RoutineKind;
  "goal": RoutineGoal;
  "progress": RoutineProgress;
  "nextItemId": string | null;
}

export interface RoutineList {
  "versions": Array<RoutineVersion>;
  "plans": Array<PracticeRoutine>;
  "runs": Array<RoutineRun>;
  "due": Array<string>;
  "active": RoutineState | null;
}

export interface RoutineSummary {
  "id": string;
  "name": string;
}

export interface RoutineSourceEntry {
  "id": string;
  "name": string;
}

export interface RoutineSourceOptions {
  "contentId": string;
  "passages": Array<RoutineSourceEntry>;
  "ladders": Array<LadderPreset>;
}

export interface ExpressionMetric {
  "contourPercent": number | null;
  "contourSteps": number;
  "samples": number;
  "meanDifference": number | null;
  "pedalOffsetMs": number | null;
  "pedalAbsoluteOffsetMs": number | null;
  "pedalDeviationMs": number | null;
  "referenceTransitions": number;
  "correspondenceFailures": number;
  "calibratedLegacy": number;
}

export const SuggestionKindValues = ["accuracy", "rhythm", "dynamics", "pedal", "review", "passageReview"] as const;
export type SuggestionKind = typeof SuggestionKindValues[number];

export interface Suggestion {
  "id": string;
  "title": string;
  "measure": number;
  "accuracy": number;
  "kind": SuggestionKind;
  "timing": RhythmMetric | null;
  "attempts": number;
  "judged": number;
  "sourceAt": number;
  "sourceSpeed": number;
  "sourceMode": string;
  "item": RoutineItem;
  "expression": ExpressionMetric | null;
  "range": string | null;
}

export interface RhythmMetric {
  "onTime": number;
  "samples": number;
  "offsetMs": number;
  "deviationMs": number;
}

export interface RecommendationPage {
  "suggestions": Array<Suggestion>;
  "note": string;
  "dueTotal"?: number;
  "eligibleTotal"?: number;
  "missingTotal"?: number;
  "passageDueTotal"?: number;
  "passageUnavailableTotal"?: number;
  "revision"?: string;
  "nextOffset"?: number;
  "hasMore"?: boolean;
}

export interface RecommendationAccepted {
  "id": string;
  "added": number;
  "skipped": number;
  "existing"?: boolean;
}

export interface WeakPracticeEdit {
  "id": string;
  "speed": number;
  "passes": number;
  "accuracy": number;
  "onTime"?: number | null;
}

export type HistoryOperationOrigin = PreparationOrigin;

export type HistoryOperationPhase = PreparationPhase;

export const HistoryOperationPhaseValues = PreparationPhaseValues;

export type EngineCommand =
  | { type: "practiceVariant"; "content_id": string; "score_revision": number; "value": Variant }
  | { type: "exportPracticeVariant" }
  | { type: "audioDevices" }
  | { type: "audioDevice"; "name"?: string | null }
  | { type: "songPreview"; "path": string }
  | { type: "readRepertoire"; "path"?: string | null; "content_id"?: string | null }
  | { type: "songCatalog" }
  | { type: "inspectNotation"; "path": string; "content_id": string; "version_id": string }
  | { type: "editRepertoire"; "request": RepertoireEdit }
  | { type: "startLibraryOpen"; "request": LibraryOpenRequest }
  | { type: "readLibraryOpen"; "id": string; "metadata_only"?: boolean }
  | { type: "cancelLibraryOpen"; "id": string }
  | { type: "releaseLibraryOpen"; "id": string }
  | { type: "startHistoryOperation"; "request": HistoryOperationRequest }
  | { type: "readHistoryOperation"; "id": string; "metadata_only"?: boolean }
  | { type: "cancelHistoryOperation"; "id": string }
  | { type: "releaseHistoryOperation"; "id": string }
  | { type: "previewLegacyExerciseTracks"; "content_id": string }
  | { type: "applyLegacyExerciseTracks"; "content_id": string; "fingerprint": string; "restore_conditions"?: boolean }
  | { type: "previewLegacyExerciseHistory"; "content_id": string }
  | { type: "reviewLegacyExerciseHistory"; "content_id": string; "old_id": string; "current_id": string; "fingerprint": string; "approve": boolean }
  | { type: "metadataTemplates" }
  | { type: "readMetadataDefaults" }
  | { type: "resetMetadataDefaults"; "fields": Array<string>; "expected": SongMetadata; "proof": string }
  | { type: "resetLibraryMetadataDefaults"; "path": string; "content_id": string; "fields": Array<string>; "expected": SongMetadata; "proof": string }
  | { type: "updateMetadataTemplate"; "name": string; "rules"?: unknown | null; "expected": number }
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
  | { type: "adaptive"; "enabled": boolean }
  | { type: "generate"; "spec": ExerciseSpec }
  | { type: "feedback" }
  | { type: "panic" }
  | { type: "recording"; "active": boolean }
  | { type: "exportMidi" }
  | { type: "practiceBackupSnapshot"; "selection": unknown }
  | { type: "exportPracticeBackup"; "selection": unknown }
  | { type: "inspectPracticeBackup"; "backup": unknown }
  | { type: "applyPracticeBackup"; "backup": unknown; "selection": unknown; "policy": string }
  | { type: "importStagedPracticeBackup"; "token": string; "selection": unknown; "policy": string }
  | { type: "pendingMetadataHistory" }
  | { type: "pendingMetadataHistoryPage"; "query": string; "offset": number; "limit": number }
  | { type: "readLibraryPath"; "content_id": string; "path": string }
  | { type: "readMetadataHistoryClaim"; "request_id": string }
  | { type: "claimPendingMetadataHistory"; "source_path": string; "content_id": string; "target_path": string; "request_id"?: string | null; "expected"?: string | null }
  | { type: "exportPackage" }
  | { type: "exportPackageFile" }
  | { type: "importStagedPackage"; "token": string; "policy": string }
  | { type: "inspectPackage"; "bytes": Array<number> }
  | { type: "importPackage"; "bytes": Array<number>; "policy": string }
  | { type: "vstEditor" }
  | { type: "score" }
  | { type: "sourceScore" }
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
  | { type: "libraryScores"; "path": string; "content_id": string }
  | { type: "previewLibraryScoreRoute"; "path": string; "content_id": string; "id": string }
  | { type: "checkLibraryScoreImport"; "path": string; "content_id": string; "bytes": Array<number>; "kind": string; "target"?: string | null }
  | { type: "updateLibraryPaper"; "path": string; "content_id": string; "id": string; "action": string; "page": number; "direction": number; "expected_pages"?: Array<string> | null }
  | { type: "addLibraryScore"; "path": string; "content_id": string; "name": string; "bytes": Array<number>; "kind": string; "target"?: string | null; "page"?: number }
  | { type: "manageLibraryScore"; "path": string; "content_id": string; "kind": string; "id": string; "action": string; "name"?: string | null }
  | { type: "openLibraryScore"; "path": string; "content_id": string; "kind": string; "id": string }
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
  | { type: "libraryWorkspace" }
  | { type: "saveSongLearning"; "path": string; "content_id": string; "value"?: Draft | null; "expected"?: Learning | null }
  | { type: "readSongLearning"; "content_id": string }
  | { type: "songLearningEvidence"; "content_id": string }
  | { type: "inspectSong"; "path": string; "force"?: boolean }
  | { type: "inspectSongs"; "paths": Array<string>; "force"?: boolean }
  | { type: "libraryGroup"; "id"?: string | null; "name": string; "parent"?: string | null }
  | { type: "removeLibraryGroup"; "id": string }
  | { type: "assignLibrary"; "paths": Array<string>; "group"?: string | null; "rating"?: number | null }
  | { type: "unassignLibrary"; "paths": Array<string>; "group": string }
  | { type: "libraryMetadataHistory"; "path": string; "content_id": string }
  | { type: "previewSynthesiaMetadata"; "bytes": Array<number>; "paths": Array<string>; "options": ImportOptions }
  | { type: "discoverSynthesiaMetadata"; "paths": Array<string>; "refresh"?: boolean }
  | { type: "previewDiscoveredSynthesiaMetadata"; "source_path": string; "source_id": string; "paths": Array<string>; "options": ImportOptions }
  | { type: "importDiscoveredSynthesiaMetadata"; "source_path": string; "source_id": string; "paths": Array<string>; "options": ImportOptions; "expected": string }
  | { type: "importSynthesiaMetadata"; "bytes": Array<number>; "paths": Array<string>; "options": ImportOptions; "expected": string }
  | { type: "previewMetadataRestore"; "path": string; "content_id": string; "id": string }
  | { type: "restoreLibraryMetadata"; "path": string; "content_id": string; "id": string; "fields": Array<string>; "expected": SongMetadata }
  | { type: "previewLibraryMetadata"; "path": string; "content_id"?: string | null; "rules": unknown }
  | { type: "readLibraryMetadata"; "path": string; "content_id"?: string | null }
  | { type: "saveLibraryMetadata"; "path": string; "content_id": string; "value": SongMetadata; "expected": SongMetadata }
  | { type: "updateSongMetadata"; "path": string; "value": SongMetadata }
  | { type: "libraryRepairs"; "query"?: string; "kind"?: string; "include_resolved"?: boolean; "offset"?: number; "limit"?: number }
  | { type: "midiReplacements"; "query"?: string; "include_reviewed"?: boolean; "offset"?: number; "limit"?: number }
  | { type: "previewMidiReplacement"; "path": string; "old_content_id": string; "new_content_id": string }
  | { type: "decideMidiReplacement"; "path": string; "old_content_id": string; "new_content_id": string; "token": string; "action": string; "target"?: string | null }
  | { type: "relinkLibrary"; "items": Array<RelinkItem> }
  | { type: "setLibraryPrimary"; "content_id": string; "path"?: string | null }
  | { type: "restoreLibraryPath"; "content_id": string; "path": string }
  | { type: "ignoreLibraryPath"; "content_id": string; "path": string }
  | { type: "libraryMonitorStatus" }
  | { type: "setLibraryMonitor"; "enabled": boolean }
  | { type: "libraryFolders" }
  | { type: "refreshLibrary" }
  | { type: "indexLibrary"; "paths": Array<string>; "force": boolean }
  | { type: "indexStatus" }
  | { type: "pauseIndex" }
  | { type: "resumeIndex" }
  | { type: "cancelIndex" }
  | { type: "removeLibraryFolder"; "path": string }
  | { type: "metadata" }
  | { type: "editMetadata"; "value": SongMetadata; "expected": SongMetadata }
  | { type: "setMetadata"; "value": SongMetadata }
  | { type: "load"; "path": string; "title": string }
  | { type: "loadIndexed"; "path": string; "title": string; "content_id": string }
  | { type: "importScore"; "bytes": Array<number>; "name": string; "default_bpm": number }
  | { type: "importMidi"; "bytes": Array<number>; "name": string }
  | { type: "currentSong" }
  | { type: "session" }
  | { type: "tasks" }
  | { type: "retrySave" }
  | { type: "retrySettingsSave"; "expected": string }
  | { type: "readStorageStatus" }
  | { type: "skipStartupSong" }
  | { type: "retryStartup" }
  | { type: "dismissStartupWarning"; "id": string }
  | { type: "cancelTask"; "id": string }
  | { type: "cancelHistoryRead"; "channel": string; "sequence": number }
  | { type: "editSongExpressionGoal"; "goal"?: ExpressionGoal | null; "expected"?: ExpressionGoal | null }
  | { type: "readSongExpressionGoal"; "content_id": string }
  | { type: "readHistoryAnnotation"; "content_id": string; "id": string }
  | { type: "setSongExpressionGoal"; "goal"?: ExpressionGoal | null }
  | { type: "routines"; "day": string }
  | { type: "editRoutine"; "request": RoutineEditRequest }
  | { type: "saveRoutine"; "id"?: string | null; "day"?: string | null; "name": string; "notes": string; "copy_of"?: string | null; "request_id"?: string | null }
  | { type: "saveRoutineSchedule"; "id": string; "schedule"?: RoutineSchedule | null }
  | { type: "removeRoutine"; "id": string }
  | { type: "passageCatalog"; "content_id"?: string | null; "query": string; "offset": number }
  | { type: "composePassages"; "routine_id": string; "day"?: string | null; "content_id": string; "entries": Array<PassageSequenceEntry>; "goal": RoutineGoal; "proof"?: string | null }
  | { type: "saveRoutineItem"; "content_id"?: string | null; "routine_id": string; "day"?: string | null; "id"?: string | null; "source"?: string | null; "source_id"?: string | null; "title": string; "notes": string; "goal": RoutineGoal }
  | { type: "moveRoutineItem"; "routine_id": string; "day"?: string | null; "item_id": string; "direction": number }
  | { type: "removeRoutineItem"; "routine_id": string; "day"?: string | null; "item_id": string }
  | { type: "openRoutineItem"; "routine_id": string; "day": string; "item_id": string; "resume": boolean }
  | { type: "stopRoutine" }
  | { type: "skipRoutineItem"; "routine_id": string; "day": string; "item_id": string; "reason": string }
  | { type: "resetRoutineItem"; "routine_id": string; "day": string; "item_id": string }
  | { type: "bookmarks" }
  | { type: "saveBookmark"; "content_id": string; "id"?: string | null; "name": string; "tick": number }
  | { type: "removeBookmark"; "content_id": string; "id": string }
  | { type: "ladderPresets" }
  | { type: "saveLadder"; "id"?: string | null; "name": string; "start": number; "end": number; "plan": SpeedLadderPlan; "expression"?: ExpressionGoal | null }
  | { type: "updateLadderName"; "id": string; "name": string }
  | { type: "removeLadder"; "id": string }
  | { type: "startLadder"; "id": string; "resume": boolean }
  | { type: "stopLadder" }
  | { type: "weakPractice" }
  | { type: "dueReview"; "offset"?: number; "expected"?: string | null }
  | { type: "acceptWeakPractice"; "ids": Array<string>; "edits"?: Array<WeakPracticeEdit>; "routine_id"?: string | null; "day"?: string | null; "name": string; "request_id"?: string | null }
  | { type: "history" }
  | { type: "historyQuery"; "query"?: string; "mode"?: string; "hands"?: string; "range"?: string; "days"?: number; "from"?: number | null; "to"?: number | null; "offset"?: number; "limit"?: number }
  | { type: "readHistoryPage"; "request": HistoryPageRequest }
  | { type: "annotateHistory"; "content_id": string; "id": string; "note": string; "teacher": string; "next": string; "expected"?: PracticeAnnotation | null }
  | { type: "practiceTime"; "content_id": string; "from": number; "to": number }
  | { type: "practiceCalendar"; "from": number; "to": number; "content_id"?: string | null }
  | { type: "historyPerformance"; "content_id": string; "id": string }
  | { type: "startHistoryReplay"; "content_id": string; "id": string; "source": string; "rate": number; "request_id"?: string | null }
  | { type: "startHistoryReplayRange"; "content_id": string; "id": string; "source": string; "rate": number; "start": number; "end": number; "request_id"?: string | null }
  | { type: "historyReplayControl"; "id": string; "action": string; "position"?: number | null; "rate"?: number | null }
  | { type: "historyReplayLoop"; "id": string; "start": number; "end": number; "enabled": boolean }
  | { type: "historyReplayClips"; "content_id": string; "id": string }
  | { type: "readHistoryReplayClips"; "content_id": string; "id": string }
  | { type: "saveHistoryReplayClip"; "content_id": string; "id": string; "clip_id"?: string | null; "request_id"?: string | null; "source"?: HistorySource | null; "name": string; "start": number; "end": number; "notes": string; "expected": string }
  | { type: "deleteHistoryReplayClip"; "content_id": string; "id": string; "clip_id": string; "expected": string }
  | { type: "historyDetail"; "content_id": string; "id": string }
  | { type: "historyOpen"; "content_id": string; "id": string; "restore": boolean }
  | { type: "readHistoryDetail"; "content_id": string; "id": string }
  | { type: "readHistoryPerformance"; "content_id": string; "id": string }
  | { type: "performHistoryAction"; "request": HistoryActionRequest }
  | { type: "playHistorySource"; "request": HistoryReplayRequest }
  | { type: "historyProblemNotes"; "content_id": string; "id": string; "offset": number }
  | { type: "previewProblemCuts"; "single"?: unknown | null; "multi"?: unknown | null; "expected": string; "edits": Array<unknown> }
  | { type: "previewMultiProblemPlan"; "spec": unknown }
  | { type: "saveMultiProblemPlan"; "spec": unknown; "expected": string; "name": string; "notes": string; "goal": RoutineGoal; "edits": Array<unknown> }
  | { type: "previewHistoryProblemPlan"; "spec": unknown }
  | { type: "saveHistoryProblemPlan"; "spec": unknown; "expected": string; "name": string; "notes": string; "goal": RoutineGoal; "edits": Array<unknown> }
  | { type: "historyPracticeRange"; "content_id": string; "id": string; "reference": number; "before": number; "after": number }
  | { type: "historyScoreReview"; "content_id": string; "id": string }
  | { type: "setLibraryCollection"; "path": string; "content_id": string; "favorite"?: boolean | null; "queued"?: boolean | null }
  | { type: "collection" }
  | { type: "favorite"; "enabled": boolean }
  | { type: "queue"; "enabled": boolean }
  | { type: "moveQueue"; "direction": number }
  | { type: "volume"; "value": number }
  | { type: "openRecent"; "content_id": string }
  | { type: "loop"; "start": number; "end": number; "enabled": boolean }
  | { type: "play" }
  | { type: "pause" }
  | { type: "restart" }
  | { type: "save" }
  | { type: "seek"; "position": number }
  | { type: "speed"; "value": number }
  | { type: "wait"; "enabled": boolean }
  | { type: "hands"; "value": string }
  | { type: "input"; "name"?: string | null }
  | { type: "output"; "name"?: string | null }
  | { type: "note"; "pitch": number; "active": boolean; "velocity": number };

export type CommandName = EngineCommand["type"];
export type CommandOf<Name extends CommandName> = Extract<EngineCommand, { type: Name }>;
