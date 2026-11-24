import { Eye, FileMusic, Hand, KeyboardMusic, Repeat, Rows2, ScrollText, Tags } from "lucide-react";
import { useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import { ToolbarMore } from "../../ui/legacy/ToolbarMore";
import type { EngineCommand, LoadedSong } from "../../api";
import type { DisplayPreferences } from "../settings/displayPreferences";
import { shortcutLabel } from "../../lib/shortcuts";
import { LabelSettings } from "../settings/LabelSettings";
import { KeyboardRangeControls } from "./KeyboardRangeControls";
import type { KeyboardRange, KeyboardViewport } from "./keyboardViewport";
import { PracticeLegend } from "./PracticeLegend";
import { PreviewBarsControl } from "./PreviewBarsControl";
import { PracticeRangeControls } from "./PracticeRangeControls";
import { SongBookmarks, type BookmarkNavigation } from "./SongBookmarks";
import { MetronomeIcon } from "./SynthesiaToolbarIcons";
import type { PracticeRangeController } from "./usePracticeRange";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./usePlaybackFields";
import { ChordsDialog } from "./ChordsDialog";
import "../../ui/stagePanel.css";

const VIEWS: [string, string, boolean, typeof Eye][] = [
  ["keyboard", "瀑布", false, KeyboardMusic],
  ["combined", "谱面 + 瀑布", true, Rows2],
  ["score", "五线谱", false, FileMusic],
  ["paper", "谱页", true, ScrollText],
];

/** The stage's tools (interface-design.md §4.4, §6), spread along the bar: how to practise
 * (mode and hands) and the view directly on the bar, then one panel each for the stage, the
 * labels, loop and bookmarks, and fingering, and the metronome. Global settings are one link
 * away, on the settings page. */
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
  status: { busy: boolean; openingActive: boolean; connected: boolean; startupReady: boolean };
  keyboard: { range: KeyboardRange; viewport: KeyboardViewport; outside: number };
  practiceRange: PracticeRangeController;
  bookmarkNavigation: RefObject<BookmarkNavigation | null>;
  visible: boolean;
  editFingers: boolean;
  setEditFingers: (value: boolean) => void;
  clearSelection: () => void;
  action: (command: EngineCommand) => void;
  run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>;
  adjustRealtime: (command: { type: "seek"; position: number }) => Promise<boolean>;
  setView: (value: string) => void;
  open: { settings: () => void; fingering: () => void };
}) {
  const { busy, openingActive, connected, startupReady } = status;
  const view = display.practiceView;
  const state = usePlaybackFields(playback, ["mode", "hands", "metronome", "recording", "passage"]);
  const [chordsOpen, setChordsOpen] = useState(false);
  const set = (patch: Partial<DisplayPreferences>) => setDisplay((previous) => ({ ...previous, ...patch }));
  const locked = busy || openingActive || !connected || state.recording;
  return (
    <div className="stage-tools">
      {chordsOpen && song && <ChordsDialog song={song} close={() => setChordsOpen(false)} run={run} />}

      <div className="stage-tools-group" aria-label="练习">
        <div className="ui-segmented stage-inline" role="group" aria-label="练习方式">
          <button aria-pressed={state.mode === "wait"} disabled={locked || !song} title="弹对后音乐才继续" onClick={() => action({ type: "mode", value: "wait" })}>
            等待
          </button>
          <button aria-pressed={state.mode === "listen"} disabled={locked || !song} title="音乐连续播放" onClick={() => action({ type: "mode", value: "listen" })}>
            连续
          </button>
        </div>
        <div className="ui-segmented stage-inline" role="group" aria-label="练习的手">
          {[
            ["left", "左手"],
            ["both", "双手"],
            ["right", "右手"],
          ].map(([value, label]) => (
            <button key={value} aria-pressed={state.hands === value} disabled={busy || state.recording || !song} onClick={() => action({ type: "hands", value })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-segmented stage-inline stage-views" role="group" aria-label="练习视图">
        {VIEWS.map(([id, label, needsSong, Icon]) => (
          <button key={id} aria-pressed={view === id} disabled={needsSong && !song} title={label} onClick={() => setView(id)}>
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="stage-tools-group" aria-label="面板">
      <ToolbarMore panel icon={<Eye size={24} />} label="舞台" disabled={!startupReady}>
        <section aria-label="舞台">
          <h3>舞台</h3>
          <label>
            <input
              type="checkbox"
              aria-label="虚拟双手演示"
              checked={display.virtualHands}
              onChange={(event) => {
                set({ virtualHands: event.target.checked });
                if (event.target.checked && view !== "keyboard" && view !== "combined") setView("keyboard");
              }}
            />
            虚拟双手
          </label>
          <label>
            <input type="checkbox" aria-label="琴键灯带" checked={display.ledStrip} onChange={(event) => set({ ledStrip: event.target.checked })} />
            琴键灯带
          </label>
          <label>
            <span>背景</span>
            <span className="settings-range">
              <input type="range" aria-label="背景不透明度" min={0} max={100} value={display.backgroundOpacity} onChange={(event) => set({ backgroundOpacity: Number(event.target.value) })} />
              <output>{display.backgroundOpacity}%</output>
            </span>
          </label>
          <PreviewBarsControl value={display.previewBars} change={(previewBars) => set({ previewBars })} label="前方预览" ariaLabel="预览小节数" />
          {(view === "keyboard" || view === "combined") && (
            <KeyboardRangeControls
              value={display}
              range={keyboard.range}
              viewport={keyboard.viewport}
              outside={keyboard.outside}
              change={(patch) => startupReady && set(patch)}
            />
          )}
        </section>
        <button className="stage-panel-link" onClick={open.settings}>
          更多舞台设置…
        </button>
      </ToolbarMore>

      <ToolbarMore panel icon={<Tags size={24} />} label="标注" disabled={!startupReady}>
        <section aria-label="标注">
          <h3>标注</h3>
          {!!song?.harmony?.chords.length && (
            <div className="ui-row">
              <span>
                和弦 <small>{song.harmony.origin === "generated" ? "自动分析" : song.harmony.origin === "imported" ? "来自标注" : "已编辑"}</small>
              </span>
              <span className="settings-row-actions">
                <select aria-label="和弦显示" value={display.chordLabels} onChange={(event) => set({ chordLabels: event.target.value as DisplayPreferences["chordLabels"] })}>
                  <option value="off">不显示</option>
                  <option value="degree">级数</option>
                  <option value="name">和弦名</option>
                  <option value="both">级数与和弦名</option>
                </select>
                <button disabled={busy} onClick={() => setChordsOpen(true)}>
                  编辑…
                </button>
              </span>
            </div>
          )}
          {!!song?.sections?.items.length && (
            <label>
              <input type="checkbox" aria-label="显示段落" checked={display.sections} onChange={(event) => set({ sections: event.target.checked })} />
              段落{song.sections.origin === "generated" && <small>（自动分析）</small>}
            </label>
          )}
          <label>
            <input type="checkbox" aria-label="显示拍号" checked={display.meterLabels} onChange={(event) => set({ meterLabels: event.target.checked })} />
            拍号
          </label>
          {!!song?.importedLayers.lyrics.length && (
            <label>
              <input type="checkbox" aria-label="显示歌词" checked={display.lyrics} onChange={(event) => set({ lyrics: event.target.checked })} />
              歌词
            </label>
          )}
          <LabelSettings
            value={display}
            tonic={song?.practiceVariant?.effectiveTonic ?? song?.practiceVariant?.tonic}
            minor={song?.practiceVariant?.minor}
            fifths={song?.practiceVariant?.effectiveFifths}
            change={set}
          />
          <PracticeLegend song={song} display={display} />
        </section>
        <button className="stage-panel-link" onClick={open.settings}>
          更多显示设置…
        </button>
      </ToolbarMore>

      <ToolbarMore panel icon={<Repeat size={24} />} label="循环与书签" disabled={!song || !startupReady}>
        <section aria-label="循环">
          <h3>循环</h3>
          <PracticeRangeControls
            range={practiceRange}
            disabled={!connected || busy || state.recording}
            active={!!state.passage}
            loop={(start, end, enabled) => run({ type: "loop", start, end, enabled })}
            toggle={() => {
              setEditFingers(false);
              clearSelection();
              practiceRange.toggle();
            }}
          />
          <label>
            <input type="checkbox" checked={display.loopPreview} onChange={(e) => set({ loopPreview: e.target.checked })} />
            预览下一轮
          </label>
        </section>
        <section aria-label="书签">
          <h3>书签</h3>
          {song && (
            <SongBookmarks
              key={`bookmarks:${JSON.stringify([song.engineId, song.contentId])}`}
              ref={bookmarkNavigation}
              shortcutHint={display.shortcuts.bookmark1 ? `${shortcutLabel(display.shortcuts.bookmark1)} 等快捷键定位` : "可在设置 → 快捷键中设置定位键"}
              song={song}
              store={playback}
              range={practiceRange}
              visible={visible}
              disabled={locked}
              seek={(position) => adjustRealtime({ type: "seek", position })}
              loop={(start, end, enabled) => run({ type: "loop", start, end, enabled })}
            />
          )}
        </section>
      </ToolbarMore>

      <ToolbarMore panel icon={<Hand size={24} />} label="指法" disabled={!song || !startupReady}>
        <section aria-label="指法">
          <h3>指法</h3>
          <label>
            <input
              type="checkbox"
              checked={editFingers}
              disabled={!song}
              onChange={(event) => {
                setEditFingers(event.target.checked);
                clearSelection();
              }}
            />
            在瀑布上编辑指法
          </label>
          <button disabled={!song || busy} onClick={open.fingering}>
            指法建议…
          </button>
        </section>
      </ToolbarMore>

      <button
        className="stage-tool-button"
        title="节拍器"
        aria-label="节拍器"
        aria-pressed={state.metronome}
        disabled={busy || !song}
        onClick={() => action({ type: "metronome", enabled: !state.metronome })}
      >
        <MetronomeIcon size={24} />
      </button>
      </div>
    </div>
  );
}
