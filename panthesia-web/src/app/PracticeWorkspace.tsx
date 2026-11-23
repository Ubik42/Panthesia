import { useApp } from "./AppContext";
import { PerformanceTools } from "../features/practice/PerformanceTools";
import { topInputScope,topPopup } from "./inputOwnership";
import { pathKey } from "../engine/pathIdentity";
import { usePlaybackFields } from "../features/practice/usePlaybackFields";
import type { PlaybackStore } from "../features/practice/playbackStore";
import { PracticeStageReadout } from "../features/practice/PracticeReadouts";
import { PracticeStage } from "../features/practice/PracticeStage";
import { PracticeTransport } from "../features/practice/PracticeTransport";
import { PracticeWelcome } from "../features/practice/PracticeWelcome";

import { X } from "lucide-react";
import { api,pitchName } from "../api";
import { PracticeTimeline } from "../features/practice/PracticeTimeline";
import { Notation } from "../features/scores/Notation";
import { PaperScore } from "../features/scores/PaperScore";
import { Piano } from "../stage/Piano";
import { shortcutLabel } from "./shortcuts";
const normalize = pathKey;

/** The practice workspace: stage, notation, paper scores and transport. */
export function PracticeWorkspace() {
  const {
    setCommandsOpen,
    clearLiveNotes,
    workspace,
    productScreens,
    setSongSetup,
    bookmarkNavigation,
    display,
    setDisplay,
    openSettings,
    performanceSize,
    view,
    setView,
    seconds,
    setSeconds,
    playback,
    state,
    song,
    installSession,
    connected,
    songOptions,
    setSongOptions,
    setScoresDialog,
    setFingeringDialog,
    setFingeringWorkbenchOpen,
    songOpeningActive,
    onNote,
    pointerNote,
    startupReady,
    scoreToolRequest,
    clearScoreToolRequest,
    busy,
    openSoundSettings,
    editFingers,
    setEditFingers,
    selectedNote,
    setSelectedNote,
    setExerciseDialog,
    paperRevision,
    pianoViewport,
    pianoRange,
    changePianoViewport,
    outsidePianoRange,
    practiceRange,
    run,
    action,
    adjustRealtime,
    recentFiles,
    openPath,
    chooseFile,
    launchPracticeTool,
    scorePairing,
    keyboardContext,
    openingActive,
  } = useApp();
  return (
    <>
      <div
        className="workspace"
        ref={performanceSize.root}
        data-practice-compact={performanceSize.compact ? "" : undefined}
        data-practice-short={performanceSize.short ? "" : undefined}
        hidden={
          workspace !== "practice" ||
          !startupReady ||
          productScreens.screen !== "performance"
        }
        inert={
          workspace !== "practice" ||
          !startupReady ||
          productScreens.screen !== "performance"
        }
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
            back={() => {
              void run({ type: "pause" }).then((ok) => {
                if (ok) {
                  setSongSetup(true);
                }
              });
            }}
            tools={
              <PerformanceTools
                song={song}
                playback={playback}
                display={display}
                setDisplay={setDisplay}
                status={{
                  busy,
                  openingActive,
                  connected,
                  startupReady,
                }}
                keyboard={{
                  range: pianoRange,
                  viewport: pianoViewport,
                  outside: outsidePianoRange,
                }}
                practiceRange={practiceRange}
                bookmarkNavigation={bookmarkNavigation}
                visible={productScreens.screen === "performance"}
                editFingers={editFingers}
                setEditFingers={setEditFingers}
                clearSelection={() => setSelectedNote(null)}
                action={action}
                run={run}
                adjustRealtime={adjustRealtime}
                setView={setView}
                open={{
                  songOptions: () => setSongOptions(true),
                  scores: () => setScoresDialog(true),
                  devices: () => openSoundSettings(),
                  display: () => openSettings("notes"),
                  fingeringWorkbench: () => setFingeringWorkbenchOpen(true),
                  parts: () => {
                    void run({ type: "pause" }).then((ok) => {
                      if (ok) productScreens.show("parts");
                    });
                  },
                  pairScore: scorePairing.request,
                  fingering: () =>
                    launchPracticeTool(() => {
                      setSelectedNote(null);
                      setFingeringDialog(true);
                    }),
                }}
              />
            }
            menu={() => { clearLiveNotes(); setCommandsOpen(true); }}
            available={!!song}
            busy={busy || openingActive}
            connected={connected}
            nextTitle="下一小节"
            previous={() => {
              const position = playback.getSnapshot().position;
              const previous = [...(song?.measures ?? [])]
                .reverse()
                .find((bar) => bar.start < position - 0.1);
              void adjustRealtime({
                type: "seek",
                position: previous?.start ?? 0,
              });
            }}
            next={() => {
              const position = playback.getSnapshot().position;
              const upcoming = song?.measures.find(
                (bar) => bar.start > position + 0.1,
              );
              if (upcoming)
                void adjustRealtime({ type: "seek", position: upcoming.start });
            }}
            command={action}
            adjust={adjustRealtime}
            stopRecording={() => {
              void run({ type: "recording", active: false }, true);
            }}
            playShortcut={
              display.shortcuts.playPause
                ? shortcutLabel(display.shortcuts.playPause)
                : ""
            }
            restartShortcut={
              display.shortcuts.restart
                ? shortcutLabel(display.shortcuts.restart)
                : ""
            }
          />
          <PracticeTimeline
            range={practiceRange}
            store={playback}
            song={song}
            busy={busy || openingActive}
            disabled={!connected || state.recording}
            seek={(position) => adjustRealtime({ type: "seek", position })}
          />
          <PracticeStage
            combined={view === "combined"}
            axis={
              display.practiceSplitAxis === "auto"
                ? "rows"
                : display.practiceSplitAxis
            }
            ratio={
              display.practiceSplitAxis === "auto"
                ? 25
                : display.practiceSplitRatio
            }
            changeRatio={(value) =>
              setDisplay((previous) => ({
                ...previous,
                practiceSplitRatio: value,
                practiceSplitAxis:
                  previous.practiceSplitAxis === "auto"
                    ? "rows"
                    : previous.practiceSplitAxis,
              }))
            }
          >
            <div
              className="practice-stage-keyboard"
              hidden={view !== "keyboard" && view !== "combined"}
              role="region"
              aria-label="瀑布与琴键区域"
            >
              {productScreens.screen === "performance" &&
                (view === "keyboard" || view === "combined") && (
                  <Piano
                    song={song}
                    state={playback.getSnapshot()}
                    store={playback}
                    onNote={pointerNote}
                    canInteract={() =>
                      !keyboardContext.current.paused &&
                      !songOpeningActive.current &&
                      !topInputScope() &&
                      !topPopup(null)
                    }
                    keyboardRange={pianoRange}
                    keyboardViewport={pianoViewport}
                    onViewportChange={changePianoViewport}
                    onPreviewBarsChange={setSeconds}
                    previewBars={seconds}
                    display={display}
                    onSelect={
                      practiceRange.picking
                        ? practiceRange.pick
                        : editFingers
                          ? setSelectedNote
                          : undefined
                    }
                    practiceRange={practiceRange.range}
                  />
                )}
              {(view === "keyboard" || view === "combined") &&
                (song || state.recording) && (
                  <PracticeStageReadout
                    store={playback}
                    connected={connected}
                    song={song}
                    display={display}
                  />
                )}
            </div>
            <div
              className="practice-stage-notation"
              hidden={view !== "score" && view !== "combined"}
              role="region"
              aria-label="五线谱区域"
            >
              {productScreens.screen === "performance" &&
                (view === "score" || view === "combined") &&
                song && (
                  state.contentId === song.contentId && (
<Notation
                        toolRequest={scoreToolRequest}
                        clearToolRequest={clearScoreToolRequest}
                        song={song}
                        store={playback}
                        seek={(position) => action({ type: "seek", position })}
                        selectPracticeNote={
                          practiceRange.picking ? practiceRange.pick : undefined
                        }
                        practiceRange={practiceRange.range}
                        loop={(start, end) =>
                          run({ type: "loop", start, end, enabled: true })
                        }
                        changed={async () => {
                          const session = await api.session();
                          installSession(session);
                        }}
                        detail={(note) => {
                          setSelectedNote(note);
                          setFingeringDialog(true);
                        }}
                        assignHands={() => {
                          void run({ type: "pause" }).then((ok) => {
                            if (ok) productScreens.show("parts");
                          });
                        }}
                        edit={editFingers}
                        canEdit
                        onEdit={(value) => {
                          if (value) practiceRange.cancelPicking();
                          setEditFingers(value);
                        }}
                      />
                  )
                )}
            </div>
            {productScreens.screen === "performance" &&
              view === "paper" &&
              song && (
                state.contentId === song.contentId && (
<FollowingPaperScore
                      store={playback}
                      engineId={song.engineId ?? undefined}
                      contentId={song.contentId}
                      revision={paperRevision}
                      contextKey={JSON.stringify(
                        song.meterMap ?? song.meterCorrection,
                      )}
                    />
                )
              )}
            {selectedNote &&
              view !== "score" &&
              view !== "combined" && (
                <div className="finger-editor">
                  <span>
                    {pitchName(selectedNote.pitch)} · 当前指法{" "}
                    {selectedNote.finger ?? "未设置"}
                  </span>
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
                        className={
                          selectedNote.finger === finger
                            ? "selected"
                            : undefined
                        }
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
                      title={
                        song?.generated
                          ? "清除后使用默认指法"
                          : "清除此音的个人指法"
                      }
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
            {!song && (
              <PracticeWelcome
                resumeTitle={recentFiles.find((file) => file.exists)?.title}
                resumeRecent={recentFiles.some((file) => file.exists)}
                disabled={
                  busy || openingActive || state.recording || !connected
                }
                input={state.input}
                inputConnected={state.inputConnected}
                resume={() => {
                  const target = recentFiles.find((file) => file.exists);
                  if (target) void openPath(target.path);
                }}
                choose={() => void chooseFile()}
                importFile={() => void chooseFile()}
                generate={() =>
                  launchPracticeTool(() => setExerciseDialog(true))
                }
                devices={() => openSoundSettings()}
              />
            )}
          </PracticeStage>
        </main>
      </div>
    </>
  );
}

const measureField = ["measure"] as const;
/** The paper reader follows the playing measure; only a measure change renders it. */
function FollowingPaperScore({ store, ...props }: Omit<Parameters<typeof PaperScore>[0], "playback"> & { store: PlaybackStore }) {
  const { measure } = usePlaybackFields(store, measureField);
  return <PaperScore {...props} playback={{ measure }} />;
}
