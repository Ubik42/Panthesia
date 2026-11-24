import { dialogs } from "../stores/dialogs";
import { setDisplay } from "../features/settings/interfaceSettingsStore";
import { useApp } from "./AppContext";
import { topInputScope, topPopup } from "../lib/inputOwnership";
import { pathKey } from "../engine/pathIdentity";
import { SongDetails } from "../screens/song/SongDetails";
import { HandSplitScreen } from "../screens/song/HandSplitScreen";
import { HomeScreen } from "../screens/home/HomeScreen";
import { FreePlayScreen } from "../screens/freeplay/FreePlayScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { applyPracticeVariant } from "./practiceVariant";

import { api } from "../api";
import { Piano } from "../stage/Piano";
const normalize = pathKey;

/** Home, settings, song setup, track and hand split screens, and free play. */
export function ProductScreens() {
  const app = useApp();
  const {
    setCommandsOpen,
    clearLiveNotes,
    workspace,
    productScreens,
    songSetup,
    display,
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
    openSoundSettings,
    openSettings,
    pianoViewport,
    pianoRange,
    run,
    workspaceUnavailable,
    setFingeringDialog,
    recentFiles,
    forgetRecent,
    openPath,
    chooseFile,
    keyboardContext,
    openingActive,
    goHome,
    openFreePlay,
  } = app;
  return (
    <>
      {/* The start page; with a song open, its details slide in over it. */}
      {startupReady && (productScreens.screen === "home" || (workspace === "practice" && songSetup && song)) && (
        <HomeScreen
          recent={recentFiles}
          current={productScreens.screen === "home" ? null : song?.sourcePath}
          disabled={!!workspaceUnavailable || !connected}
          chooseFile={chooseFile}
          open={openPath}
          play={async (path) => (await openPath(path, "performance")) && (await run({ type: "play" }))}
          forget={forgetRecent}
          freePlay={() => void openFreePlay()}
          settings={() => productScreens.settings()}
          details={
            productScreens.screen !== "home" && workspace === "practice" && songSetup && song ? (
          <SongDetails
            song={song}
            store={playback}
            engineId={progressEngineId}
            disabled={busy || openingActive || !connected}
            back={() => {
              void goHome();
            }}
            variant={(value) => applyPracticeVariant(run, song, value)}
            scores={() => setScoresDialog(true)}
            tools={() => openSettings("tools")}
            editLayer={(name) => {
              if (name === "fingering") setFingeringDialog(true);
            }}
            editInfo={() => dialogs.setMetadata(true)}
            openVersion={(path) => run({ type: "openFile", path }, true)}
            start={async (mode, hands) => {
              if ((await run({ type: "hands", value: hands })) && (await run({ type: "mode", value: mode })) && (await run({ type: "play" }))) {
                productScreens.show("performance");
                return true;
              }
              return false;
            }}
          />
            ) : undefined
          }
        />
      )}
      {startupReady && productScreens.screen === "settings" && (
        <SettingsScreen
          state={state}
          playback={playback}
          progressEngineId={progressEngineId}
          busy={busy}
          connected={connected}
          startupReady={startupReady}
          actionError={app.health.getMessages().action}
          run={run}
          refreshSession={app.refreshSession}
          setError={setError}
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
            back={() => productScreens.show("setup")}
            command={(value) => run(value, true)}
          />
        )}
      {workspace === "practice" && productScreens.screen === "freePlay" && (
        <FreePlayScreen
          state={state}
          busy={busy}
          connected={connected}
          run={run}
          goHome={goHome}
          openDevices={() => openSettings("devices")}
          playback={playback}
          pointerNote={pointerNote}
          keyboardPaused={keyboardContext}
          pianoRange={pianoRange}
          pianoViewport={pianoViewport}
        />
      )}
    </>
  );
}
