import { product } from "./product.generated";
import { SongCredits } from "./features/practice/SongCredits";
import { SongBrowser } from "./features/library/SongBrowser";
import { ApplicationMenu } from "./app/ApplicationMenu";
import { PracticeQueueStrip } from "./features/practice/PracticeQueueStrip";
import { PracticeLibraryPanel } from "./features/practice/PracticeLibraryPanel";
import { practiceCollectionByPath, collectionSongRow, type PracticeLibraryItem } from "./features/practice/practiceLibraryModel";
import { useLibraryOpening } from "./features/library/useLibraryOpening";
import { LibraryOpenRecovery } from "./features/library/LibraryOpenRecovery";
import { checkLibraryPrepared, sourceForLibraryRow, sourceForLibraryScore } from "./features/library/libraryOpenStore";
import { getInterfaceWorkbench, hasLayoutNameInput } from "./features/settings/interfaceWorkbenchStore";
import { getInterfaceSettings } from "./features/settings/interfaceSettingsStore";
import { requireHistoryScoreTarget, requireHistorySource } from "./features/review/historySource";
import { getHistoryOperations } from "./features/review/historyOperationStore";
import { performRecoveryAction, type RecoveryHost } from "./app/recovery/recoveryActions";
import { SessionRecoveryButton, SessionRecoveryDialog } from "./app/recovery/SessionRecovery";
import { createSessionRecoveryStore } from "./app/recovery/sessionRecoveryStore";
import type { RecoveryAction, RecoveryIssue } from "./app/recovery/sessionRecoveryModel";
import type { ScoreToolRequest } from "./features/scores/scoreToolRequest";
import { WorkProgressButton, WorkProgressDialog } from "./features/activity/WorkProgress";
import type { WorkEntry } from "./features/activity/workProgressStore";
import type { MediaExportKind } from "./engine/commands.generated";
import { capturePlaybackSource, isPlaybackAdjustment, samePlaybackSource } from "./features/practice/playbackCommands";
import { PracticeReturnBar } from "./app/PracticeReturnBar";
import { CurrentPracticeBar } from "./app/CurrentPracticeBar";
import { AboutDialog } from "./app/AboutDialog";
import { type LibraryOpenLocation } from "./features/library/libraryOpen";
import { useDialogFocus } from "./app/useDialogFocus";
import type { LibrarySearchRequest } from "./features/library/libraryBrowse";
import type { SongWorkspaceRequest, SongWorkspaceTarget } from "./app/songWorkspaceVisit";
import { ActionSearch } from "./app/ActionSearch";
import { applicationCommands, type ApplicationCommandId } from "./app/applicationCommands";
import { PlaybackView } from "./features/practice/PlaybackView";
import { PracticeWelcome } from "./features/practice/PracticeWelcome";
import { PracticeLegend } from "./features/practice/PracticeLegend";
import { EditDraftButton, EditDraftCenter } from "./features/editing/EditDraftCenter";
import { useWorkspaceSessions } from "./app/useWorkspaceSessions";
import { DesktopCloseProgress } from "./app/DesktopCloseProgress";
import { ImportQueueButton, ImportQueueNotice } from "./features/imports/ImportQueueButton";
import { PreparationButton } from "./app/PreparationButton";
import {ScoreWorkspaceButton} from "./features/scores/ScoreWorkspaceButton";
import {SongEditionBar} from "./features/practice/SongEditionBar";
import { WorkspaceBrowseRecovery } from "./app/WorkspaceBrowseRecovery";
import { PracticeVariantPanel } from "./features/practice/PracticeVariantPanel";
import { PianoEffectsSettings } from "./features/settings/PianoEffectsSettings";
import { isCapturingKeys, isComposingKey, isTextEntry, isVisibleInput, topInputScope, topPopup, visibleDialogs } from "./app/inputOwnership";
import { libraryResumeContext, historyResumeContext } from "./app/workspaceResumeContext";
import { SessionStatus } from "./app/SessionStatus";
import { StartupNotice } from "./app/StartupNotice";
import { TaskActivity } from "./engine/TaskActivity";
import {
  PracticeStageReadout,
  PracticeResultStrip,
  PracticeSetupSummary,
  PracticePedal,
  RecordingLabel,
} from "./features/practice/PracticeReadouts";
import { useLiveNotes } from "./features/practice/useLiveNotes";
import { usePracticeSession } from "./features/practice/usePracticeSession";
import { usePracticePanels } from "./features/practice/usePracticePanels";
import { PracticeTransport } from "./features/practice/PracticeTransport";
import { PracticeInspector, type PracticeInspectorTool } from "./features/practice/PracticeInspector";
import { activeMeasures, nextAvailableQueueSong, seekableMeasures } from "./features/practice/practicePresentation";
import {
  useWorkspaceNavigation,
  type Workspace,
} from "./app/useWorkspaceNavigation";
import { DeviceSettingsDialog } from "./features/devices/DeviceSettingsDialog";
import { WorkspaceTools } from "./app/WorkspaceTools";
import { ToolbarMore } from "./app/ToolbarMore";
import { WorkspaceNavigation } from "./app/WorkspaceNavigation";
import { requireValue } from "./engine/requireValue";
import { eventShortcut, shortcutActions, shortcutLabel } from "./shortcuts";
import { PanelResizeHandle } from "./PanelResizeHandle";
import type {
  HistoryScoreFocus,
  HistoryScoreReview,
} from "./historyScoreFocus";
import { DisplaySettingsDialog } from "./DisplaySettingsDialog";
import {
  keyboardMap,
  codeLabel,
} from "./displayPreferences";
import { PracticeBackupDialog } from "./PracticeBackupDialog";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  History,
  Info,
  KeyboardMusic,
  ListMusic,
  Maximize2,
  Menu,
  Music2,
  RotateCcw,
  Search,
  Settings2,
  Star,
  X,
} from "lucide-react";
import {
  api,
  clock,
  pitchName,
  type EngineCommand,
  type PlaybackAdjustmentCommand,
  type PlaybackAdjustmentSource,
  type LoadedSong,
  type CollectionSong,
  type Snapshot,
  type SongRow,
} from "./api";
import { Notation } from "./Notation";
import { FingeringDialog } from "./FingeringDialog";
import { FingeringWorkbench, FingeringWorkbenchButton } from "./features/fingering/FingeringWorkbench";
import { fingeringDraftId } from "./features/fingering/fingeringWorkbenchStore";
import { LegacyExerciseTracksDialog } from "./LegacyExerciseTracksDialog";
import { PackageDialog } from "./PackageDialog";
import {MediaExportDialog} from "./features/exports/MediaExportDialog";
import {MediaExportButton} from "./features/exports/MediaExportButton";
import type {MediaExportSource} from "./features/exports/mediaExportStore";
import { ImportDialog } from "./ImportDialog";
import { LibraryDialog } from "./LibraryDialog";
import { ScoresDialog } from "./ScoresDialog";
import { ScoreRangeDialog } from "./ScoreRangeDialog";
import { PaperScore } from "./PaperScore";
import { MeterDialog } from "./MeterDialog";
import { HandsDialog } from "./HandsDialog";
import { RoutineDialog, RoutineStatus } from "./RoutineDialog";
import { LadderDialog, LadderStatus } from "./LadderDialog";
import { PassageDialog } from "./PassageDialog";
import { LiveBarNavigator } from "./BarNavigator";
import { usePracticeRange } from "./features/practice/usePracticeRange";
import { PracticeTimeline } from "./features/practice/PracticeTimeline";
import { Piano } from "./Piano";
import {
  ExerciseDialog,
  FeedbackDialog,
  MetadataDialog,
  type FeedbackPlanSource,
  type MeasurePartFeedback,
} from "./PracticeDialogs";
import { HistoryProblemPlan } from "./HistoryProblemPlan";
import { HistoryDialog, type HistoryPaperTarget } from "./HistoryDialog";
import { SongExpressionEditor } from "./features/practice/SongExpressionEditor";
import { matchesSong } from "./engine/stateOrder";
const normalize = (path: string | null | undefined) =>
  (path || "").replaceAll("\\", "/").toLowerCase();

export default function App() {
  const releaseInput = useRef<() => void>(() => {});
  const inputOwnership = useDialogFocus(() => releaseInput.current());
  const workspaceSessions = useWorkspaceSessions();
  const navigation = useWorkspaceNavigation({
    initialReturn: workspaceSessions.browse.initialReturn(),
    rememberReturn: workspaceSessions.browse.rememberReturn,
  });
  const { workspace } = navigation;
  const [libraryAdvanced,setLibraryAdvanced]=useState(false);
  const libraryDialog = workspace === "library",
    history = workspace === "review";
  const setLibraryDialog = (open: boolean) =>
    open ? navigation.navigate("library") : navigation.closeLibrary();
  const setHistory = (open: boolean) =>
    open ? navigation.navigate("review") : navigation.closeReview();
  const interfaceSettings = getInterfaceSettings();
  const display = useSyncExternalStore(
    interfaceSettings.subscribe,
    interfaceSettings.getPreferences,
  );
  const setDisplay = interfaceSettings.setPreferences;
  const [displayDialog, setDisplayDialog] = useState(false);
  useEffect(() => {
    document.documentElement.style.zoom = String(display.uiScale / 100);
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(display.uiScale / 100),
    );
    return () => {
      document.documentElement.style.zoom = "";
      document.documentElement.style.removeProperty("--ui-scale");
    };
  }, [display.uiScale]);
  const panels = usePracticePanels(display, setDisplay);
  const { libraryOpen, inspector, setLibraryOpen, setInspector, inspectorTab, setInspectorTab } = panels;
  const panelActions = useRef({ libraryOpen, inspector, setLibraryOpen, setInspector });
  panelActions.current = { libraryOpen, inspector, setLibraryOpen, setInspector };
  const wideKeys = display.range === 88,
    seconds = display.previewBars;
  const setWideKeys = (value: boolean) =>
    setDisplay((previous) => ({ ...previous, range: value ? 88 : 49 }));
  const setSeconds = (value: number) =>
    setDisplay((previous) => ({ ...previous, previewBars: value }));
  const {
    playback,
    getBoundSong,
    state,
    setState,
    songs,
    song,
    collection,
    libraryReady,
    libraryProblem,
    refreshSession,
    refreshConfirmedSession,
    refreshOpenedSession,
    installSession,
    binding,
    reading,
    refreshWithCollection,
    refreshEdits,
    readCollection,
    connected,
    health,
    refreshProblem,
    error,
    setError,
    refreshOrThrow,
    refresh,
    updateCollection,
    refreshLibrary,
  } = usePracticeSession();
  const songOpeningActive = useRef(false);
  const { onNote, pointerNote, clear: clearLiveNotes } = useLiveNotes(playback, connected && !binding && !workspaceSessions.desktopClose.status, setError,
    () => !songOpeningActive.current && !document.hidden && !topInputScope() && !topPopup(null));
  const importingName = useSyncExternalStore(
    workspaceSessions.imports.subscribe,
    () => {
      const queue = workspaceSessions.imports.getSnapshot();
      return queue.busy
        ? (queue.items.find((item) => item.state === "working" && item.receipt && !item.receipt.catalogOnly)?.source.name ??
            "")
        : "";
    },
  );
  const [sessionRecovery] = useState(() => createSessionRecoveryStore(health, workspaceSessions.workProgress));
  const startupReady = state.startup?.ready ?? true;
  const [requestPending, setBusy] = useState(false);
  const [scoreToolRequest, setScoreToolRequest] = useState<ScoreToolRequest | null>(null);
  const clearScoreToolRequest = useCallback(() => setScoreToolRequest(null), []);
  const progressEngineId = useSyncExternalStore(playback.subscribe, playback.getEngineId, playback.getEngineId);
  useEffect(() => {
    workspaceSessions.workProgress.setContext({ engineId: progressEngineId, connected, closing: !!workspaceSessions.desktopClose.status });
  }, [workspaceSessions.workProgress, progressEngineId, connected, !!workspaceSessions.desktopClose.status]);
  const operationBusy = !!workspaceSessions.desktopClose.status || requestPending || Boolean(state.storage?.operation) || Boolean(state.storage?.error && !state.storage.canRetry);
  const busy = operationBusy || binding;
  useEffect(() => {
    sessionRecovery.setContext({ engineId: progressEngineId, connected, binding, reading, busy: operationBusy, commandPending: requestPending, closing: !!workspaceSessions.desktopClose.status, title: song?.title, path: song?.sourcePath, state });
  }, [sessionRecovery, progressEngineId, connected, binding, reading, operationBusy, requestPending, !!workspaceSessions.desktopClose.status, song?.title, song?.sourcePath, state]);
  const [practiceLibraryBrowse, setPracticeLibraryBrowse] = useState(workspaceSessions.browse.initialPractice);
  const [practiceLibraryScroll] = useState(() => {
    const saved = workspaceSessions.browse.initialPracticeScroll();
    return new Map<string, number>(saved ? [[saved.key, saved.top]] : []);
  });
  useEffect(() => {
    workspaceSessions.browse.rememberPractice(practiceLibraryBrowse);
  }, [practiceLibraryBrowse, workspaceSessions.browse]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState<LibrarySearchRequest | null>(null);
  const [historySongRequest, setHistorySongRequest] = useState<SongWorkspaceRequest | null>(null);
  const [annotationDraftRequest, setAnnotationDraftRequest] = useState<{ id: string; entry: import("./features/review/historyTypes").HistoryEntry } | null>(null);
  const [replayDraftRequest, setReplayDraftRequest] = useState<{ id: string; entry: import("./features/review/historyTypes").HistoryEntry } | null>(null);
  const [editDraftsOpen, setEditDraftsOpen] = useState(false);
  const [metadataDraftPath, setMetadataDraftPath] = useState<string | null>(null);
  const [expressionReveal, setExpressionReveal] = useState<{ contentId: string; id: string } | null>(null);
  const [recentCommands, setRecentCommands] = useState<ApplicationCommandId[]>([]);
  const [settingsTab,setSettingsTab]=useState<"sound"|"duet">("sound");
  const [settingsReturnToScores,setSettingsReturnToScores]=useState(false);
  const [settings, setSettings] = useState(false),
    [view, setView] = useState("score"),
    [editFingers, setEditFingers] = useState(false),
    [selectedNote, setSelectedNote] = useState<
      LoadedSong["notes"][number] | null
    >(null),
    [exerciseDialog, setExerciseDialog] = useState(false),
    [feedback, setFeedback] = useState(false),
    [feedbackPlan, setFeedbackPlan] = useState<{
      source: FeedbackPlanSource;
      scoreRevision: number;
    } | null>(null),
    [metadata, setMetadata] = useState(false),
    [fingeringDialog, setFingeringDialog] = useState(false),
    [fingeringWorkbenchOpen, setFingeringWorkbenchOpen] = useState(false),
    [fingeringDraft, setFingeringDraft] = useState<import("./features/fingering/fingeringWorkbenchStore").FingeringDraft | null>(null),
    [legacyExerciseDialog, setLegacyExerciseDialog] = useState(false),
    [libraryLaunch, setLibraryLaunch] = useState<
      "normal" | "missing" | "review"
    >("normal"),
    [libraryScoreRange, setLibraryScoreRange] = useState<{
      song: LoadedSong;
      first: number;
      last: number;
    } | null>(null),
    [passageDialog, setPassageDialog] = useState(false),
    [ladderDialog, setLadderDialog] = useState(false),
    [routineDialog, setRoutineDialog] = useState(false),
    [routineSuspended, setRoutineSuspended] = useState(false),
    [routineResumeRevision, setRoutineResumeRevision] = useState(0),
    [routineLaunch, setRoutineLaunch] = useState<{
      id: string;
      day: string | null;
    } | null>(null),
    [routinePassage, setRoutinePassage] = useState<{
      contentId: string;
      id: string;
      name: string;
      notes: string;
    } | null>(null),
    [practiceBackup, setPracticeBackup] = useState(false),
    [progressOpen, setProgressOpen] = useState(false),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [handsDialog, setHandsDialog] = useState(false),
    [meterDialog, setMeterDialog] = useState(false),
    [scoresDialog, setScoresDialog] = useState(false),
    [paperRevision, setPaperRevision] = useState(0),
    [importDialog, setImportDialog] = useState(false),
    [packageDialog, setPackageDialog] = useState(false),
    [mediaExport, setMediaExport] = useState<(MediaExportSource & { kind?: MediaExportKind }) | null>(null),
    [packageFile, setPackageFile] = useState<File | undefined>(),
    [droppedFiles, setDroppedFiles] = useState<File[]>([]),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!scoreToolRequest) return;
    const actual = playback.getSnapshot();
    if (workspace !== "practice" || view !== "score" || actual.mode === "memory" || actual.contentId !== scoreToolRequest.contentId || actual.stateOrder?.engineId !== scoreToolRequest.engineId) setScoreToolRequest(null);
  }, [scoreToolRequest, workspace, view, state.contentId, progressEngineId, state.mode, playback]);
  const showRoutine = useCallback(() => {
    setRoutineSuspended(false);
    setRoutineResumeRevision((revision) => revision + 1);
    setRoutineDialog(true);
  }, []);
  const selectionSong = useRef(song?.contentId ?? null);
  useEffect(() => {
    const previousSong = selectionSong.current;
    selectionSong.current = song?.contentId ?? null;
    setSelectedNote(previous => {
      if (!previous || !song) return null;
      // History navigation can install a new song and select its note in one action.
      if (song.notes.includes(previous)) return previous;
      if (previousSong !== song.contentId) return null;
      return song.notes.find(note => note.track === previous.track && note.index === previous.index
        && note.pitch === previous.pitch && Math.abs(note.start - previous.start) < 0.000001
        && Math.abs(note.duration - previous.duration) < 0.000001) ?? null;
    });
  }, [song?.contentId, song?.scoreRevision, song?.annotationRevision, song?.notes]);
  useEffect(() => {
    if (!routineDialog) setRoutinePassage(null);
  }, [routineDialog]);
  const [historyScoreReview, setHistoryScoreReview] =
    useState<HistoryScoreReview | null>(null);
  const historyPresentation = useRef({ review: historyScoreReview, workspace, view });
  historyPresentation.current = { review: historyScoreReview, workspace, view };
  useEffect(() => { if (!fingeringDialog) setFingeringDraft(null); }, [fingeringDialog]);
  const [historyScoreFocus, setHistoryScoreFocus] =
    useState<HistoryScoreFocus | null>(null);
  const [historyPaperFocus, setHistoryPaperFocus] = useState<
    (HistoryPaperTarget & { request: string }) | null
  >(null);
  useEffect(() => {
    if (historyScoreFocus && song?.contentId !== historyScoreFocus.contentId)
      setHistoryScoreFocus(null);
  }, [song?.contentId, historyScoreFocus]);
  useEffect(() => {
    if (historyScoreReview && song?.contentId !== historyScoreReview.contentId)
      setHistoryScoreReview(null);
  }, [song?.contentId, historyScoreReview]);
  useEffect(() => {
    if (feedbackPlan && song?.contentId !== feedbackPlan.source.contentId)
      setFeedbackPlan(null);
  }, [song?.contentId, feedbackPlan]);
  useEffect(() => {
    if (historyPaperFocus && song?.contentId !== historyPaperFocus.contentId)
      setHistoryPaperFocus(null);
  }, [song?.contentId, historyPaperFocus]);
  useEffect(() => {
    if (view !== "paper" && historyPaperFocus) setHistoryPaperFocus(null);
  }, [view, historyPaperFocus]);
  const recital = ["recital", "memory"].includes(state.mode);
  const ladderActive = Boolean(state.ladder?.active);
  const routineActive = Boolean(state.routine);
  const attemptLocked =
    routineActive ||
    ladderActive ||
    (recital && ["playing", "paused", "countIn"].includes(state.status));
  const completionShown = useRef(false);
  const completionBlocked = !!workspaceSessions.desktopClose.status || requestPending || aboutOpen || commandsOpen || progressOpen || recoveryOpen || workspace !== "practice" || settings || displayDialog ||
    exerciseDialog || metadata || fingeringDialog || passageDialog || ladderDialog || routineDialog ||
    practiceBackup || handsDialog || meterDialog || scoresDialog || importDialog || packageDialog || !!mediaExport;
  useEffect(() => {
    const finished = recital && state.status === "finished";
    const preparing = state.storage?.operation === "round" || state.songExpressionGoalState === "pending";
    if (finished && preparing) {
      if (completionBlocked) completionShown.current = true;
      return;
    }
    if (finished && !completionShown.current && !completionBlocked) setFeedback(true);
    // The result remains in the practice summary. Do not interrupt an explicit
    // search, edit or navigation with a deferred completion dialog.
    completionShown.current = finished;
  }, [recital, state.status, state.storage?.operation, state.songExpressionGoalState, completionBlocked]);
  useEffect(() => {
    if (state.mode === "memory") {
      setSelectedNote(null);
      setEditFingers(false);
    }
  }, [state.mode]);
  const [loopStart, setLoopStart] = useState(1),
    [loopEnd, setLoopEnd] = useState(0);
  const practiceRange=usePracticeRange(song,playback);
  const scoreInput = useRef<HTMLInputElement>(null);
  const scorePairTarget = useRef<{ contentId: string; title: string } | null>(null);
  const requestBusy = useRef(false);
  useEffect(() => {
    setLoopStart(
      song?.measures.find((m) => m.start === state.passage?.start)?.number ?? 1,
    );
    setLoopEnd(
      state.passage
        ? (song?.measures.find((m) => m.end >= state.passage!.end)?.number ?? 1)
        : (song?.measures.length ?? 1),
    );
  }, [
    song?.contentId,
    song?.duration,
    state.passage?.start,
    state.passage?.end,
  ]);
  useEffect(() => {
    if (song) setWideKeys(song.notes.some((n) => n.pitch < 36 || n.pitch > 84));
  }, [song?.contentId]);
  useEffect(() => {
    if (!song?.fingerActions?.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.session()
        .then((session) => {
          if (!cancelled && session.song?.contentId === song.contentId)
            installSession(session);
        })
        .catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state.speed, song?.engineId, song?.contentId, !!song?.fingerActions?.length, installSession]);
  const run = useCallback(
    async (value: EngineCommand, changesSong = false, requestedAt?: number, collectionRefresh: "wait" | "background" = "wait") => {
      if (requestBusy.current) return false;
      if (songOpeningActive.current && !["panic", "pause"].includes(value.type)) { setNotice("正在准备曲目，可在打开进度中取消或接续。"); return false; }
      if (binding && !["pause", "panic", "retryStartup", "skipStartupSong", "retrySave"].includes(value.type)) {
        setError("正在读取当前练习，请等待完成后再操作。"); return false;
      }
      if (changesSong || ["pause", "panic", "restart", "seek", "seekMeasure", "seekBeat", "stepBeat"].includes(value.type)) clearLiveNotes();
      requestBusy.current = true;
      setBusy(true);
      let coreReady = false;
      let commandAccepted = false;
      let readingSavedLists = false;
      try {
        if ((value.type === "finger" || value.type === "trackSound") && song) await api.editPractice(song, value);
        else if (value.type === "panic") await api.command(value);
        else if (isPlaybackAdjustment(value)) await api.adjustPlayback(capturePlaybackSource(playback.getSnapshot()), value, requestedAt);
        else await api.commandForEngine(playback.getSnapshot().stateOrder?.engineId, value);
        commandAccepted = true;
        if (changesSong) {
          await refreshOpenedSession();
        } else setState(await api.state());
        coreReady = true;
        if (
          [
            "load",
            "loadIndexed",
            "openRecent",
            "favorite",
            "queue",
            "moveQueue",
            "save",
            "generate",
            "recording",
          ].includes(value.type)
        ) {
          if (collectionRefresh === "background") void updateCollection().catch(() => {});
          else { readingSavedLists = true; await updateCollection(); }
        }
        if(value.type === "recording" && !value.active) { readingSavedLists = true; await refreshLibrary(); }
        setError("");
        return true;
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        if (commandAccepted && changesSong && !coreReady) setError("");
        else if (coreReady && readingSavedLists) setError("");
        else setError(coreReady ? `操作已完成，界面读取尚未结束：${message}` : message);
        return coreReady;
      } finally {
        requestBusy.current = false;
        setBusy(false);
      }
    },
    [updateCollection, refreshLibrary, refreshOpenedSession, setState, song, clearLiveNotes, binding, playback],
  );
  const changeWorkspace = useCallback(async (next: Workspace, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (next === workspace) return navigation.navigate(next);
    if (requestBusy.current || busy || !startupReady || state.recording) return false;
    clearLiveNotes();
    const originEngine = playback.getEngineId();
    const changed = await navigation.request(next, async (from, to) => {
      if (from === "practice" && to !== "practice") {
        if (!(await run({type:"pause"}))) return false;
        const snapshot=playback.getSnapshot();
        const judged=snapshot.score.matched_notes+snapshot.score.missed_notes+snapshot.score.wrong_notes;
        if (!snapshot.saved && judged>0 && snapshot.mode!=="listen" && !["recital","memory"].includes(snapshot.mode) && !(await run({type:"save"},false,undefined,"background"))) return false;
      }
      const live = playback.getSnapshot();
      return originEngine === live.stateOrder?.engineId && !requestBusy.current &&
        !live.recording && live.startup?.ready !== false && !live.storage?.operation;
    }, signal);
    if (changed && next === "library") {setLibraryLaunch("normal");setLibraryAdvanced(false);}
    if (changed && next === "review") setFeedback(false);
    return changed;
  }, [busy, startupReady, state.recording, workspace, navigation.pending, navigation.navigate, navigation.request, run, clearLiveNotes, playback]);
  const currentPracticeTarget: SongWorkspaceTarget | null = song && !binding && matchesSong(state, song) &&
    (progressEngineId ?? null) === (song.engineId ?? null)
    ? { contentId: song.contentId, title: song.title, path: song.sourcePath } : null;
  const workspaceUnavailable = workspaceSessions.desktopClose.status ? "正在保存并关闭软件。"
    : binding ? "正在读取当前练习，完成后可切换工作区。"
    : state.storage?.operation ? "正在保存练习资料，完成后可切换工作区。"
    : state.storage?.error && !state.storage.canRetry ? "练习资料保存需要处理，请查看恢复入口。"
    : requestPending ? "正在处理当前操作，完成后可切换工作区。"
    : !startupReady ? "启动恢复完成后可切换工作区。"
    : state.recording ? "请先停止录音，再切换工作区。"
    : navigation.locked ? "请先完成当前工作区中的操作。" : null;
  const currentPracticeUnavailable = workspaceUnavailable ?? (!connected ? "练习室重新连接后可打开或继续曲目。"
    : !currentPracticeTarget && song ? "正在读取当前练习，读齐后可继续。" : null);
  const continueLibraryPractice = async (expected: SongWorkspaceTarget) => {
    const live = playback.getSnapshot();
    if (requestBusy.current || busy || !connected || live.recording || live.startup?.ready === false || live.storage?.operation || !song || !matchesSong(live, song) ||
      (live.stateOrder?.engineId ?? null) !== (song.engineId ?? null) ||
      live.contentId !== expected.contentId || normalize(song.sourcePath) !== normalize(expected.path))
      throw new Error("当前练习已改变，请重新选择要继续的曲目。");
    clearLiveNotes();
    setRoutineSuspended(false);
    setRoutineDialog(false);
    setRoutineLaunch(null);
    setLibraryDialog(false);
    return true;
  };
  const resumeEditingSong = async (contentId: string, path?: string) => {
    if (!(await changeWorkspace("practice"))) return false;
    const same = playback.getSnapshot().contentId === contentId && (!path || normalize(song?.sourcePath) === normalize(path) || path === "内置技术练习" && song?.generated);
    if (!same) {
      const opened = await run(!path || path.startsWith("exercise:") || path === "内置技术练习"
        ? { type: "openRecent", content_id: contentId }
        : { type: "loadIndexed", path, title: path.split(/[\\/]/).at(-1) ?? "原曲目", content_id: contentId }, true);
      if (!opened) return false;
    }
    return playback.getSnapshot().contentId === contentId;
  };
  const visitSongWorkspace = async (next: "library" | "review", target: SongWorkspaceTarget, signal?: AbortSignal) => {
    if (signal?.aborted || navigation.locked || busy || !startupReady || state.recording || !target.contentId) return false;
    if (!(await changeWorkspace(next, signal)) || signal?.aborted) return false;
    const request = { id: crypto.randomUUID(), song: { ...target }, from: workspace };
    if (next === "library") {
      setLibraryLaunch("normal");
      setLibrarySearch(request);
    } else setHistorySongRequest(request);
    return true;
  };
  const toolContext = JSON.stringify([aboutOpen, commandsOpen, progressOpen, recoveryOpen, settings, displayDialog, exerciseDialog, feedback, metadata, editDraftsOpen, fingeringWorkbenchOpen,
    fingeringDialog, passageDialog, ladderDialog, routineDialog, practiceBackup, handsDialog, meterDialog,
    scoresDialog, importDialog, packageDialog, !!mediaExport, panels.drawer]);
  const toolIntent = useRef<{ controller: AbortController; context: string } | null>(null);
  useEffect(() => {
    if (toolIntent.current && toolIntent.current.context !== toolContext) toolIntent.current.controller.abort();
  }, [toolContext]);
  useEffect(() => () => { toolIntent.current?.controller.abort(); }, []);
  const openPracticeTool = useCallback(async (signal: AbortSignal | undefined, open: () => void, pause = true) => {
    toolIntent.current?.controller.abort();
    const intent = new AbortController();
    toolIntent.current = { controller: intent, context: toolContext };
    const abort = () => intent.abort();
    if (signal?.aborted) intent.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const origin = playback.getSnapshot();
    try {
      if (!(await changeWorkspace("practice", intent.signal)) || intent.signal.aborted) return false;
      if (pause && ["playing", "countIn"].includes(playback.getSnapshot().status)) {
        if (!(await run({ type: "pause" })) || intent.signal.aborted) return false;
      }
      if (intent.signal.aborted) return false;
      const current = playback.getSnapshot();
      if (!samePlaybackSource(origin, current)) throw new Error("当前练习已改变，请重新选择要执行的操作。");
      open();
      return true;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (toolIntent.current?.controller === intent) toolIntent.current = null;
    }
  }, [changeWorkspace, playback, run, toolContext]);
  const launchPracticeTool = useCallback((open: () => void) => {
    void openPracticeTool(undefined, open).catch((failure) =>
      setError(failure instanceof Error ? failure.message : String(failure)));
  }, [openPracticeTool, setError]);
  const workspaceChange = useRef(changeWorkspace);
  workspaceChange.current = changeWorkspace;
  useEffect(() => {
    if (api.desktop || !state.storage?.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.storage?.pending]);
  const action = (value: EngineCommand) => {
    if (value.type === "pause") {
      clearLiveNotes();
      const origin = playback.getEngineId();
      void api.commandForEngine(origin, value).then(() => api.state()).then((snapshot) => {
        if (snapshot.stateOrder?.engineId === origin && playback.getEngineId() === origin) setState(snapshot);
      }).catch((failure) => { if (playback.getEngineId() === origin) setError(failure instanceof Error ? failure.message : String(failure)); });
      return;
    }
    if (value.type === "panic") {
      clearLiveNotes();
      void api
        .command(value)
        .then(async () => setState(await api.state()))
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
      return;
    }
    if (!startupReady || binding || !connected) return;
    if (songOpeningActive.current) { setNotice("正在准备曲目，可在打开进度中取消或接续。"); return; }
    if (value.type === "speed" || value.type === "volume" || value.type === "seek" || value.type === "mode") {
      if (value.type === "seek") clearLiveNotes();
      const { stateOrder, contentId, scoreRevision } = playback.getSnapshot();
      pendingAdjust.current.set(value.type, { command: value, source: { stateOrder, contentId, scoreRevision }, createdAtMs: Date.now() });
      void drainAdjust();
    } else
      void run(
        value,
        [
          "track",
          "trackSound",
          "trackAppearance",
          "hands",
          "finger",
          "pairScore",
        ].includes(value.type),
      );
  };
  const pendingAdjust = useRef(new Map<string, { command: PlaybackAdjustmentCommand; source: PlaybackAdjustmentSource; createdAtMs: number }>());
  const adjusting = useRef(false);
  useEffect(() => {
    if (binding || !connected) pendingAdjust.current.clear();
  }, [binding, connected]);
  const drainAdjust = async () => {
    if (adjusting.current) return;
    adjusting.current = true;
    try {
      while (pendingAdjust.current.size) {
        const [key, value] = pendingAdjust.current.entries().next().value!;
        pendingAdjust.current.delete(key);
        await api.adjustPlayback(value.source, value.command, value.createdAtMs);
        setState(await api.state());
      }
      setError("");
    } catch (e) {
      pendingAdjust.current.clear();
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      adjusting.current = false;
    }
  };
  const shortcutQueue = useRef<Promise<unknown>>(Promise.resolve());
  const shortcutGeneration = useRef(0);
  const invalidateKeyboardActions = useCallback(() => {
    shortcutGeneration.current++;
    shortcutQueue.current = Promise.resolve();
  }, []);
  releaseInput.current = () => { invalidateKeyboardActions(); clearLiveNotes(); };
  useEffect(() => {
    const silence = (event: KeyboardEvent) => {
      if (
        !display.shortcuts.silence ||
        event.repeat ||
        isComposingKey(event) ||
        eventShortcut(event) !== display.shortcuts.silence
      )
        return;
      if (isCapturingKeys()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      invalidateKeyboardActions();
      clearLiveNotes();
      void api
        .command({ type: "panic" })
        .then(async () => setState(await api.state()))
        .catch((failure) =>
          setError(
            failure instanceof Error ? failure.message : String(failure),
          ),
        );
    };
    window.addEventListener("keydown", silence, true);
    return () => window.removeEventListener("keydown", silence, true);
  }, [display.shortcuts.silence, setState, clearLiveNotes, invalidateKeyboardActions]);
  const keyboardPaused = !!workspaceSessions.desktopClose.status || !startupReady || Boolean(state.storage?.operation) ||
    workspace !== "practice" || inputOwnership.modal || inputOwnership.popup;
  const shortcutScope = JSON.stringify([song?.engineId, song?.contentId, song?.scoreRevision, workspace, loopStart, loopEnd]);
  const keyboardContext = useRef({ paused: keyboardPaused, scope: shortcutScope });
  keyboardContext.current = { paused: keyboardPaused, scope: shortcutScope };
  useEffect(() => {
    invalidateKeyboardActions();
  }, [shortcutScope, keyboardPaused, display.shortcuts, inputOwnership.revision, invalidateKeyboardActions]);
  useEffect(() => {
    const keys = keyboardMap(display);
    const held = new Set<number>();
    const clear = () => {
      held.forEach((p) => onNote(p, false));
      held.clear();
      invalidateKeyboardActions();
      clearLiveNotes();
    };
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposingKey(e) || isCapturingKeys()) return;
      const editableTarget = isTextEntry(e.target);
      const zoomChord = eventShortcut(e),
        zoomAction = zoomChord
          ? shortcutActions.find(
              (a) =>
                display.shortcuts[a.id] === zoomChord &&
                ["zoomIn", "zoomOut", "zoomReset"].includes(a.id),
            )
          : undefined;
      if (zoomAction && !editableTarget && !e.repeat && !e.isComposing && !e.defaultPrevented) {
        e.preventDefault();
        setDisplay((p) => ({
          ...p,
          uiScale:
            zoomAction.id === "zoomReset"
              ? 100
              : Math.max(
                  80,
                  Math.min(
                    150,
                    p.uiScale + (zoomAction.id === "zoomIn" ? 10 : -10),
                  ),
                ),
        }));
        return;
      }

      if (zoomChord && zoomChord === display.shortcuts.commands && !e.defaultPrevented && !e.repeat && !e.isComposing) {
        if (visibleDialogs().some((node) => !node.matches("[data-practice-drawer]"))) return;
        e.preventDefault();
        clear();
        setCommandsOpen(true);
        return;
      }
      if (songOpeningActive.current && !editableTarget && !e.defaultPrevented && !e.isComposing && !e.repeat && zoomChord === display.shortcuts.playPause && ["playing", "countIn"].includes(playback.getSnapshot().status)) {
        e.preventDefault();
        clear();
        action({ type: "pause" });
        return;
      }
      if (keyboardPaused || topInputScope() || topPopup(null) || songOpeningActive.current || editableTarget || e.repeat) return;
      if (e.target instanceof Element) {
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && ["Space", "Enter"].includes(e.code) &&
          e.target.closest('button,summary,a[href],[role="button"],[role="checkbox"],[role="switch"],[role="radio"]')) return;
      }
      const chord = eventShortcut(e),
        shortcut = chord
          ? shortcutActions.find((a) => display.shortcuts[a.id] === chord)
          : undefined;
      if (shortcut) {
        e.preventDefault();
        const current = playback.getSnapshot();
        const disallowed = (c: Snapshot) =>
          [
            "previousMeasure",
            "nextMeasure",
            "slower",
            "faster",
            "metronome",
            "loop",
          ].includes(shortcut.id) &&
          (!!c.routine ||
            !!c.ladder?.active ||
            (shortcut.id !== "metronome" &&
              ["recital", "memory"].includes(c.mode)));
        if (disallowed(current)) {
          setError("当前完整演奏、计划或阶梯中，请用该练习的控制操作。");
          return;
        }
        const execute = (build: (latest: Snapshot) => EngineCommand) => {
          const generation = shortcutGeneration.current;
          const scope = keyboardContext.current.scope;
          const currentOwner = () => generation === shortcutGeneration.current &&
            !keyboardContext.current.paused && keyboardContext.current.scope === scope &&
            !document.hidden && !topInputScope() && !topPopup(null);
          const origin = capturePlaybackSource(playback.getSnapshot());
          const createdAt = Date.now();
          shortcutQueue.current = shortcutQueue.current
            .then(async () => {
              if (!currentOwner()) return;
              const latest = await api.state();
              if (!currentOwner()) return;
              if (!samePlaybackSource(origin, latest)) throw new Error("曲目已改变，已取消上一首曲目的快捷键操作。");
              if (Date.now() - createdAt > 2000) throw new Error("快捷键请求已过期，请在当前练习中重新按键。");
              if (disallowed(latest)) throw new Error("当前完整演奏、计划或阶梯中，请用该练习的控制操作。");
              const ready = await run(build(latest), false, createdAt);
              if (!ready && generation === shortcutGeneration.current) shortcutGeneration.current++;
            })
            .catch((failure) => {
              if (generation !== shortcutGeneration.current) return;
              shortcutGeneration.current++;
              setError(failure instanceof Error ? failure.message : String(failure));
            });
        };
        switch (shortcut.id) {
          case "playPause":
            execute((c) => ({
              type: ["playing", "countIn"].includes(c.status)
                ? "pause"
                : "play",
            }));
            break;
          case "restart":
            execute(() => ({ type: "restart" }));
            break;
          case "silence":
            clear();
            execute(() => ({ type: "pause" }));
            break;
          case "previousMeasure":
          case "nextMeasure":
            execute((c) => {
              const range = seekableMeasures(song, c.passage);
              if (!range) throw new Error("当前选段内没有可跳转的小节起点，请用逐拍导航。");
              return {
                type: "seekMeasure",
                measure: Math.max(
                  range.first,
                  Math.min(
                    range.last,
                    c.measure + (shortcut.id === "nextMeasure" ? 1 : -1),
                  ),
                ),
              };
            });
            break;
          case "slower":
          case "faster":
            execute((c) => ({
              type: "speed",
              value: Math.max(
                0.25,
                Math.min(
                  2,
                  Math.round(
                    (c.speed + (shortcut.id === "faster" ? 0.05 : -0.05)) * 100,
                  ) / 100,
                ),
              ),
            }));
            break;
          case "loop":
            execute((c) => {
              const range = activeMeasures(song, c.passage);
              return {
                type: "measureLoop",
                enabled: !c.passage,
                start: c.passage ? range?.first ?? 1 : loopStart,
                end: c.passage ? range?.last ?? 1 : loopEnd,
              };
            });
            break;
          case "metronome":
            execute((c) => ({ type: "metronome", enabled: !c.metronome }));
            break;
          case "view":
            setView((v) =>
              v === "keyboard" ? "score" : v === "score" ? "paper" : "keyboard",
            );
            break;
          case "library":
            panelActions.current.setLibraryOpen(!panelActions.current.libraryOpen);
            break;
          case "inspector":
            panelActions.current.setInspector(!panelActions.current.inspector);
            break;
          case "display":
            setDisplayDialog(true);
            break;
          case "history":
            setFeedback(false);
            void workspaceChange.current("review");
            break;
          case "passages":
            launchPracticeTool(() => setPassageDialog(true));
            break;
          case "libraryManager":
            void workspaceChange.current("library");
            break;
        }
        return;
      }
      if (document.querySelector('[data-practice-drawer][role="dialog"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const pitch = display.keyboardEnabled ? keys[e.code] : undefined;
      if (pitch !== undefined) {
        e.preventDefault();
        held.add(pitch);
        onNote(pitch, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      const p = keys[e.code];
      if (p !== undefined && held.delete(p)) onNote(p, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    const hide = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("compositionstart", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("compositionstart", clear);
    };
  }, [
    keyboardPaused,
    launchPracticeTool,
    display.keyCodes,
    display.shortcuts,
    loopStart,
    loopEnd,
    song,
    display.keyboardOctave,
    display.keyboardEnabled,
    onNote,
    clearLiveNotes,
    invalidateKeyboardActions,
    run,
    playback,
    setDisplay,
    setError,
  ]);
  useEffect(() => {
    const escapeWorkspace = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isComposingKey(event) ||
          event.ctrlKey || event.altKey || event.metaKey || topInputScope() || topPopup(null)) return;
      const back = [...document.querySelectorAll<HTMLButtonElement>("button[data-dialog-escape]")].find(isVisibleInput);
      const close = back ?? [...document.querySelectorAll<HTMLButtonElement>("button[data-workspace-close]")].find(isVisibleInput);
      if (!close) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!close.matches(":disabled") && close.getAttribute("aria-disabled") !== "true") close.click();
    };
    window.addEventListener("keydown", escapeWorkspace);
    return () => window.removeEventListener("keydown", escapeWorkspace);
  }, []);
  const showPracticeFeedback = () => {
    const live = playback.getSnapshot();
    const origin = capturePlaybackSource(live);
    if (["playing", "countIn"].includes(live.status)) {
      void run({ type: "pause" }).then((ok) => {
        if (ok && samePlaybackSource(origin, playback.getSnapshot())) setFeedback(true);
      });
    } else setFeedback(true);
  };
  const openInspectorTool = (tool: PracticeInspectorTool) => {
    switch (tool) {
      case "meter": setMeterDialog(true); break;
      case "hands": setHandsDialog(true); break;
      case "scores": setScoresDialog(true); break;
      case "ladder": launchPracticeTool(() => setLadderDialog(true)); break;
      case "passages": launchPracticeTool(() => setPassageDialog(true)); break;
    }
  };
  const selectedRow = useMemo(
    () => songs.find((r) => normalize(r.path) === normalize(song?.sourcePath)),
    [songs, song?.sourcePath],
  );
  const currentRecord = collection.find((r) => r.contentId === song?.contentId);
  const byPath = useMemo(() => practiceCollectionByPath(collection), [collection]);
  const queue = useMemo(
    () =>
      collection
        .filter((r) => r.queuePosition !== null)
        .sort((a, b) => a.queuePosition! - b.queuePosition!),
    [collection],
  );
  const allLibraryRows = useMemo(() => {
    const rows = songs.map(row=>{
      const record=byPath.get(normalize(row.path));
      return !row.contentId&&record?{...row,contentId:record.contentId}:row;
    });
    const known = new Set(rows.map((row) => normalize(row.path)));
    for (const record of byPath.values()) {
      const row = collectionSongRow(record),
        key = normalize(row.path);
      if (known.has(key)) continue;
      known.add(key);
      rows.push({ ...row, id: record.contentId });
    }
    return rows;
  }, [songs, byPath]);
  const recentPractice = useMemo(() => {
    const recent = collection
      .filter(
        (record) =>
          record.available && (record.lastPracticed || record.lastUsed),
      )
      .sort(
        (a, b) =>
          Math.max(b.lastPracticed ?? 0, b.lastUsed) -
          Math.max(a.lastPracticed ?? 0, a.lastUsed),
      );
    for (const record of recent) {
      const row = allLibraryRows.find(
        (candidate) =>
          byPath.get(normalize(candidate.path))?.contentId === record.contentId,
      );
      if (row) return row;
    }
    return null;
  }, [allLibraryRows, byPath, collection]);
  const starterSong =
    songs.find(row => /look at the sky/i.test(row.path) && /原调_乐谱量化/i.test(row.path)) ?? songs.find(row => /look at the sky/i.test(row.title)) ?? songs.find(row => /[\\/]Output[\\/]/i.test(row.path)) ?? songs.find((row) => row.id === "builtin/five-finger") ?? songs[0];
  const load = async (
    row: SongRow,
    expectedContentId?: string,
    location: LibraryOpenLocation = "recent",
  ) => {
    if (requestBusy.current) return false;
    if (songOpeningActive.current) { setNotice("正在准备曲目，可先接续或取消当前打开任务。"); return false; }
    if (!connected || !startupReady) { setNotice("练习室连接完成后可打开曲目。"); return false; }
    if (playback.getSnapshot().recording) { setNotice("请先停止并保存当前录音。"); return false; }
    const pathRecord = byPath.get(normalize(row.path));
    const record =
      location === "recent" && expectedContentId
        ? collection.find((record) => record.contentId === expectedContentId)
        : expectedContentId && pathRecord?.contentId !== expectedContentId
          ? undefined
          : pathRecord;
    const virtualExercise =
      row.path.startsWith("exercise:") || row.path === "内置技术练习";
    if (
      record?.available === false &&
      !virtualExercise &&
      (location === "selected" || !record.generated) &&
      api.desktop &&
      (location === "recent" || expectedContentId === record.contentId)
    ) {
      requestBusy.current = true;
      setBusy(true);
      clearLiveNotes();
      const origin = playback.getSnapshot().stateOrder?.engineId;
      const owner = navigation.getCurrent().workspace;
      let selected: string | null = null;
      try {
        selected = await api.pickRepairPath(
          record.contentId,
          record.path ?? row.path,
        );
        if (!selected) return false;
        if (
          origin !== playback.getSnapshot().stateOrder?.engineId ||
          navigation.getCurrent().workspace !== owner
        )
          throw new Error("练习室连接或工作区已变化，请重新选择曲目位置。");
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return false;
      } finally {
        requestBusy.current = false;
        setBusy(false);
      }
      try {
        await libraryOpening.start(
          {
            kind: "relocated",
            path: selected!,
            title: record.title || row.title,
            contentId: record.contentId,
          },
          record.title || row.title,
          selected!,
        );
        return true;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return false;
      }
    }
    try {
      clearLiveNotes();
      await libraryOpening.start(
        sourceForLibraryRow(row, expectedContentId, location, record),
        record?.title || row.title,
        row.path,
      );
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  };
  const openQueuedSong = async (record: CollectionSong): Promise<boolean> => {
    const origin = playback.getSnapshot(),
      owner = navigation.getCurrent().workspace;
    if (requestBusy.current || songOpeningActive.current || !connected)
      return false;
    try {
      if (origin.recording) throw new Error("请先停止并保存当前录音。");
      if (origin.routine || origin.ladder?.active)
        throw new Error("请先结束当前计划项目或速度阶梯，再切换队列曲目。");
      const judged =
        origin.score.matched_notes +
        origin.score.wrong_notes +
        origin.score.missed_notes;
      if (
        ["recital", "memory"].includes(origin.mode) &&
        origin.status !== "finished" &&
        judged > 0
      )
        throw new Error("请先完成本轮完整演奏，再继续下一首。");
      if (judged > 0 && !origin.saved && origin.mode !== "listen") {
        if (!(await run({ type: "save" }, false, undefined, "background")))
          return false;
        const saved = playback.getSnapshot();
        if (
          saved.stateOrder?.engineId !== origin.stateOrder?.engineId ||
          saved.contentId !== origin.contentId ||
          saved.scoreRevision !== origin.scoreRevision ||
          !saved.saved
        )
          throw new Error("本轮保存结果或当前曲目仍需核对，下一首尚未打开。");
      }
      if (
        navigation.getCurrent().workspace !== owner ||
        playback.getSnapshot().stateOrder?.engineId !==
          origin.stateOrder?.engineId
      )
        return false;
      return load(collectionSongRow(record), record.contentId, "recent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    }
  };
  const importMidi = async () => {
    if (requestBusy.current || busy || !startupReady || state.recording) return;
    if (songOpeningActive.current) {
      setNotice("正在准备曲目，可先接续或取消，再打开文件。");
      return;
    }
    clearLiveNotes();
    if (!api.desktop) {
      setImportDialog(true);
      return;
    }
    const origin = playback.getEngineId(),
      openingFrom = playback.getSnapshot(),
      owner = navigation.getCurrent().workspace;
    requestBusy.current = true;
    setBusy(true);
    let choice: Awaited<ReturnType<typeof api.pickMusic>> = null;
    try {
      choice = await api.pickMusic();
      if (
        origin !== playback.getEngineId() ||
        owner !== navigation.getCurrent().workspace ||
        !samePlaybackSource(openingFrom, playback.getSnapshot())
      )
        throw new Error("练习室连接、曲目或工作区已变化，请重新打开文件。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
    if (!choice) return;
    try {
      await libraryOpening.start(
        choice.kind === "score"
          ? { kind: "originalScore", path: choice.path, defaultBpm: 120 }
          : {
              kind: "file",
              path: choice.path,
              title: choice.title,
              contentId: null,
            },
        choice.title,
        choice.path,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const openPreparedSource = async (
    source: import("./engine/commands.generated").LibraryOpenSource,
    title: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (signal?.aborted) return false;
    const live = playback.getSnapshot(),
      owner = navigation.getCurrent().workspace;
    if (
      requestBusy.current ||
      songOpeningActive.current ||
      busy ||
      !connected ||
      live.startup?.ready === false ||
      live.recording
    )
      throw new Error("请先完成当前保存、录音或曲目打开，再打开曲目。");
    if (navigation.locked)
      throw new Error("请先保存或取消当前工作区中的编辑，再打开曲目。");
    if (live.routine || live.ladder?.active)
      throw new Error("请先结束当前计划项目或速度阶梯，再打开曲目。");
    const judged =
      live.score.matched_notes + live.score.wrong_notes + live.score.missed_notes;
    if (
      ["recital", "memory"].includes(live.mode) &&
      live.status !== "finished" &&
      judged > 0
    )
      throw new Error("请先完成本轮完整演奏，再打开曲目。");
    if (judged > 0 && !live.saved && live.mode !== "listen") {
      if (!(await run({ type: "save" }, false, undefined, "background")))
        return false;
      const saved = playback.getSnapshot();
      if (
        !saved.saved ||
        saved.stateOrder?.engineId !== live.stateOrder?.engineId ||
        saved.contentId !== live.contentId ||
        saved.scoreRevision !== live.scoreRevision
      )
        throw new Error("本轮保存结果需要核对，目标曲目继续保留。");
    }
    if (signal?.aborted) return false;
    if (navigation.getCurrent().workspace !== owner)
      throw new Error("工作区已变化，原打开来源继续保留。");
    clearLiveNotes();
    await libraryOpening.start(source, title, path);
    setImportDialog(false);
    setDroppedFiles([]);
    setPackageDialog(false);
    setPackageFile(undefined);
    return true;
  };
  const openImportedSong = (
    value: import("./engine/commands.generated").ImportedSong,
  ) =>
    openPreparedSource(
      value.catalogOnly
        ? {
            kind: "file",
            path: value.sourcePath,
            title: value.title,
            contentId: value.contentId,
          }
        : { kind: "recent", contentId: value.contentId },
      value.title,
      value.sourcePath,
    );
  const followingQueue = useMemo(
    () => nextAvailableQueueSong(queue, song?.contentId),
    [queue, song?.contentId],
  );
  const next = followingQueue.song;
  const exportMidi = () => {
    if (song) setMediaExport({contentId: song.contentId, title: song.title, path: song.sourcePath, engineId: song.engineId});
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => setError("当前窗口无法进入全屏"));
  };
  const openWork = async (entry: WorkEntry, signal: AbortSignal) => {
    if (signal.aborted || workspaceSessions.desktopClose.status)
      return { ok: false, error: "退出准备尚未结束，请返回窗口后继续。" };
    if (navigation.locked && entry.target !== "drafts" && entry.target !== "devices" && entry.target !== "interface-settings")
      return {
        ok: false,
        error:
          "请先保存或取消当前工作区中的编辑，再打开对应工作台。原进度继续保留。",
      };
    if (entry.target === "scores" || entry.target === "score" || entry.target === "passage" || entry.target === "ladder" || entry.target === "hands" || entry.target === "meter") {
      if (!entry.source)
        return {
          ok: false,
          error: "暂未找到来源曲目，可从曲库打开原曲目后继续。",
        };
      if (!connected || binding || !startupReady)
        return {
          ok: false,
          error: "练习室正在连接或恢复，完成后可返回来源曲目。",
        };
      if (state.recording)
        return { ok: false, error: "请先停止并保存当前录音，再返回来源曲目。" };
      if (operationBusy)
        return { ok: false, error: "当前资料仍在处理，完成后可返回来源曲目。" };
      const currentPath = allLibraryRows.find(
        (row) =>
          byPath.get(normalize(row.path))?.contentId === entry.source!.contentId,
      )?.path;
      if (
        !(await resumeEditingSong(
          entry.source.contentId,
          currentPath || entry.source.path,
        )) ||
        signal.aborted
      )
        return {
          ok: false,
          error:
            "来源曲目尚未打开。原任务保留，请从曲库检查文件位置或先处理练习室提示。",
        };
      if (entry.target === "passage" || entry.target === "ladder" || entry.target === "hands" || entry.target === "meter") {
        const current = getBoundSong();
        if (!current || current.contentId !== entry.source.contentId)
          return { ok: false, error: "来源曲目仍在切换，请稍后继续原输入。" };
        if (!(await openPracticeTool(signal, () => {
          if (entry.target === "passage") setPassageDialog(true);
          else if (entry.target === "ladder") setLadderDialog(true);
          else if (entry.target === "hands") setHandsDialog(true);
          else setMeterDialog(true);
        })))
          return { ok: false, error: "当前练习仍在处理，请完成当前操作后继续原输入。" };
      } else if (entry.target === "scores") {
        if (entry.stale && entry.restoreScoreKey) {
          const actual = playback.getSnapshot();
          workspaceSessions.scores.recoverPreview(entry.restoreScoreKey, {
            contentId: entry.source.contentId,
            engineId: actual.stateOrder?.engineId,
            scoreRevision: actual.scoreRevision ?? 0,
            title: entry.source.title,
            path: currentPath || entry.source.path,
          });
        }
        setScoresDialog(true);
      } else {
        if (playback.getSnapshot().mode === "memory")
          return {
            ok: false,
            error:
              "当前为背谱模式。请先切换练习模式，再打开谱面工具。原制作进度继续保留。",
          };
        setView("score");
        setScoreToolRequest(
          entry.scoreTool
            ? {
                id: crypto.randomUUID(),
                contentId: entry.source.contentId,
                engineId: playback.getSnapshot().stateOrder?.engineId,
                kind: entry.scoreTool,
                sourceFingerprint: entry.sourceFingerprint,
              }
            : null,
        );
      }
    } else if (entry.target === "imports") setImportDialog(true);
    else if (entry.target === "package") {
      setPackageFile(undefined);
      setPackageDialog(true);
    } else if (entry.target === "backup") setPracticeBackup(true);
    else if (entry.target === "devices") setSettings(true);
    else if (entry.target === "exercise") setExerciseDialog(true);
    else if (entry.target === "routine") {
      if (
        !(await openPracticeTool(signal, () => {
          setRoutineLaunch(null);
          showRoutine();
        }))
      )
        return {
          ok: false,
          error:
            "当前练习仍在处理，请先完成录音、保存或当前编辑，再继续编排计划。",
        };
    } else if (entry.target === "interface-settings") {
      const draft = getInterfaceWorkbench();
      const input = draft.getSnapshot(), settingsState = interfaceSettings.getSnapshot();
      const unfinishedExport = input.preparedExport && !["saved", "requested"].includes(input.preparedExport.phase);
      if (settingsState.protected || settingsState.error || input.storageError || input.preview || input.error || unfinishedExport) {
        draft.update({ section: "backup" });
      } else if (hasLayoutNameInput(input, settingsState.layouts)) {
        draft.update({ section: "layout" });
      }
      setDisplayDialog(true);
    } else if (entry.target === "library-open") {
      libraryOpening.store.keepPending();
      const destination = entry.libraryOpenWorkspace ?? "library";
      if (navigation.getCurrent().workspace !== destination && !(await changeWorkspace(destination, signal))) return { ok: false, error: "当前工作区仍在处理，可稍后接续曲目打开进度。" };
      if (entry.libraryOpenWorkspace === "practice") panels.closeDrawer();
      if (entry.libraryOpenId) setLibraryOpenFocus({ requestId: crypto.randomUUID(), id: entry.libraryOpenId });
    } else if (entry.target === "replay" || entry.target === "history-action") {
      if (entry.target === "history-action" && !entry.source) {
        if (!(await changeWorkspace("review", signal))) return { ok: false, error: "当前工作区仍在处理，可稍后打开历史操作进度。" };
        setProgressOpen(false);
        return { ok: true };
      }
      if (!entry.source || !entry.historyId) return { ok: false, error: "原演奏记录身份尚未读到，可复制输入保留。" };
      if (!connected || !startupReady) return { ok: false, error: "练习室正在连接，完成后可返回原演奏。" };
      const origin = playback.getSnapshot().stateOrder?.engineId;
      const detail = await api.commandForEngine<import("./features/review/historyTypes").HistoryDetail>(origin, { type: "readHistoryDetail", content_id: entry.source.contentId, id: entry.historyId });
      if (signal.aborted) return { ok: false, error: "已取消打开，原输入继续保留。" };
      if (origin !== playback.getSnapshot().stateOrder?.engineId) return { ok: false, error: "练习室连接已改变，可重新打开原演奏。" };
      if (!detail || detail.contentId !== entry.source.contentId || detail.id !== entry.historyId) return { ok: false, error: "原演奏记录暂未读到，可复制输入保留。" };
      if (!(await changeWorkspace("review", signal))) return { ok: false, error: "当前工作区仍在处理，原输入继续保留。" };
      if (entry.historyOperationId) getHistoryOperations().resume(entry.historyOperationId);
      setReplayDraftRequest({ id: crypto.randomUUID(), entry: detail });
    } else if (entry.target === "drafts") setEditDraftsOpen(true);
    else if (entry.target === "media") {
      if (!entry.source)
        return {
          ok: false,
          error: "导出来源尚未读到，可从原曲目重新打开导出窗口。",
        };
      setMediaExport({
        contentId: entry.source.contentId,
        title: entry.source.title || entry.subject,
        path: entry.source.path,
        engineId: playback.getSnapshot().stateOrder?.engineId,
        kind: entry.mediaKind,
      });
    }
    setProgressOpen(false);
    return { ok: true };
  };
  const openRecovery = () => { clearLiveNotes(); setProgressOpen(false); setRecoveryOpen(true); };
  const recoveryHost = useRef<RecoveryHost | null>(null);
  recoveryHost.current = {
    snapshot: playback.getSnapshot,
    commandPending: () => requestBusy.current,
    command: run,
    refresh: refreshProblem,
    syncState: async () => {
      setState(await api.state());
    },
    startupSong: async (warning, signal) => {
      if (!warning.source)
        throw new Error("原曲目位置尚未保留，请从曲库重新选择。");
      const source = warning.source;
      const title = source.kind === "file" ? source.title : "上次练习";
      const path = source.kind === "file" ? source.path : "";
      const opened = await openPreparedSource(source, title, path, signal);
      if (opened) setRecoveryOpen(false);
      return opened;
    },
    library: (signal) => changeWorkspace("library", signal),
    locateStartupSong: async (warning, signal) => {
      const source = warning.source;
      if (!api.desktop || source?.kind !== "file" || !source.contentId)
        throw new Error("原曲目缺少可核对的本地文件身份，请从曲库重新选择。");
      if (signal?.aborted) return false;
      if (requestBusy.current || busy || songOpeningActive.current)
        throw new Error("当前资料仍在处理，完成后可重新定位原文件。");
      const origin = playback.getSnapshot(),
        owner = navigation.getCurrent().workspace;
      requestBusy.current = true;
      setBusy(true);
      let path: string | null;
      try {
        path = await api.pickRepairPath(source.contentId, source.path);
      } finally {
        requestBusy.current = false;
        setBusy(false);
      }
      if (!path || signal?.aborted) return false;
      if (
        owner !== navigation.getCurrent().workspace ||
        origin.stateOrder?.engineId !== playback.getEngineId() ||
        !samePlaybackSource(origin, playback.getSnapshot())
      )
        throw new Error("练习室连接、曲目或工作区已变化，请重新选择原文件。");
      const opened = await openPreparedSource(
        {
          kind: "relocated",
          path,
          title: source.title,
          contentId: source.contentId,
          from: source.path,
        },
        source.title,
        path,
        signal,
      );
      if (opened) setRecoveryOpen(false);
      return opened;
    },
    practice: (signal) => {
      if (navigation.locked)
        throw new Error("请先保存或取消当前工作区中的编辑，再打开录音回放。");
      return changeWorkspace("practice", signal);
    },
    work: async (id, signal) => {
      const entry = workspaceSessions.workProgress
        .getSnapshot()
        .rows.find((entry) => entry.id === id);
      return entry ? openWork(entry, signal) : null;
    },
    devices: () => {
      setRecoveryOpen(false);
      setSettings(true);
    },
    progress: () => {
      setRecoveryOpen(false);
      setProgressOpen(true);
    },
    close: () => setRecoveryOpen(false),
  };
  const recoverSession = useCallback(
    (issue: RecoveryIssue, action: RecoveryAction, signal?: AbortSignal) =>
      performRecoveryAction(
        sessionRecovery,
        () => {
          if (!recoveryHost.current)
            throw new Error("恢复入口尚未准备好，请重新打开。");
          return recoveryHost.current;
        },
        issue,
        action,
        signal,
      ),
    [sessionRecovery],
  );
  const commandActions = applicationCommands({
    sessionRecovery: () => { openRecovery(); return true; },
    workProgress: () => { clearLiveNotes(); setProgressOpen(true); return true; },
    library: (signal) => changeWorkspace("library", signal),
    practice: (signal) => changeWorkspace("practice", signal),
    review: (signal) => changeWorkspace("review", signal),
    songHistory: (signal) => song ? visitSongWorkspace("review", { contentId: song.contentId, title: song.title, path: song.sourcePath }, signal) : false,
    play: async (signal) => {
      if (!(await changeWorkspace("practice", signal)) || signal.aborted) return false;
      return run({ type: ["playing", "countIn"].includes(playback.getSnapshot().status) ? "pause" : "play" });
    },
    import: (signal) => openPracticeTool(signal, () => setImportDialog(true), false),
    exercise: (signal) => openPracticeTool(signal, () => setExerciseDialog(true), false),
    routine: (signal) => openPracticeTool(signal, () => { setRoutineLaunch(null); showRoutine(); }),
    passages: (signal) => openPracticeTool(signal, () => setPassageDialog(true)),
    ladder: (signal) => openPracticeTool(signal, () => setLadderDialog(true)),
    fingering: (signal) => openPracticeTool(signal, () => { setSelectedNote(null); setFingeringDialog(true); }),
    hands: (signal) => openPracticeTool(signal, () => setHandsDialog(true), false),
    meter: (signal) => openPracticeTool(signal, () => setMeterDialog(true), false),
    scores: (signal) => openPracticeTool(signal, () => setScoresDialog(true), false),
    metadata: (signal) => openPracticeTool(signal, () => { setMetadataDraftPath(null); setMetadata(true); }, false),
    keyboard: (signal) => openPracticeTool(signal, () => setView("keyboard"), false),
    score: (signal) => openPracticeTool(signal, () => setView("score"), false),
    libraryPanel: (signal) => openPracticeTool(signal, () => setLibraryOpen(!panelActions.current.libraryOpen), false),
    inspector: (signal) => openPracticeTool(signal, () => setInspector(!panelActions.current.inspector), false),
    devices: () => setSettings(true),
    display: () => setDisplayDialog(true),
    backup: () => setPracticeBackup(true),
    silence: () => action({ type: "panic" }),
  }, {
    engine: !connected ? "练习室连接中断，请等待重新连接。" : binding ? "正在读取当前练习，请稍后再试。" : !startupReady ? "练习室正在恢复，完成后可使用。" : operationBusy ? "正在处理练习资料，请等待当前操作完成。" : null,
    idle: state.recording ? "请先停止并保存当前录音。" : null,
    navigation: navigation.locked ? "请先保存或取消当前工作区中的编辑。" : null,
    loaded: !song ? "请先打开一首曲目。" : null,
    song: !song || !song.notes.length ? "请先从曲库选择一首可演奏的曲目。" : null,
    editable: attemptLocked ? "请先结束当前计划、阶梯或完整演奏，再修改练习条件。" : null,
    score: !song?.hasScore ? "请先在乐谱管理中配对 MusicXML 或 MXL 乐谱。" : null,
  }, display.shortcuts);
  const [libraryOpenFocus, setLibraryOpenFocus] = useState<{
    requestId: string;
    id: string;
  } | null>(null);
  const libraryOpening = useLibraryOpening({
    engineId: progressEngineId,
    workspace,
    visible:
      startupReady &&
      !workspaceSessions.desktopClose.status,
    canPresent:
      !navigation.locked &&
      !requestBusy.current &&
      !busy &&
      !state.recording &&
      !binding &&
      !aboutOpen &&
      !commandsOpen &&
      !progressOpen &&
      !recoveryOpen &&
      !settings &&
      !displayDialog &&
      !exerciseDialog &&
      !feedback &&
      !metadata &&
      !editDraftsOpen &&
      !fingeringWorkbenchOpen &&
      !fingeringDialog &&
      !passageDialog &&
      !ladderDialog &&
      !routineDialog &&
      !practiceBackup &&
      !handsDialog &&
      !meterDialog &&
      !scoresDialog &&
      !importDialog &&
      !packageDialog &&
      !mediaExport,
    present: async (intent, prepared, current, owner) => {
      const session = await api.session();
      const navigationState = navigation.getCurrent();
      if (
        !current() ||
        navigationState.workspace !== owner ||
        navigationState.locked
      )
        return false;
      checkLibraryPrepared(prepared, intent.request.engineId, session.state);
      if (
        playback.getSnapshot().stateOrder?.engineId !== intent.request.engineId
      )
        throw new Error("练习室连接已变化，原打开结果继续保留。");
      if (!session.song || session.song.contentId !== prepared.contentId)
        throw new Error("打开结果尚未读齐，可重新读取原结果。");
      checkLibraryPrepared(
        prepared,
        intent.request.engineId,
        installSession(session),
      );
      clearLiveNotes();
      setError("");
      setNotice((prepared.importWarnings ?? []).join("；"));
      panels.closeDrawer();
      setRoutineSuspended(false);
      setRoutineDialog(false);
      setRoutineLaunch(null);
      if (prepared.view !== "practice") {
        setView(prepared.view === "paper" ? "paper" : "score");
        setPaperRevision((value) => value + 1);
      }
      if (
        prepared.view === "range" &&
        prepared.source.kind === "score" &&
        prepared.source.selection
      ) {
        setLibraryScoreRange({
          song: session.song,
          first: prepared.source.selection.first.ordinal,
          last: prepared.source.selection.last.ordinal,
        });
      }
      if (owner === "review") navigation.closeReview();
      else setLibraryDialog(false);
      void updateCollection().catch(() => {});
      return true;
    },
  });
  const openingIntent = [...libraryOpening.state.entries]
    .reverse()
    .find(
      (intent) =>
        intent.request.engineId === progressEngineId &&
        ((libraryOpening.submitting && intent.disposition === "pending") ||
          ["queued", "running", "committing"].includes(
            libraryOpening.state.receipts[intent.request.id]?.phase ??
              intent.lastPhase,
          )),
    );
  const openingActive = libraryOpening.submitting || !!openingIntent || !!importingName;
  songOpeningActive.current = openingActive;
  useEffect(() => {
    if (openingActive) {
      pendingAdjust.current.clear();
      shortcutGeneration.current++;
      shortcutQueue.current = Promise.resolve();
      clearLiveNotes();
    }
  }, [openingActive, clearLiveNotes]);
  return (
    <div
      data-skin={display.skin}
      className={`workbench daily-workbench page-${workspace} ${libraryOpen ? "with-library" : ""} ${inspector ? "with-inspector" : ""}`}
      data-engine-connected={connected}
      data-engine-ready={startupReady}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!startupReady) {setNotice("练习室正在恢复，请稍后再导入文件");return;}
        if (navigation.locked) {
          setNotice("请先保存或取消当前编辑，再导入文件");
          return;
        }
        if (songOpeningActive.current) { setNotice("正在准备曲目，可先接续或取消，再拖入文件。"); return; }
        if (state.recording || busy) {
          setNotice(
            state.recording
              ? "请先停止录音，再导入文件"
              : "请等待当前操作完成，再导入文件",
          );
          return;
        }
        if (document.querySelector('[role="dialog"]')) {
          setNotice("请先关闭当前窗口，再拖入文件；导入窗口内可以继续添加文件");
          return;
        }
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 1 && /\.neopiece$/i.test(files[0].name)) {
          setPackageFile(files[0]);
          setPackageDialog(true);
          return;
        }
        setDroppedFiles(files);
        setImportDialog(true);
      }}
    >
      <header className="workspace-topbar">
        <button
          className="app-name"
          onClick={() => {
            if (workspace === "practice") setLibraryOpen(!libraryOpen);
            else void changeWorkspace("practice");
          }}
          disabled={workspace !== "practice" && !!workspaceUnavailable}
          title={workspace === "practice" ? "显示或隐藏曲库" : "返回练习"}
        >
          <img src="/brand.svg" alt="" aria-hidden="true" width={27} height={27} />
          {product.name}
        </button>
        <ApplicationMenu disabled={!startupReady || navigation.locked || !!state.storage?.operation || !!workspaceSessions.desktopClose.status} groups={[
          {label:"文件",content:<>
            <button disabled={busy || state.recording} onClick={()=>void importMidi()}>打开 MIDI / MusicXML…</button>
            <ImportQueueButton queue={workspaceSessions.imports} open={()=>setImportDialog(true)}/>
            <PreparationButton store={workspaceSessions.piecePackage} name="曲目包…" readyLabel="已保存" disabled={busy || state.recording || openingActive} open={()=>{setPackageFile(undefined);setPackageDialog(true);}}/>
            <MediaExportButton source={song} kind="practiceMidi" disabled={!song || busy} open={()=>{if(song)setMediaExport({contentId:song.contentId,title:song.title,path:song.sourcePath,engineId:song.engineId,kind:"practiceMidi"});}}/>
            <MediaExportButton source={song} kind="midi" disabled={!song || busy} open={exportMidi}/>
            <button onClick={()=>setPracticeBackup(true)}>练习资料备份…</button>
          </>},
          {label:"曲库",content:<>
            <button onClick={()=>{setLibraryAdvanced(false);void changeWorkspace("library");}}>选择曲目…</button>
            <button onClick={()=>{void changeWorkspace("library").then(()=>setLibraryAdvanced(true));}}>管理目录与资料…</button>
            <button onClick={()=>{setLibraryOpen(true);void refresh();}}>显示选曲侧栏</button>
            <button disabled={!song || song.generated || busy} onClick={()=>{setMetadataDraftPath(null);setMetadata(true);}}>当前曲目信息…</button>
            {api.desktop&&<button disabled={busy} onClick={()=>void api.importFolder().then(refresh).catch(e=>setError(String(e)))}>添加扫描文件夹…</button>}
            <button disabled={busy} onClick={()=>void api.command({type:"refreshLibrary"}).then(refresh).catch(e=>setError(String(e)))}>重新扫描目录</button>
          </>},
          {label:"练习",content:<>
            <button disabled={!song || state.recording} onClick={()=>action({type:["playing","countIn"].includes(playback.getSnapshot().status)?"pause":"play"})}>播放 / 暂停</button>
            <button disabled={!song} onClick={()=>action({type:"restart"})}>从头开始</button>
            <button disabled={!song || routineActive || ladderActive} onClick={()=>action({type:"mode",value:"wait"})}>弹对后继续</button>
            <button disabled={!song || routineActive || ladderActive} onClick={()=>action({type:"mode",value:"flow"})}>连续播放</button>
            <button disabled={!song} onClick={()=>action({type:"mode",value:"listen"})}>聆听示范</button>
            <button disabled={busy || openingActive || ladderActive || routineActive} onClick={()=>void run({type:"recording",active:!state.recording},state.recording)}> {state.recording?"停止录制":"录制演奏"}</button>
            <PreparationButton store={workspaceSessions.exercise} name="技术练习…" readyLabel="已生成" disabled={openingActive} open={()=>setExerciseDialog(true)}/>
            <button onClick={()=>launchPracticeTool(()=>showRoutine())}>练习计划…</button>
            {song && <button onClick={()=>void visitSongWorkspace("review",{contentId:song.contentId,title:song.title,path:song.sourcePath})}>本曲练习历史…</button>}
            {song?.generated && song.notes.length>0 && song.notes.every(n=>n.part==="left") && <button disabled={busy} onClick={()=>setLegacyExerciseDialog(true)}>核对旧版左手资料…</button>}
          </>},
          {label:"视图",content:<>
            <button onClick={()=>setView("score")}>五线谱</button><button onClick={()=>setView("keyboard")}>瀑布与琴键</button><button disabled={!song} onClick={()=>setView("paper")}>PDF / 图片谱页</button>
            <button onClick={()=>setLibraryOpen(!libraryOpen)}>{libraryOpen?"隐藏":"显示"}选曲侧栏</button>
            <button onClick={()=>setInspector(!inspector)}>{inspector?"隐藏":"显示"}练习参数</button>
            <button onClick={fullscreen}>切换全屏</button>
            <button onClick={()=>setDisplayDialog(true)}>显示与光效…</button>
          </>},
          {label:"设置",content:<>
            <button onClick={()=>setSettings(true)}>键盘与音源…</button><button onClick={()=>setDisplayDialog(true)}>界面与快捷键…</button>
            <button disabled={!song} onClick={()=>setScoresDialog(true)}>谱面管理…</button>
            <button disabled={!song} onClick={()=>{if(song){scorePairTarget.current={contentId:song.contentId,title:song.title};scoreInput.current?.click();}}}>配对原谱…</button>
            <button disabled={!song || busy} onClick={()=>setFingeringWorkbenchOpen(true)}>指法工作台…</button>
            <button onClick={()=>panels.revealInspector("setup")}>练习参数…</button>
          </>},
          {label:"帮助",content:<>
            <button onClick={()=>{clearLiveNotes();setCommandsOpen(true);}}>查找操作…</button>
            <button onClick={openRecovery}>恢复与问题…</button>
            <button onClick={()=>{clearLiveNotes();setProgressOpen(true);}}>后台任务…</button>
            <button onClick={()=>setEditDraftsOpen(true)}>编辑中的草稿…</button>
            <button onClick={()=>setAboutOpen(true)}>关于 Panthesia…</button>
          </>},
        ]}/>
        <WorkspaceNavigation
          active={workspace}
          disabled={!!workspaceUnavailable}
          unavailable={workspaceUnavailable}
          pending={navigation.pending}
          change={(next) => { void changeWorkspace(next); }}
        />
        <span className="menu-spacer" />
        <span className={`engine-indicator ${connected ? "connected" : ""}`} role="status"
          title={connected ? startupReady ? "练习室已连接" : "正在恢复练习室" : "练习室连接中断"}>
          <i />
          {connected ? startupReady ? "练习室已连接" : "正在恢复练习室" : "练习室连接中断"}
        </span>
        <button className="icon-button" aria-label="全屏" onClick={fullscreen}>
          <Maximize2 size={16} />
        </button>
      </header>
      {workspace === "review" && startupReady && (song || workspace === "review") && <CurrentPracticeBar
        workspace={workspace} song={song} state={state} sourceReady={!!currentPracticeTarget && connected}
        unavailable={workspaceUnavailable} sourceUnavailable={currentPracticeUnavailable}
        resume={() => { void changeWorkspace("practice"); }}
        locate={() => { if (currentPracticeTarget) void visitSongWorkspace("library", currentPracticeTarget); }}
        review={() => { if (currentPracticeTarget) void visitSongWorkspace("review", currentPracticeTarget); }}
        choose={() => { void changeWorkspace("library"); }} />}
      {workspace === "practice" && startupReady && navigation.returnWorkspace === "review" && <PracticeReturnBar
        workspace={navigation.returnWorkspace}
        dismiss={navigation.dismissReturn}
        title={navigation.returnWorkspace === "review" ? workspaceSessions.history?.selected?.title ?? workspaceSessions.history?.song?.title
          : allLibraryRows.find((row) => normalize(row.path) === workspaceSessions.library?.active)?.title}
        context={navigation.returnWorkspace === "review"
          ? historyResumeContext(workspaceSessions.history)
          : libraryResumeContext(workspaceSessions.library)}
        disabled={!!workspaceUnavailable}
        unavailable={workspaceUnavailable}
        resume={() => { if (navigation.returnWorkspace) void changeWorkspace(navigation.returnWorkspace); }} />}
      {workspace === "practice" && routineDialog && routineSuspended && <div className="routine-return-banner" role="status">
        <div><strong>练习计划的输入已保留</strong><span>可以继续编排，或关闭计划窗口并保留草稿后练习。</span></div>
        <button disabled={busy || !startupReady} onClick={showRoutine}>继续编排计划</button>
        <button disabled={workspaceSessions.routineWorkbench.getSnapshot().busy} onClick={() => { setRoutineDialog(false); setRoutineSuspended(false); setRoutineLaunch(null); }}>关闭并保留草稿</button>
      </div>}

      <DesktopCloseProgress {...workspaceSessions.desktopClose} />
      <WorkspaceBrowseRecovery store={workspaceSessions.browse} />
      <StartupNotice status={state.startup} connected={connected} recovery={sessionRecovery} act={recoverSession} openRecovery={openRecovery} error={health.getMessages().action || health.getMessages().session} />
      {notice && (
        <div className="app-notice" role="status">
          <span>{notice}</span>
          <button aria-label="关闭导入提示" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      )}
      {startupReady && <SessionStatus store={sessionRecovery} act={recoverSession} openRecovery={openRecovery} />}
      {!importDialog && <ImportQueueNotice queue={workspaceSessions.imports} open={() => setImportDialog(true)} />}
      {workspace !== "library" && startupReady && <LibraryOpenRecovery opening={libraryOpening} engineId={progressEngineId} focusRequest={libraryOpenFocus} />}
      {busy && !importDialog && !fingeringDialog && !exerciseDialog && <TaskActivity />}
      <div
        className="workspace"
        ref={panels.root}
        data-practice-compact={panels.compact ? "" : undefined}
        data-practice-short={panels.short ? "" : undefined}
        hidden={workspace !== "practice" || !startupReady}
        inert={workspace !== "practice" || !startupReady}
        style={
          {
            "--library-width": `${display.libraryWidth}px`,
            "--inspector-width": `${display.inspectorWidth}px`,
            "--keyboard-height": `${display.keyboardHeight}px`,
            "--paper-preview-height": `${display.paperPreviewHeight}px`,
          } as React.CSSProperties
        }
      >
        {panels.compact && panels.drawer && (
          <button
            className="practice-panel-backdrop"
            aria-label="返回练习画面"
            onClick={panels.closeDrawer}
          />
        )}
        {libraryOpen && <PracticeLibraryPanel
          rows={allLibraryRows} collection={collection} browse={practiceLibraryBrowse} change={setPracticeLibraryBrowse} scrollMemory={practiceLibraryScroll} rememberScroll={workspaceSessions.browse.rememberPracticeScroll} ready={libraryReady} readError={libraryProblem}
          current={song ? { contentId: song.contentId, title: song.title, path: song.sourcePath, generated: song.generated } : null}
          compact={panels.compact} width={display.libraryWidth} resize={(value) => setDisplay((previous) => ({ ...previous, libraryWidth: value }))}
          close={() => setLibraryOpen(false)} manage={() => { void changeWorkspace("library"); }} refresh={refreshWithCollection}
          unavailable={!connected ? "练习室连接中断，连接后可打开曲目。" : busy ? "正在处理当前练习，完成后可打开曲目。" : state.recording ? "请先停止并保存录音。" : importingName ? `正在导入：${importingName}。可从顶部导入入口返回。` : openingActive ? "正在打开上一首曲目，可从打开进度中接续或取消。" : null}
          opening={openingActive && !importingName ? { path: openingIntent?.path ?? "", title: openingIntent?.title || "所选曲目" } : null}
          progress={() => { clearLiveNotes(); setProgressOpen(true); }}
          open={async (item: PracticeLibraryItem) => {
            const current = getBoundSong();
            if (current && item.contentId === current.contentId && (item.location === "recent" || normalize(item.row.path) === normalize(current.sourcePath) || current.generated && item.row.path === `exercise:${current.contentId}`)) { panels.closeDrawer(); return true; }
            return load(item.row, item.contentId, item.location);
          }} />}
        <main className="practice-panel">
          <div className="song-toolbar">
            <button className="back-to-library" onClick={()=>void changeWorkspace("library")}><ChevronLeft size={17}/>曲库</button>
            {!libraryOpen && (
              <button
                className="icon-button"
                aria-label="显示曲库"
                onClick={() => setLibraryOpen(true)}
              >
                <Menu size={18} />
              </button>
            )}
            <div className="current-song">
              <h1 title={song?.title}>{song?.title || "选择曲目"}</h1>
              <SongCredits song={song} editing={metadata} fallback={selectedRow?.composer ||
                (song ? "本地 MIDI" : "打开本地 MIDI 或选择内置练习")} />
            </div>
            <button
              disabled={!song || song.generated || busy}
              className="icon-button metadata-info-button"
              onClick={() => { setMetadataDraftPath(null); setMetadata(true); }}
              title="编辑曲目信息"
              aria-label="编辑曲目信息"
            >
              <Info size={16} />信息
            </button>
            <button
              className={`icon-button ${currentRecord?.favorite ? "is-favorite" : ""}`}
              aria-label={currentRecord?.favorite ? "取消收藏" : "收藏曲目"}
              aria-pressed={!!currentRecord?.favorite}
              disabled={!song || busy}
              onClick={() =>
                action({ type: "favorite", enabled: !currentRecord?.favorite })
              }
            >
              <Star
                size={17}
                fill={currentRecord?.favorite ? "currentColor" : "none"}
              />
            </button>
            <button
              className={
                currentRecord?.queuePosition != null ? "is-queued" : ""
              }
              aria-pressed={currentRecord?.queuePosition != null}
              title={currentRecord?.queuePosition != null ? "移出练习队列" : "加入练习队列"}
              disabled={!song || busy}
              onClick={() =>
                action({
                  type: "queue",
                  enabled: currentRecord?.queuePosition == null,
                })
              }
            >
              <ListMusic size={16} />
              {currentRecord?.queuePosition != null ? "移出队列" : "加入队列"}
            </button>
            <button
              className="icon-button"
              aria-label="练习设置"
              aria-expanded={inspector}
              aria-controls="practice-inspector"
              onClick={() => setInspector(!inspector)}
            >
              <Settings2 size={17} />
            </button>
          </div>
          <PracticeSetupSummary store={playback} song={song} connected={connected}
            display={display} showRequired={view === "score"}
            open={() => panels.revealInspector("setup")} />
          {song && <SongEditionBar song={song} active={workspace==="practice"} disabled={busy || openingActive || navigation.locked || !startupReady || !!state.recording}
            execute={command=>run(command,true)}
            openPerformance={(path,contentId,title)=>openPreparedSource({kind:"file",path,contentId,title},title,path)}
            manage={()=>setScoresDialog(true)}/>}
          <div className="view-toolbar practice-view-toolbar">
            <div className="practice-view-tabs" role="group" aria-label="练习视图">
              <button
                className={view === "keyboard" ? "selected" : ""}
                aria-pressed={view === "keyboard"}
                onClick={() => setView("keyboard")}
              >
                瀑布与琴键
              </button>
              <button
                className={view === "score" ? "selected" : ""}
                aria-pressed={view === "score"}
                onClick={() => setView("score")}
              >
                五线谱
              </button>
              <button
                className={view === "paper" ? "selected" : ""}
                aria-pressed={view === "paper"}
                disabled={!song}
                onClick={() => setView("paper")}
              >
                谱页
              </button>
            </div>
            <ScoreWorkspaceButton store={workspaceSessions.scores} song={song} disabled={busy} expanded={scoresDialog} open={() => setScoresDialog(true)} />
            <FingeringWorkbenchButton store={workspaceSessions.fingeringWorkbench} disabled={busy || state.recording || navigation.locked || !startupReady} open={() => setFingeringWorkbenchOpen(true)} />
            <ToolbarMore label="谱面与指法" scale={display.uiScale / 100} disabled={!song || busy || navigation.locked || !startupReady}>
              <button disabled={!song || busy} onClick={() => setHandsDialog(true)}>分手与逐音播放</button>
              <button
                disabled={!song || busy}
                onClick={() => {
                  if (!song) return;
                  scorePairTarget.current = { contentId: song.contentId, title: song.title };
                  scoreInput.current?.click();
                }}
              >
                配对乐谱
              </button>
              <input
                ref={scoreInput}
                type="file"
                accept=".musicxml,.xml,.mxl"
                aria-label="配对乐谱文件"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0], target = scorePairTarget.current;
                  scorePairTarget.current = null;
                  e.target.value = "";
                  if (!file || !target) return;
                  if (file.size > 4_000_000) {
                    setError("乐谱超过 4 MB");
                    return;
                  }
                  try {
                    if (playback.getSnapshot().contentId !== target.contentId) throw new Error(`当前曲目已切换，请重新为“${target.title}”选择乐谱。`);
                    const bytes = Array.from(
                      new Uint8Array(await file.arrayBuffer()),
                    );
                    if (playback.getSnapshot().contentId !== target.contentId) throw new Error("读取乐谱期间曲目已切换，请重新选择要配对的曲目。");
                    const paired = await run(
                      {
                        type: "pairScore",
                        bytes,
                        name: file.name,
                        content_id: target.contentId,
                      },
                      true,
                    );
                    if (paired && playback.getSnapshot().contentId === target.contentId) setView("score");
                  } catch (err) {
                    setError(String(err));
                  }
                }}
              />
              <button
                className={editFingers ? "selected" : ""}
                disabled={!song || recital || ladderActive || routineActive}
                onClick={() => {
                  setEditFingers(!editFingers);
                  setSelectedNote(null);
                }}
              >
                编辑指法
              </button>
              <button
                disabled={
                  !song || busy || recital || ladderActive || routineActive
                }
                onClick={() => {
                  launchPracticeTool(() => { setSelectedNote(null); setFingeringDialog(true); });
                }}
              >
                指法建议
              </button>
            </ToolbarMore>
            <PracticeLegend song={song} display={display} />
            <ToolbarMore label="显示选项" scale={display.uiScale / 100} disabled={navigation.locked || !startupReady}>
              <PracticeLegend song={song} display={display} />
              <button
                aria-label="界面与按键设置"
                onClick={() => setDisplayDialog(true)}
              >
                界面与按键
              </button>
              <label>
                显示
                <select
                  aria-label="键盘显示范围"
                  value={wideKeys ? "88" : "49"}
                  onChange={(e) => setWideKeys(e.target.value === "88")}
                >
                  <option value="49">49 键</option>
                  <option value="88">88 键</option>
                </select>
              </label>
              <label>
                预览
                <select
                  aria-label="预览小节数"
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                >
                  {[2, 4, 8, 12].map((n) => (
                    <option value={n} key={n}>
                      {n} 小节
                    </option>
                  ))}
                </select>
              </label>
            </ToolbarMore>
          </div>
          {view === "keyboard" && <PianoEffectsSettings compact value={display} change={patch => setDisplay(previous => ({...previous, ...patch}))} openAppearance={()=>{getInterfaceWorkbench().update({section:"appearance"});setDisplayDialog(true);}} />}
          <div className="piano-stage">
            {(view === "keyboard" || state.mode === "memory") && <Piano
                  song={state.mode === "memory" ? null : song}
                  state={playback.getSnapshot()}
                  store={playback}
                  onNote={pointerNote}
                  canInteract={() => !keyboardContext.current.paused && !songOpeningActive.current && !topInputScope() && !topPopup(null)}
                  fullRange={wideKeys}
                  previewBars={seconds}
                  display={display}
                  onSelect={
                    practiceRange.picking ? practiceRange.pick : editFingers && !recital ? setSelectedNote : undefined
                  }
                  practiceRange={practiceRange.range}
                />}
            {view === "score" && song && state.mode !== "memory" && (
              <PlaybackView
                store={playback}
                contentId={song?.contentId ?? null}
              >
                {(live) => (
                  <Notation
                    toolRequest={scoreToolRequest}
                    clearToolRequest={clearScoreToolRequest}
                    openHistoryPlan={(id, day) => {
                      launchPracticeTool(() => {
                        setRoutineLaunch({ id, day });
                        setHistoryScoreReview(null);
                        showRoutine();
                      });
                    }}
                    historyReview={historyScoreReview}
                    clearHistoryReview={() => setHistoryScoreReview(null)}
                    openOriginalHistoryReview={async (signal) => {
                      const original = historyScoreReview;
                      if (!original || signal.aborted) return;
                      const origin = playback.getSnapshot().stateOrder?.engineId;
                      const entry = await api.commandForEngine<import("./features/review/historyTypes").HistoryDetail>(origin, {
                        type: "readHistoryDetail", content_id: original.contentId, id: original.historyId,
                      });
                      requireHistorySource(entry.source, original.contentId, original.historyId);
                      if (signal.aborted) return;
                      if (origin !== playback.getSnapshot().stateOrder?.engineId) throw new Error("练习室连接已改变，请重新打开原演奏记录。");
                      if (!(await changeWorkspace("review", signal))) {
                        if (signal.aborted) return;
                        throw new Error("当前练习仍在处理，稍后可返回原演奏记录。");
                      }
                      setReplayDraftRequest({ id: crypto.randomUUID(), entry });
                    }}
                    practiceHistoryReview={async (reference, before, after, source) => {
                      if (!historyScoreReview) return;
                      const originalReview = historyScoreReview;
                      const originalPresentation = historyPresentation.current;
                      const origin = playback.getSnapshot().stateOrder?.engineId;
                      try {
                        const operations = getHistoryOperations();
                        const intent = await operations.create(origin, requireHistorySource(source ?? originalReview.source, originalReview.contentId, originalReview.historyId, true), { kind: "practiceRange", reference, before, after }, "score", originalReview.title, undefined, () => historyPresentation.current.review === originalReview && historyPresentation.current.workspace === originalPresentation.workspace && historyPresentation.current.view === originalPresentation.view);
                        if (!origin) throw new Error("练习室连接尚未读到，请返回原演奏核对结果。");
                        const receipt = await operations.follow(intent.request.id, origin);
                        if (historyPresentation.current.review !== originalReview || historyPresentation.current.workspace !== originalPresentation.workspace || historyPresentation.current.view !== originalPresentation.view) return;
                        if (receipt?.phase !== "done" || !receipt.result) throw new Error(receipt?.error || "原重练请求已保留，可从工作进度返回原演奏核对。");
                        const result = receipt.result;
                        if (origin !== playback.getSnapshot().stateOrder?.engineId) throw new Error("原重练请求来自上次连接，请返回练习核对当前曲目。");
                        await refresh();
                        const current = playback.getSnapshot();
                        if (historyPresentation.current.review !== originalReview || historyPresentation.current.workspace !== originalPresentation.workspace || historyPresentation.current.view !== originalPresentation.view) return;
                        if (origin !== current.stateOrder?.engineId || current.contentId !== result.historyPrepared.contentId || current.scoreRevision !== result.historyPrepared.scoreRevision) throw new Error("已准备的练习又有变化，请核对当前曲目后重新定位。");
                        if (result.restoreWarning)
                          throw new Error(result.restoreWarning);
                        const focus = requireHistoryScoreTarget(result.scoreFocus, result.historyPrepared, reference);
                        setHistoryScoreReview((current) => current === originalReview ? null : current);
                        setHistoryScoreFocus(
                          focus
                            ? {
                                ...focus,
                                request: crypto.randomUUID(),
                              }
                            : null,
                        );
                        setFeedback(false);
                        operations.present(intent.request.id);
                      } catch (e) {
                        await refresh();
                        throw e;
                      }
                    }}
                    historyFocus={historyScoreFocus}
                    clearHistoryFocus={() => setHistoryScoreFocus(null)}
                    song={song}
                    state={live}
                    seek={(position) => action({ type: "seek", position })}
                    selectPracticeNote={practiceRange.picking?practiceRange.pick:undefined}
                    practiceRange={practiceRange.range}
                    loop={(start,end)=>run({type:"loop",start,end,enabled:true})}
                    changed={async () => {
                      const session = await api.session();
                      installSession(session);
                    }}
                    detail={(note) => {
                      setSelectedNote(note);
                      setFingeringDialog(true);
                    }}
                    assignHands={() => setHandsDialog(true)}
                    edit={editFingers && !recital}
                    canEdit={!recital}
                    onEdit={value=>{if(value)practiceRange.cancelPicking();setEditFingers(value);}}
                  />
                )}
              </PlaybackView>
            )}
            {view === "paper" && song && state.mode !== "memory" && (
              <PlaybackView
                store={playback}
                contentId={song?.contentId ?? null}
              >
                {(live) => (
                  <PaperScore
                    engineId={song.engineId ?? undefined}
                    contentId={song.contentId}
                    historyFocus={historyPaperFocus}
                    revision={paperRevision}
                    playback={{ measure: live.measure }}
                    contextKey={JSON.stringify(
                      song.meterMap ?? song.meterCorrection,
                    )}
                  />
                )}
              </PlaybackView>
            )}
            {selectedNote && view !== "score" && state.mode !== "memory" && (
              <div className="finger-editor">
                <span>{pitchName(selectedNote.pitch)} · 当前指法 {selectedNote.finger ?? "未设置"}</span>
                <button
                  aria-label="关闭指法编辑"
                  onClick={() => setSelectedNote(null)}
                >
                  <X size={12} />
                </button>
                <div>
                  {[1, 2, 3, 4, 5].map((finger) => (
                    <button
                      key={finger}
                      className={selectedNote.finger === finger ? "selected" : undefined}
                      aria-pressed={selectedNote.finger === finger}
                      onClick={() => {
                        void run(
                          {
                            type: "finger",
                            track: selectedNote.track,
                            index: selectedNote.index,
                            finger,
                          },
                          true,
                        );
                        setSelectedNote(null);
                      }}
                    >
                      {finger}
                    </button>
                  ))}
                  <button
                    title={song?.generated ? "清除后使用默认指法" : "清除此音的个人指法"}
                    onClick={() => {
                      void run(
                        {
                          type: "finger",
                          track: selectedNote.track,
                          index: selectedNote.index,
                          finger: null,
                        },
                        true,
                      );
                      setSelectedNote(null);
                    }}
                  >
                    清除个人覆盖
                  </button>
                </div>
              </div>
            )}
            {(song || state.recording) && (view !== "score" || state.mode === "memory") && <PracticeStageReadout
              store={playback}
              connected={connected}
              song={song}
              display={display}
            />}
            {!song && <PracticeWelcome
              resumeTitle={(recentPractice ?? starterSong)?.title} resumeRecent={!!recentPractice}
              disabled={busy || openingActive || state.recording || !connected || navigation.locked}
              input={state.input} inputConnected={state.inputConnected}
              resume={() => { const target = recentPractice ?? starterSong; if (target) void load(target, target.contentId ?? undefined, "recent"); }}
              choose={() => { void changeWorkspace("library"); }} importFile={() => void importMidi()}
              generate={() => launchPracticeTool(() => setExerciseDialog(true))} devices={() => setSettings(true)} />}

          </div>
          {state.routine && (
            <RoutineStatus
              state={state}
              disabled={busy || state.recording || !connected || navigation.locked}
              manage={() => showRoutine()}
              end={() => action({ type: "stopRoutine" })}
              resume={(routine) => { void run({ type: "openRoutineItem", routine_id: routine.routineId, day: routine.day, item_id: routine.itemId, resume: true }, true); }}
              next={(r) => {
                if (!r.nextItemId) return;
                const nextItemId = r.nextItemId;
                void run(
                    {
                      type: "openRoutineItem",
                      routine_id: r.routineId,
                      day: r.day,
                      item_id: nextItemId,
                      resume: true,
                    },
                    true,
                  );
              }}
            />
          )}
          {state.ladder && (
            <LadderStatus
              state={state}
              action={action}
              manage={() => setLadderDialog(true)}
            />
          )}
          <details className="practice-passage-details"><summary>小节与分段</summary>
          {song && (
            <LiveBarNavigator
              store={playback}
              song={song}
              condensed={panels.compact || panels.short}
              start={loopStart}
              end={loopEnd}
              disabled={busy || state.recording || ladderActive || routineActive}
              recital={recital}
              select={(first, last) => { setLoopStart(first); setLoopEnd(last); }}
              command={action}
            />
          )}
          </details>
          <PracticeTimeline
            range={practiceRange}
            loop={(start,end,enabled)=>run({type:"loop",start,end,enabled})}
            togglePicking={()=>{setEditFingers(false);setSelectedNote(null);practiceRange.toggle();}}
            store={playback}
            song={song}
            busy={busy || openingActive}
            disabled={!connected || state.recording || recital || ladderActive || routineActive}
            seek={(position) => run({ type: "seek", position })}
          />
          <PracticeResultStrip
            store={playback}
            busy={busy}
            feedback={showPracticeFeedback}
            details={() => panels.revealInspector("results")}
          />
          <PracticeQueueStrip store={playback} queue={queue} busy={busy || openingActive} connected={connected}
            open={openQueuedSong}
            manage={() => { setPracticeLibraryBrowse((previous) => ({ ...previous, tab: "queue", query: "", source: "", page: 0, focusedKey: song?.contentId ?? null })); setLibraryOpen(true); }}
            repair={() => { void changeWorkspace("library").then((opened) => { if (opened) setLibraryLaunch("missing"); }); }} />
          <div className="instrument-controls">
            {song && <PracticeVariantPanel song={song} disabled={busy || openingActive || state.recording || routineActive || ladderActive || recital} apply={async value => {const ok=await run({type:"practiceVariant",content_id:song.contentId,score_revision:song.scoreRevision,value},true);if(ok)setDisplay(previous=>({...previous,...(value.quantize?{gridSubdivision:value.quantize as 8|16|32}:{}),tonic:((value.tonic??song.practiceVariant?.tonic??0)+(value.transpose??0)+120)%12}));return ok;}} />}
            <button onClick={()=>{getInterfaceWorkbench().update({section:"appearance"});setDisplayDialog(true);}}>外观与网格</button>
            <div className="instrument-hands" role="group" aria-label="练习声部">{[["left","左手"],["both","双手"],["right","右手"]].map(([value,label])=><button key={value} aria-pressed={state.hands===value} disabled={busy||!song||routineActive||ladderActive||recital} onClick={()=>action({type:"hands",value})}>{label}</button>)}</div>
            <button className="instrument-sound" aria-label={`音源设置，当前${state.output}`} data-state={state.sound?.changing?"changing":state.sound?.error?"error":state.sound?.ready?"ready":"offline"} onClick={()=>setSettings(true)}><span className={`signal-dot ${state.sound?.ready?"ready":""}`}/><span>{state.output}<small>{state.sound?.changing?"正在连接音源…":state.sound?.error?"连接未完成，查看设置":state.sound?.ready?state.sound.device??"已连接":"未连接，选择音源"}</small></span></button>
          </div>
          <PracticeTransport
            store={playback}
            available={!!song}
            busy={busy || openingActive}
            openingTitle={openingActive ? importingName || openingIntent?.title || "所选曲目" : undefined}
            connected={connected}
            nextTitle={next?.title}
            nextDisabledReason={routineActive || ladderActive ? "请先结束当前计划项目或速度阶梯。" : recital && ["playing", "paused", "countIn"].includes(state.status) ? "完整演奏结束后可继续下一首。" : undefined}
            next={() => { if (next) void openQueuedSong(next); }}
            nextHint={followingQueue.skipped
              ? next
                ? `下一首：${next.title}，已跳过 ${followingQueue.skipped} 首文件不可用的曲目`
                : `后续 ${followingQueue.skipped} 首文件不可用，可在曲库中修复文件位置`
              : undefined}
            command={action}
            adjust={run}
            stopRecording={() => { void run({ type: "recording", active: false }, true); }}
            playShortcut={display.shortcuts.playPause ? shortcutLabel(display.shortcuts.playPause) : ""}
            restartShortcut={display.shortcuts.restart ? shortcutLabel(display.shortcuts.restart) : ""}
          />
        </main>
        {inspector && (
          <PracticeInspector
            store={playback}
            state={state}
            song={song}
            automaticTranscription={selectedRow?.source === "GiantMIDI-Piano"}
            currentRecord={currentRecord}
            queueLength={queue.length}
            busy={busy}
            compact={panels.compact}
            width={display.inspectorWidth}
            resize={(width) => setDisplay((old) => ({ ...old, inspectorWidth: width }))}
            close={() => setInspector(false)}
            tab={inspectorTab}
            changeTab={setInspectorTab}
            command={action}
            feedback={showPracticeFeedback}
            openTool={openInspectorTool}
            start={loopStart}
            end={loopEnd}
            selectStart={setLoopStart}
            selectEnd={setLoopEnd}
            expression={song && (
              <SongExpressionEditor
                key={song.contentId}
                song={song}
                state={state}
                synchronize={refreshConfirmedSession}
                sourceReady={startupReady && !binding && matchesSong(state, song) && (playback.getEngineId() ?? null) === (song.engineId ?? null)}
                drafts={workspaceSessions.expressions}
                reveal={expressionReveal?.contentId === song.contentId ? expressionReveal.id : undefined}
                revealHandled={(id) => setExpressionReveal((old) => old?.id === id ? null : old)}
                busy={busy}
                locked={attemptLocked}
                planActive={routineActive || ladderActive}
              />
            )}
          />
        )}
      </div>
      <footer hidden={workspace !== "practice" || !startupReady} className="statusbar">
        <span>
          <KeyboardMusic size={13} />
          {state.input
            ? `${state.input}${state.inputConnected ? " · 已连接" : " · 未连接"}`
            : display.keyboardEnabled
              ? `电脑键盘 · ${display.keyCodes.map(codeLabel).join(" ")} · C${display.keyboardOctave}`
              : "电脑键盘演奏已关闭"}
        </span>
        <span>{state.output}</span>
        <PracticePedal store={playback} />
        {selectedRow?.source === "GiantMIDI-Piano" && (
          <span className="transcription-note">
            GiantMIDI · 自动转录，尚未校对
          </span>
        )}
        <span className="menu-spacer" />
        {selectedRow && (
          <details className="source-info">
            <summary>来源与许可</summary>
            <div>
              <strong>{selectedRow.source}</strong>
              <p>{selectedRow.license}</p>
              <p>{selectedRow.sourceUrl}</p>
            </div>
          </details>
        )}
        <button onClick={() => action({ type: "panic" })}>停止发声</button>
        <span>
          {display.shortcuts.playPause
            ? `${shortcutLabel(display.shortcuts.playPause)}：播放 / 暂停`
            : "播放快捷键未分配"}
        </span>
      </footer>
      {mediaExport && <MediaExportDialog source={mediaExport} kind={mediaExport.kind ?? "midi"} close={() => setMediaExport(null)} />}
      {packageDialog && (
        <PackageDialog
          session={workspaceSessions.piecePackage}
          openSong={openImportedSong}
          song={song}
          initialFile={packageFile}
          close={() => { setPackageDialog(false); setPackageFile(undefined); }}
          changed={refreshOrThrow}
        />
      )}
      {importDialog && (
        <ImportDialog
          queue={workspaceSessions.imports}
          openSong={openImportedSong}
          initialFiles={droppedFiles}
          close={() => {
            setImportDialog(false);
            setDroppedFiles([]);
          }}
          changed={async (catalogOnly) => {
            workspaceSessions.libraryReads.invalidate();
            if (catalogOnly) await refreshLibrary();
            else await refreshOrThrow();
          }}
        />
      )}
      {scoresDialog && song && (
        <ScoresDialog
          workspace={workspaceSessions.scores}
          configureDuet={()=>{setScoresDialog(false);setSettingsTab("duet");setSettingsReturnToScores(true);setSettings(true);}}
          song={song}
          close={() => {
            setScoresDialog(false);
            setPaperRevision((v) => v + 1);
          }}
          changed={async () => {
            const session = await api.session();
            installSession(session);
            await updateCollection();
          }}
        />
      )}
      {meterDialog && song && (
        <MeterDialog
          song={song}
          close={() => setMeterDialog(false)}
          changed={async () => {
            const session = await api.session();
            installSession(session);
            setLoopStart(1);
            setLoopEnd(1);
            await updateCollection();
          }}
        />
      )}
      {handsDialog && song && (
        <HandsDialog
          song={song}
          start={loopStart}
          end={loopEnd}
          close={() => setHandsDialog(false)}
          changed={async () => {
            const session = await api.session();
            installSession(session);
            await updateCollection();
          }}
        />
      )}
      {practiceBackup && (
        <PracticeBackupDialog
          session={workspaceSessions.practiceBackup}
          close={() => setPracticeBackup(false)}
          changed={refresh}
        />
      )}
      {routineDialog && (
        <RoutineDialog
          engineId={progressEngineId}
          session={workspaceSessions.routineWorkbench}
          initialPlan={routineLaunch}
          initialPassage={routinePassage}
          suspended={routineSuspended || workspace !== "practice"}
          resumeRevision={routineResumeRevision}
          song={song}
          songs={songs}
          collection={collection}
          state={state}
          close={() => {
            setRoutineDialog(false);
            setRoutineSuspended(false);
            setRoutineLaunch(null);
          }}
          backup={() => {
            setRoutineDialog(false);
            setPracticeBackup(true);
          }}
          openLibrary={(focus) => {
            setRoutineSuspended(true);
            action({ type: "pause" });
            setLibraryLaunch(focus);
            setLibraryDialog(true);
          }}
          changed={refreshOrThrow}
        />
      )}
      {ladderDialog && song && (
        <LadderDialog
          key={song.contentId}
          song={song}
          state={state}
          start={loopStart}
          end={loopEnd}
          close={() => setLadderDialog(false)}
          changed={refreshOrThrow}
        />
      )}
      {passageDialog && song && (
        <PassageDialog
          key={song.contentId}
          song={song}
          state={state}
          start={loopStart}
          end={loopEnd}
          close={() => setPassageDialog(false)}
          addToRoutine={(passage) => {
            setPassageDialog(false);
            setRoutineLaunch(null);
            setRoutinePassage(passage);
            showRoutine();
          }}
          changed={async () => {
            const session = await api.session();
            installSession(session);
            await updateCollection();
          }}
        />
      )}
      {libraryDialog && startupReady && !libraryAdvanced && libraryLaunch==="normal" && !librarySearch && <SongBrowser
        rows={allLibraryRows} ready={libraryReady} current={song} state={state} collection={collection}
        unavailable={workspaceUnavailable} refresh={refreshWithCollection} devices={()=>setSettings(true)}
        manage={()=>setLibraryAdvanced(true)} resume={()=>void changeWorkspace("practice")}
        open={row=>load(row,row.contentId??undefined,"selected")}
        preparation={<LibraryOpenRecovery opening={libraryOpening} engineId={progressEngineId} focusRequest={libraryOpenFocus}/>}/>} 
      {libraryDialog && startupReady && (libraryAdvanced || libraryLaunch!=="normal" || !!librarySearch) && (
        <LibraryDialog
          engineId={progressEngineId}
          readCache={workspaceSessions.libraryReads}
          readCollection={readCollection}
          metadataDrafts={workspaceSessions.metadata}
          learningDrafts={workspaceSessions.learning}
          initialBrowse={workspaceSessions.library}
          searchRequest={librarySearch}
          reviewSong={(target) => visitSongWorkspace("review", target)}
          currentPractice={currentPracticeTarget}
          continuePractice={continueLibraryPractice}
          openUnavailable={currentPracticeUnavailable}
          importFiles={() => { clearLiveNotes(); setImportDialog(true); }}
          backToSource={changeWorkspace}
          searchConsumed={(id) => setLibrarySearch((old) => old?.id === id ? null : old)}
          rememberBrowse={workspaceSessions.rememberLibrary}
          presentation="workspace"
          navigationLockChanged={navigation.setLibraryLocked}
          initialFocus={libraryLaunch === "normal" ? null : libraryLaunch}
          focusConsumed={(focus) => setLibraryLaunch((old) => old === focus ? "normal" : old)}
          rows={allLibraryRows}
          rowsReady={libraryReady}
          rowsError={libraryProblem}
          refreshRows={refreshLibrary}
          close={() => {
            setLibraryDialog(false);
            setLibraryLaunch("normal");
            if (routineSuspended) {
              setRoutineSuspended(false);
              setRoutineResumeRevision((revision) => revision + 1);
            }
          }}
          changed={refreshWithCollection}
          confirmEditRefresh={refreshEdits}
          preparation={<LibraryOpenRecovery opening={libraryOpening} engineId={progressEngineId} focusRequest={libraryOpenFocus} />}
          openVersion={async (row, contentId, kind, id, selection) => {
            clearLiveNotes();
            await libraryOpening.start(sourceForLibraryScore(row, contentId, kind, id, selection), row.title, row.path);
          }}
          open={(row, expectedContentId) => load(row, expectedContentId, "selected")}
        />
      )}
      {libraryScoreRange && (
        <ScoreRangeDialog
          song={libraryScoreRange.song}
          first={libraryScoreRange.first}
          last={libraryScoreRange.last}
          close={() => setLibraryScoreRange(null)}
          changed={async () => {
            const session = await api.session();
            installSession(session);
            await updateCollection();
          }}
        />
      )}
      {fingeringDialog && song && (
        <FingeringDialog
          key={`${song.engineId ?? "legacy"}:${song.contentId}:${selectedNote?.track ?? "range"}:${selectedNote?.index ?? "all"}:${fingeringDraft ? fingeringDraftId(fingeringDraft) : "current"}`}
          workbench={workspaceSessions.fingeringWorkbench}
          song={song}
          note={selectedNote}
          start={fingeringDraft?.start ?? loopStart}
          end={fingeringDraft?.end ?? loopEnd}
          initialDraft={fingeringDraft}
          openWorkbench={() => { setFingeringDialog(false); setFingeringWorkbenchOpen(true); }}
          close={() => { setFingeringDialog(false); setFingeringDraft(null); }}
          changed={async () => {
            await refreshConfirmedSession();
            void updateCollection().catch(() => {});
          }}
        />
      )}
      {legacyExerciseDialog && song?.generated && (
        <LegacyExerciseTracksDialog
          contentId={song.contentId}
          close={() => setLegacyExerciseDialog(false)}
          changed={refresh}
        />
      )}
      {metadata && song && (
        <MetadataDialog
          close={() => setMetadata(false)}
          draftPath={metadataDraftPath ?? undefined}
          song={song}
          drafts={workspaceSessions.metadata}
          saved={async () => {
            await refreshEdits();
            setMetadata(false);
          }}
        />
      )}
      {exerciseDialog && (
        <ExerciseDialog
          session={workspaceSessions.exercise}
          close={() => setExerciseDialog(false)}
          runPreparation={async (work) => {
            if (requestBusy.current) throw new Error("当前操作尚未结束，请稍后再生成。");
            requestBusy.current = true; setBusy(true); clearLiveNotes();
            try { await work(); }
            finally { requestBusy.current = false; setBusy(false); }
          }}
          refreshGenerated={async (source) => {
            await refreshOrThrow();
            const latest = await api.state();
            if (latest.contentId !== source.contentId || latest.stateOrder?.engineId !== source.engineId)
              throw new Error("练习或连接已再次切换，请重新打开已生成的练习。");
            setExerciseDialog(false);
          }}
        />
      )}
      {feedback && (
        <PlaybackView store={playback}>
          {(live) => (
            <FeedbackDialog
              close={() => setFeedback(false)}
              state={live}
              contentId={song?.contentId ?? null}
              trackNames={Object.fromEntries(
                (song?.tracks ?? []).map((track) => [track.id, track.name]),
              )}
              practicePart={async (target: MeasurePartFeedback) => {
                if (!song) throw new Error("请先选择曲目");
                if (requestBusy.current) throw new Error("请等待当前操作完成");
                requestBusy.current = true;
                setBusy(true);
                try {
                  const initial = await api.session();
                  if (initial.song?.contentId !== song.contentId)
                    throw new Error("曲目已切换，请重新打开练习反馈");
                  const current = initial.state;
                  const send = (command: EngineCommand) => api.commandForEngine(current.stateOrder?.engineId, command);
                  if (current.recording)
                    throw new Error("请先停止录音，再重练指定小节和声部");
                  if (current.routine)
                    await send({ type: "stopRoutine" });
                  else if (current.ladder?.active)
                    await send({ type: "stopLadder" });
                  if (["recital", "memory"].includes(current.mode))
                    await send({ type: "mode", value: "flow" });
                  await send({
                    type: "prepareMeasurePart",
                    contentId: song.contentId,
                    measure: target.measure,
                    part: target.part,
                    trackId: target.track_id,
                  });
                  const session = await api.session();
                  installSession(session);
                  setFeedback(false);
                  setError("");
                } catch (e) {
                  try {
                    const session = await api.session();
                    installSession(session);
                  } catch {
                    /* Keep the command error visible in the feedback dialog. */
                  }
                  throw e;
                } finally {
                  requestBusy.current = false;
                  setBusy(false);
                }
              }}
              arrangeNext={(source) => {
                if (
                  !song ||
                  song.contentId !== source.contentId ||
                  state.currentHistoryId !== source.id
                )
                  return;
                setFeedbackPlan({ source, scoreRevision: song.scoreRevision });
                setFeedback(false);
              }}
              retry={async () => {
                await run({ type: "restart" });
                setFeedback(false);
                await run({ type: "play" });
              }}
              practice={async (start, end) => {
                if (state.routine) await run({ type: "stopRoutine" });
                else if (ladderActive) await run({ type: "stopLadder" });
                if (recital) await run({ type: "mode", value: "flow" });
                await run({ type: "measureLoop", start, end, enabled: true });
                setFeedback(false);
              }}
            />
          )}
        </PlaybackView>
      )}
      {feedbackPlan && song?.contentId === feedbackPlan.source.contentId && (
        <HistoryProblemPlan
          key={`${feedbackPlan.source.contentId}:${feedbackPlan.source.id}`}
          launchImmediately
          review={{
            contentId: feedbackPlan.source.contentId,
            historyId: feedbackPlan.source.id,
            scoreRevision: feedbackPlan.scoreRevision,
            recordedAt: feedbackPlan.source.recordedAt,
            title: feedbackPlan.source.title,
            exact: true,
            notes: feedbackPlan.source.notes,
          }}
          disabled={
            busy || state.status === "playing" || state.status === "countIn"
          }
          dirtyChanged={() => {}}
          onClose={() => setFeedbackPlan(null)}
          openPlan={(id, day) => {
            launchPracticeTool(() => {
              setFeedbackPlan(null);
              setRoutineLaunch({ id, day });
              showRoutine();
            });
          }}
        />
      )}
      {history && startupReady && (
        <HistoryDialog
          engineId={progressEngineId}
          songRequest={historySongRequest}
          songConsumed={(id) => setHistorySongRequest((old) => old?.id === id ? null : old)}
          currentSong={currentPracticeTarget}
          locateSong={(target) => visitSongWorkspace("library", target)}
          backToSource={changeWorkspace}
          readCache={workspaceSessions.historyReads}
          annotationDrafts={workspaceSessions.annotations}
          annotationRequest={annotationDraftRequest}
          replayRequest={replayDraftRequest}
          replayConsumed={(id) => setReplayDraftRequest((old) => old?.id === id ? null : old)}
          annotationConsumed={(id) => setAnnotationDraftRequest((old) => old?.id === id ? null : old)}
          initialBrowse={workspaceSessions.history}
          rememberBrowse={workspaceSessions.rememberHistory}
          presentation="workspace"
          navigationLockChanged={navigation.setReviewLocked}
          openPlan={(id, day) => {
            launchPracticeTool(() => {
              setHistory(false);
              setRoutineLaunch({ id, day });
              showRoutine();
            });
          }}
          review={(data) => {
            setHistoryScoreReview(data);
            setHistoryScoreFocus(null);
            setView("score");
            setEditFingers(false);
            setSelectedNote(null);
            setFeedback(false);
          }}
          score={(focus) => {
            setHistoryScoreReview(null);
            setHistoryScoreFocus({ ...focus, request: crypto.randomUUID() });
            setView("score");
            setEditFingers(false);
            setSelectedNote(null);
          }}
          paper={(focus) => {
            setHistoryScoreReview(null);
            setHistoryScoreFocus(null);
            setHistoryPaperFocus({ ...focus, request: crypto.randomUUID() });
            setView("paper");
            setEditFingers(false);
            setSelectedNote(null);
          }}
          finger={async (focus) => {
            const loaded = getBoundSong();
            if (!loaded || loaded.contentId !== focus.contentId)
              throw new Error("曲目已经切换，请重新从历史定位指法");
            const note = loaded.notes.find(
              (n) =>
                n.track === focus.track &&
                n.index === focus.index &&
                n.pitch === focus.pitch &&
                Math.abs(n.start - focus.songTime) < 0.001,
            );
            if (!note)
              throw new Error("原曲音符位置已经改变，无法安全定位指法");
            setHistoryScoreReview(null);
            setHistoryScoreFocus(null);
            setHistoryPaperFocus(null);
            setView("keyboard");
            setEditFingers(false);
            setSelectedNote(note);
            setFingeringDialog(true);
          }}
          close={() => {
            setHistory(false);
            setFeedback(false);
          }}
          changed={async () => {
            const current = await refreshConfirmedSession();
            setFeedback(false);
            void updateCollection().catch((failure) => {
              setError(`当前练习已更新，最近曲目读取失败：${failure instanceof Error ? failure.message : String(failure)}`);
            });
            return current;
          }}
          backup={() => {
            setHistory(false);
            setPracticeBackup(true);
          }}
        />
      )}
      {displayDialog && (
        <DisplaySettingsDialog
          value={display}
          change={setDisplay}
          close={() => setDisplayDialog(false)}
        />
      )}
      {commandsOpen && <ActionSearch
        actions={commandActions}
        recent={recentCommands}
        context={`${workspace === "library" ? "曲库" : workspace === "review" ? "回顾" : "练习"} · ${song ? `当前练习：${song.title}` : "还未选择练习曲目"}`}
        shortcut={display.shortcuts.commands}
        libraryUnavailable={commandActions.find((item) => item.id === "library")?.unavailable ?? null}
        searchLibrary={async (query, signal) => {
          if (!(await changeWorkspace("library", signal)) || signal.aborted) return false;
          setLibraryLaunch("normal");
          setLibrarySearch({ id: crypto.randomUUID(), query });
          return true;
        }}
        close={() => setCommandsOpen(false)}
        used={(id) => setRecentCommands((old) => [id, ...old.filter((value) => value !== id)].slice(0, 6))}
        silence={async () => {
          clearLiveNotes();
          await api.command({ type: "panic" });
          setState(await api.state());
        }}
      />}
      {settings && <DeviceSettingsDialog
        initialTab={settingsTab}
        store={playback}
        state={state}
        engineId={progressEngineId}
        unavailable={!connected ? "练习室连接中断，当前显示上次读取的设备设置。重新连接后可更改。" : !startupReady ? "启动恢复尚未完成，当前可以查看设备与原选择。返回恢复入口继续处理资料。" : binding ? "曲目与设备状态仍在交接，完成后可以更改设置。" : navigation.locked ? "当前工作区有尚未保存的编辑，可以查看设备；保存或取消编辑后可更改设置。" : operationBusy ? "当前操作尚未结束，可以查看设备与连接进度。完成后可更改设置。" : undefined}
        busy={busy}
        error={health.getMessages().action}
        command={run}
        synchronize={refreshSession}
        reportError={setError}
        close={() => {setSettings(false);setSettingsTab("sound");if(settingsReturnToScores)setScoresDialog(true);setSettingsReturnToScores(false);}}
      />}
      {editDraftsOpen && <EditDraftCenter store={workspaceSessions.edits} close={() => setEditDraftsOpen(false)} changed={refreshEdits}
        resumePractice={async (contentId, path) => {
          if (!(await resumeEditingSong(contentId, path))) return false;
          setMetadataDraftPath(path); setMetadata(true); return true;
        }}
        resumeExpression={async (contentId, path) => {
          if (!(await resumeEditingSong(contentId, path))) return false;
          if (["playing", "countIn"].includes(playback.getSnapshot().status) && !(await run({ type: "pause" }))) return false;
          setInspectorTab("tools"); setInspector(true); setExpressionReveal({ contentId, id: crypto.randomUUID() }); return true;
        }}
        resumeAnnotation={async (entry) => {
          if (!(await changeWorkspace("review"))) return false;
          setAnnotationDraftRequest({ id: crypto.randomUUID(), entry }); return true;
        }} />}

      {fingeringWorkbenchOpen && <FingeringWorkbench store={workspaceSessions.fingeringWorkbench} close={() => setFingeringWorkbenchOpen(false)} resume={async (draft) => {
        if (!await resumeEditingSong(draft.contentId, draft.path)) return false;
        if (["playing", "countIn"].includes(playback.getSnapshot().status) && !await run({ type: "pause" })) return false;
        const current = getBoundSong();
        if (!current || current.contentId !== draft.contentId) throw new Error("曲目已经切换，请重新打开这份指法输入。");
        const note = draft.origin ? current.notes.find((note) => note.track === draft.origin!.track && note.index === draft.origin!.index) : null;
        if (draft.origin && !note) throw new Error("原音符位置暂时无法核对。输入继续保留，可复制后在当前曲目重新定位。");
        setSelectedNote(note ?? null); setFingeringDraft(draft); setFingeringDialog(true); setFingeringWorkbenchOpen(false); return true;
      }} />}
      {recoveryOpen && !workspaceSessions.desktopClose.status && <SessionRecoveryDialog store={sessionRecovery} act={recoverSession} close={() => setRecoveryOpen(false)} />}
      {progressOpen && !workspaceSessions.desktopClose.status && <WorkProgressDialog store={workspaceSessions.workProgress} close={() => setProgressOpen(false)} open={openWork} />}
      {aboutOpen && !workspaceSessions.desktopClose.status && <AboutDialog close={() => setAboutOpen(false)} />}
    </div>
  );
}
