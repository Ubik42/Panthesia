import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { splitTopLevel, attributes, domainDeclaration } from "./rust-wire-types.mjs";

// The wire command enum owns names, field names, defaults and primitive types.
// Migrated domain types are generated from their Rust declarations below.
const source = readFileSync(new URL("../../panthesia-engine/src/protocol.rs", import.meta.url), "utf8");
const target = new URL("../src/engine/commands.generated.ts", import.meta.url);

const domains = [
  ["../../panthesia-core/src/song_catalog.rs", ["CatalogPerformance", "SongCatalog"], "output"],
  ["../../panthesia-engine/src/metadata_discovery.rs", ["MetadataSourceCandidate", "MetadataDiscovery"], "output"],
  ["../../panthesia-engine/src/synthesia_import.rs", ["ImportOptions"]],
  ["../../panthesia-engine/src/synthesia_import.rs", ["ImportRow", "ImportPreview"], "output"],
  ["../../panthesia-core/src/practice_transform.rs", ["Variant"]],
  ["../../panthesia-core/src/song_project.rs", ["NotationGeneration", "PracticeEdition", "ProjectNotation", "SongProject"], "output"],
  ["../../panthesia-core/src/score_document.rs", ["NotationCapabilities"], "output"],
  ["../../panthesia-core/src/repertoire.rs", ["ScoreQuality", "MusicalWork", "PerformanceEdition", "NotationEdition", "RepertoireRegistry"], "output"],
  ["../../panthesia-engine/src/repertoire.rs", ["RepertoireEdit"]],
  ["../../panthesia-engine/src/repertoire.rs", ["RepertoireView"], "output"],
  ["../../panthesia-engine/src/startup.rs", ["StartupStatus", "StartupWarning", "StartupWarningKind"], "output"],
  ["../../panthesia-engine/src/operation_journal.rs", ["PreparationOrigin"]],
  ["../../panthesia-engine/src/operation_journal.rs", ["PreparationPhase"], "output"],
  ["../../panthesia-engine/src/history_operations.rs", ["HistoryOperationRequest"]],
  ["../../panthesia-engine/src/library_operations.rs", ["LibraryOpenRequest", "LibraryOpenSource", "LibraryScoreKind", "LibraryRangeMode", "LibraryRouteVisit", "LibraryScoreSelection"]],
  ["../../panthesia-engine/src/library_operations.rs", ["LibraryOpenView", "LibraryPrepared", "LibraryOpenResult", "LibraryOpenReceipt"], "output"],
  ["../../panthesia-engine/src/history_operations.rs", ["HistoryOperationResult", "HistoryOperationReceipt"], "output"],
  ["../../panthesia-engine/src/history_review.rs", ["HistoryScoreTarget", "HistoryReviewNote", "HistoryScoreReview", "HistoryPaperTarget"], "output"],
  ["../../panthesia-engine/src/performance_archive.rs", ["PerformanceInput", "PerformanceReference", "PerformanceMeasureSpan", "PerformanceDecision", "PerformanceArchive", "PerformancePedalEvidence", "PerformanceNoteExpression", "HistoryPerformanceRead"], "output"],
  ["../../panthesia-engine/src/history_source.rs", ["HistorySource", "HistoryActionKind", "HistoryActionRequest", "HistoryPrepared", "ReplaySelection", "ReplaySound", "HistoryReplayRequest"]],
  ["../../panthesia-engine/src/storage_recovery.rs", ["StorageRecovery"], "output"],
  ["../../panthesia-engine/src/pending_save.rs", ["StorageOperation", "StorageStatus"], "output"],
  ["../src-tauri/src/located_paper_bridge.rs", ["LocatedPaperSaved"], "output"],
  ["../../panthesia-engine/src/score_attachments.rs", ["LocatedNoteDraft", "LocatedPaperUpload"]],
  ["../src-tauri/src/musescore_program.rs", ["ProgramSource", "MuseScoreProgramStatus"], "output"],
  ["../src-tauri/src/desktop_close.rs", ["DesktopClosePhase", "DesktopCloseStatus", "DesktopCloseIssueKind", "DesktopCloseIssue", "DesktopCloseReport", "DesktopCloseReview"], "output"],
  ["../../panthesia-engine/src/paper_navigation.rs", ["PaperPracticeSnapshot"], "output"],
  ["../../panthesia-engine/src/paper_practice.rs", ["PaperPracticeRequest"]],
  ["../../panthesia-engine/src/score_review.rs", ["ScoreReviewExpectation"]],
  ["../../panthesia-engine/src/paper_practice.rs", ["PaperPracticeReview"], "output"],
  ["../../panthesia-engine/src/file_locations.rs", ["FileLocationPath", "FileLocationKind", "FileLocationListing"], "output"],
  ["../../panthesia-engine/src/score_attachments.rs", ["View", "PaperViewState", "PaperViewSaved"], "output"],
  ["../../panthesia-engine/src/score_attachments.rs", ["PageRegion", "PageAnchor", "Mapping", "NoteAnchor"], "output"],
  ["../../panthesia-engine/src/score_attachments.rs", ["NoteAnchorDraft", "NoteAnchorEdit"]],
  ["../../panthesia-engine/src/score_attachments.rs", ["MappingExpectation"]],
  ["../../panthesia-engine/src/library_repairs.rs", ["LibraryPathState"], "output"],
  ["../../panthesia-engine/src/library_repairs.rs", ["RelinkItem"]],
  ["../../panthesia-engine/src/library_repairs.rs", ["ReplacementReview", "MidiReplacementRow", "MidiReplacementPage", "ReplacementComparison", "MidiReplacementPreview", "RepairLocation", "RepairGroup", "RepairInventory", "LibraryRepairResult", "LibraryRelinkResult"], "output"],
  ["../../panthesia-engine/src/metadata_claims.rs", ["MetadataHistoryClaim"], "output"],
  ["../../panthesia-engine/src/metadata_history.rs", ["PendingMetadataRow", "PendingMetadataPage"], "output"],
  ["../../panthesia-engine/src/routine_protocol.rs", ["RoutineVersion"], "output"],
  ["../../panthesia-engine/src/routine_protocol.rs", ["RoutineEditRequest", "RoutineChange"]],
  ["../../panthesia-engine/src/history_reader.rs", ["HistoryPageRequest"]],
  ["../../panthesia-engine/src/history_reader.rs", ["ReadScope"]],
  ["../../panthesia-engine/src/history_calendar.rs", ["HistoryCalendar", "CalendarInterval", "CalendarSave"], "output"],
  ["../../panthesia-engine/src/history_list.rs", ["HistoryPage", "HistoryListEntry", "HistoryCoverage"], "output"],
  ["../../panthesia-core/src/practice.rs", ["PracticeHands", "PracticeSnapshot"], "output"],
  ["../../panthesia-core/src/practice_history.rs", ["PracticeAnnotation", "ReplayClip"], "output"],
  ["../../panthesia-engine/src/replay_clips.rs", ["ReplayClipRead"], "output"],
  ["../../panthesia-engine/src/backup_operations.rs", ["BackupImportRequest", "BackupImportQuery", "BackupPolicy", "BackupSelection"]],
  ["../../panthesia-engine/src/backup_operations.rs", ["BackupImportResult", "BackupImportReceipt", "BackupImportPhase"], "output"],
  ["../../panthesia-engine/src/media_export.rs", ["MediaExportKind", "MediaExportInput"]],
  ["../../panthesia-engine/src/media_export.rs", ["MediaExportSummary"], "output"],
  ["../../panthesia-engine/src/media_export_cache.rs", ["MediaExportDraft", "MediaExportListing"], "output"],
  ["../../panthesia-engine/src/score_export.rs", ["ScoreExportOptions", "RepeatPolicy", "ScoreExportInput"]],
  ["../../panthesia-engine/src/score_export.rs", ["ScoreExportChange", "ScoreExportPosition", "ScoreExportConflict", "ScoreExportPreview"], "output"],
  ["../src-tauri/src/score_export_bridge.rs", ["PreparedScoreExport", "ScoreExportCacheItem", "ScoreExportCacheListing", "ScoreExportResult"], "output"],
  ["../../panthesia-engine/src/pdf_drafts.rs", ["PdfDraft", "PdfListing"], "output"],
  ["../../panthesia-engine/src/notation_drafts.rs", ["DraftSaved", "DraftSummary", "DraftListing"], "output"],
  ["../src-tauri/src/score_draft_bridge.rs", ["DraftSelection", "ImportedNotationDraft"]],
  ["../src-tauri/src/score_draft_bridge.rs", ["RetainedNotationFile"], "output"],
  ["../src-tauri/src/score_jobs.rs", ["ScoreJobKind", "ScoreJobRequest"]],
  ["../src-tauri/src/score_jobs.rs", ["ScoreSubmitted", "ScoreDraft", "ScoreJobPhase", "ScoreJobStatus"], "output"],
  ["../../panthesia-engine/src/package_preview.rs", ["PackagePreviewRequest"]],
  ["../../panthesia-engine/src/package_preview.rs", ["PackagePaperPreview", "PackageTrackPreview", "PackageMetadataPreview", "PackageProvenancePreview", "PackagePreview"], "output"],
  ["../../panthesia-engine/src/music_import.rs", ["ExerciseRequest", "PackagePolicy", "PackageRequest"]],
  ["../../panthesia-engine/src/music_import.rs", ["MusicKind", "MusicPhase", "ImportedSong", "MusicReceipt"], "output"],
  ["../../panthesia-engine/src/state_order.rs", ["StateOrder"], "output"],
  ["../../panthesia-engine/src/demo_protocol.rs", ["DemoKind", "DemoLoop", "DemoFingerNote", "DemoState", "HeldContext", "HeldNote", "HeldChange"], "output"],
  ["../../panthesia-engine/src/finger_pair_interactions.rs", ["InteractionKind", "Interaction", "Analysis"], "output"],
  ["../../panthesia-engine/src/fingerings.rs", ["PlanRequest", "Pin", "Edit"]],
  ["../../panthesia-engine/src/fingerings.rs", ["Proposal", "Position"], "output"],
  ["../../panthesia-engine/src/finger_pair.rs", ["PairPart"]],
  ["../../panthesia-engine/src/held_actions.rs", ["ActionInput", "ActionEdit"]],
  ["../../panthesia-core/src/fingering/review.rs", ["FingeringReviewKind", "CrossHandReviewKind"], "output"],
  ["../../panthesia-engine/src/fingering_protocol.rs", ["ScoreArticulations", "MotionReview", "CrossHandPlanReview", "FingeringPlan", "PlanResult", "HeldSubstitution", "HeldPlan", "HeldPlanResult", "MarkedNeighbor", "CoverageNote", "AcceptanceConflict", "AcceptanceMotionReview", "ExpressionReview", "TrackAcceptance", "AcceptanceReview", "SharedKey", "PairReview", "PairSaved"], "output"],
  ["../../panthesia-core/src/exercise.rs", ["ExercisePattern", "ExerciseTonality", "ExerciseMinorForm", "ExerciseDirection", "ExerciseHands", "ExerciseSpec"]],
  ["../../panthesia-core/src/practice.rs", ["PracticePart"]],
  ["../../panthesia-core/src/fingering.rs", ["HandSpanProfile"]],
  ["../../panthesia-core/src/metadata_layers.rs", ["MetadataLayers"]],
  ["../../panthesia-engine/src/metadata_defaults.rs", ["MetadataDefaultsView"], "output"],
  ["../../panthesia-core/src/song_config.rs", ["PlayerConfig", "NotePlaybackRule"]],
  ["../../panthesia-engine/src/note_playback.rs", ["PlaybackNote", "PlaybackPage"], "output"],
  ["../../panthesia-core/src/library.rs", ["SongMetadata", "FingerHint", "NoteHandHint", "FingerAction", "MeterCorrection", "MeterSegment", "MeasureLength", "MeterMap"]],
  ["../../panthesia-engine/src/track_appearance.rs", ["TrackAppearance"]],
  ["../../panthesia-engine/src/track_sound.rs", ["TrackSound"]],
  ["../../panthesia-core/src/speed_ladder.rs", ["SpeedLadderPlan", "SpeedLadderProgress"], "output"],
  ["../../panthesia-core/src/practice_history.rs", ["PracticeTrackMode", "PracticeTrackSetup"], "output"],
  ["../../panthesia-engine/src/expression_goal.rs", ["ExpressionGoal"]],
  ["../../panthesia-engine/src/expression_goal.rs", ["ExpressionGoalSnapshot"], "output"],
  ["../../panthesia-engine/src/history_reader.rs", ["AnnotationRead"], "output"],
  ["../../panthesia-engine/src/song_learning.rs", ["Draft", "Learning", "Transition", "LearningRead"], "output"],
  ["../../panthesia-engine/src/expression_goal.rs", ["NoteVelocityEvidence", "NotePedalEvidence"], "output"],
  ["../../panthesia-engine/src/song_learning_evidence.rs", ["WeekEvidence", "WholeAttempt", "WholeEvidence", "RoutineItemEvidence", "RoutineEvidence", "HistoricalRef", "Evidence"], "output"],
  ["../../panthesia-engine/src/tick_ranges.rs", ["TickRange", "BeatPoint"], "output"],
  ["../../panthesia-engine/src/score_ranges.rs", ["ScoreRange"], "output"],
  ["../../panthesia-core/src/song_bookmarks.rs", ["Bookmark"], "output"],
  ["../../panthesia-engine/src/bookmarks.rs", ["BookmarkEntry", "BookmarkCatalog"], "output"],
  ["../../panthesia-engine/src/preferences.rs", ["SessionSettings", "PassagePreset", "ExercisePreset", "LadderPreset", "LadderRun"], "output"],
  ["../../panthesia-engine/src/practice_catalog.rs", ["PassageCatalog", "LadderCatalog", "ExerciseCatalog", "FingerProfileCatalog"], "output"],
  ["../../panthesia-engine/src/hands.rs", ["HandProposal"], "output"],
  ["../../panthesia-engine/src/meter_map.rs", ["MeterEditorState"], "output"],
  ["../../panthesia-engine/src/hand_annotations.rs", ["HandUndoState", "HandAssignmentValue", "HandAssignmentRead", "HandSuggestionRead"], "output"],
  ["../../panthesia-engine/src/routine_commands.rs", ["RoutineGoal", "PassageSequenceEntry", "RoutineSchedule"]],
  ["../../panthesia-engine/src/routine_commands.rs", ["RoutineTarget", "RoutineItem", "PracticeRoutine", "RoutineProgress", "RoutineRun", "RoutineKind", "RoutineState", "RoutineList", "RoutineSummary"], "output"],
  ["../../panthesia-engine/src/routine_edit.rs", ["RoutineSourceEntry", "RoutineSourceOptions"], "output"],
  ["../../panthesia-engine/src/expression_review.rs", ["ExpressionMetric"], "output"],
  ["../../panthesia-engine/src/weak_practice.rs", ["SuggestionKind", "Suggestion", "RhythmMetric", "RecommendationPage", "RecommendationAccepted"], "output"],
  ["../../panthesia-engine/src/weak_practice.rs", ["WeakPracticeEdit"]],
];
const domainNames = new Map();
for (const [path, names] of domains) {
  const module = path.split("/src/")[1].replace(/\.rs$/, "").replaceAll("/", "::");
  const prefixes = ["", `${module}::`, `crate::${module}::`, ...(path.includes("panthesia-core") ? [`panthesia_core::${module}::`] : [])];
  for (const name of names) for (const prefix of prefixes) domainNames.set(prefix + name, name);
}
function typeOf(rust, strict = false) {
  rust = rust.trim();
  if (["crate::practice_variant::Variant", "practice_variant::Variant"].includes(rust)) return "Variant";
  if (["HistoryOperationPhase", "crate::history_operations::HistoryOperationPhase", "history_operations::HistoryOperationPhase"].includes(rust)) return "PreparationPhase";
  if (["HistoryOperationOrigin", "crate::history_operations::HistoryOperationOrigin", "history_operations::HistoryOperationOrigin"].includes(rust)) return "PreparationOrigin";
  if (["String", "PathBuf", "&'static str"].includes(rust)) return "string";
  if (rust === "bool") return "boolean";
  if (/^(?:[ui](?:8|16|32|64|size)|f(?:32|64))$/.test(rust)) return "number";
  const shared = rust.match(/^(?:preferences::|crate::preferences::)?Shared<([\s\S]+)>$/);
  if (shared) return typeOf(shared[1], strict);
  const map = rust.match(/^BTreeMap<([\s\S]+)>$/);
  if (map) {
    const fields = splitTopLevel(map[1]);
    if (fields.length !== 2) throw Error(`Unsupported map type: ${rust}`);
    return `Record<${typeOf(fields[0], strict)}, ${typeOf(fields[1], strict)}>`;
  }
  const generic = rust.match(/^(Option|Vec|BTreeSet)<([\s\S]+)>$/);
  if (generic) return generic[1] === "Option"
    ? `${typeOf(generic[2], strict)} | null`
    : `Array<${typeOf(generic[2], strict)}>`;
  if (rust.startsWith("(") && rust.endsWith(")"))
    return `[${splitTopLevel(rust.slice(1, -1)).map(type => typeOf(type, strict)).join(", ")}]`;
  const array = rust.match(/^\[([\s\S]+);\s*(\d+)\s*\]$/);
  if (array) {
    const length = Number(array[2]);
    if (!Number.isSafeInteger(length) || length < 0 || length > 256) throw Error(`Unsupported fixed wire array: ${rust}`);
    return `[${Array.from({ length }, () => typeOf(array[1], strict)).join(", ")}]`;
  }
  if (!/^[\w:]+$/.test(rust)) throw Error(`Unsupported wire type: ${rust}`);
  if (domainNames.has(rust)) return domainNames.get(rust);
  if (strict) throw Error(`Unmigrated nested wire type: ${rust}`);
  return "unknown";
}

const declarations = domains.flatMap(([path, names, direction]) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  return names.map(name => domainDeclaration(source, name, typeOf, direction));
});
declarations.push("export type HistoryOperationOrigin = PreparationOrigin;", "export type HistoryOperationPhase = PreparationPhase;", "export const HistoryOperationPhaseValues = PreparationPhaseValues;");

const enumStart = source.indexOf("pub enum Command {");
if (enumStart < 0) throw Error("Command enum missing");
const body = source.slice(enumStart + "pub enum Command {".length, source.lastIndexOf("}"));
const commands = splitTopLevel(body).map((variant) => {
  const declaration = attributes(variant);
  const match = declaration.text.match(/^(\w+)(?:\s*\{([\s\S]*)\})?$/);
  if (!match) throw Error(`Unsupported command declaration: ${variant}`);
  const rename = declaration.values.match(/rename\s*=\s*"([^"]+)"/);
  const name = rename?.[1] ?? match[1][0].toLowerCase() + match[1].slice(1);
  const fields = splitTopLevel(match[2] ?? "").map((field) => {
    const parsed = attributes(field);
    const match = parsed.text.match(/^(\w+)\s*:\s*([\s\S]+)$/);
    if (!match) throw Error(`Unsupported command field: ${field}`);
    const name = parsed.values.match(/rename\s*=\s*"([^"]+)"/)?.[1] ?? match[1];
    const optional = /\bdefault\b/.test(parsed.values) || /^Option\s*</.test(match[2]);
    return `${JSON.stringify(name)}${optional ? "?" : ""}: ${typeOf(match[2])}`;
  });
  return `  | { type: ${JSON.stringify(name)}${fields.length ? "; " + fields.join("; ") : ""} }`;
});
const output = `// Generated from panthesia-engine/src/protocol.rs. Do not edit.\n// Migrated domains follow Rust serde names and input defaults; remaining domains use unknown.\n${declarations.join("\n\n")}\n\nexport type EngineCommand =\n${commands.join("\n")};\n\nexport type CommandName = EngineCommand["type"];\nexport type CommandOf<Name extends CommandName> = Extract<EngineCommand, { type: Name }>;\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    throw Error("Engine protocol changed. Run npm run protocol:generate.");
  }
} else writeFileSync(target, output);
console.log(`${commands.length} engine commands ${process.argv.includes("--check") ? "verified" : "generated"}: ${fileURLToPath(target)}`);
