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
  const root = useRef<HTMLElement>(null);
  const activate = (next: PracticeInspectorTab) => {
    changeTab(next);
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-practice-tab="${next}"]`)
      ?.focus();
  };
  const playback = store;
  const recital = ["recital", "memory"].includes(state.mode);
  const recitalLive = recital && state.status !== "finished";
  const ladderActive = Boolean(state.ladder?.active);
  const routineActive = Boolean(state.routine);
  const attemptLocked =
    ladderActive ||
    routineActive ||
    (recital && ["playing", "paused", "countIn"].includes(state.status));
  const loopLocked =
    busy || state.recording || recital || ladderActive || routineActive;
  const recommendation = currentRecord?.recommended;
  const recommendedStart = recommendation?.[0] ?? 1;
  const recommendedEnd = Math.min(
    recommendation?.[1] ?? 1,
    song?.measures.length ?? 1,
  );
  const recommendationAvailable =
    !!song &&
    Number.isInteger(recommendedStart) &&
    recommendedStart >= 1 &&
    recommendedStart <= recommendedEnd;
  return (
    <aside
      ref={root}
      id="practice-inspector"
      className="practice-inspector practice-inspector-workbench"
      role={compact ? "dialog" : undefined}
      aria-modal={compact ? true : undefined}
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
          data-dialog-close={compact || undefined}
          onClick={close}
        >
          <X size={16} />
        </button>
      </div>
      <PracticeInspectorTabs
        value={tab}
        change={activate}
        setup={
          <>
            <section className="inspector-section practice-mode-section">
              <h2>练习方式</h2>
              <div
                className="practice-mode-options"
                role="group"
                aria-label="练习方式"
              >
                {practiceModes.map((mode) => (
                  <button
                    key={mode.value}
                    aria-pressed={state.mode === mode.value}
                    disabled={
                      busy ||
                      !song ||
                      state.recording ||
                      ladderActive ||
                      routineActive
                    }
                    onClick={() => {
                      if (state.mode !== mode.value)
                        action({ type: "mode", value: mode.value });
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <p className="parameter-help">
                {practiceMode(state.mode)?.detail}
              </p>
              {(ladderActive || routineActive) && (
                <p className="practice-lock-note">
                  练习条件由当前计划或速度阶梯管理。
                </p>
              )}
            </section>
            <section className="inspector-section practice-hands-section">
              <h2>练习声部</h2>
              <select
                aria-label="练习声部"
                value={state.hands}
                disabled={busy || !song || attemptLocked}
                onChange={(e) =>
                  action({ type: "hands", value: e.target.value })
                }
              >
                <option value="both">双手 / 全部练习音轨</option>
                <option value="left">左手 · 右手伴奏</option>
                <option value="right">右手 · 左手伴奏</option>
                <option value="custom" disabled>
                  自定义音轨
                </option>
              </select>
              <button
                className="practice-track-link"
                onClick={() => activate("tools")}
                disabled={!song}
              >
                音轨、分手与音色设置
              </button>
            </section>
            <section className="inspector-section timing-controls">
              <h2>节拍</h2>
              <button
                disabled={!song || busy || attemptLocked}
                onClick={() => openTool("meter")}
              >
                修正小节网格
              </button>
              <PracticeMeter store={playback} song={song} />
              <label>
                预备拍
                <select
                  aria-label="预备拍"
                  disabled={busy || !song || attemptLocked}
                  value={state.countIn}
                  onChange={(e) =>
                    action({ type: "countIn", bars: Number(e.target.value) })
                  }
                >
                  {[0, 1, 2, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "关闭" : `${n} 小节`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  aria-label="节拍器"
                  disabled={busy || !song || ladderActive || routineActive}
                  type="checkbox"
                  checked={state.metronome}
                  onChange={(e) =>
                    action({ type: "metronome", enabled: e.target.checked })
                  }
                />
                节拍器
              </label>
              <label>
                <input
                  aria-label="自动调整速度"
                  disabled={
                    busy || !song || recital || ladderActive || routineActive
                  }
                  type="checkbox"
                  checked={state.adaptive}
                  onChange={(e) =>
                    action({ type: "adaptive", enabled: e.target.checked })
                  }
                />
                循环后自动调整速度
              </label>
              {song?.measures.some((m) => !m.explicit) && (
                <p className="parameter-help">
                  * 文件缺少拍号，暂按 4/4 显示。
                </p>
              )}
            </section>
            <PracticeLoopControls
              key={`${song?.engineId}:${song?.contentId}:${song?.scoreRevision}`}
              store={store}
              song={song}
              start={start}
              end={end}
              selectStart={selectStart}
              selectEnd={selectEnd}
              disabled={loopLocked}
              command={action}
              passages={() => openTool("passages")}
            />
          </>
        }
        tools={
          <>
            {automaticTranscription && song && (
              <section
                className="inspector-section transcription-review"
                aria-label="自动转录核对"
              >
                <p>自动转录曲目 · 练习前核对小节、分手和谱面</p>
                <div className="transcription-review-actions">
                  <button
                    disabled={busy || attemptLocked}
                    onClick={() => openTool("meter")}
                  >
                    修正小节
                  </button>
                  <button
                    disabled={busy || attemptLocked || state.mode === "memory"}
                    onClick={() => openTool("hands")}
                  >
                    逐音分手
                  </button>
                  <button disabled={busy} onClick={() => openTool("scores")}>
                    谱面管理
                  </button>
                </div>
              </section>
            )}
            <section className="inspector-section">
              <h2>声部与音轨</h2>
              {song?.tracks.map((t) => (
                <div
                  className="track-control"
                  key={`${song.contentId}:${t.id}`}
                >
                  <div>
                    <span className="track-name" title={t.name}>
                      <i
                        className="track-color-dot"
                        style={{
                          background:
                            t.color ??
                            (t.part === "left" ? "#6cb7f3" : "#a9df74"),
                        }}
                      />
                      {t.name}
                    </span>
                    <small>
                      {t.notes} 音符
                      {t.inferred && t.part !== "other" ? " · 自动分手" : ""}
                    </small>
                    <input
                      type="checkbox"
                      aria-label={`${t.name}显示`}
                      disabled={busy || attemptLocked}
                      checked={t.visible}
                      onChange={(e) =>
                        action({
                          type: "track",
                          ...t,
                          visible: e.target.checked,
                        })
                      }
                    />
                  </div>
                  <div>
                    <select
                      aria-label={`${t.name}模式`}
                      value={t.mode}
                      disabled={busy || attemptLocked}
                      onChange={(e) =>
                        action({ type: "track", ...t, mode: e.target.value })
                      }
                    >
                      <option value="human">自己弹</option>
                      <option value="auto">伴奏</option>
                      <option value="mute">静音</option>
                    </select>
                    <select
                      aria-label={`${t.name}声部`}
                      value={t.part}
                      disabled={busy || attemptLocked}
                      onChange={(e) =>
                        action({ type: "track", ...t, part: e.target.value })
                      }
                    >
                      <option value="other">未分手</option>
                      <option value="left">左手</option>
                      <option value="right">右手</option>
                    </select>
                  </div>
                  <TrackAppearanceControl
                    track={t}
                    disabled={busy}
                    action={action}
                  />
                  <TrackSoundControl
                    track={t}
                    sound={song.trackSounds?.[String(t.id)]}
                    presets={song.soundPresets}
                    disabled={busy || attemptLocked}
                    builtin={state.output === "内置钢琴"}
                    action={action}
                  />
                </div>
              ))}
              {song?.tracks.some((t) => t.part === "other") && (
                <p className="parameter-help">
                  单轨曲目可以逐音分手；音轨声部作为未单独标注音符的默认值。
                </p>
              )}
              <button
                disabled={
                  !song || busy || attemptLocked || state.mode === "memory"
                }
                onClick={() => openTool("hands")}
              >
                逐音分手
              </button>
            </section>
            {expression}
            <section className="inspector-section">
              <h2>速度阶梯</h2>
              <button
                disabled={!song || busy || state.recording || recital}
                onClick={() => {
                  openTool("ladder");
                }}
              >
                速度阶梯方案
              </button>
              <p className="parameter-help">
                按连续达标轮数逐级提速，保存每个方案的进度。
              </p>
            </section>
          </>
        }
        results={
          <>
            {!recitalLive && (
              <PracticeResults
                store={playback}
                busy={busy}
                planActive={ladderActive || routineActive}
                command={action}
                feedback={feedback}
              />
            )}
            {recitalLive && (
              <section className="inspector-section">
                <h2>{state.mode === "memory" ? "背谱演奏" : "完整演奏"}</h2>
                <p className="parameter-help">
                  完成后显示准确率、节奏和逐小节反馈。
                </p>
                {state.mode === "memory" && <p>谱面与指法提示已隐藏</p>}
              </section>
            )}
            {currentRecord?.recommended && (
              <section className="inspector-section">
                <h2>建议重练</h2>
                {recommendationAvailable && (
                  <button
                    disabled={busy || recital || routineActive || ladderActive}
                    onClick={() =>
                      action({
                        type: "measureLoop",
                        start: recommendedStart,
                        end: recommendedEnd,
                        enabled: true,
                      })
                    }
                  >
                    第 {recommendedStart}–{recommendedEnd} 小节
                  </button>
                )}
                <p className="parameter-help">
                  {!recommendationAvailable
                    ? "原建议超出当前小节范围，请在历史回顾中重新选择。"
                    : recital
                      ? "切换到等音或连续模式后可重练选段。"
                      : "根据多次练习记录确定。"}
                </p>
              </section>
            )}
            {currentRecord?.queuePosition != null && (
              <section className="inspector-section queue-controls">
                <h2>队列顺序</h2>
                <span>
                  第 {currentRecord.queuePosition + 1} 首 / {queueLength} 首
                </span>
                <div>
                  <button
                    disabled={currentRecord.queuePosition === 0 || busy}
                    onClick={() => action({ type: "moveQueue", direction: -1 })}
                  >
                    上移
                  </button>
                  <button
                    disabled={
                      currentRecord.queuePosition === queueLength - 1 || busy
                    }
                    onClick={() => action({ type: "moveQueue", direction: 1 })}
                  >
                    下移
                  </button>
                </div>
              </section>
            )}
          </>
        }
      />
    </aside>
  );
}
