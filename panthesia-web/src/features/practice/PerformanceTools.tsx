import {
  Bookmark as BookmarkIcon,
  Settings as DisplayGear,
  Repeat2 as LoopIcon,
  Music2 as ScoreIcon,
  Search as ZoomIcon,
} from "lucide-react";
import type { Dispatch, SetStateAction, RefObject } from "react";
import { ToolbarMore } from "../../app/ToolbarMore";
import type { EngineCommand, LoadedSong } from "../../api";
import type { DisplayPreferences } from "../settings/displayPreferences";
import { shortcutLabel } from "../../app/shortcuts";
import { LabelSettings } from "../screens/LabelSettings";
import { KeyboardRangeControls } from "./KeyboardRangeControls";
import type { KeyboardRange, KeyboardViewport } from "./keyboardViewport";
import { PracticeLegend } from "./PracticeLegend";
import { PreviewBarsControl } from "./PreviewBarsControl";
import { PracticeRangeControls } from "./PracticeRangeControls";
import { SongBookmarks, type BookmarkNavigation } from "./SongBookmarks";
import { LabelsIcon, MetronomeIcon } from "./SynthesiaToolbarIcons";
import type { PracticeRangeController } from "./usePracticeRange";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./PlaybackView";
export function PerformanceTools({
  song,
  playback,
  display,
  setDisplay,
  status,
  keyboard,
  practiceRange,
  bookmarkNavigation,
  visible,
  editFingers,
  setEditFingers,
  clearSelection,
  action,
  run,
  adjustRealtime,
  setView,
  open,
}: {
  song: LoadedSong | null;
  playback: PlaybackStore;
  display: DisplayPreferences;
  setDisplay: Dispatch<SetStateAction<DisplayPreferences>>;
  status: {
    busy: boolean;
    openingActive: boolean;
    connected: boolean;
    startupReady: boolean;
    editable: boolean;
  };
  keyboard: {
    range: KeyboardRange;
    viewport: KeyboardViewport;
    outside: number;
  };
  practiceRange: PracticeRangeController;
  bookmarkNavigation: RefObject<BookmarkNavigation | null>;
  visible: boolean;
  editFingers: boolean;
  setEditFingers: (value: boolean) => void;
  clearSelection: () => void;
  action: (command: EngineCommand) => void;
  run: (command: EngineCommand) => Promise<boolean>;
  adjustRealtime: (command: {
    type: "seek";
    position: number;
  }) => Promise<boolean>;
  setView: (value: string) => void;
  open: {
    songOptions: () => void;
    scores: () => void;
    devices: () => void;
    display: () => void;
    fingeringWorkbench: () => void;
    parts: () => void;
    pairScore: () => void;
    fingering: () => void;
  };
}) {
  const { busy, openingActive, connected, startupReady, editable } =
    status;
  const {
    range: pianoRange,
    viewport: pianoViewport,
    outside: outsidePianoRange,
  } = keyboard;
  const view = display.practiceView;
  const state = usePlaybackFields(playback, [
    "mode",
    "metronome",
    "recording",
    "passage",
  ]);
  return (
    <div className="synthesia-play-tools">
      <ToolbarMore
        icon={<ScoreIcon size={27} />}
        label="歌曲设置"
        scale={display.uiScale / 100}
        disabled={!song || busy || !startupReady}
      >
        <button onClick={() => open.songOptions()}>练习与版本设置…</button>
        <button onClick={() => open.scores()}>谱面管理…</button>
        <button onClick={() => open.devices()}>键盘与音源…</button>
        <button onClick={() => open.display()}>外观、网格与按键…</button>
        <button onClick={() => open.fingeringWorkbench()}>指法工作台…</button>
        <button
          disabled={!song || busy}
          onClick={() => {
            open.parts();
          }}
        >
          手别、颜色与乐器
        </button>
        <button
          disabled={!song || busy}
          onClick={() => {
            open.pairScore();
          }}
        >
          配对乐谱
        </button>
        <button
          className={editFingers ? "selected" : ""}
          disabled={!song || !editable}
          onClick={() => {
            setEditFingers(!editFingers);
            clearSelection();
          }}
        >
          编辑指法
        </button>
        <button
          disabled={!song || busy || !editable}
          onClick={() => {
            open.fingering();
          }}
        >
          指法建议
        </button>
      </ToolbarMore>

      <ToolbarMore
        icon={<DisplayGear size={27} />}
        label="显示设置"
        scale={display.uiScale / 100}
        disabled={!startupReady}
      >
        <div className="practice-view-tabs" role="group" aria-label="练习视图">
          <button
            className={view === "keyboard" ? "selected" : ""}
            aria-pressed={view === "keyboard"}
            onClick={() => setView("keyboard")}
          >
            瀑布与琴键
          </button>
          <button
            className={view === "score" ? "selected" : ""}
            aria-pressed={view === "score"}
            onClick={() => setView("score")}
          >
            五线谱
          </button>
          <button
            className={view === "combined" ? "selected" : ""}
            aria-pressed={view === "combined"}
            disabled={!song}
            onClick={() => setView("combined")}
          >
            谱面与瀑布
          </button>
          <button
            className={view === "paper" ? "selected" : ""}
            aria-pressed={view === "paper"}
            disabled={!song}
            onClick={() => setView("paper")}
          >
            谱页
          </button>
        </div>
        <label><input type="checkbox" aria-label="虚拟双手演示" checked={display.virtualHands} onChange={event=>{setDisplay(previous=>({...previous,virtualHands:event.target.checked}));if(event.target.checked&&view!=="keyboard"&&view!=="combined")setView("keyboard");}}/>虚拟双手演示</label>
        <PracticeLegend song={song} display={display} />
        <button aria-label="界面与按键设置" onClick={() => open.display()}>
          界面与按键
        </button>
        <PreviewBarsControl
          value={display.previewBars}
          change={(value) =>
            setDisplay((previous) => ({ ...previous, previewBars: value }))
          }
          label="前方预览"
          ariaLabel="预览小节数"
        />

        <button
          className="product-narrow-metronome"
          aria-pressed={state.metronome}
          disabled={busy || !song}
          onClick={() =>
            action({ type: "metronome", enabled: !state.metronome })
          }
        >
          节拍器：{state.metronome ? "开启" : "关闭"}
        </button>
      </ToolbarMore>
      <button
        className="synthesia-metronome"
        title="节拍器"
        aria-label="节拍器"
        aria-pressed={state.metronome}
        disabled={busy || !song}
        onClick={() => action({ type: "metronome", enabled: !state.metronome })}
      >
        <MetronomeIcon size={27} />
      </button>
      <ToolbarMore
        label="键盘缩放"
        icon={<ZoomIcon size={27} />}
        disabled={!song}
      >
        {" "}
        {(view === "keyboard" ||
          view === "combined" ||
          state.mode === "memory") && (
          <KeyboardRangeControls
            value={display}
            range={pianoRange}
            viewport={pianoViewport}
            outside={outsidePianoRange}
            change={(patch) => {
              if (startupReady)
                setDisplay((previous) => ({ ...previous, ...patch }));
            }}
          />
        )}
      </ToolbarMore>
      <ToolbarMore
        label="音符标签"
        icon={<LabelsIcon />}
        disabled={!startupReady}
      >
        <LabelSettings
          value={display}
          tonic={
            song?.practiceVariant?.effectiveTonic ??
            song?.practiceVariant?.tonic
          }
          minor={song?.practiceVariant?.minor}
          fifths={song?.practiceVariant?.effectiveFifths}
          change={(patch) =>
            setDisplay((previous) => ({ ...previous, ...patch }))
          }
        />
      </ToolbarMore>
      <ToolbarMore
        label="书签"
        icon={<BookmarkIcon size={27} />}
        disabled={!song || busy}
      >
        <div
          className="product-bookmark-menu"
          onClick={(e) => e.stopPropagation()}
        >
          {song && (
            <SongBookmarks
              key={`bookmarks:${JSON.stringify([song.engineId, song.contentId])}`}
              ref={bookmarkNavigation}
              shortcutHint={
                display.shortcuts.bookmark1
                  ? `${shortcutLabel(display.shortcuts.bookmark1)} 等快捷键定位`
                  : "可在界面与按键中设置定位键"
              }
              song={song}
              store={playback}
              range={practiceRange}
              visible={visible}
              disabled={
                busy ||
                openingActive ||
                !connected ||
                state.recording ||
                !editable
              }
              seek={(position) => adjustRealtime({ type: "seek", position })}
              loop={(start, end, enabled) =>
                run({ type: "loop", start, end, enabled })
              }
            />
          )}
        </div>
      </ToolbarMore>
      <ToolbarMore
        label="循环"
        icon={<LoopIcon size={27} />}
        disabled={!song || busy}
      >
        <div className="product-loop-menu" onClick={(e) => e.stopPropagation()}>
          <PracticeRangeControls
            range={practiceRange}
            disabled={!connected || busy || state.recording}
            active={!!state.passage}
            loop={(start, end, enabled) =>
              run({ type: "loop", start, end, enabled })
            }
            toggle={() => {
              setEditFingers(false);
              clearSelection();
              practiceRange.toggle();
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={display.loopPreview}
              onChange={(e) =>
                setDisplay((previous) => ({
                  ...previous,
                  loopPreview: e.target.checked,
                }))
              }
            />
            预览下一轮
          </label>
        </div>
      </ToolbarMore>
    </div>
  );
}
