import { useApp } from "./AppContext";
import { SongEditorHost } from "../features/screens/SongEditorHost";
import { PerformanceTools } from "../features/practice/PerformanceTools";
import { AboutDialog } from "./AboutDialog";
import { ActionSearch } from "./ActionSearch";
import { ApplicationMenu } from "./ApplicationMenu";
import { DesktopCloseProgress } from "./DesktopCloseProgress";
import { topInputScope,topPopup } from "./inputOwnership";
import { PreparationButton } from "./PreparationButton";
import { SessionRecoveryDialog } from "./recovery/SessionRecovery";
import { SessionStatus } from "./SessionStatus";
import { StartupNotice } from "./StartupNotice";
import { pathKey } from "../engine/pathIdentity";
import { TaskActivity } from "../engine/TaskActivity";
import { WorkProgressDialog } from "../features/activity/WorkProgress";
import { EditDraftCenter } from "../features/editing/EditDraftCenter";
import { PlaybackView } from "../features/practice/PlaybackView";
import {
PracticeStageReadout
} from "../features/practice/PracticeReadouts";
import { PracticeStage } from "../features/practice/PracticeStage";
import { PracticeTransport } from "../features/practice/PracticeTransport";
import { PracticeWelcome } from "../features/practice/PracticeWelcome";
import { SongSetupScreen } from "../features/practice/SongSetupScreen";
import { SongFilesDialog } from "../features/screens/SongFilesDialog";
import { HandSplitScreen } from "../features/screens/HandSplitScreen";
import { HomeScreen } from "../features/screens/HomeScreen";
import { ScreenHeader } from "../features/screens/ScreenHeader";
import { SettingsScreen } from "../features/screens/SettingsScreen";
import { TrackSetupScreen } from "../features/screens/TrackSetupScreen";
import { product } from "../product.generated";

import {
Maximize2,
X
} from "lucide-react";
import {
api,
pitchName
} from "../api";
import { DisplaySettingsDialog } from "../features/settings/DisplaySettingsDialog";
import { DeviceSettingsDialog } from "../features/devices/DeviceSettingsDialog";
import { MediaExportButton } from "../features/exports/MediaExportButton";
import { MediaExportDialog } from "../features/exports/MediaExportDialog";
import { FingeringWorkbench } from "../features/fingering/FingeringWorkbench";
import { fingeringDraftId } from "../features/fingering/fingeringWorkbenchStore";
import { PracticeTimeline } from "../features/practice/PracticeTimeline";
import { FingeringDialog } from "../features/fingering/FingeringDialog";
import { Notation } from "../features/scores/Notation";
import { PaperScore } from "../features/scores/PaperScore";
import { PassageDialog } from "../features/practice/PassageDialog";
import { Piano } from "../stage/Piano";
import { ExerciseDialog } from "../features/practice/ExerciseDialog";
import { MetadataDialog } from "../features/library/SongMetadataDialog";
import { shortcutLabel } from "./shortcuts";
const normalize = pathKey;


/** The application window: menu, product screens, practice workspace and dialogs. */
export function AppShell() {
  const {
    appMenuOpen,
    setAppMenuOpen,
    workspaceSessions,
    workspace,
    productScreens,
    songSetup,
    setSongSetup,
    bookmarkNavigation,
    display,
    setDisplay,
    displayDialog,
    setDisplayDialog,
    displaySection,
    setDisplaySection,
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
    editDraftsOpen,
    setEditDraftsOpen,
    metadataDraftPath,
    setMetadataDraftPath,
    recentCommands,
    setRecentCommands,
    settingsTab,
    setSettingsTab,
    settingsDevice,
    openSoundSettings,
    settingsReturnToScores,
    setSettingsReturnToScores,
    settings,
    setSettings,
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
    recital,
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
    songFilesOpen,
    setSongFilesOpen,
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
  } = useApp();
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
        <ApplicationMenu disabled={!startupReady || !!state.storage?.operation || !!workspaceSessions.desktopClose.status} groups={[
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
      {startupReady && productScreens.screen==="home" && <HomeScreen recent={recentFiles} disabled={!!workspaceUnavailable||!connected} chooseFile={chooseFile} open={openPath} forget={forgetRecent} freePlay={()=>void openFreePlay()} settings={()=>productScreens.settings()}/>}
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
              status={{busy,openingActive,connected,startupReady,editable:!recital}}
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
              disabled={busy || openingActive || state.recording || !connected}
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
        changed={async kind=>{await refreshConfirmedSession();if(kind==="meter"){setLoopStart(1);setLoopEnd(1);}}}
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
            await refreshConfirmedSession();
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
            await refreshConfirmedSession();
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
        context={`${workspace === "home" ? "主页" : "练习"} · ${song ? `当前练习：${song.title}` : "还未选择练习曲目"}`}
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
        unavailable={!connected ? "练习室连接中断，当前显示上次读取的设备设置。重新连接后可更改。" : !startupReady ? "启动恢复尚未完成，当前可以查看设备与原选择。返回恢复入口继续处理资料。" : binding ? "曲目与设备状态仍在交接，完成后可以更改设置。" : operationBusy ? "当前操作尚未结束，可以查看设备与连接进度。完成后可更改设置。" : undefined}
        busy={busy}
        error={health.getMessages().action}
        command={run}
        synchronize={refreshSession}
        reportError={setError}
        close={() => {setSettings(false);setSettingsTab("sound");if(settingsReturnToScores)setScoresDialog(true);setSettingsReturnToScores(false);}}
      />}
      {editDraftsOpen && <EditDraftCenter store={workspaceSessions.edits} close={() => setEditDraftsOpen(false)} changed={async () => { await refreshConfirmedSession(); }}
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
