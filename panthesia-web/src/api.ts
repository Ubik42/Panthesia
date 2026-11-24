import { reportDiagnostic } from "./lib/diagnostics";

import { readDesktopBuildReport, type DesktopBuildReport } from "./engine/buildIdentity";
import { readDeviceSnapshot, type DeviceScanTarget } from "./engine/deviceCatalog";
export type { DeviceSnapshot, DeviceScanTarget, DeviceScanStatus } from "./engine/deviceCatalog";
import type { PlaybackAdjustmentCommand, PlaybackAdjustmentSource } from "./features/practice/playbackCommands";
export type { PlaybackAdjustmentCommand, PlaybackAdjustmentSource } from "./features/practice/playbackCommands";
import type { ScoreMappingRequest, ScoreMappingResult } from "./features/scores/mappingTypes";
import type { ScoreSource, ScoreSourcePreview, SourceApplyMode, AppliedSource } from "./features/scores/sourceTypes";
import { invoke as nativeInvoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EngineCommand } from "./engine/commands.generated";
export type { EngineCommand } from "./engine/commands.generated";

export * from "./engine/sessionTypes";
import type { PracticeEditCommand, PracticeDemoCommand, PracticeReadCommand, PracticeEditScope, Note, TrackSound, SoundFontStatus, AudiverisProgramStatus, MeterMapSegment, MeterMap, MeterMapPreview, LoadedSong, LiveNoteEvent, LiveNoteReceipt, StorageStatus, Snapshot, EngineSession } from "./engine/sessionTypes";
import { emptyState } from "./engine/sessionTypes";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await nativeInvoke<T>(command, args); }
  catch(error) { reportDiagnostic(command,error); throw error; }
}
const historyReadCommands = new Set<EngineCommand["type"]>(["practiceTime"]);
const controlCommands = new Set<EngineCommand["type"]>(["panic", "pause", "note", "startInstrumentPreview", "stopSongAudition", "songAuditionState", "stopFingerDemo", "fingerDemoState", "tasks", "cancelTask", "cancelHistoryRead", "skipStartupSong", "retryStartup", "dismissStartupWarning"]);

let sessionReadSequence = 0;
const service = "http://127.0.0.1:32124";
/** The browser debug transport: the local engine service. Control requests use a reserved lane
 * with a short timeout; everything else may run long (score work, file preparation). */
async function local<T>(path: string, body?: unknown, timeout = 125000, keepalive = false): Promise<T> {
  const response = await fetch(service + path, {
    cache: "no-store", keepalive,
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Panthesia-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "本地音乐引擎请求失败");
  return data as T;
}
/** One request: a Tauri command on the desktop, the matching service path in the browser. */
function call<T>(nativeCommand: string, path: string, body: unknown, timeout?: number, keepalive = false): Promise<T> {
  return isTauri() ? invoke<T>(nativeCommand, { request: body }) : local<T>(path, body, timeout, keepalive);
}
function engineCommand<T = { ok: boolean }>(command: EngineCommand): Promise<T> {
  if (historyReadCommands.has(command.type)) return call<T>("read_history", "/api/history-read", command);
  if (isTauri()) return invoke<T>("engine_command", { command });
  return controlCommands.has(command.type) ? local<T>("/api/control", command, 3500) : local<T>("/api/command", command);
}
async function practiceRequest<T>(mode: "edit" | "read" | "demo", song: PracticeEditScope,
  command: PracticeEditCommand | PracticeReadCommand | PracticeDemoCommand, requestId?: string, catalogRevision?: string): Promise<T> {
  const body = { command, engineId: song.engineId ?? undefined, contentId: song.contentId, scoreRevision: song.scoreRevision, annotationRevision: song.annotationRevision ?? 0, requestId, catalogRevision };
  return call<T>(mode === "edit" ? "edit_practice" : mode === "demo" ? "start_practice_demo" : "read_practice", `/api/practice-${mode}`, body);
}

/** Desktop: listen to a pushed event and read the current value once (the first push may
 * precede the listener). Browser: long-poll `<path>?after=N` for `{revision, <field>}`. */
function subscribe<T>(event: string, current: () => Promise<T>, path: string, field: string,
  onValue: (value: T) => void, onError: (failure: unknown) => void): () => void {
  let stopped = false;
  if (isTauri()) {
    let release: (() => void) | undefined;
    listen<T>(event, (message) => { if (!stopped) onValue(message.payload); })
      .then((unlisten) => { if (stopped) unlisten(); else release = unlisten; })
      .catch(onError);
    current().then((value) => { if (!stopped) onValue(value); }, onError);
    return () => { stopped = true; release?.(); };
  }
  void (async () => {
    let revision = 0, failures = 0;
    while (!stopped) {
      try {
        const next = await local<Record<string, unknown> & { revision: number }>(`${path}?after=${revision}`, undefined, 30000);
        failures = 0;
        revision = next.revision;
        if (!stopped) onValue(next[field] as T);
      } catch (failure) {
        if (stopped) return;
        onError(failure);
        revision = 0;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * 2 ** failures++)));
      }
    }
  })();
  return () => { stopped = true; };
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
  /** Files handed over by the command line, a second launch or a native drop. Empty outside the desktop. */
  /** Files handed over by Explorer, Keel, the command line or a drop; `play` (`--play`) goes
   * straight to the stage. */
  takeOpenRequests: async (): Promise<{ path: string; play: boolean }[]> => isTauri() ? invoke<{ path: string; play: boolean }[]>("take_open_requests") : [],
  pickSongFile: async (kind: "music" | "performance" | "audio" | "paper" | "score" | "tool", near?: string): Promise<string | null> =>
    isTauri() ? invoke<string | null>("pick_song_file", { kind, near: near ?? null }) : null,
  pickFolder: async (title: string): Promise<string | null> => (isTauri() ? invoke<string | null>("pick_folder", { title }) : null),
  /** Show a file in the system file manager (desktop only). */
  revealFile: async (path: string): Promise<void> => { if (isTauri()) await invoke<void>("reveal_library_file", { path }); },
  desktopBuildInfo: async (): Promise<DesktopBuildReport | null> => isTauri() ? readDesktopBuildReport(await invoke<unknown>("desktop_build_info")) : null,
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
  readNotation:<T>(request:import("./features/scores/notationReadTypes").NotationReadRequest):Promise<T>=>call("read_notation","/api/notation-read",request,60000,request.type==="release"),
  notationDocument: (bytes:number[]):Promise<number[]> => call("notation_document","/api/notation-document",{bytes},30000),
  mapScore: (request: ScoreMappingRequest): Promise<ScoreMappingResult> => call("map_score", "/api/score-map", request),
  openDataFolder: () => invoke<void>("open_practice_data_folder"),
  session: async (): Promise<EngineSession> => {
    const readSequence = ++sessionReadSequence;
    const session = isTauri() ? await invoke<EngineSession>("engine_command", { command: { type: "session" } }) : await local<EngineSession>("/api/session");
    return { ...session, readSequence };
  },
  currentSessionRead: (session: EngineSession) => session.readSequence === undefined || session.readSequence === sessionReadSequence,
  desktop: isTauri(),
  soundfontStatus: () => invoke<SoundFontStatus>("get_soundfont_status"),
  selectSoundfont: () => invoke<SoundFontStatus | null>("select_soundfont"),
  resetSoundfont: () => invoke<SoundFontStatus>("reset_soundfont"),
  state: () =>
    isTauri() ? invoke<Snapshot>("engine_state") : local<Snapshot>("/api/state"),
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
    return call("play_live_notes", "/api/live-notes", { epoch, engineId, createdAtMs, events }, 3500);
  },
  /** The background task list whenever it changes; same transport as `subscribeState`. */
  subscribeTasks: (onTasks: (tasks: unknown) => void, onError: (failure: unknown) => void): (() => void) =>
    subscribe<unknown>("engine-tasks", () => engineCommand<unknown>({ type: "tasks" }), "/api/tasks/next", "tasks", onTasks, onError),
  /** Every state the engine publishes, in order: pushed events on the desktop, a long poll
   * in the browser. Returns the unsubscribe function. */
  subscribeState: (onState: (state: Snapshot) => void, onError: (failure: unknown) => void): (() => void) =>
    subscribe<Snapshot>("engine-state", () => invoke<Snapshot>("engine_state"), "/api/state/next", "state", onState, onError),

  song: () =>
    isTauri()
      ? invoke<LoadedSong | null>("engine_song")
      : local<LoadedSong | null>("/api/song"),
  devices: async (refresh = false, target: DeviceScanTarget = "all") => readDeviceSnapshot(await (isTauri()
    ? invoke<unknown>("midi_devices", { refresh, target: refresh ? target : undefined })
    : refresh ? local<unknown>("/api/devices/refresh", { refresh: true, target }, 3000) : local<unknown>("/api/devices"))),
  command: engineCommand,
  adjustPlayback: (source: PlaybackAdjustmentSource, command: PlaybackAdjustmentCommand, createdAtMs = Date.now()): Promise<{ok: boolean}> => source.stateOrder
    ? call("adjust_playback", "/api/playback-adjustment", {
        engineId: source.stateOrder.engineId, contentId: source.contentId, createdAtMs,
        scoreRevision: source.scoreRevision ?? 0, command,
      })
    : engineCommand(command),
  commandForEngine: <T = { ok: boolean }>(engineId: string | undefined, command: EngineCommand): Promise<T> => engineId
    ? call<T>("engine_scoped_command", controlCommands.has(command.type) ? "/api/control-scoped" : historyReadCommands.has(command.type) ? "/api/history-read-scoped" : "/api/command-scoped", { engineId, command }, controlCommands.has(command.type) ? 3500 : 125000)
    : engineCommand<T>(command),
  adjustForSong: (song: PracticeEditScope, command: PlaybackAdjustmentCommand): Promise<{ok: boolean}> => song.engineId
    ? call("adjust_playback", "/api/playback-adjustment", { engineId: song.engineId, contentId: song.contentId, scoreRevision: song.scoreRevision, createdAtMs: Date.now(), command })
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
};
export { pitchName, clock } from "./engine/musicFormatting";
