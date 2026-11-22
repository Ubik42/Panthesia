import { ToolbarMore } from "../../app/ToolbarMore";
import {
  ChevronRight,
  ChevronLeft,
  Minus,
  Plus,
  Hand,
  Menu,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { EngineCommand } from "../../api";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePlaybackFields } from "./usePlaybackFields";
import { StemControls } from "./StemControls";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackSlider } from "./usePlaybackSlider";

const transportFields = [
  "status",
  "mode",
  "hands",
  "speed",
  "bpm",
  "volume",
  "output",
  "recording",
] as const;

/** Playback controls subscribe independently of the application shell. */
export function PracticeTransport({
  store,
  available,
  busy,
  connected,
  nextTitle,
  nextHint,
  nextDisabledReason,
  openingTitle,
  next,
  previous,
  command,
  adjust,
  stopRecording,
  playShortcut,
  restartShortcut,
  back,
  menu,
  tools,
}: {
  store: PlaybackStore;
  available: boolean;
  busy: boolean;
  connected: boolean;
  nextTitle?: string;
  nextHint?: string;
  nextDisabledReason?: string;
  openingTitle?: string;
  next: () => void;
  previous?: () => void;
  command: (command: EngineCommand) => void;
  adjust: (command: {
    type: "speed" | "volume";
    value: number;
  }) => Promise<boolean>;
  stopRecording: () => void;
  playShortcut: string;
  restartShortcut: string;
  back: () => void;
  menu: () => void;
  tools: ReactNode;
}) {
  const state = usePlaybackFields(store, transportFields);
  const [bpmText, setBpmText] = useState<string | null>(null);
  const [bpmError, setBpmError] = useState("");
  const playing = ["playing", "countIn"].includes(state.status);
  const speedUnavailable = !connected || !available || state.recording;
  const speedLocked = busy || speedUnavailable;
  const playLabel = playing
    ? "暂停"
    : openingTitle
      ? "正在准备曲目"
      : state.status === "paused"
        ? "继续"
        : state.status === "finished"
          ? "再练一遍"
          : state.mode === "listen"
            ? "开始播放"
            : "开始练习";
  const unavailable = !connected
    ? "等待引擎连接"
    : playing && !state.recording
      ? undefined
      : openingTitle
        ? `正在打开：${openingTitle}`
        : state.recording
          ? "停止录音后可开始曲目练习"
          : !available
            ? "请先选择曲目"
            : busy
              ? "请等待当前操作完成"
              : undefined;
  const lastVolume = useRef(state.volume > 0 ? state.volume : 0.8);
  useEffect(() => {
    if (state.volume > 0) lastVolume.current = state.volume;
  }, [state.volume]);
  const speed = usePlaybackSlider({
    store,
    value: state.speed * state.bpm,
    disabled: speedLocked,
    commit: (value) =>
      adjust({
        type: "speed",
        value: Math.max(
          0.25,
          Math.min(2, value / Math.max(1, store.getSnapshot().bpm)),
        ),
      }),
  });
  const volume = usePlaybackSlider({
    store,
    value: state.volume,
    disabled: !connected,
    commit: (value) => adjust({ type: "volume", value }),
  });
  return (
    <div
      className="practice-transport synthesia-transport"
      role="group"
      aria-label="播放控制"
    >
      <button
        className="synthesia-back"
        aria-label="返回歌曲设置"
        onClick={back}
      >
        <ChevronLeft size={23} />
        返回
      </button>
      <div className="practice-transport-main">
        <button
          className="icon-button"
          title="上一小节"
          aria-label="上一小节"
          disabled={!available || busy || !connected || state.recording}
          onClick={previous ?? (() => command({ type: "restart" }))}
        >
          <SkipBack size={22} />
        </button>
        <button
          className="play-button"
          aria-label={playLabel}
          aria-busy={!!openingTitle || undefined}
          disabled={!!unavailable}
          title={
            unavailable ??
            `${playLabel}${playShortcut ? ` · ${playShortcut}` : ""}`
          }
          onClick={() =>
            command({
              type: ["playing", "countIn"].includes(store.getSnapshot().status)
                ? "pause"
                : "play",
            })
          }
        >
          {openingTitle && !playing ? (
            <LoaderCircle size={17} className="practice-opening-spin" />
          ) : playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
          <span className="synthesia-play-label">{playLabel}</span>
          {playShortcut && <kbd aria-hidden="true">{playShortcut}</kbd>}
        </button>
        <button
          className="icon-button"
          aria-label={
            nextHint ?? nextTitle ?? "下一小节"
          }
          title={
            nextDisabledReason ??
            nextHint ??
            (nextTitle ?? "下一小节")
          }
          disabled={
            !nextTitle ||
            !!nextDisabledReason ||
            busy ||
            !connected ||
            state.recording
          }
          onClick={next}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {state.recording && (
        <button
          className="practice-record-stop"
          disabled={busy || !connected}
          onClick={stopRecording}
        >
          <span aria-hidden="true" />
          停止并保存录音
        </button>
      )}
      <div className="practice-speed">
        <button
          className="synthesia-tempo-step"
          aria-label="减慢 5 BPM"
          disabled={speedLocked}
          onClick={() =>
            void adjust({
              type: "speed",
              value: Math.max(0.25, (speed.value - 5) / Math.max(1, state.bpm)),
            })
          }
        >
          <Minus size={26} />
        </button>
        <label>
          <span>
            速度 <small>BPM</small>
          </span>
          <input
            aria-label="播放速度"
            aria-valuetext={`${Math.round(speed.value)} BPM`}
            type="range"
            min={Math.round(state.bpm * 0.25)}
            max={Math.round(state.bpm * 2)}
            step="1"
            value={Math.round(speed.value)}
            disabled={speedUnavailable || (busy && !speed.pending)}
            aria-busy={speed.pending || undefined}
            onChange={(event) => speed.stage(Number(event.target.value))}
            onPointerDown={speed.begin}
            onKeyDown={(event) => speed.keyDown(event.key, event.repeat)}
            onPointerUp={speed.apply}
            onPointerCancel={speed.cancel}
            onBlur={speed.apply}
            onKeyUp={(event) => speed.keyUp(event.key)}
          />
        </label>
        <input
          className="bpm-number"
          type="number"
          aria-label="目标 BPM"
          min={Math.round(state.bpm * 0.25)}
          max={Math.round(state.bpm * 2)}
          step={1}
          value={bpmText ?? Math.round(speed.value)}
          disabled={speedUnavailable || busy}
          aria-invalid={!!bpmError || undefined}
          onFocus={() => {
            speed.begin();
            setBpmText(String(Math.round(speed.value)));
            setBpmError("");
          }}
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={(e) => {
            const text = e.currentTarget.value.trim(),
              value = Number(text);
            setBpmText(null);
            if (!text) {
              speed.cancel();
              return;
            }
            const min = Math.round(state.bpm * 0.25),
              max = Math.round(state.bpm * 2);
            if (!Number.isFinite(value) || value < min || value > max) {
              speed.cancel();
              setBpmError(`请输入 ${min}–${max} BPM`);
              return;
            }
            speed.stage(value);
            speed.apply();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.currentTarget.value = "";
              speed.cancel();
              setBpmText(null);
              setBpmError("");
              e.currentTarget.blur();
            }
          }}
        />
        <button
          className="practice-speed-reset"
          disabled={speedLocked || state.speed === 1}
          title={`恢复原曲速度 ${Math.round(state.bpm)} BPM`}
          onClick={() => {
            speed.cancel();
            command({ type: "speed", value: 1 });
          }}
        >
          原速
        </button>
        <span className="synthesia-bpm-unit">BPM</span>
        <button
          className="synthesia-tempo-step"
          aria-label="加快 5 BPM"
          disabled={speedLocked}
          onClick={() =>
            void adjust({
              type: "speed",
              value: Math.min(2, (speed.value + 5) / Math.max(1, state.bpm)),
            })
          }
        >
          <Plus size={26} />
        </button>
        {bpmError && (
          <span className="practice-bpm-error" role="status">
            {bpmError}
          </span>
        )}
      </div>
      <div className="synthesia-tool-cluster">
        {tools}
        <ToolbarMore
          label="练习方式"
          icon={<Hand size={27} />}
          disabled={!connected || !available}
        >
          <button
            aria-pressed={state.mode === "wait"}
            title={nextDisabledReason}
            disabled={
              !available ||
              !connected ||
              !!openingTitle ||
              state.recording ||
              !!nextDisabledReason
            }
            onClick={() => command({ type: "mode", value: "wait" })}
          >
            弹对后继续
          </button>
          <button
            aria-pressed={state.mode === "listen"}
            title={nextDisabledReason}
            disabled={
              !available ||
              !connected ||
              !!openingTitle ||
              state.recording ||
              !!nextDisabledReason
            }
            onClick={() => command({ type: "mode", value: "listen" })}
          >
            连续播放
          </button>
          <hr />
          {[
            ["left", "左手"],
            ["both", "双手"],
            ["right", "右手"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={state.hands === value}
              disabled={busy || state.recording}
              onClick={() => command({ type: "hands", value })}
            >
              {label}
            </button>
          ))}
        </ToolbarMore>
        <ToolbarMore
          label="音量"
          icon={<Volume2 size={27} />}
          disabled={!connected}
        >
          {" "}
          <div
            className="practice-volume"
            role="group"
            aria-label="演奏主音量"
            title={`主音量 · ${state.output}`}
          >
            <button
              type="button"
              className="volume-mute"
              aria-label={volume.value === 0 ? "取消静音" : "静音"}
              aria-pressed={volume.value === 0}
              disabled={!connected || volume.pending}
              onClick={() => {
                if (volume.value > 0) lastVolume.current = volume.value;
                volume.begin();
                volume.stage(volume.value === 0 ? lastVolume.current : 0);
                volume.apply();
              }}
            >
              {volume.value === 0 ? (
                <VolumeX size={17} aria-hidden="true" />
              ) : (
                <Volume2 size={17} aria-hidden="true" />
              )}
            </button>
            <input
              aria-label="主音量"
              aria-valuetext={`${Math.round(volume.value * 100)}%`}
              type="range"
              min="0"
              max="100"
              value={volume.value * 100}
              disabled={!connected}
              aria-busy={volume.pending || undefined}
              onChange={(event) =>
                volume.stage(Number(event.target.value) / 100)
              }
              onPointerDown={volume.begin}
              onKeyDown={(event) => volume.keyDown(event.key, event.repeat)}
              onPointerUp={volume.apply}
              onPointerCancel={volume.cancel}
              onBlur={volume.apply}
              onKeyUp={(event) => volume.keyUp(event.key)}
            />
            <output>{`${Math.round(volume.value * 100)}%`}</output>
          </div>
          <StemControls store={store} command={command} />
        </ToolbarMore>
        <button
          className="synthesia-app-menu"
          aria-label="应用菜单"
          onClick={menu}
        >
          <Menu size={25} />
        </button>
      </div>
    </div>
  );
}
