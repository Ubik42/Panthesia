import { AudioLines, AudioWaveform, Blend, ChevronLeft, ChevronRight, Clock4, FileMusic, Hand, Hash, Hourglass, KeyboardMusic, Lightbulb, MicVocal, Milestone, Music2, Palette, PencilLine, Piano, Repeat, Tags, Box, Rows2, ScrollText, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { StageBackgroundSettings } from "../settings/StageBackgroundSettings";
import { useOpenSongCover } from "../library/songCover";
import { PartsList, type PartsListProps } from "../parts/PartsList";
import { useState, type ComponentType, type Dispatch, type SetStateAction, type RefObject } from "react";
import { ToolbarMore } from "../../ui/legacy/ToolbarMore";
import type { EngineCommand, LoadedSong } from "../../api";
import type { DisplayPreferences } from "../settings/displayPreferences";
import { shortcutLabel } from "../../lib/shortcuts";
import { LabelPicker } from "../settings/LabelPicker";
import { KeyboardRangeControls, KeyboardRangeInline } from "./KeyboardRangeControls";
import type { KeyboardRange, KeyboardViewport } from "./keyboardViewport";
import { PracticeLegend } from "./PracticeLegend";
import { PreviewBarsControl } from "./PreviewBarsControl";
import { previewBarsLabel } from "./keyboardViewport";
import { PracticeRangeControls } from "./PracticeRangeControls";
import { SongBookmarks, type BookmarkNavigation } from "./SongBookmarks";
import { MetronomeIcon } from "./SynthesiaToolbarIcons";
import type { PracticeRangeController } from "./usePracticeRange";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./usePlaybackFields";
import { ChordsDialog } from "./ChordsDialog";
import { StemControls } from "./StemControls";
import "../../ui/stagePanel.css";

/** Views of the stage: the waterfall alone, one score line over the waterfall, or the paper
 * score above the keys. (A score without the waterfall is the combined view.) */
const VIEWS: [string, string, boolean, LucideIcon][] = [
  ["keyboard", "瀑布", false, KeyboardMusic],
  ["combined", "谱面 + 瀑布", true, Rows2],
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
  parts,
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
  /** The song's parts (hands, colours, instruments) for the parts panel. */
  parts: Omit<PartsListProps, "song" | "disabled">;
}) {
  const { busy, openingActive, connected, startupReady } = status;
  const view = display.practiceView;
  const state = usePlaybackFields(playback, ["mode", "hands", "metronome", "recording", "passage", "stems"]);
  const [chordsOpen, setChordsOpen] = useState(false);
  const cover = useOpenSongCover(song?.contentId);
  const set = (patch: Partial<DisplayPreferences>) => setDisplay((previous) => ({ ...previous, ...patch }));
  const locked = busy || openingActive || !connected || state.recording;
  return (
    <div className="stage-tools">
      {chordsOpen && song && <ChordsDialog song={song} close={() => setChordsOpen(false)} run={run} />}

      <div className="ui-segmented stage-inline stage-practice" role="group" aria-label="练习方式与手">
        <button aria-pressed={state.mode === "wait"} aria-label="等待按键" disabled={locked || !song} title="等待按键：弹对后音乐才继续" onClick={() => action({ type: "mode", value: "wait" })}>
          <Hourglass size={17} aria-hidden="true" />
        </button>
        {/* Which hand plays matters only while the music waits for the player. */}
        {state.mode === "wait" &&
          [
            ["left", "左", "只练左手"],
            ["both", "双", "双手练习"],
            ["right", "右", "只练右手"],
          ].map(([value, short, label]) => (
            <button key={value} className="stage-hand" aria-pressed={state.hands === value} aria-label={label} title={label} disabled={busy || state.recording || !song} onClick={() => action({ type: "hands", value })}>
              {short}
            </button>
          ))}
        <button aria-pressed={state.mode === "listen"} aria-label="连续播放" disabled={locked || !song} title="连续播放：音乐不等待" onClick={() => action({ type: "mode", value: "listen" })}>
          <AudioLines size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="ui-segmented stage-inline stage-views" role="group" aria-label="练习视图">
        {VIEWS.map(([id, label, needsSong, Icon]) => (
          <button key={id} aria-pressed={view === id} disabled={needsSong && !song} title={label} onClick={() => setView(id)}>
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="stage-tools-group stage-toggles" aria-label="显示开关">
        <Toggle icon={Hand} label="虚拟双手" on={display.virtualHands} change={(virtualHands) => {
          set({ virtualHands });
          if (virtualHands && view !== "keyboard" && view !== "combined") setView("keyboard");
        }} />
        <Toggle icon={Box} label="立体视角（从前上方看双手与琴键）" on={display.handCamera === "front"} disabled={!display.virtualHands} change={(on) => set({ handCamera: on ? "front" : "top" })} />
        <Toggle icon={Hash} label="在瀑布上编辑指法" on={editFingers} disabled={!song} change={(on) => {
          setEditFingers(on);
          clearSelection();
        }} />
        <Toggle icon={Milestone} label="段落" on={display.sections} disabled={!song?.sections?.items.length} change={(sections) => set({ sections })} />
        <Toggle icon={Music2} label="和弦" on={display.chordLabels !== "off"} disabled={!song?.harmony?.chords.length} change={(on) => set({ chordLabels: on ? "name" : "off" })} />
        <Toggle icon={Clock4} label="拍号" on={display.meterLabels} change={(meterLabels) => set({ meterLabels })} />
        <Toggle icon={MetronomeIcon} label="节拍器" on={!!state.metronome} disabled={busy || !song} change={(enabled) => action({ type: "metronome", enabled })} />
      </div>

      <div className="stage-tools-group stage-display" aria-label="显示">
        {(view === "keyboard" || view === "combined") && (
          <KeyboardRangeInline className="bar-1280" value={display} range={keyboard.range} viewport={keyboard.viewport} change={(patch) => startupReady && set(patch)} />
        )}
        <span className="stage-preview bar-1280" title={`前方预览 ${previewBarsLabel(display.previewBars)}`}>
          <button className="ui-icon-button" aria-label="减少前方预览" disabled={display.previewBars <= 0.5} onClick={() => set({ previewBars: Math.max(0.5, display.previewBars >= 2 ? display.previewBars - 1 : display.previewBars - 0.5) })}>
            <ChevronLeft size={16} />
          </button>
          <output aria-label="前方预览小节数">{display.previewBars}</output>
          <button className="ui-icon-button" aria-label="增加前方预览" disabled={display.previewBars >= 16} onClick={() => set({ previewBars: Math.min(16, display.previewBars >= 1 ? display.previewBars + 1 : display.previewBars + 0.5) })}>
            <ChevronRight size={16} />
          </button>
        </span>
      </div>

      <div className="stage-tools-group" aria-label="面板">
      <ToolbarMore panel width={460} icon={<Tags size={21} />} label="标签与和弦" disabled={!startupReady}>
        <LabelPicker value={display} change={set} context={{ tonic: song?.practiceVariant?.effectiveTonic ?? song?.practiceVariant?.tonic, minor: song?.practiceVariant?.minor, fifths: song?.practiceVariant?.effectiveFifths }} />
        {!!song?.harmony?.chords.length && (
          <section aria-label="和弦">
            <div className="stage-chords">
              <span>和弦</span>
              <span className="ui-segmented" role="group" aria-label="和弦显示">
                {(
                  [
                    ["off", "不显示"],
                    ["name", "和弦名"],
                    ["degree", "级数"],
                    ["both", "两者"],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={display.chordLabels === value} onClick={() => set({ chordLabels: value })}>
                    {label}
                  </button>
                ))}
              </span>
              <button className="ui-icon-button" title="编辑和弦" aria-label="编辑和弦" disabled={busy} onClick={() => setChordsOpen(true)}>
                <PencilLine size={16} />
              </button>
            </div>
          </section>
        )}
        <PracticeLegend song={song} display={display} />
      </ToolbarMore>

      <ToolbarMore panel width={440} icon={<Palette size={22} />} label="背景" disabled={!startupReady}>
        <StageBackgroundSettings value={display} change={set} cover={cover} />
      </ToolbarMore>

      <ToolbarMore panel width={420} className="narrow-only" icon={<Piano size={21} />} label="键盘范围与前方预览" disabled={!startupReady || (view !== "keyboard" && view !== "combined")}>
        <section aria-label="键盘范围">
          <span className="fallback-1280">
            <PreviewBarsControl value={display.previewBars} change={(previewBars) => set({ previewBars })} label="前方预览" ariaLabel="预览小节数" />
          </span>
          <KeyboardRangeControls
            value={display}
            range={keyboard.range}
            viewport={keyboard.viewport}
            outside={keyboard.outside}
            change={(patch) => startupReady && set(patch)}
          />
        </section>
      </ToolbarMore>

      <ToolbarMore panel width={660} icon={<Blend size={22} />} label="声部与音轨" disabled={!song || !startupReady}>
        {song && <PartsList song={song} disabled={busy || !connected} {...parts} />}
        {!!state.stems?.stems.length && (
          <section aria-label="音轨">
            <h3>音轨</h3>
            <StemControls store={playback} command={action} />
          </section>
        )}
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
      </div>
    </div>
  );
}

/** An icon toggle on the stage bar (name in the tooltip). */
function Toggle({ icon: Icon, label, on, change, disabled, optional }: { icon: ComponentType<{ size?: number }>; label: string; on: boolean; change: (on: boolean) => void; disabled?: boolean; /** Left off the bar in a narrow window (the display settings panel has it too). */ optional?: boolean }) {
  return (
    <button className="stage-tool-button stage-toggle" data-optional={optional || undefined} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={() => change(!on)}>
      <Icon size={20} />
    </button>
  );
}
