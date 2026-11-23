import { Circle, Square } from "lucide-react";
import { useApp } from "../../app/AppContext";
import { topInputScope, topPopup } from "../../app/inputOwnership";
import { Piano } from "../../stage/Piano";
import { PageHeader } from "../../ui/PageHeader";
import "./freePlayScreen.css";

/** Free play: the keyboard and waterfall without a song, and recording what is played. */
export function FreePlayScreen() {
  const { state, display, setDisplay, busy, connected, run, goHome, openSettings, playback, pointerNote, keyboardContext, pianoRange, pianoViewport } = useApp();
  const recording = state.recording;
  return (
    <main className="ui-screen ui-page free-play-screen">
      <PageHeader title="自由演奏" subtitle={recording ? "正在录音…" : "弹奏或录音；录音保存到文档文件夹"} back={() => void goHome()} backLabel="主页" backDisabled={recording || busy}>
        <label className="free-play-field" title="录音按这个速度写入，量化与小节线以它为准">
          速度
          <input
            type="number"
            min={30}
            max={300}
            value={display.recordBpm}
            disabled={recording}
            aria-label="录音速度 BPM"
            onChange={(event) => {
              const bpm = Number(event.target.value);
              if (bpm >= 30 && bpm <= 300) setDisplay((previous) => ({ ...previous, recordBpm: bpm }));
            }}
          />
          BPM
        </label>
        <label className="free-play-field">
          <input type="checkbox" checked={display.recordClick} disabled={recording} onChange={(event) => setDisplay((previous) => ({ ...previous, recordClick: event.target.checked }))} />
          节拍器
        </label>
        <button className="ui-button" onClick={() => openSettings("devices")}>
          声音与设备…
        </button>
        <button
          className={`ui-button ${recording ? "" : "ui-button--primary"}`}
          disabled={busy || !connected}
          onClick={() =>
            void run(recording ? { type: "recording", active: false } : { type: "recording", active: true, bpm: display.recordBpm, click: display.recordClick }, recording)
          }
        >
          {recording ? <Square /> : <Circle />}
          {recording ? "停止并保存" : "录音"}
        </button>
      </PageHeader>
      <div className="free-play-stage">
        <Piano
          song={null}
          state={playback.getSnapshot()}
          store={playback}
          onNote={pointerNote}
          canInteract={() => !keyboardContext.current.paused && !topInputScope() && !topPopup(null)}
          keyboardRange={pianoRange}
          keyboardViewport={pianoViewport}
          display={display}
        />
      </div>
    </main>
  );
}
