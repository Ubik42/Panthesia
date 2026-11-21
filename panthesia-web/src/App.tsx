import {reportDiagnostic} from "./app/diagnostics";
import {usePerformanceKeyboard} from "./features/practice/usePerformanceKeyboard";
import {SongEditorHost} from "./features/screens/SongEditorHost";
import {useSongEditors} from "./features/screens/useSongEditors";
import {openWorkEntry} from "./features/activity/workNavigation";
import {PerformanceTools} from "./features/practice/PerformanceTools";
import {useScorePairing} from "./features/scores/useScorePairing";
import { usePracticeToolNavigation } from "./features/screens/usePracticeToolNavigation";
import { usePlaybackActions } from "./features/practice/usePlaybackActions";
import type { DeviceObject } from "./features/screens/MusicDeviceList";
import { useProductNavigation } from "./features/screens/useProductNavigation";
import { AboutDialog } from "./app/AboutDialog";
import { ActionSearch } from "./app/ActionSearch";
import { applicationCommands,type ApplicationCommandId } from "./app/applicationCommands";
import { ApplicationMenu } from "./app/ApplicationMenu";
import { DesktopCloseProgress } from "./app/DesktopCloseProgress";
import { installDiagnostics } from "./app/diagnostics";
import { isComposingKey,isVisibleInput,topInputScope,topPopup } from "./app/inputOwnership";
import { PreparationButton } from "./app/PreparationButton";
import { performRecoveryAction,type RecoveryHost } from "./app/recovery/recoveryActions";
import { SessionRecoveryDialog } from "./app/recovery/SessionRecovery";
import type { RecoveryAction,RecoveryIssue } from "./app/recovery/sessionRecoveryModel";
import { createSessionRecoveryStore } from "./app/recovery/sessionRecoveryStore";
import { SessionStatus } from "./app/SessionStatus";
import type { SongWorkspaceRequest,SongWorkspaceTarget } from "./app/songWorkspaceVisit";
import { StartupNotice } from "./app/StartupNotice";
import { useDialogFocus } from "./app/useDialogFocus";
import { useWorkspaceSessions } from "./app/useWorkspaceSessions";
import type { DisplayPreferences } from "./displayPreferences";
import type { MediaExportKind } from "./engine/commands.generated";
import { pathKey } from "./engine/pathIdentity";
import { TaskActivity } from "./engine/TaskActivity";
import { WorkProgressDialog } from "./features/activity/WorkProgress";
import type { WorkEntry } from "./features/activity/workProgressStore";
import { EditDraftCenter } from "./features/editing/EditDraftCenter";
import { resolveKeyboardViewport,viewportRange,type KeyboardViewport } from "./features/practice/keyboardViewport";
import { samePlaybackSource } from "./features/practice/playbackCommands";
import { PlaybackView } from "./features/practice/PlaybackView";
import {
PracticeStageReadout
} from "./features/practice/PracticeReadouts";
import { PracticeStage } from "./features/practice/PracticeStage";
import { PracticeTransport } from "./features/practice/PracticeTransport";
import { PracticeWelcome } from "./features/practice/PracticeWelcome";
import { type BookmarkNavigation } from "./features/practice/SongBookmarks";
import { SongSetupScreen } from "./features/practice/SongSetupScreen";
import { SongFilesDialog } from "./features/screens/SongFilesDialog";
import { useLiveNotes } from "./features/practice/useLiveNotes";
import {usePerformanceSize} from "./features/practice/usePerformanceSize";
import { usePracticeSession } from "./features/practice/usePracticeSession";
import type { ScoreToolRequest } from "./features/scores/scoreToolRequest";
import { HandSplitScreen } from "./features/screens/HandSplitScreen";
import { HomeScreen, type RecentFile } from "./features/screens/HomeScreen";
import { ScreenHeader } from "./features/screens/ScreenHeader";
import { SettingsScreen } from "./features/screens/SettingsScreen";
import { TrackSetupScreen } from "./features/screens/TrackSetupScreen";
import { useProductScreens } from "./features/screens/useProductScreens";
import { getInterfaceSettings } from "./features/settings/interfaceSettingsStore";
import { getInterfaceWorkbench } from "./features/settings/interfaceWorkbenchStore";
import { product } from "./product.generated";

import {
KeyboardMusic,
Maximize2,
X
} from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore } from "react";
import {
api,
pitchName,
type CollectionSong,
type EngineCommand,
type LoadedSong,
type PlaybackAdjustmentCommand,
type Snapshot,
type SongRow
} from "./api";
import {
useWorkspaceNavigation,
type Workspace,
} from "./app/useWorkspaceNavigation";
import { DisplaySettingsDialog } from "./features/settings/DisplaySettingsDialog";
import { matchesSong } from "./engine/stateOrder";
import { DeviceSettingsDialog } from "./features/devices/DeviceSettingsDialog";
import { MediaExportButton } from "./features/exports/MediaExportButton";
import { MediaExportDialog } from "./features/exports/MediaExportDialog";
import type { MediaExportSource } from "./features/exports/mediaExportStore";
import { FingeringWorkbench } from "./features/fingering/FingeringWorkbench";
import { fingeringDraftId } from "./features/fingering/fingeringWorkbenchStore";
import { PracticeTimeline } from "./features/practice/PracticeTimeline";
import { usePracticeRange } from "./features/practice/usePracticeRange";
import { FingeringDialog } from "./FingeringDialog";
import { Notation } from "./Notation";
import { PaperScore } from "./PaperScore";
import { PassageDialog } from "./PassageDialog";
import { Piano } from "./Piano";
import { ExerciseDialog } from "./features/practice/ExerciseDialog";
import { MetadataDialog } from "./features/library/SongMetadataDialog";
import { ScoreRangeDialog } from "./ScoreRangeDialog";
import { shortcutLabel } from "./shortcuts";
const normalize = pathKey;

export default function App() {
  useEffect(installDiagnostics, []);
  const [appMenuOpen,setAppMenuOpen]=useState(false);

  useEffect(() => {
    if (!appMenuOpen) return;
    const pointer = (event: MouseEvent) => {
      const target = event.target as Element;
      const toggle = target.closest('button[aria-label="应用菜单"]');
      const menu = target.closest(".workspace-topbar");
      if (!toggle && (!menu || target.closest("button"))) setAppMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppMenuOpen(false);
    };
    window.addEventListener("click", pointer);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", pointer);
      window.removeEventListener("keydown", key);
    };
  }, [appMenuOpen]);

  const releaseInput = useRef<() => void>(() => {});
  const inputOwnership = useDialogFocus(() => releaseInput.current());
  const workspaceSessions = useWorkspaceSessions();
  const navigation = useWorkspaceNavigation({
    initialReturn: workspaceSessions.browse.initialReturn(),
    rememberReturn: workspaceSessions.browse.rememberReturn,
  });
  const { workspace } = navigation;
  const productScreens=useProductScreens(workspace);
  const songSetup=productScreens.screen==="setup";
  const setSongSetup=productScreens.setSongSetup;
  const bookmarkNavigation = useRef<BookmarkNavigation>(null);
  const interfaceSettings = getInterfaceSettings();
  const display = useSyncExternalStore(
    interfaceSettings.subscribe,
    interfaceSettings.getPreferences,
  );
  const setDisplay = interfaceSettings.setPreferences;
  const [displayDialog, setDisplayDialog] = useState(false);
  const [displaySection,setDisplaySection]=useState<"display"|"appearance"|"keyboard"|"shortcuts"|"backup"|undefined>(undefined);
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
  const performanceSize=usePerformanceSize();
  const productActions=useRef<{browse:(signal?:AbortSignal)=>Promise<boolean>;resume:(signal?:AbortSignal)=>Promise<boolean>}>({browse:async()=>false,resume:async()=>false});
  const view = display.practiceView;
  const setView = useCallback((next: string | ((previous: string) => string)) => setDisplay(previous => ({ ...previous,
    practiceView: (typeof next === "function" ? next(previous.practiceView) : next) as DisplayPreferences["practiceView"],
  })), [setDisplay]);
  const seconds = display.previewBars;
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
  const editors=useSongEditors(song);
  const {songOptions,setSongOptions,scoresDialog,setScoresDialog,meterDialog,setMeterDialog,handsDialog,setHandsDialog,fingeringDialog,setFingeringDialog,fingeringWorkbenchOpen,setFingeringWorkbenchOpen}=editors;
  const songOpeningActive = useRef(false);
  const { onNote, pointerNote, clear: clearLiveNotes } = useLiveNotes(playback, connected && !binding && !workspaceSessions.desktopClose.status, setError,
    () => !songOpeningActive.current && !document.hidden && !topInputScope() && !topPopup(null));
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
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [editDraftsOpen, setEditDraftsOpen] = useState(false);
  const [metadataDraftPath, setMetadataDraftPath] = useState<string | null>(null);
  const [recentCommands, setRecentCommands] = useState<ApplicationCommandId[]>([]);
  const [settingsTab,setSettingsTab]=useState<"sound"|"duet">("sound");
  const [settingsDevice,setSettingsDevice]=useState<DeviceObject|undefined>();
  function openSoundSettings(device?:DeviceObject){setSettingsDevice(device);setSettingsTab("sound");setSettingsReturnToScores(false);setSettings(true);}
  const [settingsReturnToScores,setSettingsReturnToScores]=useState(false);
  const [settings, setSettings] = useState(false),
    [editFingers, setEditFingers] = useState(false),
    [selectedNote, setSelectedNote] = useState<
      LoadedSong["notes"][number] | null
    >(null),
    [exerciseDialog, setExerciseDialog] = useState(false),
    [metadata, setMetadata] = useState(false),
    [fingeringDraft, setFingeringDraft] = useState<import("./features/fingering/fingeringWorkbenchStore").FingeringDraft | null>(null),
    [passageDialog, setPassageDialog] = useState(false),
    [progressOpen, setProgressOpen] = useState(false),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [paperRevision, setPaperRevision] = useState(0),
    [mediaExport, setMediaExport] = useState<(MediaExportSource & { kind?: MediaExportKind }) | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!scoreToolRequest) return;
    const actual = playback.getSnapshot();
    if (workspace !== "practice" || view !== "score" || actual.mode === "memory" || actual.contentId !== scoreToolRequest.contentId || actual.stateOrder?.engineId !== scoreToolRequest.engineId) setScoreToolRequest(null);
  }, [scoreToolRequest, workspace, view, state.contentId, progressEngineId, state.mode, playback]);
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
  useEffect(() => { if (!fingeringDialog) setFingeringDraft(null); }, [fingeringDialog]);
  const pianoViewport = useMemo(() => resolveKeyboardViewport(display, song?.notes ?? [], state.input),
    [display.range, display.keyboardViewport, display.keyboardLow, display.keyboardHigh, display.keyboardDeviceRanges, song?.notes, state.input]);
  const pianoRange = useMemo(()=>viewportRange(pianoViewport),[pianoViewport]);
  const changePianoViewport = (viewport:KeyboardViewport) => {
    const range=viewportRange(viewport);
    setDisplay(previous=>({...previous,range:"custom",keyboardViewport:viewport,keyboardLow:range.low,keyboardHigh:range.high}));
  };
  const pianoPitchCounts = useMemo(()=>{
    const counts=Array<number>(129).fill(0);
    for(const note of song?.notes??[])counts[note.pitch+1]++;
    for(let pitch=1;pitch<counts.length;pitch++)counts[pitch]+=counts[pitch-1];
    return counts;
  },[song?.notes]);
  const outsidePianoRange = pianoPitchCounts[pianoRange.low]+pianoPitchCounts[128]-pianoPitchCounts[pianoRange.high+1];
  const recital = ["recital", "memory"].includes(state.mode);
  const attemptLocked = recital && ["playing", "paused", "countIn"].includes(state.status);
  useEffect(() => {
    if (state.mode === "memory") {
      setSelectedNote(null);
      setEditFingers(false);
    }
  }, [state.mode]);
  const [loopStart, setLoopStart] = useState(1),
    [loopEnd, setLoopEnd] = useState(0);
  const practiceRange=usePracticeRange(song,playback);
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
  const {run,action,adjustRealtime,playbackAdjustments}=usePlaybackActions({
    session:{playback,getBoundSong,setState,setError,refreshOpenedSession,updateCollection,refreshLibrary},
    song,binding,connected,startupReady,requestBusy,songOpeningActive,setBusy,setNotice,clearLiveNotes,
  });
  const changeWorkspace = useCallback(async (next: Workspace, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (next === workspace) return navigation.navigate(next);
    if (requestBusy.current || busy || !startupReady || state.recording) return false;
    clearLiveNotes();
    const originEngine = playback.getEngineId();
    const changed = await navigation.request(next, async (from, to) => {
      if (from === "practice" && to !== "practice") {
        if (!(await run({type:"pause"}))) return false;

      }
      const live = playback.getSnapshot();
      return originEngine === live.stateOrder?.engineId && !requestBusy.current &&
        !live.recording && live.startup?.ready !== false && !live.storage?.operation;
    }, signal);
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
  const resumeEditingSong = async (contentId: string, path?: string) => {
    if (!(await changeWorkspace("practice"))) return false;
    if (playback.getSnapshot().contentId !== contentId) {
      if (!path || !(await openPathRef.current(path))) return false;
    }
    return playback.getSnapshot().contentId === contentId;
  };
  const toolContext = JSON.stringify([aboutOpen, commandsOpen, progressOpen, recoveryOpen, settings, displayDialog, exerciseDialog, metadata, editDraftsOpen, fingeringWorkbenchOpen,
    fingeringDialog, passageDialog, handsDialog, meterDialog,
    scoresDialog, !!mediaExport]);
  // Files opened from Explorer, Ouro, the command line or a drop open directly from their own location.
  const [songFilesOpen, setSongFilesOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const refreshRecent = useCallback(() => {
    void api.command<RecentFile[]>({ type: "recentFiles" }).then(setRecentFiles).catch(() => {});
  }, []);
  useEffect(() => { if (connected && startupReady) refreshRecent(); }, [connected, startupReady, refreshRecent]);
  const [opening, setOpening] = useState(false);
  /** Open a file from its own location (current-plan 3.7) and show its setup or the stage. */
  const openPath = async (path: string, screen: "setup" | "performance" = "setup") => {
    if (requestBusy.current || songOpeningActive.current) return false;
    if (!connected || !startupReady) { setNotice("练习室连接完成后可打开曲目。"); return false; }
    if (playback.getSnapshot().recording) { setNotice("请先停止并保存当前录音。"); return false; }
    if (!(await changeWorkspace("practice"))) return false;
    clearLiveNotes();
    setOpening(true);
    let opened = false;
    try {
      opened = await run({ type: "openFile", path }, true);
    } finally {
      setOpening(false);
      refreshRecent();
    }
    if (!opened) return false;
    setView("keyboard");
    productScreens.show(screen);
    // Report manifest problems once; details are in the song files dialog.
    const files = await api.command<{ files?: { missing: boolean }[]; unmatched?: number }>({ type: "songFiles" }).catch(() => null);
    const missing = files?.files?.filter((file) => file.missing).length ?? 0;
    const problems = [missing ? `${missing} 个文件缺失` : "", files?.unmatched ? `${files.unmatched} 条标注无法对应到音符` : ""].filter(Boolean);
    if (problems.length) setError(`歌曲清单中${problems.join("，")}；可在歌曲设置的“歌曲文件与版本”中查看。`);
    return true;
  };
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  const chooseFile = async () => {
    if (requestBusy.current || busy || !startupReady || state.recording) return false;
    const path = api.desktop ? await api.pickSongFile("music", song?.sourcePath ?? undefined) : window.prompt("MIDI、MusicXML 或 .panthesia 文件的完整路径")?.trim();
    return path ? openPath(path) : false;
  };
  const openRequestsBusy = useRef(false);
  const takeOpenRequests = useCallback(async () => {
    if (openRequestsBusy.current || !connected || !startupReady) return;
    openRequestsBusy.current = true;
    try {
      const paths = await api.takeOpenRequests();
      const path = paths.at(-1);
      if (!path) return;
      await openPathRef.current(path, "performance");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      openRequestsBusy.current = false;
    }
  }, [connected, startupReady, setError]);
  useEffect(() => {
    if (!api.desktop) return;
    void takeOpenRequests();
    let release: (() => void) | undefined, active = true;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("panthesia://open-requested", () => void takeOpenRequests()).then((stop) => {
        if (active) release = stop; else stop();
      }));
    return () => { active = false; release?.(); };
  }, [takeOpenRequests]);
  const {openPracticeTool,launchPracticeTool}=usePracticeToolNavigation({toolContext,changeWorkspace,playback,run,setError});
  useEffect(() => {
    if (api.desktop || !state.storage?.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.storage?.pending]);
  const scorePairing=useScorePairing({song,playback,run,setView,setError});
  const keyboardPaused=!!workspaceSessions.desktopClose.status||!startupReady||Boolean(state.storage?.operation)||workspace!=="practice"||!["performance","freePlay"].includes(productScreens.screen)||inputOwnership.modal||inputOwnership.popup;
  const shortcutScope=JSON.stringify([song?.engineId,song?.contentId,song?.scoreRevision,workspace,loopStart,loopEnd]);
  const {keyboardContext,invalidateKeyboardActions}=usePerformanceKeyboard({
    display,setDisplay,song,playback,getBoundSong,keyboardPaused,shortcutScope,ownershipRevision:inputOwnership.revision,songOpeningActive,
    run,action,setState,setError,onNote,clearLiveNotes,loopStart,loopEnd,bookmarkNavigation,
    ui:{commands:()=>setCommandsOpen(true),browse:()=>void productActions.current.browse(),options:()=>setSongOptions(previous=>!previous),display:()=>setDisplayDialog(true),passages:()=>launchPracticeTool(()=>setPassageDialog(true))},
  });
  releaseInput.current=()=>{invalidateKeyboardActions();clearLiveNotes();};
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
  const openWork=(entry:WorkEntry,signal:AbortSignal)=>openWorkEntry(entry,signal,{
    unavailable:target=>{
      if(workspaceSessions.desktopClose.status)return "正在准备退出，请返回窗口后继续。";
      if(navigation.locked&&!["drafts","devices","interface-settings"].includes(target))return "请先保存或取消当前编辑，再接续任务。";
      if(["scores","score","passage","hands","meter"].includes(target)){
        if(!connected||binding||!startupReady)return "练习室正在恢复，完成后可返回来源曲目。";
        if(state.recording)return "请先停止并保存录音，再返回来源曲目。";
        if(operationBusy)return "当前资料正在保存，完成后可接续任务。";
      }
      return null;
    },
    prepare:(source,signal)=>{
      if(signal.aborted)return Promise.resolve(false);
      return resumeEditingSong(source.contentId,source.path);
    },
    current:getBoundSong,snapshot:playback.getSnapshot,scores:workspaceSessions.scores,
    openEditor:(target,signal)=>openPracticeTool(signal,()=>{
      if(target==="passage")setPassageDialog(true);else if(target==="hands")setHandsDialog(true);else setMeterDialog(true);
    }),
    openScores:()=>setScoresDialog(true),
    openScore:request=>{setView("score");productScreens.show("performance");setScoreToolRequest(request);},
    openSimple:target=>{
      if(target==="devices")openSoundSettings();
      else if(target==="exercise")setExerciseDialog(true);
      else if(target==="drafts")setEditDraftsOpen(true);
    },
    openInterface:()=>{
      const draft=getInterfaceWorkbench(),input=draft.getSnapshot(),settings=interfaceSettings.getSnapshot();
      if(settings.protected||settings.error||input.storageError||input.preview||input.error||input.preparedExport&&!["saved","requested"].includes(input.preparedExport.phase))draft.update({section:"backup"});
      setDisplayDialog(true);
    },
    browsePending:async(id,signal)=>{
      if(!(await productActions.current.browse(signal)))return false;
      return true;
    },
    openMedia:entry=>setMediaExport({contentId:entry.source.contentId,title:entry.source.title||entry.subject,path:entry.source.path,engineId:playback.getEngineId(),kind:entry.mediaKind}),
    done:()=>setProgressOpen(false),
  });
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
      const source = warning.source;
      if (source?.kind !== "file" || signal?.aborted)
        throw new Error("上次的曲目没有保留文件位置，请重新打开乐曲。");
      const opened = await openPathRef.current(source.path);
      if (opened) setRecoveryOpen(false);
      return opened;
    },
    library: async () => { await goHomeRef.current(); return true; },
    locateStartupSong: async (_warning, signal) => {
      if (signal?.aborted) return false;
      const opened = await chooseFile();
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
      openSoundSettings();
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
    library: (signal) => productActions.current.browse(signal),
    practice: (signal) => productActions.current.resume(signal),
    play: async (signal) => {
      if (!(await productActions.current.resume(signal)) || signal.aborted) return false;
      productScreens.show("performance");
      return run({ type: ["playing", "countIn"].includes(playback.getSnapshot().status) ? "pause" : "play" });
    },
    import: async () => { await chooseFile(); return true; },
    exercise: (signal) => openPracticeTool(signal, () => setExerciseDialog(true), false),
    passages: (signal) => openPracticeTool(signal, () => setPassageDialog(true)),
    fingering: (signal) => openPracticeTool(signal, () => { setSelectedNote(null); setFingeringDialog(true); }),
    hands: (signal) => openPracticeTool(signal, () => setHandsDialog(true), false),
    meter: (signal) => openPracticeTool(signal, () => setMeterDialog(true), false),
    scores: (signal) => openPracticeTool(signal, () => setScoresDialog(true), false),
    metadata: (signal) => openPracticeTool(signal, () => { setMetadataDraftPath(null); setMetadata(true); }, false),
    keyboard: (signal) => openPracticeTool(signal, () => setView("keyboard"), false),
    score: (signal) => openPracticeTool(signal, () => setView("score"), false),
    libraryPanel: async () => { await chooseFile(); return true; },
    inspector: (signal) => openPracticeTool(signal, () => setSongOptions(true), false),
    devices: () => openSoundSettings(),
    display: () => setDisplayDialog(true),
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
  const openingActive = opening;
  songOpeningActive.current = openingActive;
  useEffect(() => {
    if (openingActive) {
      playbackAdjustments.cancel();
      invalidateKeyboardActions();
      clearLiveNotes();
    }
  }, [openingActive, clearLiveNotes]);
  const {goHome,openFreePlay,resumePractice}=useProductNavigation({
    screens:productScreens,changeWorkspace,run,clearLiveNotes,closeMenu:()=>setAppMenuOpen(false),
  });
  const goHomeRef=useRef(goHome);goHomeRef.current=goHome;
  productActions.current={browse:goHome,resume:resumePractice};
  return (
    <div
      data-skin={display.skin}
      className={`workbench daily-workbench synthesia-layout page-${workspace} ${display.practiceFocus ? "practice-focus" : ""}`}
      data-product-screen={productScreens.screen}
      data-engine-connected={connected}
      data-engine-ready={startupReady}
    >
      <header className="workspace-topbar" hidden={!appMenuOpen} role={appMenuOpen?"dialog":undefined} aria-modal={appMenuOpen||undefined} aria-label="应用菜单">
        <button
          className="app-name"
          onClick={()=>void goHome()}
          disabled={!!workspaceUnavailable}
          title="返回主页"
        >
          <img src="/brand.svg" alt="" aria-hidden="true" width={27} height={27} />
          {product.name}
        </button>
        <ApplicationMenu disabled={!startupReady || navigation.locked || !!state.storage?.operation || !!workspaceSessions.desktopClose.status} groups={[
          {label:"文件",content:<>
            <button disabled={busy || state.recording} onClick={()=>void chooseFile()}>打开乐曲…</button>
            <button disabled={!song || song.generated || busy} onClick={()=>{setMetadataDraftPath(null);setMetadata(true);}}>当前曲目信息…</button>
            {song && <button disabled={busy} onClick={()=>setSongFilesOpen(true)}>歌曲文件与版本…</button>}
            <MediaExportButton source={song} kind="practiceMidi" disabled={!song || busy} open={()=>{if(song)setMediaExport({contentId:song.contentId,title:song.title,path:song.sourcePath,engineId:song.engineId,kind:"practiceMidi"});}}/>
            <MediaExportButton source={song} kind="midi" disabled={!song || busy} open={exportMidi}/>
          </>},
          {label:"练习",content:<>
            <button disabled={!song || state.recording} onClick={()=>action({type:["playing","countIn"].includes(playback.getSnapshot().status)?"pause":"play"})}>播放 / 暂停</button>
            <button disabled={!song} onClick={()=>action({type:"restart"})}>从头开始</button>
            <button disabled={!song} onClick={()=>action({type:"mode",value:"wait"})}>弹对后继续</button>
            <button disabled={!song} onClick={()=>action({type:"mode",value:"listen"})}>连续播放</button>
            <button disabled={busy || openingActive} onClick={()=>void run({type:"recording",active:!state.recording},state.recording)}> {state.recording?"停止录制":"录制演奏"}</button>
            <PreparationButton store={workspaceSessions.exercise} name="技术练习…" readyLabel="已生成" disabled={openingActive} open={()=>setExerciseDialog(true)}/>
          </>},
          {label:"视图",content:<>
            <button onClick={()=>setView("score")}>五线谱</button><button disabled={!song} onClick={()=>setView("combined")}>谱面与瀑布</button><button onClick={()=>setView("keyboard")}>瀑布与琴键</button><button disabled={!song} onClick={()=>setView("paper")}>PDF / 图片谱页</button>
            <button disabled={!song} onClick={()=>setSongOptions(true)}>歌曲选项…</button>
            <button onClick={fullscreen}>切换全屏</button>
            <button onClick={()=>setDisplayDialog(true)}>显示与光效…</button>
          </>},
          {label:"设置",content:<>
            <button onClick={()=>openSoundSettings()}>键盘与音源…</button><button onClick={()=>setDisplayDialog(true)}>界面与快捷键…</button>
            <button disabled={!song} onClick={()=>setScoresDialog(true)}>谱面管理…</button>
            <button disabled={!song} onClick={scorePairing.request}>配对原谱…</button>
            <button disabled={!song || busy} onClick={()=>setFingeringWorkbenchOpen(true)}>指法工作台…</button>
            <button onClick={()=>setSongOptions(true)}>练习参数…</button>
          </>},
          {label:"帮助",content:<>
            <button onClick={()=>{clearLiveNotes();setCommandsOpen(true);}}>查找操作…</button>
            <button onClick={()=>void api.openLogs().catch(e=>setError(String(e)))}>打开日志文件夹</button>
            <button onClick={openRecovery}>诊断详情…</button>
            <button onClick={()=>{clearLiveNotes();setProgressOpen(true);}}>后台任务…</button>
            <button onClick={()=>setEditDraftsOpen(true)}>编辑中的草稿…</button>
            <button onClick={()=>setAboutOpen(true)}>关于 Panthesia…</button>
          </>},
        ]}/>
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

      <DesktopCloseProgress {...workspaceSessions.desktopClose} />
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
      {busy && !fingeringDialog && !exerciseDialog && <TaskActivity />}
      {startupReady && productScreens.screen==="home" && <HomeScreen recent={recentFiles} disabled={!!workspaceUnavailable||!connected} chooseFile={chooseFile} open={openPath} forget={path=>void api.command<RecentFile[]>({type:"forgetRecentFile",path}).then(setRecentFiles).catch(()=>{})} freePlay={()=>void openFreePlay()} settings={()=>productScreens.settings()}/>}
      {startupReady && <div className="product-settings-host" hidden={productScreens.screen!=="settings"} inert={productScreens.screen!=="settings"}><SettingsScreen state={state} engineId={progressEngineId} visible={productScreens.screen==="settings"&&!settings&&!displayDialog} back={()=>productScreens.home()} devices={device=>openSoundSettings(device)} duet={()=>{setSettingsTab("duet");setSettingsReturnToScores(false);setSettings(true);}} display={section=>{setDisplaySection(section);setDisplayDialog(true);}} logs={()=>void api.openLogs().catch(e=>setError(String(e)))} about={()=>setAboutOpen(true)} disabled={busy||!connected}/></div>}

      {workspace === "practice" && songSetup && song && <SongSetupScreen song={song} store={playback} disabled={busy || openingActive || !connected} back={()=>{void goHome();}} menu={()=>setAppMenuOpen(v=>!v)} hands={()=>productScreens.show("parts")} sound={()=>openSoundSettings()} scores={()=>setScoresDialog(true)} settings={()=>setSongOptions(true)} files={()=>setSongFilesOpen(true)} start={async(mode,hands)=>{if(await run({type:"hands",value:hands}) && await run({type:"mode",value:mode}) && await run({type:"play"})){productScreens.show("performance");return true;}return false;}} />}
      {songFilesOpen && song && <SongFilesDialog close={()=>setSongFilesOpen(false)} openVersion={path=>run({type:"openFile",path},true)}/>}
      {workspace==="practice" && productScreens.screen==="parts" && song && <TrackSetupScreen song={song} disabled={busy||openingActive||!connected} builtin={!state.outputId} pianoOnly={/default\.sf2$/i.test(state.soundfont??"")} back={()=>productScreens.show("setup")} custom={track=>{const t=song.tracks.find(t=>t.id===track);if(t&&!t.visible){void run({type:"track",id:t.id,mode:t.mode,part:t.part,visible:true},true).then(ok=>{if(ok)productScreens.split(track);});}else productScreens.split(track);}} command={value=>run(value,true)}/>}
      {workspace==="practice" && productScreens.screen==="split" && song && productScreens.splitTrack!==null && <HandSplitScreen key={`${song.contentId}:${productScreens.splitTrack}`} song={song} trackId={productScreens.splitTrack} disabled={busy||openingActive||!connected} back={()=>productScreens.show("parts")} command={value=>run(value,true)}/>}
      {workspace==="practice" && productScreens.screen==="freePlay" && <main className="product-freeplay product-page"><ScreenHeader title="自由演奏" back={()=>void goHome()} backDisabled={state.recording||busy} backLabel="主页"><button disabled={busy||!connected} onClick={()=>void run({type:"recording",active:!state.recording},state.recording)}>{state.recording?"停止并保存录音":"录音"}</button><button onClick={()=>openSoundSettings()}>设置</button></ScreenHeader><div className="product-freeplay-stage"><Piano song={null} state={playback.getSnapshot()} store={playback} onNote={pointerNote} canInteract={()=>!keyboardContext.current.paused&&!topInputScope()&&!topPopup(null)} keyboardRange={pianoRange} keyboardViewport={pianoViewport} display={display}/></div></main>}

      <div
        className="workspace"
        ref={performanceSize.root}
        data-practice-compact={performanceSize.compact ? "" : undefined}
        data-practice-short={performanceSize.short ? "" : undefined}
        hidden={workspace !== "practice" || !startupReady || productScreens.screen!=="performance"}
        inert={workspace !== "practice" || !startupReady || productScreens.screen!=="performance"}
        style={
          {
            "--keyboard-height": `${display.keyboardHeight}px`,
            "--paper-preview-height": `${display.paperPreviewHeight}px`,
          } as React.CSSProperties
        }
      >
        <main className="practice-panel">
          <PracticeTransport
            store={playback}
            back={() => {void run({type:"pause"}).then(ok=>{if(ok){setSongSetup(true);}});}}
            tools={<PerformanceTools song={song} playback={playback} display={display} setDisplay={setDisplay}
              status={{busy,openingActive,connected,locked:navigation.locked,startupReady,editable:!recital}}
              keyboard={{range:pianoRange,viewport:pianoViewport,outside:outsidePianoRange}} practiceRange={practiceRange} bookmarkNavigation={bookmarkNavigation}
              visible={productScreens.screen==="performance"} editFingers={editFingers} setEditFingers={setEditFingers} clearSelection={()=>setSelectedNote(null)}
              action={action} run={run} adjustRealtime={adjustRealtime} setView={setView}
              open={{songOptions:()=>setSongOptions(true),scores:()=>setScoresDialog(true),devices:()=>openSoundSettings(),display:()=>setDisplayDialog(true),fingeringWorkbench:()=>setFingeringWorkbenchOpen(true),
                parts:()=>{void run({type:"pause"}).then(ok=>{if(ok)productScreens.show("parts");});},pairScore:scorePairing.request,fingering:()=>launchPracticeTool(()=>{setSelectedNote(null);setFingeringDialog(true);})}}/>}
            menu={() => setAppMenuOpen(v=>!v)}
            available={!!song}
            busy={busy || openingActive}
            connected={connected}
            nextTitle="下一小节"
            previous={()=>{const position=playback.getSnapshot().position;const previous=[...(song?.measures??[])].reverse().find(bar=>bar.start<position-.1);void adjustRealtime({type:"seek",position:previous?.start??0});}}
            next={()=>{const position=playback.getSnapshot().position;const upcoming=song?.measures.find(bar=>bar.start>position+.1);if(upcoming)void adjustRealtime({type:"seek",position:upcoming.start});}}
            command={action}
            adjust={adjustRealtime}
            stopRecording={() => { void run({ type: "recording", active: false }, true); }}
            playShortcut={display.shortcuts.playPause ? shortcutLabel(display.shortcuts.playPause) : ""}
            restartShortcut={display.shortcuts.restart ? shortcutLabel(display.shortcuts.restart) : ""}
          />
          <PracticeTimeline
            range={practiceRange}
            store={playback}
            song={song}
            busy={busy || openingActive}
            disabled={!connected || state.recording || recital}
            seek={(position) => adjustRealtime({ type: "seek", position })}
          />
          <PracticeStage combined={view === "combined" && state.mode !== "memory"} axis={display.practiceSplitAxis === "auto" ? "rows" : display.practiceSplitAxis} ratio={display.practiceSplitAxis === "auto" ? 25 : display.practiceSplitRatio}
            changeRatio={value => setDisplay(previous => ({...previous,practiceSplitRatio:value,practiceSplitAxis:previous.practiceSplitAxis==="auto"?"rows":previous.practiceSplitAxis}))}>
            <div className="practice-stage-keyboard" hidden={view !== "keyboard" && view !== "combined" && state.mode !== "memory"} role="region" aria-label="瀑布与琴键区域">
            {productScreens.screen==="performance" && (view === "keyboard" || view === "combined" || state.mode === "memory") && <Piano
                  song={state.mode === "memory" ? null : song}
                  state={playback.getSnapshot()}
                  store={playback}
                  onNote={pointerNote}
                  canInteract={() => !keyboardContext.current.paused && !songOpeningActive.current && !topInputScope() && !topPopup(null)}
                  keyboardRange={pianoRange}
                  keyboardViewport={pianoViewport}
                  onViewportChange={changePianoViewport}
                  onPreviewBarsChange={setSeconds}
                  previewBars={seconds}
                  display={display}
                  onSelect={
                    practiceRange.picking ? practiceRange.pick : editFingers && !recital ? setSelectedNote : undefined
                  }
                  practiceRange={practiceRange.range}
                />}
            {(view === "keyboard" || view === "combined" || state.mode === "memory") && (song || state.recording) && <PracticeStageReadout store={playback} connected={connected} song={song} display={display} />}
            </div>
            <div className="practice-stage-notation" hidden={(view !== "score" && view !== "combined") || state.mode === "memory"} role="region" aria-label="五线谱区域">
            {productScreens.screen==="performance" && (view === "score" || view === "combined") && song && state.mode !== "memory" && (
              <PlaybackView
                store={playback}
                contentId={song?.contentId ?? null}
              >
                {(live) => (
                  <Notation
                    toolRequest={scoreToolRequest}
                    clearToolRequest={clearScoreToolRequest}
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
                    assignHands={() => {void run({type:"pause"}).then(ok=>{if(ok)productScreens.show("parts");});}}
                    edit={editFingers && !recital}
                    canEdit={!recital}
                    onEdit={value=>{if(value)practiceRange.cancelPicking();setEditFingers(value);}}
                  />
                )}
              </PlaybackView>
            )}
            </div>
            {productScreens.screen==="performance" && view === "paper" && song && state.mode !== "memory" && (
              <PlaybackView
                store={playback}
                contentId={song?.contentId ?? null}
              >
                {(live) => (
                  <PaperScore
                    engineId={song.engineId ?? undefined}
                    contentId={song.contentId}
                    revision={paperRevision}
                    playback={{ measure: live.measure }}
                    contextKey={JSON.stringify(
                      song.meterMap ?? song.meterCorrection,
                    )}
                  />
                )}
              </PlaybackView>
            )}
            {selectedNote && view !== "score" && view !== "combined" && state.mode !== "memory" && (
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
            {!song && <PracticeWelcome
              resumeTitle={recentFiles.find(file=>file.exists)?.title} resumeRecent={recentFiles.some(file=>file.exists)}
              disabled={busy || openingActive || state.recording || !connected || navigation.locked}
              input={state.input} inputConnected={state.inputConnected}
              resume={() => { const target = recentFiles.find(file=>file.exists); if (target) void openPath(target.path); }}
              choose={() => void chooseFile()} importFile={() => void chooseFile()}
              generate={() => launchPracticeTool(() => setExerciseDialog(true))} devices={() => openSoundSettings()} />}

          </PracticeStage>



        </main>

      </div>
      <input ref={scorePairing.input} type="file" accept=".musicxml,.xml,.mxl" aria-label="配对乐谱文件" hidden onChange={scorePairing.change}/>
      <SongEditorHost song={song} editors={editors} disabled={busy||openingActive||state.recording}
        scoreWorkspace={workspaceSessions.scores} configureDuet={()=>{setScoresDialog(false);setSettingsTab("duet");setSettingsReturnToScores(true);setSettings(true);}}
        openScorePractice={async()=>{
          if(!song)return;
          const current=playback.getSnapshot();
          if(current.contentId!==song.contentId||playback.getEngineId()!==song.engineId)throw new Error("当前歌曲已改变，请返回对应歌曲打开谱面。");
          if(!(await changeWorkspace("practice")))throw new Error("谱面已采用，可稍后打开演奏。");
          setView("score");productScreens.show("performance");setScoresDialog(false);setPaperRevision(value=>value+1);
        }} paperChanged={()=>setPaperRevision(value=>value+1)}
        changed={async kind=>{await refreshConfirmedSession();if(kind==="meter"){setLoopStart(1);setLoopEnd(1);}await updateCollection();}}
        loopStart={loopStart} loopEnd={loopEnd}
        applyVariant={async value=>{
          if(!song)return false;
          const ok=await run({type:"practiceVariant",content_id:song.contentId,score_revision:song.scoreRevision,value},true);
          if(ok)setDisplay(previous=>({...previous,...(value.quantize?{gridSubdivision:value.quantize as 8|16|32}:{}),tonic:((value.tonic??song.practiceVariant?.tonic??0)+(value.transpose??0)+120)%12}));return ok;
        }} execute={command=>run(command,true)}/>
      {mediaExport && <MediaExportDialog source={mediaExport} kind={mediaExport.kind ?? "midi"} close={() => setMediaExport(null)} />}
      {passageDialog && song && (
        <PassageDialog
          key={song.contentId}
          song={song}
          state={state}
          start={loopStart}
          end={loopEnd}
          close={() => setPassageDialog(false)}
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
      {null}
      {null}
      {displayDialog && (
        <DisplaySettingsDialog
          page={productScreens.screen==="settings"} initialSection={displaySection}
          input={state.input}
          value={display}
          change={setDisplay}
          close={() => {setDisplayDialog(false);setDisplaySection(undefined);}}
        />
      )}
      {commandsOpen && <ActionSearch
        actions={commandActions}
        recent={recentCommands}
        context={`${workspace === "library" ? "曲库" : workspace === "review" ? "回顾" : "练习"} · ${song ? `当前练习：${song.title}` : "还未选择练习曲目"}`}
        shortcut={display.shortcuts.commands}
        close={() => setCommandsOpen(false)}
        used={(id) => setRecentCommands((old) => [id, ...old.filter((value) => value !== id)].slice(0, 6))}
        silence={async () => {
          clearLiveNotes();
          await api.command({ type: "panic" });
          setState(await api.state());
        }}
      />}
      {settings && <DeviceSettingsDialog selectedDevice={settingsTab==="sound"?settingsDevice:undefined} page={productScreens.screen==="settings"}
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
 />}

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
