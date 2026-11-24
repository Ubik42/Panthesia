import { usePerformanceKeyboard } from "../features/practice/usePerformanceKeyboard";
import { useSongEditors } from "../features/editing/useSongEditors";
import { openWorkEntry } from "../features/activity/workNavigation";
import { useScorePairing } from "../features/scores/useScorePairing";
import { usePracticeToolNavigation } from "./usePracticeToolNavigation";
import { usePlaybackActions } from "../features/practice/usePlaybackActions";
import { useProductNavigation } from "./useProductNavigation";
import { applicationCommands,type ApplicationCommandId } from "./applicationCommands";
import { installDiagnostics } from "../lib/diagnostics";
import { isComposingKey,isVisibleInput,topInputScope,topPopup } from "../lib/inputOwnership";
import { performRecoveryAction,type RecoveryHost } from "./recovery/recoveryActions";
import type { RecoveryAction,RecoveryIssue } from "./recovery/sessionRecoveryModel";
import { createSessionRecoveryStore } from "./recovery/sessionRecoveryStore";
import type { SongWorkspaceTarget } from "./songWorkspaceVisit";
import { useDialogFocus } from "./useDialogFocus";
import { useWorkspaceSessions } from "./useWorkspaceSessions";
import type { DisplayPreferences } from "../features/settings/displayPreferences";
import { pathKey } from "../engine/pathIdentity";
import type { WorkEntry } from "../features/activity/workProgressStore";
import { type BookmarkNavigation } from "../features/practice/SongBookmarks";
import { useLiveNotes } from "../features/practice/useLiveNotes";
import { usePerformanceSize } from "../features/practice/usePerformanceSize";
import { usePracticeSession } from "../features/practice/usePracticeSession";
import type { ScoreToolRequest } from "../features/scores/scoreToolRequest";
import { useSongOpening } from "./useSongOpening";
import type { DeviceObject } from "../features/devices/MusicDeviceList";
import { useProductScreens, type SettingsSection } from "./useProductScreens";
import { getInterfaceSettings } from "../features/settings/interfaceSettingsStore";
import { getInterfaceWorkbench } from "../features/settings/interfaceWorkbenchStore";

import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import {
api,type LoadedSong
} from "../api";
import { route as routeActions, useRoute, type Workspace } from "../stores/route";
import { matchesSong } from "../engine/stateOrder";
import { usePracticeRange } from "../features/practice/usePracticeRange";
const normalize = pathKey;


/** Session, navigation and actions of the application window; the view reads them through AppContext. */
import { useAppDialogs } from "./useAppDialogs";
import { useKeyboardViewport } from "../features/practice/useKeyboardViewport";

export function useAppModel() {
  useEffect(installDiagnostics, []);
  const dialogs = useAppDialogs();
  const {
    commandsOpen, setCommandsOpen, aboutOpen, setAboutOpen,
    metadata, setMetadata, metadataDraftPath, setMetadataDraftPath,
    settingsDevice, setSettingsDevice, exerciseDialog, setExerciseDialog, passageDialog, setPassageDialog,
    progressOpen, setProgressOpen, recoveryOpen, setRecoveryOpen, mediaExport, setMediaExport,
  } = dialogs;
  const releaseInput = useRef<() => void>(() => {});
  const inputOwnership = useDialogFocus(() => releaseInput.current());
  const workspaceSessions = useWorkspaceSessions();
  const workspace = useRoute((s) => s.workspace);
  const productScreens=useProductScreens();
  /** Every global setting lives on the settings page; other places link to its sections. The
   * stage pauses while the page is open. */
  const openSettings = (section: SettingsSection, device?: DeviceObject) => {
    if (productScreens.screen === "performance" && ["playing", "countIn"].includes(playback.getSnapshot().status)) void action({ type: "pause" });
    setSettingsDevice(section === "devices" ? device : undefined);
    productScreens.settings(section);
    return true;
  };
  const openSoundSettings = (device?: DeviceObject) => openSettings("devices", device);
  const songSetup=productScreens.screen==="setup";
  const setSongSetup=productScreens.setSongSetup;
  const bookmarkNavigation = useRef<BookmarkNavigation>(null);
  const interfaceSettings = getInterfaceSettings();
  const display = useSyncExternalStore(
    interfaceSettings.subscribe,
    interfaceSettings.getPreferences,
  );
  const setDisplay = interfaceSettings.setPreferences;
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
    song,
    refreshSession,
    refreshConfirmedSession,
    refreshOpenedSession,
    installSession,
    binding,
    reading,
    connected,
    health,
    refreshProblem,
    error,
    setError,
    refresh,
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
  const operationBusy = !!workspaceSessions.desktopClose.status || requestPending || Boolean(state.storage?.operation) || Boolean(state.storage?.error);
  const busy = operationBusy || binding;
  useEffect(() => {
    sessionRecovery.setContext({ engineId: progressEngineId, connected, binding, reading, busy: operationBusy, commandPending: requestPending, closing: !!workspaceSessions.desktopClose.status, title: song?.title, path: song?.sourcePath, state });
  }, [sessionRecovery, progressEngineId, connected, binding, reading, operationBusy, requestPending, !!workspaceSessions.desktopClose.status, song?.title, song?.sourcePath, state]);
  const [recentCommands, setRecentCommands] = useState<ApplicationCommandId[]>([]);
  const [editFingers, setEditFingers] = useState(false),
    [selectedNote, setSelectedNote] = useState<
      LoadedSong["notes"][number] | null
    >(null),
    [fingeringDraft, setFingeringDraft] = useState<import("../features/fingering/fingeringWorkbenchStore").FingeringDraft | null>(null),
    [paperRevision, setPaperRevision] = useState(0),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (!scoreToolRequest) return;
    const actual = playback.getSnapshot();
    if (workspace !== "practice" || view !== "score" || actual.contentId !== scoreToolRequest.contentId || actual.stateOrder?.engineId !== scoreToolRequest.engineId) setScoreToolRequest(null);
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
  const { pianoViewport, pianoRange, changePianoViewport, outsidePianoRange } = useKeyboardViewport(display, setDisplay, song?.notes, state.input);
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
    session:{playback,getBoundSong,setState,setError,refreshOpenedSession},
    song,binding,connected,startupReady,requestBusy,songOpeningActive,setBusy,setNotice,clearLiveNotes,
  });
  const changeWorkspace = useCallback(async (next: Workspace, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (next === workspace) { routeActions.navigate(next); return true; }
    if (requestBusy.current || busy || !startupReady || state.recording) return false;
    clearLiveNotes();
    const originEngine = playback.getEngineId();
    const changed = await routeActions.request(next, async (from, to) => {
      if (from === "practice" && to !== "practice") {
        if (!(await run({type:"pause"}))) return false;

      }
      const live = playback.getSnapshot();
      return originEngine === live.stateOrder?.engineId && !requestBusy.current &&
        !live.recording && live.startup?.ready !== false && !live.storage?.operation;
    }, signal);
    return changed;
  }, [busy, startupReady, state.recording, workspace, run, clearLiveNotes, playback]);
  const currentPracticeTarget: SongWorkspaceTarget | null = song && !binding && matchesSong(state, song) &&
    (progressEngineId ?? null) === (song.engineId ?? null)
    ? { contentId: song.contentId, title: song.title, path: song.sourcePath } : null;
  const workspaceUnavailable = workspaceSessions.desktopClose.status ? "正在保存并关闭软件。"
    : binding ? "正在读取当前练习，完成后可切换工作区。"
    : state.storage?.operation ? "正在保存练习资料，完成后可切换工作区。"
    : state.storage?.error ? "练习资料保存需要处理，请查看恢复入口。"
    : requestPending ? "正在处理当前操作，完成后可切换工作区。"
    : !startupReady ? "启动恢复完成后可切换工作区。"
    : state.recording ? "请先停止录音，再切换工作区。"
    : null;
  const currentPracticeUnavailable = workspaceUnavailable ?? (!connected ? "练习室重新连接后可打开或继续曲目。"
    : !currentPracticeTarget && song ? "正在读取当前练习，读齐后可继续。" : null);
  const resumeEditingSong = async (contentId: string, path?: string) => {
    if (!(await changeWorkspace("practice"))) return false;
    if (playback.getSnapshot().contentId !== contentId) {
      if (!path || !(await openPathRef.current(path))) return false;
    }
    return playback.getSnapshot().contentId === contentId;
  };
  const toolContext = JSON.stringify([aboutOpen, commandsOpen, progressOpen, recoveryOpen, exerciseDialog, metadata, fingeringWorkbenchOpen,
    fingeringDialog, passageDialog, handsDialog, meterDialog,
    scoresDialog, !!mediaExport]);
  const { recentFiles, forgetRecent, opening, openPath, chooseFile } = useSongOpening({
    connected, startupReady, busy, recording: state.recording, song, playback, requestBusy, songOpeningActive,
    changeWorkspace, clearLiveNotes, run, setNotice, setError,
    showOpened: (screen) => { setView("keyboard"); productScreens.show(screen); },
  });
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
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
    ui:{commands:()=>setCommandsOpen(true),browse:()=>void productActions.current.browse(),options:()=>setSongOptions(previous=>!previous),display:()=>openSettings("notes"),passages:()=>launchPracticeTool(()=>setPassageDialog(true)),fullscreen:()=>fullscreen()},
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
  /** The desktop window itself goes full screen (a page-level fullscreen in the webview would
   * not resize the window); the browser debug build uses the page fullscreen. */
  const fullscreen = () => {
    if (api.desktop) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const window = getCurrentWindow();
          await window.setFullscreen(!(await window.isFullscreen()));
        })
        .catch(() => setError("当前窗口无法进入全屏"));
    } else if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => setError("当前窗口无法进入全屏"));
  };
  const openWork=(entry:WorkEntry,signal:AbortSignal)=>openWorkEntry(entry,signal,{
    unavailable:target=>{
      if(workspaceSessions.desktopClose.status)return "正在准备退出，请返回窗口后继续。";
      
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
      else if(target==="drafts"){setMetadataDraftPath(null);setMetadata(true);}
    },
    openInterface:()=>{
      const draft=getInterfaceWorkbench(),input=draft.getSnapshot(),settings=interfaceSettings.getSnapshot();
      openSettings(settings.protected||settings.error||input.storageError||input.preview||input.error||input.preparedExport&&!["saved","requested"].includes(input.preparedExport.phase)?"backup":"notes");
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
    inspector: (signal) => openPracticeTool(signal, () => setSongOptions(true), false),
    devices: () => openSoundSettings(),
    display: () => openSettings("notes"),
    silence: () => action({ type: "panic" }),
    fullscreen: () => { fullscreen(); return true; },
    exportPracticeMidi: () => {
      if (!song) return false;
      setMediaExport({ contentId: song.contentId, title: song.title, path: song.sourcePath, engineId: song.engineId, kind: "practiceMidi" });
      return true;
    },
    exportMidi: () => { exportMidi(); return !!song; },
    pairScore: (signal) => openPracticeTool(signal, () => scorePairing.request(), false),
    fingeringWorkbench: (signal) => openPracticeTool(signal, () => setFingeringWorkbenchOpen(true), false),
    logs: () => { void api.openLogs().catch((e) => setError(String(e))); return true; },
    about: () => { setAboutOpen(true); return true; },
  }, {
    engine: !connected ? "练习室连接中断，请等待重新连接。" : binding ? "正在读取当前练习，请稍后再试。" : !startupReady ? "练习室正在恢复，完成后可使用。" : operationBusy ? "正在处理练习资料，请等待当前操作完成。" : null,
    idle: state.recording ? "请先停止并保存当前录音。" : null,
    loaded: !song ? "请先打开一首曲目。" : null,
    song: !song || !song.notes.length ? "请先打开一首可演奏的曲目。" : null,
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
    screens:productScreens,changeWorkspace,run,clearLiveNotes,closeMenu:()=>{},
  });
  const goHomeRef=useRef(goHome);goHomeRef.current=goHome;
  productActions.current={browse:goHome,resume:resumePractice};
  return {
    workspaceSessions,
    workspace,
    productScreens,
    songSetup,
    setSongSetup,
    bookmarkNavigation,
    display,
    setDisplay,
    performanceSize,
    view,
    setView,
    seconds,
    setSeconds,
    playback,
    getBoundSong,
    state,
    setState,
    song,
    refreshSession,
    refreshConfirmedSession,
    installSession,
    binding,
    connected,
    health,
    error,
    setError,
    editors,
    songOptions,
    setSongOptions,
    setScoresDialog,
    fingeringDialog,
    setFingeringDialog,
    fingeringWorkbenchOpen,
    setFingeringWorkbenchOpen,
    songOpeningActive,
    onNote,
    pointerNote,
    clearLiveNotes,
    sessionRecovery,
    startupReady,
    setBusy,
    scoreToolRequest,
    clearScoreToolRequest,
    progressEngineId,
    operationBusy,
    busy,
    commandsOpen,
    setCommandsOpen,
    aboutOpen,
    setAboutOpen,
    metadataDraftPath,
    setMetadataDraftPath,
    recentCommands,
    setRecentCommands,
    settingsDevice,
    setSettingsDevice,
    openSoundSettings,
    openSettings,
    editFingers,
    setEditFingers,
    selectedNote,
    setSelectedNote,
    exerciseDialog,
    setExerciseDialog,
    metadata,
    setMetadata,
    fingeringDraft,
    setFingeringDraft,
    passageDialog,
    setPassageDialog,
    progressOpen,
    setProgressOpen,
    recoveryOpen,
    setRecoveryOpen,
    paperRevision,
    setPaperRevision,
    mediaExport,
    setMediaExport,
    notice,
    setNotice,
    pianoViewport,
    pianoRange,
    changePianoViewport,
    outsidePianoRange,
    loopStart,
    setLoopStart,
    loopEnd,
    setLoopEnd,
    practiceRange,
    requestBusy,
    run,
    action,
    adjustRealtime,
    changeWorkspace,
    workspaceUnavailable,
    resumeEditingSong,
    recentFiles,
    forgetRecent,
    openPath,
    chooseFile,
    launchPracticeTool,
    scorePairing,
    keyboardContext,
    exportMidi,
    fullscreen,
    openWork,
    openRecovery,
    recoverSession,
    commandActions,
    openingActive,
    goHome,
    openFreePlay,
    resumePractice,
  };
}
export type AppModel = ReturnType<typeof useAppModel>;
