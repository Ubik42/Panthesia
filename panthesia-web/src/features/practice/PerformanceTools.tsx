import {
  Bookmark as BookmarkIcon,
  Settings as DisplayGear,
  Repeat2 as LoopIcon,
  Music2 as ScoreIcon,
  Search as ZoomIcon,
} from "lucide-react";
import { useState, type Dispatch, type SetStateAction, type RefObject } from "react";
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
import { usePlaybackFields } from "./usePlaybackFields";
import { ChordsDialog } from "./ChordsDialog";
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
  run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>;
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
  const { busy, openingActive, connected, startupReady } =
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
  const [chordsOpen, setChordsOpen] = useState(false);
  return (
    <div className="synthesia-play-tools">
      {chordsOpen && song && <ChordsDialog song={song} close={() => setChordsOpen(false)} run={run} />}
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
          disabled={!song}
          onClick={() => {
            setEditFingers(!editFingers);
            clearSelection();
          }}
        >
          编辑指法
        </button>
        <button
          disabled={!song || busy}
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
        {!!song?.harmony?.chords.length && (
          <label>
            和弦
            <select
              aria-label="和弦显示"
              value={display.chordLabels}
              onChange={(event) =>
                setDisplay((previous) => ({ ...previous, chordLabels: event.target.value as typeof previous.chordLabels }))
              }
            >
              <option value="off">不显示</option>
              <option value="degree">级数</option>
              <option value="name">和弦名</option>
              <option value="both">级数与和弦名</option>
            </select>
            <small>{song.harmony.origin === "generated" ? "自动分析" : song.harmony.origin === "imported" ? "来自标注" : "已编辑"}</small>
            <button disabled={busy} onClick={() => setChordsOpen(true)}>编辑…</button>
          </label>
        )}
        {!!song?.sections?.items.length && (
          <label>
            <input
              type="checkbox"
              aria-label="显示段落"
              checked={display.sections}
              onChange={(event) => setDisplay((previous) => ({ ...previous, sections: event.target.checked }))}
            />
            段落
            {song.sections.origin === "generated" && <small>自动分析</small>}
          </label>
        )}
        <label>
          <input
            type="checkbox"
            aria-label="琴键灯带"
            checked={display.ledStrip}
            onChange={(event) => setDisplay((previous) => ({ ...previous, ledStrip: event.target.checked }))}
          />
          灯带
        </label>
        <label>
          背景
          <input
            type="range"
            aria-label="背景不透明度"
            min={0}
            max={100}
            value={display.backgroundOpacity}
            onChange={(event) => setDisplay((previous) => ({ ...previous, backgroundOpacity: Number(event.target.value) }))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="显示拍号"
            checked={display.meterLabels}
            onChange={(event) => setDisplay((previous) => ({ ...previous, meterLabels: event.target.checked }))}
          />
          拍号
        </label>
        {!!song?.importedLayers.lyrics.length && (
          <label>
            <input
              type="checkbox"
              aria-label="显示歌词"
              checked={display.lyrics}
              onChange={(event) => setDisplay((previous) => ({ ...previous, lyrics: event.target.checked }))}
            />
            歌词
          </label>
        )}
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
        {(view === "keyboard" || view === "combined") && (
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
                state.recording
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
