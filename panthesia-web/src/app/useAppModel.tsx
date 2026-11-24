import { usePerformanceKeyboard } from "../features/practice/usePerformanceKeyboard";
import { useSongEditors } from "../features/editing/useSongEditors";
import { openWorkEntry } from "../features/activity/workNavigation";
import { useScorePairing } from "../features/scores/useScorePairing";
import { usePracticeToolNavigation } from "./usePracticeToolNavigation";
import { usePlaybackActions } from "../features/practice/usePlaybackActions";
import { useProductNavigation } from "./useProductNavigation";
import { applicationCommands } from "./applicationCommands";
import { installDiagnostics } from "../lib/diagnostics";
import { topInputScope,topPopup } from "../lib/inputOwnership";
import type { RecoveryHost } from "./recovery/recoveryActions";
import { createSessionRecoveryStore } from "./recovery/sessionRecoveryStore";
import { useRecoverSession } from "./recovery/useRecoverSession";
import { useWorkspaceChange } from "./useWorkspaceChange";
import { useWindowGuards } from "./useWindowGuards";
import { toggleFullscreen } from "./windowActions";
import { usePracticeUiSync } from "../features/practice/usePracticeUiSync";
import { useTheme, useUiScale } from "../features/settings/useUiScale";
import { practiceUi, usePracticeUi } from "../stores/practiceUi";
import { useDialogFocus } from "./useDialogFocus";
import { useWorkspaceSessions } from "./useWorkspaceSessions";
import type { DisplayPreferences } from "../features/settings/displayPreferences";
import type { WorkEntry } from "../features/activity/workProgressStore";
import { type BookmarkNavigation } from "../features/practice/SongBookmarks";
import { useLiveNotes } from "../features/practice/useLiveNotes";
import { usePerformanceSize } from "../features/practice/usePerformanceSize";
import { usePracticeSession } from "../features/practice/usePracticeSession";
import { useSongOpening } from "./useSongOpening";
import type { DeviceObject } from "../features/devices/MusicDeviceList";
import { useProductScreens, type SettingsSection } from "./useProductScreens";
import { getInterfaceSettings, setDisplay, useDisplay } from "../features/settings/interfaceSettingsStore";
import { getInterfaceWorkbench } from "../features/settings/interfaceWorkbenchStore";

import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import { api } from "../api";
import { useRoute } from "../stores/route";
import { usePracticeRange } from "../features/practice/usePracticeRange";
import { useAppDialogs } from "./useAppDialogs";
import { useKeyboardViewport } from "../features/practice/useKeyboardViewport";

/** The application's composition root: the engine session, navigation and the actions that
 * join them. Interface state lives in stores (route, dialogs, practiceUi); only the app/
 * components read this model, through AppContext. */
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
  const display = useDisplay();
  useUiScale(display.uiScale);
  useTheme(display.theme);
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
  const scoreToolRequest = usePracticeUi((s) => s.scoreToolRequest);
  const { setScoreToolRequest, setNotice, setSelectedNote } = practiceUi;
  const progressEngineId = useSyncExternalStore(playback.subscribe, playback.getEngineId, playback.getEngineId);
  useEffect(() => {
    workspaceSessions.workProgress.setContext({ engineId: progressEngineId, connected, closing: !!workspaceSessions.desktopClose.status });
  }, [workspaceSessions.workProgress, progressEngineId, connected, !!workspaceSessions.desktopClose.status]);
  const operationBusy = !!workspaceSessions.desktopClose.status || requestPending || Boolean(state.storage?.operation) || Boolean(state.storage?.error);
  const busy = operationBusy || binding;
  useEffect(() => {
    sessionRecovery.setContext({ engineId: progressEngineId, connected, binding, reading, busy: operationBusy, commandPending: requestPending, closing: !!workspaceSessions.desktopClose.status, title: song?.title, path: song?.sourcePath, state });
  }, [sessionRecovery, progressEngineId, connected, binding, reading, operationBusy, requestPending, !!workspaceSessions.desktopClose.status, song?.title, song?.sourcePath, state]);
  useEffect(() => {
    if (!scoreToolRequest) return;
    const actual = playback.getSnapshot();
    if (workspace !== "practice" || view !== "combined" || actual.contentId !== scoreToolRequest.contentId || actual.stateOrder?.engineId !== scoreToolRequest.engineId) setScoreToolRequest(null);
  }, [scoreToolRequest, workspace, view, state.contentId, progressEngineId, state.mode, playback]);
  usePracticeUiSync(song, state.passage, fingeringDialog);
  const { pianoViewport, pianoRange, changePianoViewport, outsidePianoRange } = useKeyboardViewport(display, setDisplay, song?.notes, state.input);
  const loopStart = usePracticeUi((s) => s.loopStart), loopEnd = usePracticeUi((s) => s.loopEnd);
  const practiceRange=usePracticeRange(song,playback);
  const requestBusy = useRef(false);
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
  const openPathRef = useRef<(path: string) => Promise<boolean>>(async () => false);
  const { changeWorkspace, workspaceUnavailable, resumeEditingSong } = useWorkspaceChange({
    workspace, busy, startupReady, state, closing: !!workspaceSessions.desktopClose.status, binding, requestPending,
    requestBusy, playback, run, clearLiveNotes, openPath: openPathRef,
  });
  const toolContext = JSON.stringify([aboutOpen, commandsOpen, progressOpen, recoveryOpen, exerciseDialog, metadata, fingeringWorkbenchOpen,
    fingeringDialog, passageDialog, handsDialog, meterDialog,
    scoresDialog, !!mediaExport]);
  const { recentFiles, forgetRecent, opening, openPath, chooseFile } = useSongOpening({
    connected, startupReady, busy, recording: state.recording, song, playback, requestBusy, songOpeningActive,
    changeWorkspace, clearLiveNotes, run, setNotice, setError,
    showOpened: (screen) => { setView("keyboard"); productScreens.show(screen); },
  });
  openPathRef.current = openPath;
  const {openPracticeTool,launchPracticeTool}=usePracticeToolNavigation({toolContext,changeWorkspace,playback,run,setError});
  useWindowGuards(!!state.storage?.pending);
  const scorePairing=useScorePairing({song,playback,run,setView,setError});
  const keyboardPaused=!!workspaceSessions.desktopClose.status||!startupReady||Boolean(state.storage?.operation)||workspace!=="practice"||!["performance","freePlay"].includes(productScreens.screen)||inputOwnership.modal||inputOwnership.popup;
  const shortcutScope=JSON.stringify([song?.engineId,song?.contentId,song?.scoreRevision,workspace,loopStart,loopEnd]);
  const {keyboardContext,invalidateKeyboardActions}=usePerformanceKeyboard({
    display,setDisplay,song,playback,getBoundSong,keyboardPaused,shortcutScope,ownershipRevision:inputOwnership.revision,songOpeningActive,
    run,action,setState,setError,onNote,clearLiveNotes,loopStart,loopEnd,bookmarkNavigation,
    ui:{commands:()=>setCommandsOpen(true),browse:()=>void productActions.current.browse(),options:()=>setSongOptions(previous=>!previous),display:()=>openSettings("notes"),passages:()=>launchPracticeTool(()=>setPassageDialog(true)),fullscreen:()=>fullscreen()},
  });
  releaseInput.current=()=>{invalidateKeyboardActions();clearLiveNotes();};
  const exportMidi = () => {
    if (song) setMediaExport({contentId: song.contentId, title: song.title, path: song.sourcePath, engineId: song.engineId});
  };
  const fullscreen = () => toggleFullscreen(setError);
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
    openScore:request=>{setView("combined");productScreens.show("performance");setScoreToolRequest(request);},
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
  const recoveryHost: RecoveryHost = {
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
  const recoverSession = useRecoverSession(sessionRecovery, recoveryHost);
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
    score: (signal) => openPracticeTool(signal, () => setView("combined"), false),
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
    progressEngineId,
    operationBusy,
    busy,
    commandsOpen,
    setCommandsOpen,
    aboutOpen,
    setAboutOpen,
    metadataDraftPath,
    setMetadataDraftPath,
    settingsDevice,
    setSettingsDevice,
    openSoundSettings,
    openSettings,
    exerciseDialog,
    setExerciseDialog,
    metadata,
    setMetadata,
    passageDialog,
    setPassageDialog,
    progressOpen,
    setProgressOpen,
    recoveryOpen,
    setRecoveryOpen,
    mediaExport,
    setMediaExport,
    pianoViewport,
    pianoRange,
    changePianoViewport,
    outsidePianoRange,
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
