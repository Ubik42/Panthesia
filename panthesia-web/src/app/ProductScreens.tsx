import { useApp } from "./AppContext";
import { topInputScope, topPopup } from "./inputOwnership";
import { pathKey } from "../engine/pathIdentity";
import { SongSetupScreen } from "../features/practice/SongSetupScreen";
import { SongFilesDialog } from "../features/screens/SongFilesDialog";
import { HandSplitScreen } from "../features/screens/HandSplitScreen";
import { HomeScreen } from "../features/screens/HomeScreen";
import { ScreenHeader } from "../features/screens/ScreenHeader";
import { SettingsScreen } from "../features/screens/SettingsScreen";
import { TrackSetupScreen } from "../features/screens/TrackSetupScreen";

import { api } from "../api";
import { Piano } from "../stage/Piano";
const normalize = pathKey;

/** Home, settings, song setup, track and hand split screens, and free play. */
export function ProductScreens() {
  const {
    setAppMenuOpen,
    workspace,
    productScreens,
    songSetup,
    display,
    displayDialog,
    setDisplayDialog,
    setDisplaySection,
    playback,
    state,
    song,
    connected,
    setError,
    setSongOptions,
    setScoresDialog,
    onNote,
    pointerNote,
    startupReady,
    progressEngineId,
    busy,
    setAboutOpen,
    setSettingsTab,
    openSoundSettings,
    setSettingsReturnToScores,
    settings,
    setSettings,
    pianoViewport,
    pianoRange,
    run,
    workspaceUnavailable,
    songFilesOpen,
    setSongFilesOpen,
    recentFiles,
    forgetRecent,
    openPath,
    chooseFile,
    keyboardContext,
    openingActive,
    goHome,
    openFreePlay,
  } = useApp();
  return (
    <>
      {startupReady && productScreens.screen === "home" && (
        <HomeScreen
          recent={recentFiles}
          disabled={!!workspaceUnavailable || !connected}
          chooseFile={chooseFile}
          open={openPath}
          forget={forgetRecent}
          freePlay={() => void openFreePlay()}
          settings={() => productScreens.settings()}
        />
      )}
      {startupReady && (
        <div
          className="product-settings-host"
          hidden={productScreens.screen !== "settings"}
          inert={productScreens.screen !== "settings"}
        >
          <SettingsScreen
            state={state}
            engineId={progressEngineId}
            visible={
              productScreens.screen === "settings" &&
              !settings &&
              !displayDialog
            }
            back={() => productScreens.home()}
            devices={(device) => openSoundSettings(device)}
            duet={() => {
              setSettingsTab("duet");
              setSettingsReturnToScores(false);
              setSettings(true);
            }}
            display={(section) => {
              setDisplaySection(section);
              setDisplayDialog(true);
            }}
            logs={() => void api.openLogs().catch((e) => setError(String(e)))}
            about={() => setAboutOpen(true)}
            disabled={busy || !connected}
          />
        </div>
      )}

      {workspace === "practice" && songSetup && song && (
        <SongSetupScreen
          song={song}
          store={playback}
          disabled={busy || openingActive || !connected}
          back={() => {
            void goHome();
          }}
          menu={() => setAppMenuOpen((v) => !v)}
          hands={() => productScreens.show("parts")}
          sound={() => openSoundSettings()}
          scores={() => setScoresDialog(true)}
          settings={() => setSongOptions(true)}
          files={() => setSongFilesOpen(true)}
          start={async (mode, hands) => {
            if (
              (await run({ type: "hands", value: hands })) &&
              (await run({ type: "mode", value: mode })) &&
              (await run({ type: "play" }))
            ) {
              productScreens.show("performance");
              return true;
            }
            return false;
          }}
        />
      )}
      {songFilesOpen && song && (
        <SongFilesDialog
          contentId={song.contentId}
          close={() => setSongFilesOpen(false)}
          openVersion={(path) => run({ type: "openFile", path }, true)}
        />
      )}
      {workspace === "practice" &&
        productScreens.screen === "parts" &&
        song && (
          <TrackSetupScreen
            song={song}
            disabled={busy || openingActive || !connected}
            builtin={!state.outputId}
            pianoOnly={/default\.sf2$/i.test(state.soundfont ?? "")}
            back={() => productScreens.show("setup")}
            custom={(track) => {
              const t = song.tracks.find((t) => t.id === track);
              if (t && !t.visible) {
                void run(
                  {
                    type: "track",
                    id: t.id,
                    mode: t.mode,
                    part: t.part,
                    visible: true,
                  },
                  true,
                ).then((ok) => {
                  if (ok) productScreens.split(track);
                });
              } else productScreens.split(track);
            }}
            command={(value) => run(value, true)}
          />
        )}
      {workspace === "practice" &&
        productScreens.screen === "split" &&
        song &&
        productScreens.splitTrack !== null && (
          <HandSplitScreen
            key={`${song.contentId}:${productScreens.splitTrack}`}
            song={song}
            trackId={productScreens.splitTrack}
            disabled={busy || openingActive || !connected}
            back={() => productScreens.show("parts")}
            command={(value) => run(value, true)}
          />
        )}
      {workspace === "practice" && productScreens.screen === "freePlay" && (
        <main className="product-freeplay product-page">
          <ScreenHeader
            title="自由演奏"
            back={() => void goHome()}
            backDisabled={state.recording || busy}
            backLabel="主页"
          >
            <button
              disabled={busy || !connected}
              onClick={() =>
                void run(
                  { type: "recording", active: !state.recording },
                  state.recording,
                )
              }
            >
              {state.recording ? "停止并保存录音" : "录音"}
            </button>
            <button onClick={() => openSoundSettings()}>设置</button>
          </ScreenHeader>
          <div className="product-freeplay-stage">
            <Piano
              song={null}
              state={playback.getSnapshot()}
              store={playback}
              onNote={pointerNote}
              canInteract={() =>
                !keyboardContext.current.paused &&
                !topInputScope() &&
                !topPopup(null)
              }
              keyboardRange={pianoRange}
              keyboardViewport={pianoViewport}
              display={display}
            />
          </div>
        </main>
      )}
    </>
  );
}
