import { useApp } from "./AppContext";
import { topInputScope, topPopup } from "./inputOwnership";
import { pathKey } from "../engine/pathIdentity";
import { SongScreen } from "../screens/song/SongScreen";
import { HandSplitScreen } from "../features/screens/HandSplitScreen";
import { HomeScreen } from "../screens/home/HomeScreen";
import { ScreenHeader } from "../features/screens/ScreenHeader";
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
      {startupReady && productScreens.screen === "settings" && <SettingsScreen />}

      {workspace === "practice" && songSetup && song && (
        <SongScreen
          song={song}
          store={playback}
          engineId={progressEngineId}
          disabled={busy || openingActive || !connected}
          back={() => {
            void goHome();
          }}
          menu={() => { clearLiveNotes(); setCommandsOpen(true); }}
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
      {workspace === "practice" && productScreens.screen === "freePlay" && (
        <main className="product-freeplay product-page">
          <ScreenHeader
            title="自由演奏"
            back={() => void goHome()}
            backDisabled={state.recording || busy}
            backLabel="主页"
          >
            <label className="product-freeplay-tempo" title="录音按这个速度写入，量化与小节线以它为准">
              速度
              <input
                type="number"
                min={30}
                max={300}
                value={display.recordBpm}
                disabled={state.recording}
                aria-label="录音速度 BPM"
                onChange={(event) => {
                  const bpm = Number(event.target.value);
                  if (bpm >= 30 && bpm <= 300) setDisplay((previous) => ({ ...previous, recordBpm: bpm }));
                }}
              />
              BPM
            </label>
            <label className="product-freeplay-click">
              <input
                type="checkbox"
                checked={display.recordClick}
                disabled={state.recording}
                onChange={(event) => setDisplay((previous) => ({ ...previous, recordClick: event.target.checked }))}
              />
              节拍器
            </label>
            <button
              disabled={busy || !connected}
              onClick={() =>
                void run(
                  state.recording
                    ? { type: "recording", active: false }
                    : { type: "recording", active: true, bpm: display.recordBpm, click: display.recordClick },
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
