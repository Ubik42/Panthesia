import { useApp } from "./AppContext";
import { topInputScope, topPopup } from "./inputOwnership";
import { pathKey } from "../engine/pathIdentity";
import { SongDetails } from "../screens/song/SongDetails";
import { HandSplitScreen } from "../screens/song/HandSplitScreen";
import { HomeScreen } from "../screens/home/HomeScreen";
import { FreePlayScreen } from "../screens/freeplay/FreePlayScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { PartsScreen } from "../screens/song/PartsScreen";

import { api } from "../api";
import { Piano } from "../stage/Piano";
const normalize = pathKey;

/** Home, settings, song setup, track and hand split screens, and free play. */
export function ProductScreens() {
  const {
    setCommandsOpen,
    clearLiveNotes,
    workspace,
    productScreens,
    songSetup,
    display,
    setDisplay,
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
  } = useApp();
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
            parts={() => productScreens.show("parts")}
            options={() => setSongOptions(true)}
            scores={() => setScoresDialog(true)}
            sound={() => openSoundSettings()}
            tools={() => openSettings("tools")}
            editLayer={(name) => {
              if (name === "hands") productScreens.show("parts");
              else if (name === "fingering") setFingeringDialog(true);
            }}
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
      {startupReady && productScreens.screen === "settings" && <SettingsScreen />}

      {workspace === "practice" &&
        productScreens.screen === "parts" &&
        song && (
          <PartsScreen
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
      {workspace === "practice" && productScreens.screen === "freePlay" && <FreePlayScreen />}
    </>
  );
}
