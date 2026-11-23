import "../ui/legacyDialog.css";
import { useApp } from "./AppContext";
import { SongEditorHost } from "../features/screens/SongEditorHost";
import { AboutDialog } from "./AboutDialog";
import { ActionSearch } from "./ActionSearch";
import { SessionRecoveryDialog } from "./recovery/SessionRecovery";
import { pathKey } from "../engine/pathIdentity";
import { WorkProgressDialog } from "../features/activity/WorkProgress";
import { EditDraftCenter } from "../features/editing/EditDraftCenter";

import { api } from "../api";
import { MediaExportDialog } from "../features/exports/MediaExportDialog";
import { FingeringWorkbench } from "../features/fingering/FingeringWorkbench";
import { fingeringDraftId } from "../features/fingering/fingeringWorkbenchStore";
import { FingeringDialog } from "../features/fingering/FingeringDialog";
import { PassageDialog } from "../features/practice/PassageDialog";
import { ExerciseDialog } from "../features/practice/ExerciseDialog";
import { MetadataDialog } from "../features/library/SongMetadataDialog";
const normalize = pathKey;

/** Song editors and the application's dialogs. */
export function AppDialogs() {
  const {
    workspaceSessions,
    workspace,
    productScreens,
    openSettings,
    display,
    setDisplay,
    setView,
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
    setScoresDialog,
    fingeringDialog,
    setFingeringDialog,
    fingeringWorkbenchOpen,
    setFingeringWorkbenchOpen,
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
    editDraftsOpen,
    setEditDraftsOpen,
    metadataDraftPath,
    setMetadataDraftPath,
    recentCommands,
    setRecentCommands,
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
    setPaperRevision,
    mediaExport,
    setMediaExport,
    loopStart,
    setLoopStart,
    loopEnd,
    setLoopEnd,
    requestBusy,
    run,
    action,
    changeWorkspace,
    resumeEditingSong,
    scorePairing,
    openWork,
    recoverSession,
    commandActions,
    openingActive,
    resumePractice,
  } = useApp();
  return (
    <>
      <input
        ref={scorePairing.input}
        type="file"
        accept=".musicxml,.xml,.mxl"
        aria-label="配对乐谱文件"
        hidden
        onChange={scorePairing.change}
      />
      <SongEditorHost
        song={song}
        editors={editors}
        disabled={busy || openingActive || state.recording}
        scoreWorkspace={workspaceSessions.scores}
        configureDuet={() => {
          setScoresDialog(false);
          openSettings("tools");
        }}
        openScorePractice={async () => {
          if (!song) return;
          const current = playback.getSnapshot();
          if (
            current.contentId !== song.contentId ||
            playback.getEngineId() !== song.engineId
          )
            throw new Error("当前歌曲已改变，请返回对应歌曲打开谱面。");
          if (!(await changeWorkspace("practice")))
            throw new Error("谱面已采用，可稍后打开演奏。");
          setView("score");
          productScreens.show("performance");
          setScoresDialog(false);
          setPaperRevision((value) => value + 1);
        }}
        paperChanged={() => setPaperRevision((value) => value + 1)}
        changed={async (kind) => {
          await refreshConfirmedSession();
          if (kind === "meter") {
            setLoopStart(1);
            setLoopEnd(1);
          }
        }}
        loopStart={loopStart}
        loopEnd={loopEnd}
        applyVariant={async (value) => {
          if (!song) return false;
          const ok = await run(
            {
              type: "practiceVariant",
              content_id: song.contentId,
              score_revision: song.scoreRevision,
              value,
            },
            true,
          );
          if (ok)
            setDisplay((previous) => ({
              ...previous,
              ...(value.quantize
                ? { gridSubdivision: value.quantize as 8 | 16 | 32 }
                : {}),
              tonic:
                ((value.tonic ?? song.practiceVariant?.tonic ?? 0) +
                  (value.transpose ?? 0) +
                  120) %
                12,
            }));
          return ok;
        }}
        execute={(command) => run(command, true)}
      />
      {mediaExport && (
        <MediaExportDialog
          source={mediaExport}
          kind={mediaExport.kind ?? "midi"}
          close={() => setMediaExport(null)}
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
          openWorkbench={() => {
            setFingeringDialog(false);
            setFingeringWorkbenchOpen(true);
          }}
          close={() => {
            setFingeringDialog(false);
            setFingeringDraft(null);
          }}
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
            if (requestBusy.current)
              throw new Error("当前操作尚未结束，请稍后再生成。");
            requestBusy.current = true;
            setBusy(true);
            clearLiveNotes();
            try {
              await work();
            } finally {
              requestBusy.current = false;
              setBusy(false);
            }
          }}
          refreshGenerated={async (source) => {
            await refreshConfirmedSession();
            const latest = await api.state();
            if (
              latest.contentId !== source.contentId ||
              latest.stateOrder?.engineId !== source.engineId
            )
              throw new Error("练习或连接已再次切换，请重新打开已生成的练习。");
            setExerciseDialog(false);
          }}
        />
      )}
      {commandsOpen && (
        <ActionSearch
          actions={commandActions}
          recent={recentCommands}
          context={`${workspace === "home" ? "主页" : "练习"} · ${song ? `当前练习：${song.title}` : "还未选择练习曲目"}`}
          shortcut={display.shortcuts.commands}
          close={() => setCommandsOpen(false)}
          used={(id) =>
            setRecentCommands((old) =>
              [id, ...old.filter((value) => value !== id)].slice(0, 6),
            )
          }
          silence={async () => {
            clearLiveNotes();
            await api.command({ type: "panic" });
            setState(await api.state());
          }}
        />
      )}
      {editDraftsOpen && (
        <EditDraftCenter
          store={workspaceSessions.edits}
          close={() => setEditDraftsOpen(false)}
          changed={async () => {
            await refreshConfirmedSession();
          }}
          resumePractice={async (contentId, path) => {
            if (!(await resumeEditingSong(contentId, path))) return false;
            setMetadataDraftPath(path);
            setMetadata(true);
            return true;
          }}
        />
      )}

      {fingeringWorkbenchOpen && (
        <FingeringWorkbench
          store={workspaceSessions.fingeringWorkbench}
          close={() => setFingeringWorkbenchOpen(false)}
          resume={async (draft) => {
            if (!(await resumeEditingSong(draft.contentId, draft.path)))
              return false;
            if (
              ["playing", "countIn"].includes(playback.getSnapshot().status) &&
              !(await run({ type: "pause" }))
            )
              return false;
            const current = getBoundSong();
            if (!current || current.contentId !== draft.contentId)
              throw new Error("曲目已经切换，请重新打开这份指法输入。");
            const note = draft.origin
              ? current.notes.find(
                  (note) =>
                    note.track === draft.origin!.track &&
                    note.index === draft.origin!.index,
                )
              : null;
            if (draft.origin && !note)
              throw new Error(
                "原音符位置暂时无法核对。输入继续保留，可复制后在当前曲目重新定位。",
              );
            setSelectedNote(note ?? null);
            setFingeringDraft(draft);
            setFingeringDialog(true);
            setFingeringWorkbenchOpen(false);
            return true;
          }}
        />
      )}
      {recoveryOpen && !workspaceSessions.desktopClose.status && (
        <SessionRecoveryDialog
          store={sessionRecovery}
          act={recoverSession}
          close={() => setRecoveryOpen(false)}
        />
      )}
      {progressOpen && !workspaceSessions.desktopClose.status && (
        <WorkProgressDialog
          store={workspaceSessions.workProgress}
          close={() => setProgressOpen(false)}
          open={openWork}
        />
      )}
      {aboutOpen && !workspaceSessions.desktopClose.status && (
        <AboutDialog close={() => setAboutOpen(false)} />
      )}
    </>
  );
}
