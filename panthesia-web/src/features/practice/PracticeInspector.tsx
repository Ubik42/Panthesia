import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { CollectionSong, EngineCommand, LoadedSong } from "../../api";
import { PanelResizeHandle } from "../../PanelResizeHandle";
import { TrackAppearanceControl } from "../../TrackAppearanceControl";
import { TrackSoundControl } from "../../TrackSoundControl";
import type { ControlSnapshot, PlaybackStore } from "./playbackStore";
import { PracticeMeter, PracticeResults } from "./PracticeReadouts";
import { PracticeLoopControls } from "./PracticeLoopControls";
import {
  PracticeInspectorTabs,
  type PracticeInspectorTab,
} from "./PracticeInspectorTabs";
import { practiceModes, practiceMode } from "./practicePresentation";

export type PracticeInspectorTool =
  "meter" | "hands" | "scores" | "ladder" | "passages";

export function PracticeInspector({
  store,
  state,
  song,
  automaticTranscription,
  currentRecord,
  queueLength,
  busy: processing,
  compact,
  width,
  resize,
  close,
  tab,
  changeTab,
  command: action,
  openTool,
  start,
  end,
  selectStart,
  selectEnd,
  expression,
  feedback,
}: {
  store: PlaybackStore;
  state: ControlSnapshot;
  song: LoadedSong | null;
  automaticTranscription: boolean;
  currentRecord?: CollectionSong;
  queueLength: number;
  busy: boolean;
  compact: boolean;
  width: number;
  resize: (width: number) => void;
  close: () => void;
  tab: PracticeInspectorTab;
  changeTab: (tab: PracticeInspectorTab) => void;
  command: (command: EngineCommand) => void;
  openTool: (tool: PracticeInspectorTool) => void;
  start: number;
  end: number;
  selectStart: (value: number) => void;
  selectEnd: (value: number) => void;
  expression: ReactNode;
  feedback: () => void;
}) {
  const busy = processing || state.recording;
  return (
    <aside
      id="practice-inspector"
      className="practice-inspector practice-inspector-workbench"
      role={compact ? "dialog" : undefined}
      aria-modal={compact || undefined}
      aria-label="练习设置"
      data-practice-drawer={compact ? "" : undefined}
    >
      <PanelResizeHandle
        label="调整练习参数宽度"
        value={width}
        min={180}
        max={360}
        reverse
        change={resize}
      />
      <div className="panel-heading">
        <strong>练习设置</strong>
        <button
          className="icon-button"
          aria-label="隐藏练习设置"
          onClick={close}
        >
          <X size={16} />
        </button>
      </div>
      <section className="inspector-section">
        <h2>练习方式</h2>
        <div className="practice-mode-options">
          {practiceModes.map((mode) => (
            <button
              key={mode.value}
              aria-pressed={state.mode === mode.value}
              disabled={busy || !song}
              onClick={() => action({ type: "mode", value: mode.value })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="parameter-help">{practiceMode(state.mode)?.detail}</p>
      </section>
      <section className="inspector-section">
        <h2>练习声部</h2>
        <select
          aria-label="练习声部"
          value={state.hands}
          disabled={busy || !song}
          onChange={(e) => action({ type: "hands", value: e.target.value })}
        >
          <option value="both">双手</option>
          <option value="left">左手 · 右手伴奏</option>
          <option value="right">右手 · 左手伴奏</option>
          <option value="custom">自定义音轨</option>
        </select>
        <button disabled={busy || !song} onClick={() => openTool("hands")}>
          分手与逐音播放
        </button>
      </section>
      <section className="inspector-section">
        <h2>节拍</h2>
        <PracticeMeter store={store} song={song} />
        <label>
          预备拍
          <select
            aria-label="预备拍"
            value={state.countIn}
            disabled={busy || !song}
            onChange={(e) =>
              action({ type: "countIn", bars: Number(e.target.value) })
            }
          >
            {[0, 1, 2, 4].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} 小节` : "关闭"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="节拍器"
            checked={state.metronome}
            disabled={busy || !song}
            onChange={(e) =>
              action({ type: "metronome", enabled: e.target.checked })
            }
          />
          节拍器
        </label>
        <button disabled={busy || !song} onClick={() => openTool("meter")}>
          小节与拍号设置
        </button>
      </section>
      <PracticeLoopControls
        store={store}
        song={song}
        start={start}
        end={end}
        selectStart={selectStart}
        selectEnd={selectEnd}
        disabled={busy || !song}
        command={action}
        passages={() => openTool("passages")}
      />
      <section className="inspector-section">
        <h2>声部与音轨</h2>
        {song?.tracks.map((t) => (
          <div className="track-control" key={`${song.contentId}:${t.id}`}>
            <strong>{t.name}</strong>
            <small>{t.notes} 音符</small>
            <label>
              播放方式
              <select
                aria-label={`${t.name}模式`}
                value={t.mode}
                disabled={busy}
                onChange={(e) =>
                  action({ type: "track", ...t, mode: e.target.value })
                }
              >
                <option value="human">自己弹</option>
                <option value="auto">伴奏</option>
                <option value="mute">静音</option>
              </select>
            </label>
            <label>
              声部
              <select
                aria-label={`${t.name}声部`}
                value={t.part}
                disabled={busy}
                onChange={(e) =>
                  action({ type: "track", ...t, part: e.target.value })
                }
              >
                <option value="other">未分手</option>
                <option value="left">左手</option>
                <option value="right">右手</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={t.visible}
                disabled={busy}
                onChange={(e) =>
                  action({ type: "track", ...t, visible: e.target.checked })
                }
              />
              {t.name}显示
            </label>
            <TrackAppearanceControl track={t} disabled={busy} action={action} />
            <TrackSoundControl
              track={t}
              sound={song.trackSounds?.[String(t.id)]}
              presets={song.soundPresets}
              disabled={busy}
              builtin={state.output === "内置钢琴"}
              action={action}
            />
          </div>
        ))}
        <button disabled={busy || !song} onClick={() => openTool("scores")}>
          谱面管理
        </button>
      </section>
    </aside>
  );
}
