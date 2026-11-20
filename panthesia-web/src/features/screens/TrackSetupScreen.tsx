import type { PracticePart } from "../../engine/commands.generated";
import type { CSSProperties } from "react";
import { usePartSettings, type PartDrag } from "./usePartSettings";
import {
  Hand,
  Zap,
  Palette,
  KeyboardMusic,
  Volume2,
  VolumeX,
} from "lucide-react";
import { type LoadedSong, type EngineCommand } from "../../api";
import { trackColors } from "./partPalette";
import { Dialog } from "../../Dialog";
import { ScreenHeader } from "./ScreenHeader";
const groups = [
  "钢琴",
  "半音打击乐",
  "风琴",
  "吉他",
  "贝斯",
  "弦乐",
  "合奏",
  "铜管",
  "簧管",
  "长笛",
  "合成主音",
  "合成音垫",
  "合成效果",
  "民族乐器",
  "打击乐",
  "音效",
];
export function TrackSetupScreen({
  song,
  disabled,
  builtin,
  pianoOnly,
  back,
  custom,
  command,
}: {
  song: LoadedSong;
  disabled: boolean;
  builtin: boolean;
  pianoOnly: boolean;
  back: () => void;
  custom: (track: number) => void;
  command: (value: EngineCommand) => Promise<boolean>;
}) {
  const {
    choice,
    setChoice,
    group,
    setGroup,
    pending,
    error,
    track,
    sound,
    act,
    chooseColor,
    chooseHand,
    update,
    soundChange,
    drag,
    setDrag,
    copyTo,
    autoColor,
    preview,
    setPreview,
  } = usePartSettings(song, disabled, command);
  const beginDrag = (
    event: React.DragEvent,
    track: number,
    kind: PartDrag["kind"],
  ) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-panthesia-part",
      `${song.contentId}:${track}:${kind}`,
    );
    setDrag({ track, kind });
  };
  const accept = (event: React.DragEvent, ids: number[]) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    void copyTo(ids);
  };
  const labels = (t: LoadedSong["tracks"][number]) =>
    song.notes.some((n) => n.track === t.id && n.manualHand)
      ? "自定义"
      : t.part === "left"
        ? "左手"
        : t.part === "right"
          ? "右手"
          : "背景";
  return (
    <main className="product-track-screen product-page">
      <ScreenHeader
        title="手别、颜色与乐器"
        back={back}
        backLabel="歌曲设置"
        backDisabled={pending}
      >
        <button
          className="synthesia-continue"
          onClick={back}
          disabled={pending}
        >
          继续
        </button>
      </ScreenHeader>
      <div className="product-track-grid">
        {song.tracks
          .filter((t) => t.notes > 0)
          .map((t) => {
            const s = song.trackSounds?.[String(t.id)],
              part = labels(t),
              color =
                t.color ??
                (t.part === "left"
                  ? "#386fae"
                  : t.part === "right"
                    ? "#679b20"
                    : "#777f85");
            return (
              <article
                key={t.id}
                className={`product-track-card ${drag && drag.track !== t.id ? "accepts-part-setting" : ""}`}
                onDragOver={(e) => {
                  if (drag) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => accept(e, [t.id])}
                onDragEnd={() => setDrag(null)}
                style={{ "--part-color": color } as CSSProperties}
              >
                <button
                  className="product-track-instrument"
                  draggable={!disabled && !pending}
                  onDragStart={(e) => beginDrag(e, t.id, "instrument")}
                  disabled={disabled || pending}
                  onClick={() => {
                    setGroup(pianoOnly ? 0 : Math.floor((s?.program ?? 0) / 8));
                    setChoice({ track: t.id, kind: "instrument" });
                  }}
                >
                  <KeyboardMusic size={48} />
                  <span>
                    <strong>
                      {s?.program != null
                        ? (song.soundPresets?.find(
                            (p) => p.program === s.program,
                          )?.name ?? `音色 ${s.program + 1}`)
                        : (t.sourceInstrument ?? t.name)}
                    </strong>
                    <small>
                      {t.name} · {t.notes.toLocaleString()} 个音符
                    </small>
                  </span>
                </button>
                <div className="product-track-controls">
                  <button
                    aria-label={`${t.name}手别`}
                    draggable={!disabled && !pending}
                    onDragStart={(e) => beginDrag(e, t.id, "hand")}
                    disabled={disabled || pending}
                    onClick={() => setChoice({ track: t.id, kind: "hand" })}
                  >
                    <Hand />
                    <span>{part}</span>
                  </button>
                  <button
                    aria-label={`${t.name}颜色`}
                    draggable={!disabled && !pending}
                    onDragStart={(e) => beginDrag(e, t.id, "color")}
                    disabled={disabled || pending}
                    onClick={() => setChoice({ track: t.id, kind: "color" })}
                  >
                    <Palette />
                    <span>{t.visible ? "颜色" : "隐藏"}</span>
                  </button>
                  <button
                    aria-label={`${t.name}声音`}
                    draggable={!disabled && !pending}
                    onDragStart={(e) => beginDrag(e, t.id, "volume")}
                    disabled={disabled || pending}
                    onClick={() =>
                      void act(
                        update(t, {
                          mode:
                            t.mode === "mute"
                              ? t.part === "other"
                                ? "auto"
                                : "human"
                              : "mute",
                        }),
                        false,
                      )
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setChoice({ track: t.id, kind: "volume" });
                    }}
                  >
                    {t.mode === "mute" ? <VolumeX /> : <Volume2 />}
                    <span>{t.mode === "mute" ? "静音" : "声音"}</span>
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      <footer className="product-page-footer">
        <button
          draggable={!pending && !disabled}
          disabled={pending || disabled}
          title="拖到声部或全部声部，恢复默认设置"
          onDragStart={(e) => beginDrag(e, -1, "reset")}
          onDragEnd={() => setDrag(null)}
        >
          <Zap size={20} />
          恢复默认
        </button>
        <button disabled={pending || disabled} onClick={() => void autoColor()}>
          自动配色
        </button>
        {drag && (
          <button
            className="product-all-parts"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) =>
              accept(
                e,
                song.tracks.map((t) => t.id),
              )
            }
          >
            全部声部
          </button>
        )}
        <button onClick={back} disabled={pending}>
          返回歌曲设置
        </button>
      </footer>
      {error && (
        <p className="product-inline-error" role="status">
          {error}
        </p>
      )}
      {choice && track && (
        <Dialog
          title={
            choice.kind === "hand"
              ? "手别"
              : choice.kind === "color"
                ? "音符颜色"
                : choice.kind === "volume"
                  ? "声音"
                  : "选择乐器"
          }
          close={() => {
            if (!pending) {
              setPreview(false);
              setChoice(null);
            }
          }}
        >
          <div className={`product-track-picker picker-${choice.kind}`}>
            {choice.kind === "hand" && (
              <>
                {[
                  ["left", "左手"],
                  ["right", "右手"],
                  ["other", "背景"],
                ].map(([part, label]) => (
                  <button
                    key={part}
                    disabled={pending || disabled}
                    aria-pressed={track.part === part}
                    onClick={() =>
                      void chooseHand(
                        part === "left"
                          ? "LeftHand"
                          : part === "right"
                            ? "RightHand"
                            : "Other",
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
                <button
                  disabled={pending || disabled}
                  onClick={() => {
                    setChoice(null);
                    custom(track.id);
                  }}
                >
                  自定义…
                </button>
              </>
            )}
            {choice.kind === "color" && (
              <>
                <button
                  disabled={pending || disabled}
                  onClick={() => void chooseColor(null)}
                >
                  按手别配色
                </button>
                <div className="product-color-grid">
                  {trackColors.map((color, i) => (
                    <button
                      key={color}
                      style={{ background: color }}
                      aria-label={`颜色 ${i + 1}`}
                      aria-pressed={track.color === color && track.visible}
                      disabled={pending || disabled}
                      onClick={() => void chooseColor(color)}
                    />
                  ))}
                </div>
                <button
                  disabled={pending || disabled}
                  aria-pressed={!track.visible}
                  onClick={() => void act(update(track, { visible: false }))}
                >
                  隐藏音符
                </button>
              </>
            )}
            {choice.kind === "volume" && (
              <>
                <button
                  disabled={pending || disabled}
                  onClick={() =>
                    void act(
                      update(track, {
                        mode:
                          track.mode === "mute"
                            ? track.part === "other"
                              ? "auto"
                              : "human"
                            : "mute",
                      }),
                    )
                  }
                >
                  {track.mode === "mute" ? "开启声音" : "静音"}
                </button>
                <label>
                  音量
                  <select
                    aria-label="音轨音量"
                    value={sound?.volume ?? 100}
                    disabled={pending || disabled}
                    onChange={(e) =>
                      void soundChange({ volume: Number(e.target.value) })
                    }
                  >
                    {[0, 25, 50, 75, 100].map((v) => (
                      <option key={v} value={v}>
                        {v}%
                      </option>
                    ))}
                    {sound && ![0, 25, 50, 75, 100].includes(sound.volume) && (
                      <option value={sound.volume}>{sound.volume}%</option>
                    )}
                  </select>
                </label>
              </>
            )}
            {choice.kind === "instrument" && (
              <>
                {!builtin ? (
                  <p>音色由当前外部音源管理，请在音源设置中选择。</p>
                ) : (
                  <>
                    <div className="product-instrument-preview">
                      <button
                        disabled={pending || disabled}
                        aria-pressed={preview}
                        onClick={() => setPreview((v) => !v)}
                      >
                        {preview ? "暂停预听" : "播放预听"}
                      </button>
                      <span>
                        原曲：{track.sourceInstrument ?? track.sourceName}
                      </span>
                    </div>
                    <nav aria-label="乐器分类">
                      {groups.map((label, i) => (
                        <button
                          key={label}
                          aria-selected={i === group}
                          disabled={
                            pending ||
                            (pianoOnly && i !== 0) ||
                            !(song.soundPresets ?? []).some(
                              (p) =>
                                pianoOnly || Math.floor(p.program / 8) === i,
                            )
                          }
                          onClick={() => setGroup(i)}
                        >
                          {label}
                        </button>
                      ))}
                    </nav>
                    <div className="product-instrument-list">
                      <button
                        aria-pressed={sound?.program == null}
                        disabled={pending || disabled}
                        onClick={() => void soundChange({ program: null })}
                      >
                        跟随原曲
                      </button>
                      {song.soundPresets
                        ?.filter(
                          (p) =>
                            pianoOnly || Math.floor(p.program / 8) === group,
                        )
                        .map((p) => (
                          <button
                            key={p.program}
                            aria-pressed={sound?.program === p.program}
                            disabled={pending || disabled}
                            onClick={() =>
                              void soundChange({ program: p.program })
                            }
                          >
                            {p.name}
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}
    </main>
  );
}
