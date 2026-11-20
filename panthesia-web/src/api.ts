import { reportDiagnostic } from "./app/diagnostics";
import type { MusicKind, MusicReceipt } from "./engine/commands.generated";
export type { StorageRecovery, StorageOperation } from "./engine/commands.generated";
import { readDesktopBuildReport, type DesktopBuildReport } from "./engine/buildIdentity";
import { readDeviceSnapshot, type DeviceScanTarget } from "./engine/deviceCatalog";
export type { DeviceSnapshot, DeviceScanTarget, DeviceScanStatus } from "./engine/deviceCatalog";
import type { PlaybackAdjustmentCommand, PlaybackAdjustmentSource } from "./features/practice/playbackCommands";
export type { PlaybackAdjustmentCommand, PlaybackAdjustmentSource } from "./features/practice/playbackCommands";
import type { HistoryAnnotationRequest, HistoryAnnotationSaved } from "./features/review/historyTypes";
import type { ScoreMappingRequest, ScoreMappingResult } from "./features/scores/mappingTypes";
import type { ScoreSource, ScoreSourcePreview, SourceApplyMode, AppliedSource } from "./features/scores/sourceTypes";
import type { RoutineState, RoutineList, RoutineSummary, RoutineSourceOptions } from "./features/routines/routineTypes";
import { invoke as nativeInvoke, isTauri } from "@tauri-apps/api/core";
import type { EngineCommand } from "./engine/commands.generated";
export type { EngineCommand } from "./engine/commands.generated";

export * from "./engine/sessionTypes";
import type { PracticeEditCommand, HistoryReadScope, HistoryReadCommand, PracticeDemoCommand, PracticeReadCommand, PracticeEditScope, SongRow, LibraryMonitorStatus, Note, CollectionSong, TrackSound, SoundFontStatus, AudiverisProgramStatus, MeterMapSegment, MeterMap, MeterMapPreview, LoadedSong, LiveNoteEvent, LiveNoteReceipt, StorageStatus, Snapshot, EngineSession, Feedback } from "./engine/sessionTypes";
import { emptyState } from "./engine/sessionTypes";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await nativeInvoke<T>(command, args); }
  catch(error) { reportDiagnostic(command,error); throw error; }
}
const historyReadCommands = new Set<EngineCommand["type"]>([
  "weakPractice", "dueReview", "collection", "history", "historyQuery", "readHistoryPage", "historyDetail", "practiceTime", "practiceCalendar",
  "readHistoryDetail", "readHistoryPerformance", "historyProblemNotes", "historyReplayClips", "readHistoryReplayClips", "historyPerformance", "songLearningEvidence", "readSongExpressionGoal", "readHistoryAnnotation",
]);

let sessionReadSequence = 0;
const service = "http://127.0.0.1:32124";
const controlCommands = new Set<EngineCommand["type"]>([
  "panic", "pause", "note", "startInstrumentPreview", "stopSongAudition", "songAuditionState", "stopFingerDemo", "fingerDemoState", "tasks", "cancelTask", "cancelHistoryRead", "skipStartupSong", "retryStartup", "dismissStartupWarning",
]);
const backgroundCommands = new Set<EngineCommand["type"]>([
  "discoverSynthesiaMetadata", "previewDiscoveredSynthesiaMetadata", "importDiscoveredSynthesiaMetadata",
  "previewSynthesiaMetadata", "importSynthesiaMetadata",
  "libraryRepairs", "midiReplacements", "previewMidiReplacement", "decideMidiReplacement", "readLibraryPath",
  "relinkLibrary", "setLibraryPrimary", "ignoreLibraryPath", "restoreLibraryPath", "pendingMetadataHistory", "pendingMetadataHistoryPage", "claimPendingMetadataHistory", "readMetadataHistoryClaim",
  "libraryWorkspace", "inspectSong", "inspectSongs", "libraryGroup", "removeLibraryGroup", "assignLibrary", "unassignLibrary",
  "readSongLearning", "saveSongLearning", "readLibraryMetadata", "previewLibraryMetadata", "saveLibraryMetadata", "resetLibraryMetadataDefaults", "restoreLibraryMetadata", "updateSongMetadata",
  "libraryMetadataHistory", "previewMetadataRestore", "metadataTemplates", "updateMetadataTemplate",
  "importMidi", "importScore", "importScoreOriginal",
  "startLibraryOpen", "readLibraryOpen", "cancelLibraryOpen", "releaseLibraryOpen",
  "load", "loadIndexed", "openRecent", "historyOpen", "historyPerformance",
  "historyScoreReview", "historyPracticeRange", "performHistoryAction", "playHistorySource", "startHistoryReplay", "startHistoryReplayRange", "startHistoryOperation", "readHistoryOperation", "cancelHistoryOperation", "releaseHistoryOperation",
  "openRoutineItem", "generate", "openLibraryScore", "openPassage", "startLadder",
  "inspectPackage", "importPackage", "importStagedPackage", "exportPackage", "exportPackageFile",
  "practiceBackupSnapshot", "exportPracticeBackup",
  "inspectPracticeBackup",
  "applyPracticeBackup", "importStagedPracticeBackup",
  "retrySave", "recording", "soundFont", "feedback",
  "linkScoreSource", "applyScoreSource", "acknowledgeScoreSource", "unlinkScoreSource",
  "scoreSources", "previewScoreSource", "manageLibraryScore", "addLibraryScore",
  "pairScore", "activateScore", "detachScore", "saveScoreVersion", "removeScoreVersion", "scoreVersions", "renameScoreVersion", "setPaperMapping", "savePaperPractice", "previewPaperPractice", "previewScoreVersionRoute", "previewCrossPaperTransfer", "paperTransferSources", "score", "exportAnnotatedScore", "addScoreAttachment", "updateScoreAttachment", "readPaperView", "savePaperView", "seekPaperMeasure", "seekPaperNote",
  "editPaperAnnotation", "editPaperInk", "editPaperNoteAnchor", "batchPaperNoteAnchors",
  "fileLocations", "fileLocationsFor", "updateFileLocation",
  "createLocatedScorePaper", "linkPaperSource", "applyPaperSource", "applyPaperTransfer", "applyCrossPaperTransfer", "updateLibraryPaper",
  "suggestFingers", "suggestFingerPlans", "suggestHeldFingerPlans", "reviewFingerAcceptance",
]);
async function http<T>(path: string, command?: EngineCommand, post = false): Promise<T> {
  if (path === "/api/command" && command && controlCommands.has(command.type)) path = "/api/control";
  const response = await fetch(service + path, {
    cache: "no-store",
    method: command || post ? "POST" : "GET",
    headers: command || post
      ? { "Content-Type": "application/json", "X-Panthesia-Client": "web" }
      : {},
    body: command ? JSON.stringify(command) : undefined,
    signal: AbortSignal.timeout(
      command && controlCommands.has(command.type) ? 3500 :
      command && backgroundCommands.has(command.type) ? 125000 :
      command &&
        [
          "importScore",
          "importMidi",
          "importPackage",
          "inspectPackage",
          "exportPackage",
          "libraryScores",
          "manageLibraryScore",
          "openLibraryScore",
          "createLocatedScorePaper",
        ].includes(command.type)
        ? 120000
        : command || path === "/api/song" || path === "/api/session" ? 125000 : 15000,
    ),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "本地音乐引擎请求失败");
  return data;
}
function engineCommand<T={ok:boolean}>(command:EngineCommand):Promise<T> {
  if (command.type === "passageCatalog") return postLocal<T>("read_routine_sources", "/api/routines/sources", command);
  if (command.type === "routines") return postLocal<T>("read_routines", "/api/routines/read", { day: command.day });
  if (command.type === "saveHistoryReplayClip" || command.type === "deleteHistoryReplayClip") return postLocal<T>("edit_history_clips", "/api/history-clips/edit", command);
  if (historyReadCommands.has(command.type)) return postLocal<T>("read_history", "/api/history-read", command);
  return isTauri()?invoke<T>("engine_command",{command}):http<T>("/api/command",command);
}
async function practiceRequest<T>(mode: "edit" | "read" | "demo", song: PracticeEditScope,
  command: PracticeEditCommand | PracticeReadCommand | PracticeDemoCommand, requestId?: string, catalogRevision?: string): Promise<T> {
  const request = { command, engineId: song.engineId ?? undefined, contentId: song.contentId, scoreRevision: song.scoreRevision, annotationRevision: song.annotationRevision ?? 0, requestId, catalogRevision };
  return postLocal<T>(mode === "edit" ? "edit_practice" : mode === "demo" ? "start_practice_demo" : "read_practice", `/api/practice-${mode}`, request);
}
async function postLocal<T>(nativeCommand: string, path: string, request: unknown, timeout = 125000): Promise<T> {
  if (isTauri()) return invoke<T>(nativeCommand, { request });
  const response = await fetch(service + path, {
    cache: "no-store",
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Panthesia-Client": "web" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地音乐引擎请求失败");
  return result as T;
}

export type PaperSaveOptions = {
  signal?: AbortSignal;
  progress?: (phase: "choosing" | "writing" | "committing", percent: number) => void;
};
async function savePaperFile(format: "png" | "pdf", name: string, bytes: Uint8Array, options: PaperSaveOptions): Promise<string | null> {
  const check = () => {if (options.signal?.aborted) throw new DOMException("已停止保存，原位置的文件保留。", "AbortError");};
  check();
  const maximum = format === "png" ? 48_000_000 : 64_000_000;
  if (bytes.length < (format === "png" ? 45 : 100) || bytes.length > maximum) throw new Error(`批注${format === "png" ? "图片" : " PDF"}大小无效，最大支持 ${maximum / 1_000_000} MB`);
  const protocol = await api.scoreJobProtocol();
  check();
  if (protocol < (format === "png" ? 3 : 2)) {
    options.progress?.("committing", 0);
    return invoke<string | null>(format === "png" ? "export_paper_page" : "export_paper_book", {name, bytes: Array.from(bytes)});
  }
  options.progress?.("choosing", 0);
  const session = await invoke<string | null>(format === "png" ? "begin_paper_png_export" : "begin_paper_pdf_export", {name, size: bytes.length});
  if (!session) {check(); return null;}
  try {
    for (let offset = 0; offset < bytes.length; offset += 1_048_576) {
      check();
      const chunk = bytes.subarray(offset, offset + 1_048_576);
      await invoke("write_score_batch_export", {session, offset, bytes: Array.from(chunk)});
      options.progress?.("writing", Math.round((offset + chunk.length) / bytes.length * 100));
    }
    check();
    options.progress?.("committing", 100);
    return await invoke<string>("finish_score_batch_export", {session});
  } catch (failure) {
    await invoke("cancel_score_batch_export", {session}).catch(() => {});
    throw failure;
  }
}

export const api = {
  desktopBuildInfo: async (): Promise<DesktopBuildReport | null> => isTauri() ? readDesktopBuildReport(await invoke<unknown>("desktop_build_info")) : null,
  backupImportProtocol: async (): Promise<number> => {
    if(isTauri())return invoke<number>("backup_import_protocol").catch(error=>{if(/not found|unknown command|不存在/i.test(String(error)))return 0;throw error;});
    const response=await fetch(service+"/api/practice-backup/protocol",{cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(response.status===404)return 0;
    if(!response.ok)throw new Error("备份接口暂不可读，请保留预览后重试。");
    const version=await response.json();if(!Number.isInteger(version)||version<0)throw new Error("备份接口版本无效。");return version;
  },
  prepareBackupImport: (request: import("./engine/commands.generated").BackupImportRequest): Promise<import("./engine/commands.generated").BackupImportReceipt> => postLocal("prepare_backup_import", "/api/practice-backup/prepare", request, 15000),
  readBackupImport: (request: import("./engine/commands.generated").BackupImportQuery): Promise<import("./engine/commands.generated").BackupImportReceipt | null> => postLocal("read_backup_import", "/api/practice-backup/read", request, 15000),
  cancelBackupImport: (request: import("./engine/commands.generated").BackupImportQuery): Promise<import("./engine/commands.generated").BackupImportReceipt | null> => postLocal("cancel_backup_import", "/api/practice-backup/cancel", request, 15000),

  prepareMediaExport: (request: import("./engine/commands.generated").ScoreJobRequest, input: import("./engine/commands.generated").MediaExportInput): Promise<import("./engine/commands.generated").ScoreSubmitted> => invoke("prepare_media_export", {request, input}),
  listMediaExports: (engineId: string): Promise<import("./engine/commands.generated").MediaExportListing> => invoke("list_media_exports", {engineId}),
  saveMediaExport: (request: import("./engine/commands.generated").ScoreJobRequest, draft: import("./engine/commands.generated").DraftSelection): Promise<import("./engine/commands.generated").ScoreSubmitted> => invoke("save_media_export", {request, draft}),
  removeMediaExport: (request: import("./engine/commands.generated").DraftSelection): Promise<void> => invoke("remove_media_export", {request}),
  confirmMediaExport: (request: import("./engine/commands.generated").DraftSelection): Promise<import("./engine/commands.generated").MediaExportDraft> => invoke("confirm_media_export", {request}),
  prepareScoreExport: (request: import("./engine/commands.generated").ScoreJobRequest, input: import("./engine/commands.generated").ScoreExportInput): Promise<import("./engine/commands.generated").ScoreSubmitted> => invoke("prepare_score_export", {request, input}),
  listScoreExports: (engineId: string): Promise<import("./engine/commands.generated").ScoreExportCacheListing> => invoke("list_score_exports", {engineId}),
  readScoreExport: (request: import("./engine/commands.generated").DraftSelection): Promise<import("./engine/commands.generated").PreparedScoreExport> => invoke("read_score_export", {request}),
  saveScoreExport: (request: import("./engine/commands.generated").DraftSelection): Promise<string | null> => invoke("save_score_export", {request}),
  removeScoreExport: (request: import("./engine/commands.generated").DraftSelection): Promise<void> => invoke("remove_score_export", {request}),
  preparePdfDraft: (request: import("./engine/commands.generated").ScoreJobRequest, versionId: string, sourceTitle?: string): Promise<import("./engine/commands.generated").ScoreSubmitted> => invoke("prepare_pdf_draft", {request, versionId, sourceTitle: sourceTitle ?? null}),
  listPdfDrafts: (engineId: string, contentId?: string): Promise<import("./engine/commands.generated").PdfListing> => invoke("list_pdf_drafts", {engineId, contentId: contentId ?? null}),
  readPdfDraftBytes: async (request: import("./engine/commands.generated").DraftSelection): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>("read_pdf_draft_bytes", {request})),
  adoptPdfDraft: (request: import("./engine/commands.generated").DraftSelection, adopt = true): Promise<import("./engine/commands.generated").PdfDraft> => invoke("adopt_pdf_draft", {request, adopt}),
  exportPdfDraft: (request: import("./engine/commands.generated").DraftSelection): Promise<string | null> => invoke("export_pdf_draft", {request}),
  removePdfDraft: (request: import("./engine/commands.generated").DraftSelection): Promise<void> => invoke("remove_pdf_draft", {request}),
  scoreJobProtocol: () => isTauri() ? invoke<number>("score_job_protocol").catch(() => 0) : Promise.resolve(0),
  retainNotationFile: (request: import("./engine/commands.generated").ImportedNotationDraft): Promise<import("./engine/commands.generated").RetainedNotationFile> => invoke("retain_notation_file", { request }),
  listNotationDrafts: (contentId: string): Promise<import("./engine/commands.generated").DraftListing> => invoke("list_notation_drafts", { contentId }),
  readNotationDraft: (request: import("./engine/commands.generated").DraftSelection): Promise<import("./engine/commands.generated").ScoreDraft> => invoke("read_notation_draft", { request }),
  removeNotationDraft: (request: import("./engine/commands.generated").DraftSelection): Promise<void> => invoke("remove_notation_draft", { request }),
  exportNotationDraft: (request: import("./engine/commands.generated").DraftSelection): Promise<string | null> => invoke("export_notation_draft", { request }),
  exportNotationDraftBytes: (request: import("./engine/commands.generated").DraftSelection, name: string, bytes: number[] | Uint8Array): Promise<string | null> => invoke("export_notation_draft_bytes", {request, name, bytes: bytes instanceof Uint8Array ? Array.from(bytes) : bytes}),
  readScoreJob: (request: import("./engine/commands.generated").ScoreJobRequest): Promise<import("./engine/commands.generated").ScoreJobStatus | null> => invoke("read_score_job", { request }),
  cancelScoreJob: (request: import("./engine/commands.generated").ScoreJobRequest): Promise<import("./engine/commands.generated").ScoreJobStatus> => invoke("cancel_score_job", { request }),
  startMidiScoreJob: (job: import("./engine/commands.generated").ScoreJobRequest): Promise<import("./engine/commands.generated").ScoreSubmitted> => invoke("generate_duet_score", { contentId: job.contentId, job }),
  startPaperScoreJob: async (job: import("./engine/commands.generated").ScoreJobRequest, bookId: string, expectedPages: {id: string; kind: string}[], preparedPdf?: Uint8Array, options: {signal?: AbortSignal; shouldCancel?: () => boolean; progress?: (sent: number, total: number) => void} = {}): Promise<import("./engine/commands.generated").ScoreSubmitted> => {
    let session: string | undefined;
    const check = () => { if (options.shouldCancel?.() || options.signal?.reason === "cancelled") throw new Error("已停止传输识谱 PDF，原谱页保留。"); };
    try {
      check();
      if (preparedPdf) {
        session = await invoke<string>("begin_score_input", {size: preparedPdf.length});
        for (let offset = 0; offset < preparedPdf.length; offset += 1_048_576) {
          check();
          await invoke("write_score_input_chunk", {session, offset, bytes: Array.from(preparedPdf.subarray(offset, offset + 1_048_576))});
          options.progress?.(Math.min(offset + 1_048_576, preparedPdf.length), preparedPdf.length);
        }
      }
      check();
      preparedPdf = undefined;
      return await invoke("recognize_paper_with_audiveris", {contentId: job.contentId, bookId, expectedPages, preparedPdf: null, preparedPdfSession: session ?? null, job: {...job, createdAtMs: Date.now()}});
    } catch (failure) {
      if (session) await invoke("cancel_score_input", {session}).catch(() => {});
      throw failure;
    }
  },
  prepareExercise: (request: import("./engine/commands.generated").ExerciseRequest): Promise<MusicReceipt> => postLocal("prepare_exercise", "/api/exercise/prepare", request, 20000),
  preparePackage: (request: import("./engine/commands.generated").PackageRequest): Promise<MusicReceipt> => postLocal("prepare_package", "/api/package/prepare", request, 20000),
  refreshPackagePreview: (request: import("./engine/commands.generated").PackagePreviewRequest): Promise<import("./engine/commands.generated").PackagePreview> => postLocal("refresh_package_preview", "/api/package/preview", request),
  beginMusicImport: (request: { engineId: string; requestId?: string; createdAtMs?: number; name: string; size: number; kind: MusicKind; defaultBpm?: number; catalogOnly?: boolean }): Promise<MusicReceipt> => postLocal("begin_music_import", "/api/music-import/begin", request, 15000),
  writeMusicImport: async (id: string, offset: number, bytes: Blob): Promise<MusicReceipt> => {
    if (bytes.size > 524288) throw new Error("文件分块超过传输限制");
    if (isTauri()) return invoke<MusicReceipt>("write_music_import", { request: { id, offset, bytes: Array.from(new Uint8Array(await bytes.arrayBuffer())) } });
    const response = await fetch(service + "/api/music-import/chunk", {
      method: "POST", headers: { "X-Panthesia-Client": "web", "X-Panthesia-Upload": id, "X-Panthesia-Offset": String(offset) },
      body: bytes, signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "文件分块传输失败");
    return value as MusicReceipt;
  },
  finishMusicImport: (id: string): Promise<MusicReceipt> => postLocal("finish_music_import", "/api/music-import/finish", { id }, 20000),
  readMusicImport: (id: string): Promise<MusicReceipt> => postLocal("read_music_import", "/api/music-import/read", { id }, 4000),
  cancelMusicImport: async (id: string, kind?: MusicKind): Promise<MusicReceipt> => {
    const state = await api.state();
    return postLocal("cancel_music_import", "/api/music-import/cancel", { id, ...((state.musicImportVersion ?? 0) >= 2 ? { kind } : {}) }, 4000);
  },
  routineOptions: (contentId:string, engineId?: string): Promise<RoutineSourceOptions> => postLocal("routine_options","/api/routines/options",{contentId, engineId}),
  editRoutine: <T = { id: string }>(request: import("./engine/commands.generated").RoutineEditRequest): Promise<T> => engineCommand<T>({ type: "editRoutine", request }),
  readLearningState: async (contentId: string, engineId?: string): Promise<import("./engine/commands.generated").LearningRead> => {
    const reply = await api.commandForEngine<import("./engine/commands.generated").LearningRead>(engineId, { type: "readSongLearning", content_id: contentId });
    if (!reply || reply.contentId !== contentId || !Object.hasOwn(reply, "value") || reply.value === undefined || typeof reply.writeSettled !== "boolean") throw new Error("学习资料读取不完整，请重新读取。");
    return reply;
  },
  readLearning: async (contentId: string): Promise<import("./songLearning").SongLearning | null> => {
    const reply = await engineCommand<{ contentId: string; value: import("./songLearning").SongLearning | null }>({ type: "readSongLearning", content_id: contentId });
    if (!reply || reply.contentId !== contentId || !Object.hasOwn(reply, "value") || reply.value === undefined) throw new Error("学习资料与所选曲目不一致或读取结果不完整，请重新读取。");
    return reply.value;
  },
  routines: (day: string, scope?: HistoryReadScope, engineId?: string): Promise<RoutineList> => postLocal("read_routines", "/api/routines/read", { day, scope, engineId }),
  routineTemplates: (): Promise<{ plans: RoutineSummary[] }> => isTauri()
    ? invoke("routine_templates") : http("/api/routines/templates"),
  saveHistoryAnnotation: (request: HistoryAnnotationRequest): Promise<HistoryAnnotationSaved> => postLocal("save_history_annotation", "/api/history-annotation", request),
  readHistory: <T>(command: HistoryReadCommand, scope?: HistoryReadScope, engineId?: string): Promise<T> => scope ? postLocal("read_history", "/api/history-read", {command,scope,...(engineId ? {engineId} : {})}) : engineId ? api.commandForEngine<T>(engineId, command) : postLocal("read_history", "/api/history-read", command),
  mapScore: (request: ScoreMappingRequest): Promise<ScoreMappingResult> => postLocal("map_score", "/api/score-map", request),
  openDataFolder: () => invoke<void>("open_practice_data_folder"),
  session: async (): Promise<EngineSession> => {
    const readSequence = ++sessionReadSequence;
    const session = isTauri() ? await invoke<EngineSession>("engine_command", { command: { type: "session" } }) : await http<EngineSession>("/api/session");
    return { ...session, readSequence };
  },
  currentSessionRead: (session: EngineSession) => session.readSequence === undefined || session.readSequence === sessionReadSequence,
  checkLibraryScoreImport: async (
    path: string,
    contentId: string,
    file: File,
    kind: string,
    target?: string,
  ) => {
    if (file.size > (kind === "notation" ? 4_000_000 : 48_000_000))
      throw new Error("文件超过谱面容量上限");
    type Result = {
      matches: { id: string; name: string; kind: string; page: number }[];
    };
    if (isTauri())
      return invoke<Result>("engine_command", {
        command: {
          type: "checkLibraryScoreImport",
          path,
          content_id: contentId,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          kind,
          target: target ?? null,
        },
      });
    const r = await fetch(service + "/api/library-score/check", {
      method: "POST",
      headers: {
        "X-Panthesia-Client": "web",
        "X-Panthesia-Path": encodeURIComponent(path),
        "X-Panthesia-Song": contentId,
        "X-Panthesia-Kind": kind,
        ...(target ? { "X-Panthesia-Target": target } : {}),
      },
      body: file,
      signal: AbortSignal.timeout(120000),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "保存结果核对失败");
    return value as Result;
  },
  desktop: isTauri(),
  soundfontStatus: () => invoke<SoundFontStatus>("get_soundfont_status"),
  selectSoundfont: () => invoke<SoundFontStatus | null>("select_soundfont"),
  resetSoundfont: () => invoke<SoundFontStatus>("reset_soundfont"),
  library: () =>
    isTauri()
      ? invoke<{ songs: SongRow[] }>("library_list")
      : http<{ songs: SongRow[] }>("/api/library"),
  state: () =>
    isTauri() ? invoke<Snapshot>("engine_state") : http<Snapshot>("/api/state"),
  liveNotes: async (epoch: number | undefined, createdAtMs: number, events: LiveNoteEvent[], engineId?: string): Promise<LiveNoteReceipt> => {
    if (epoch === undefined) {
      let accepted = 0, expired = 0;
      for (const event of events) {
        if (event.active && Date.now() - createdAtMs > 200) { expired++; continue; }
        await engineCommand({ type: "note", ...event });
        accepted++;
      }
      return { accepted, expired };
    }
    return postLocal("play_live_notes", "/api/live-notes", { epoch, engineId, createdAtMs, events }, 3500);
  },
  pollState: async (previous: Snapshot): Promise<Snapshot> => {
    // Older engines and saved UI fixtures use the existing full-state interface.
    if (!previous.summaryVersion)
      return isTauri() ? invoke<Snapshot>("engine_state") : http<Snapshot>("/api/state");
    const frame = await postLocal<{ state: Snapshot; summaryUnchanged: boolean }>(
      "engine_state_frame", "/api/state-frame", { summaryVersion: previous.summaryVersion }, 3000,
    );
    if (!frame.summaryUnchanged) return frame.state;
    if (!previous.summaryVersion || frame.state.summaryVersion !== previous.summaryVersion)
      throw new Error("演奏结果版本已改变，请重新读取当前练习");
    return { ...frame.state, summary: previous.summary };
  },
  song: () =>
    isTauri()
      ? invoke<LoadedSong | null>("engine_song")
      : http<LoadedSong | null>("/api/song"),
  devices: async (refresh = false, target: DeviceScanTarget = "all") => readDeviceSnapshot(await (isTauri()
    ? invoke<unknown>("midi_devices", { refresh, target: refresh ? target : undefined })
    : refresh ? postLocal<unknown>("midi_devices", "/api/devices/refresh", { refresh: true, target }, 3000) : http<unknown>("/api/devices"))),
  command: engineCommand,
  adjustPlayback: (source: PlaybackAdjustmentSource, command: PlaybackAdjustmentCommand, createdAtMs = Date.now()): Promise<{ok: boolean}> => source.stateOrder
    ? postLocal("adjust_playback", "/api/playback-adjustment", {
        engineId: source.stateOrder.engineId, contentId: source.contentId, createdAtMs,
        scoreRevision: source.scoreRevision ?? 0, command,
      })
    : engineCommand(command),
  commandForEngine: <T = { ok: boolean }>(engineId: string | undefined, command: EngineCommand): Promise<T> => engineId
    ? postLocal<T>("engine_scoped_command", controlCommands.has(command.type) ? "/api/control-scoped" : historyReadCommands.has(command.type) ? "/api/history-read-scoped" : "/api/command-scoped", { engineId, command }, controlCommands.has(command.type) ? 3500 : 125000)
    : engineCommand<T>(command),
  adjustForSong: (song: PracticeEditScope, command: PlaybackAdjustmentCommand | Extract<EngineCommand, { type: "stopLadder" }>): Promise<{ok: boolean}> => song.engineId
    ? postLocal("adjust_playback", "/api/playback-adjustment", { engineId: song.engineId, contentId: song.contentId, scoreRevision: song.scoreRevision, createdAtMs: Date.now(), command })
    : engineCommand(command),
  editPractice: <T = { ok: boolean }>(song: PracticeEditScope, command: PracticeEditCommand, catalogRevision?: string, requestId?: string) =>
    practiceRequest<T>("edit", song, command, requestId, catalogRevision),
  startPracticeDemo: <T>(song: PracticeEditScope, command: PracticeDemoCommand, requestId: string) =>
    practiceRequest<T>("demo", song, command, requestId),
  readPractice: <T>(song: PracticeEditScope, command: PracticeReadCommand) =>
    practiceRequest<T>("read", song, command),
  inspectScoreSources: (contentId?:string) => engineCommand<{entries:ScoreSource[]}>({type:"scoreSources",content_id:contentId??null}),
  previewScoreSource: (id:string,fingerprint:string) => engineCommand<ScoreSourcePreview>({type:"previewScoreSource",id,fingerprint}),
  applyScoreSource: (id:string,fingerprint:string,mode:SourceApplyMode) => engineCommand<AppliedSource>({type:"applyScoreSource",id,fingerprint,mode}),
  keepScoreSource: (id:string,fingerprint:string) => engineCommand<{kept:boolean}>({type:"acknowledgeScoreSource",id,fingerprint}),
  createLocatedScorePaper: async (
    metadata: Omit<import("./engine/commands.generated").LocatedPaperUpload, "page_count">,
    pages: Blob[],
    options: { signal?: AbortSignal; progress?: (sent: number, total: number) => void; committing?: () => void } = {},
  ): Promise<import("./engine/commands.generated").LocatedPaperSaved> => {
    const check = () => { if (options.signal?.aborted) throw new DOMException("谱页制作或传输已停止，当前输入和已生成图片保留。", "AbortError"); };
    check();
    if (!pages.length || pages.length > 80) throw new Error("纸谱需有 1 至 80 页");
    const total = pages.reduce((sum, page) => sum + page.size, 0);
    if (total > 48_000_000) throw new Error("生成谱页超过 48 MB 容量上限");
    const meta = new TextEncoder().encode(JSON.stringify({ ...metadata, page_count: pages.length }));
    if (!meta.length || meta.length > 2_000_000) throw new Error("纸谱音符位置超过容量上限");
    const length = (value: number) => {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value, true);
      return bytes;
    };
    const parts: BlobPart[] = [new Uint8Array([78, 76, 80, 49]), length(meta.length), new Uint8Array(meta)];
    for (const page of pages) parts.push(length(page.size), page);
    const body = new Blob(parts, { type: "application/x-neothesia-located-paper" });
    if (isTauri()) {
      const session = await invoke<string>("begin_located_paper_upload", { size: body.size });
      try {
        check();
        for (let offset = 0; offset < body.size; offset += 1_048_576) {
          check();
          const bytes = Array.from(new Uint8Array(await body.slice(offset, offset + 1_048_576).arrayBuffer()));
          check();
          await invoke("write_located_paper_chunk", { session, offset, bytes });
          options.progress?.(Math.min(body.size, offset + bytes.length), body.size);
        }
        check();
        options.committing?.();
        // Once submitted, return the actual save result even if the caller closes its view.
        const result = await invoke<import("./engine/commands.generated").LocatedPaperSaved & { createdPaperId?: string }>("finish_located_paper_upload", { session });
        const active = result.createdPaperId || result.active;
        if (typeof active !== "string" || !active) throw new Error("谱页保存结果尚未确认，请核对谱页列表后继续。");
        return { active, alreadySaved: result.alreadySaved === true };
      } catch (error) {
        await invoke("cancel_located_paper_upload", { session }).catch(() => {});
        throw error;
      }
    }
    check();
    options.committing?.();
    const response = await fetch(service + "/api/located-paper/create", {
      method: "POST",
      headers: { "X-Panthesia-Client": "web", "Content-Type": body.type },
      body,
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "可定位纸谱保存失败");
    const active = result.createdPaperId || result.active;
    if (typeof active !== "string" || !active) throw new Error("谱页保存结果尚未确认，请核对谱页列表后继续。");
    return { active, alreadySaved: result.alreadySaved === true };
  },
  cancelLibraryScoreImport: (batchId: string) =>
    invoke("cancel_library_score_import", { batchId }),
  importLibraryScores: (
    batchId: string,
    path: string,
    contentId: string,
    kind: string,
    target?: string,
    page = 0,
  ) =>
    invoke<{
      results: { name: string; ok: boolean; id?: string; kind?: "notation" | "paper"; error?: string; warning?: string }[];
      stopped?: boolean;
    } | null>("import_library_scores", {
      batchId,
      path,
      contentId,
      kind,
      target: target ?? null,
      page,
    }),
  addLibraryScore: async (
    path: string,
    contentId: string,
    file: File,
    kind: string,
    target?: string,
    page = 0,
  ) => {
    if (file.size > (kind === "notation" ? 4_000_000 : 48_000_000))
      throw new Error("文件超过当前谱面格式容量上限");
    if (isTauri())
      return invoke<{ active?: string }>("engine_command", {
        command: {
          type: "addLibraryScore",
          path,
          content_id: contentId,
          name: file.name,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          kind,
          target: target ?? null,
          page,
        },
      });
    const r = await fetch(service + "/api/library-score/add", {
      method: "POST",
      headers: {
        "X-Panthesia-Client": "web",
        "X-Panthesia-Song": contentId,
        "X-Panthesia-Name": encodeURIComponent(file.name),
        "X-Panthesia-Path": encodeURIComponent(path),
        "X-Panthesia-Kind": kind,
        "X-Panthesia-Page": String(page),
        ...(target ? { "X-Panthesia-Target": target } : {}),
      },
      body: file,
      signal: AbortSignal.timeout(120000),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "谱面导入失败");
    return value as { active?: string };
  },
  addScoreAttachment: async (
    contentId: string,
    file: File,
    append?: string,
  ) => {
    if (file.size > 48_000_000) throw new Error("单份谱面超过 48 MB");
    if (isTauri())
      return invoke<{ active: string }>("engine_command", {
        command: {
          type: "addScoreAttachment",
          content_id: contentId,
          name: file.name,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          append: append ?? null,
        },
      });
    const r = await fetch(service + "/api/score-attachment/add", {
      method: "POST",
      headers: {
        "X-Panthesia-Client": "web",
        "X-Panthesia-Song": contentId,
        "X-Panthesia-Name": encodeURIComponent(file.name),
        ...(append ? { "X-Panthesia-Append": append } : {}),
      },
      body: file,
      signal: AbortSignal.timeout(120000),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "谱面导入失败");
    return data as { active: string };
  },
  readScoreAttachment: async (
    contentId: string,
    id: string,
    page: number,
    previewKind?: string,
    expectedAsset?: string,
  ) => {
    if (isTauri()) {
      const bytes = await invoke<ArrayBuffer>("score_attachment_bytes", {
        contentId,
        id,
        page,
        previewKind: previewKind ?? null,
        expectedAsset: expectedAsset ?? null,
      });
      return new Uint8Array(bytes);
    }
    const r = await fetch(service + "/api/score-attachment/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Panthesia-Client": "web",
      },
      body: JSON.stringify({ contentId, id, page, previewKind, expectedAsset }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const v = await r.json();
      throw new Error(v.error || "谱页读取失败");
    }
    return new Uint8Array(await r.arrayBuffer());
  },
  importScoreAttachments: (contentId: string, append?: string) =>
    invoke<{ results: { name: string; ok: boolean; error?: string }[] } | null>(
      "import_score_attachments",
      { contentId, append: append ?? null },
    ),
  openLogs: () => invoke<void>("open_log_folder"),
  revealFile: (path: string) => invoke<void>("reveal_library_file", { path }),
  importFolder: () => invoke<number | null>("import_folder"),
  repairPath: (contentId: string, from: string) =>
    invoke<{ results: import("./features/library/repairSessionStore").RepairResult[] } | null>(
      "repair_midi",
      { contentId, from },
    ),
  pickRepairPath: (contentId: string, from: string) => invoke<string | null>("repair_midi", { contentId, from, chooseOnly: true }),
  relocate: (contentId: string) =>
    invoke<LoadedSong | null>("relocate_midi", { contentId }),
  export: () => invoke<string | null>("export_midi"),
  downloadMidi: async (contentId: string, signal?: AbortSignal): Promise<Blob> => {
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch(service + "/api/midi/export", {method: "POST", headers: {"X-Panthesia-Client": "web", "Content-Type": "application/json"}, body: JSON.stringify({contentId}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
    if (response.status === 404) {
      const before = await api.state();
      if (before.contentId !== contentId || signal?.aborted) throw new Error("曲目已切换或导出已停止。");
      const result = await api.command<{bytes: number[]}>({type: "exportMidi"});
      const after = await api.state();
      if (after.contentId !== contentId || signal?.aborted) throw new Error("曲目已切换或导出已停止。");
      if (!Array.isArray(result.bytes) || result.bytes.length < 14 || result.bytes.length > 32_000_000 || String.fromCharCode(...result.bytes.slice(0, 4)) !== "MThd") throw new Error("旧版服务没有返回有效的 MIDI 文件，请重新导出。");
      return new Blob([new Uint8Array(result.bytes)], {type: "audio/midi"});
    }
    if (!response.ok) {const value = await response.json(); throw new Error(value.error || "MIDI 导出失败");}
    const blob = await response.blob();
    const prefix = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (blob.size < 14 || blob.size > 32_000_000 || String.fromCharCode(...prefix) !== "MThd") throw new Error("导出结果不是有效的 MIDI 文件，请重新读取当前曲目。");
    return blob;
  },
  linkScoreSource: (midiPath: string, contentId: string, versionId: string, expectedEngine?: string) =>
    invoke<{ id: string; linked: boolean } | null>("link_score_source", {
      midiPath,
      contentId,
      versionId,
      expectedEngine: expectedEngine ?? null,
    }),
  openScoreInMuseScore: (contentId: string, versionId: string, engineId?: string) =>
    invoke<void>("open_score_in_musescore", { contentId, versionId, engineId: engineId ?? null }),
  addMuseScorePdf: (contentId: string, versionId: string) =>
    invoke<{ active: string }>("add_musescore_pdf", { contentId, versionId }),
  generateDuetScore: (contentId: string) =>
    invoke<import("./engine/commands.generated").ScoreDraft>("generate_duet_score", { contentId, job: null }),
  museScoreProgramStatus: () => invoke<import("./engine/commands.generated").MuseScoreProgramStatus>("musescore_program_status"),
  selectMuseScoreProgram: () => invoke<import("./engine/commands.generated").MuseScoreProgramStatus>("select_musescore_program"),
  resetMuseScoreProgram: () => invoke<import("./engine/commands.generated").MuseScoreProgramStatus>("reset_musescore_program"),
  audiverisProgramStatus: () =>
    invoke<AudiverisProgramStatus>("audiveris_program_status"),
  selectAudiverisProgram: () =>
    invoke<AudiverisProgramStatus>("select_audiveris_program"),
  resetAudiverisProgram: () =>
    invoke<AudiverisProgramStatus>("reset_audiveris_program"),
  recognizePaperWithAudiveris: (contentId: string, bookId: string, expectedPages: { id: string; kind: string }[], preparedPdf?: Uint8Array) =>
    invoke<import("./engine/commands.generated").ScoreDraft>("recognize_paper_with_audiveris", { contentId, bookId, expectedPages, preparedPdf: preparedPdf ? Array.from(preparedPdf) : null, preparedPdfSession: null, job: null }),
  saveRecognizedScoreForEdit: (contentId: string, name: string, bytes: number[] | Uint8Array, previewToken: string) =>
    invoke<import("./engine/commands.generated").DraftSaved | null>("save_recognized_score_for_edit", {
      contentId, name, bytes: bytes instanceof Uint8Array ? Array.from(bytes) : bytes, previewToken,
    }),
  saveGeneratedScoreForEdit: (contentId: string, name: string, bytes: number[] | Uint8Array, previewToken: string) =>
    invoke<import("./engine/commands.generated").DraftSaved | null>("save_generated_score_for_edit", {
      contentId,
      name,
      bytes: bytes instanceof Uint8Array ? Array.from(bytes) : bytes,
      previewToken,
    }),
  exportPaperPage: (name: string, bytes: Uint8Array, options: PaperSaveOptions = {}) => savePaperFile("png", name, bytes, options),
  exportPaperBook: (name: string, bytes: Uint8Array, options: PaperSaveOptions = {}) => savePaperFile("pdf", name, bytes, options),
  exportAnnotatedScore: (request: Extract<EngineCommand, { type: "exportAnnotatedScore" }>) =>
    invoke<string | null>("export_annotated_score", { request }),
  pickPracticeBackup: () =>
    invoke<import("./features/backups/backupTypes").BackupSummary | null>("pick_practice_backup"),
  exportPracticeBackup: (selection: {
    plans: boolean;
    records: boolean;
    presets: boolean;
    days: number;
  }) => invoke<string | null>("export_practice_backup", { selection }),
  downloadPracticeBackup: async (selection: {plans:boolean;records:boolean;presets:boolean;days:number}, options:{signal?:AbortSignal;progress?:(text:string)=>void}={}):Promise<Blob> => {
    const check=()=>{if(options.signal?.aborted)throw new DOMException("备份读取已停止，原资料保留。","AbortError");};
    check();options.progress?.("正在准备练习资料备份…");
    if(isTauri()) {
      const {session,size}=await invoke<{session:string;size:number}>("begin_practice_backup_read",{selection});
      try {
        check();
        if(!Number.isSafeInteger(size)||size<=0||size>256_000_000)throw new Error("练习备份大小无效，最大支持 256 MB");
        const chunks:BlobPart[]=[];
        for(let offset=0;offset<size;offset+=1_048_576){
          check();const length=Math.min(1_048_576,size-offset);
          const bytes=await invoke<number[]>("read_practice_backup_chunk",{session,offset,length});
          check();if(bytes.length!==length)throw new Error("练习备份分块不完整");
          chunks.push(new Uint8Array(bytes));options.progress?.(`正在读取练习备份 ${Math.round((offset+length)/size*100)}%`);
        }
        await invoke("finish_practice_backup_read",{session});check();
        return new Blob(chunks,{type:"application/octet-stream"});
      }catch(error){await invoke("cancel_practice_backup_transfer",{session}).catch(()=>{});throw error;}
    }
    const timeout=AbortSignal.timeout(120000);
    const response=await fetch(service+"/api/practice-backup/export",{method:"POST",headers:{"X-Panthesia-Client":"web","Content-Type":"application/json"},body:JSON.stringify(selection),signal:options.signal?AbortSignal.any([options.signal,timeout]):timeout});
    if(!response.ok){const value=await response.json();throw new Error(value.error||"备份导出失败");}
    const blob=await response.blob();check();
    if(!blob.size||blob.size>256_000_000)throw new Error("练习备份大小无效");
    return blob;
  },
  stagePracticeBackup: async (file:File,options:{signal?:AbortSignal;progress?:(text:string)=>void}={}):Promise<import("./features/backups/backupTypes").BackupSummary> => {
    if(!file.size||file.size>256_000_000)throw new Error("练习备份为空或超过 256 MB");
    const check=()=>{if(options.signal?.aborted)throw new DOMException("备份预览已停止，原文件和原预览保留。","AbortError");};
    check();
    if(isTauri()) {
      const session=await invoke<string>("begin_practice_backup_stage",{size:file.size});
      try {
        for(let offset=0;offset<file.size;offset+=1_048_576){
          check();const bytes=Array.from(new Uint8Array(await file.slice(offset,offset+1_048_576).arrayBuffer()));check();
          await invoke("write_practice_backup_chunk",{session,offset,bytes});
          options.progress?.(`正在传输练习备份 ${Math.round(Math.min(file.size,offset+1_048_576)/file.size*100)}%`);
        }
        check();options.progress?.("正在核对备份内容与本机资料…");
        const value=await invoke<import("./features/backups/backupTypes").BackupSummary>("finish_practice_backup_stage",{session});check();return value;
      }catch(error){await invoke("cancel_practice_backup_transfer",{session}).catch(()=>{});throw error;}
    }
    const timeout=AbortSignal.timeout(120000);
    const response=await fetch(service+"/api/practice-backup/stage",{method:"POST",headers:{"X-Panthesia-Client":"web"},body:file,signal:options.signal?AbortSignal.any([options.signal,timeout]):timeout});
    const value=await response.json();check();if(!response.ok)throw new Error(value.error||"备份预览失败");return value;
  },
  pickPackage: () => invoke<import("./engine/commands.generated").PackagePreview | null>("pick_package"),
  stagePackage: async (file: File, options: { signal?: AbortSignal; progress?: (percent: number) => void } = {}): Promise<import("./engine/commands.generated").PackagePreview> => {
    if (!file.size || file.size > 256_000_000) throw new Error("曲目包为空或超过 256 MB");
    const check = () => { if (options.signal?.aborted) throw new DOMException("曲目包传输已取消，原文件保留", "AbortError"); };
    check();
    if (isTauri()) {
      const engine = await api.state();
      if (!engine.packageImportVersion) return invoke<import("./engine/commands.generated").PackagePreview>("stage_package", {
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      });
      const session = await invoke<string>("begin_package_stage", { size: file.size });
      try {
        for (let offset = 0; offset < file.size; offset += 1_048_576) {
          check();
          const bytes = Array.from(new Uint8Array(await file.slice(offset, offset + 1_048_576).arrayBuffer()));
          await invoke("write_package_stage_chunk", { session, offset, bytes });
          options.progress?.(Math.min(100, Math.round((offset + bytes.length) / file.size * 100)));
        }
        check();
        const result = await invoke<import("./engine/commands.generated").PackagePreview>("finish_package_stage", { session });
        check();
        return result;
      } catch (failure) {
        await invoke("cancel_package_stage", { session }).catch(() => {});
        throw failure;
      }
    }
    const r = await fetch(service + "/api/package/stage", {
      method: "POST",
      headers: { "X-Panthesia-Client": "web" },
      body: file,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    });
    const v = await r.json();
    if (!r.ok) throw new Error(v.error || "曲目包预览失败");
    check();
    options.progress?.(100);
    return v as import("./engine/commands.generated").PackagePreview;
  },
  downloadPackage: async (contentId?: string, signal?: AbortSignal): Promise<Blob> => {
    if (contentId && (await api.state()).contentId !== contentId) throw new Error("曲目已切换，请返回来源曲目后重新导出。");
    const timeout = AbortSignal.timeout(120000);
    const r = await fetch(service + "/api/package/export", {
      method: "POST",
      headers: { "X-Panthesia-Client": "web", "Content-Type": "application/json" },
      body: JSON.stringify({contentId}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!r.ok) {
      const v = await r.json();
      throw new Error(v.error || "曲目包导出失败");
    }
    const blob = await r.blob();
    const prefix = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (blob.size < 22 || blob.size > 256_000_000 || prefix[0] !== 0x50 || prefix[1] !== 0x4b) throw new Error("导出结果不是有效的曲目包，请重新读取当前曲目。");
    if (contentId && (await api.state()).contentId !== contentId) throw new Error("制作期间曲目已切换，请返回来源曲目后重新导出。");
    return blob;
  },
  exportPackage: () => invoke<string | null>("export_package"),
  import: () => invoke<LoadedSong | null>("import_midi"),
  pickMusic: () => invoke<{ path: string; title: string; kind: "midi" | "score" } | null>("import_midi", { chooseOnly: true }),
};
export { pitchName, clock } from "./engine/musicFormatting";
