import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { KeyboardMusic, Palette, RotateCcw, Volume2, VolumeX, Wand2 } from "lucide-react";
import type { LoadedSong, EngineCommand } from "../../api";
import type { PracticePart } from "../../engine/commands.generated";
import { trackColors } from "./partPalette";
import { Dialog } from "../../ui/Dialog";
import { usePartSettings } from "./usePartSettings";
import "../../ui/forms.css";
import "./partsList.css";

const groups = ["钢琴", "半音打击乐", "风琴", "吉他", "贝斯", "弦乐", "合奏", "铜管", "簧管", "长笛", "合成主音", "合成音垫", "合成效果", "民族乐器", "打击乐", "音效"];
const HANDS: [PracticePart, "left" | "right" | "other", string][] = [
  ["LeftHand", "left", "左手"],
  ["RightHand", "right", "右手"],
  ["Other", "other", "伴奏"],
];

export type PartsListProps = {
  song: LoadedSong;
  disabled: boolean;
  /** The built-in synthesizer plays the song (instruments can be chosen). */
  builtin: boolean;
  /** Only the piano sound bank is installed. */
  pianoOnly: boolean;
  /** Split this track's notes between the hands (the split page). */
  custom: (track: number) => void;
  command: (value: EngineCommand) => Promise<boolean>;
};

/** The song's parts (in the song details): for each track its hand, note colour, sound and
 * instrument, set in place; note by note hand splitting opens the split page. */
export function PartsList({ song, disabled, builtin, pianoOnly, custom, command }: PartsListProps) {
  const parts = usePartSettings(song, disabled, command);
  const { picker, setPicker, pickerTrack, pending } = parts;
  const locked = disabled || pending;
  const instrumentName = (t: LoadedSong["tracks"][number]) => {
    const program = parts.soundOf(t)?.program;
    return program != null ? (song.soundPresets?.find((p) => p.program === program)?.name ?? `音色 ${program + 1}`) : (t.sourceInstrument ?? t.name);
  };
  const tracks = song.tracks.filter((t) => t.notes > 0);
  return (
    <div className="parts-panel">
      <div className="parts-tools">
        <button className="ui-icon-button" title="自动配色" aria-label="自动配色" disabled={locked} onClick={() => void parts.autoColor()}>
          <Wand2 />
        </button>
        <button className="ui-icon-button" title="全部恢复默认" aria-label="全部恢复默认" disabled={locked} onClick={() => void parts.resetAll()}>
          <RotateCcw />
        </button>
      </div>
        {parts.error && (
          <p className="parts-error" role="alert">
            {parts.error}
          </p>
        )}
        <ul className="parts-list">
          {tracks.map((t) => {
            const custom_ = song.notes.some((n) => n.track === t.id && n.manualHand);
            // A track split note by note: how many notes each hand plays.
            const split = custom_
              ? (["left", "right"] as const).map((hand) => [hand, song.notes.filter((n) => n.track === t.id && n.part === hand).length] as const)
              : null;
            const color = t.color ?? (t.part === "left" ? "var(--hand-left)" : t.part === "right" ? "var(--hand-right)" : "var(--text-muted)");
            const sound = parts.soundOf(t);
            return (
              <Fragment key={t.id}>
              <li className="parts-row" style={{ "--part-color": color } as CSSProperties} data-hidden={!t.visible || undefined}>
                <button className="parts-swatch" aria-label={`${t.name}音符颜色`} disabled={locked} onClick={() => setPicker({ track: t.id, kind: "color" })}>
                  <Palette aria-hidden="true" />
                </button>
                <div className="parts-name" title={`${t.notes.toLocaleString()} 个音符${!t.visible ? " · 音符已隐藏" : ""}`}>
                  <strong>{t.name}</strong>
                  <small>{t.notes.toLocaleString()}</small>
                </div>
                <div className="ui-segmented parts-hand" role="group" aria-label={`${t.name}手别`}>
                  {HANDS.map(([part, id, label]) => (
                    <button key={id} aria-pressed={!custom_ && t.part === id} disabled={locked} onClick={() => void parts.setHand(t, part)}>
                      {label}
                    </button>
                  ))}
                  <button aria-pressed={custom_} disabled={locked} onClick={() => custom(t.id)} title="按音符分配左右手">
                    逐音
                  </button>
                </div>
                <button
                  className="ui-button parts-instrument"
                  disabled={locked}
                  onClick={() => {
                    parts.setGroup(pianoOnly ? 0 : Math.floor((sound?.program ?? t.sourceProgram ?? 0) / 8));
                    setPicker({ track: t.id, kind: "instrument" });
                  }}
                >
                  <KeyboardMusic />
                  {instrumentName(t)}
                </button>
                <div className="parts-sound">
                  <button className="ui-icon-button" aria-label={t.mode === "mute" ? `开启${t.name}声音` : `${t.name}静音`} aria-pressed={t.mode === "mute"} disabled={locked} onClick={() => void parts.toggleSound(t)}>
                    {t.mode === "mute" ? <VolumeX /> : <Volume2 />}
                  </button>
                  <VolumeSlider label={`${t.name}音量`} value={sound?.volume ?? 100} disabled={locked || t.mode === "mute"} commit={(volume) => void parts.setSound(t, { volume })} />
                </div>
              </li>
              {split?.map(([hand, count]) => {
                const level = sound?.[hand] ?? 100;
                const name = hand === "left" ? "左手" : "右手";
                return (
                  <li key={`${t.id}:${hand}`} className="parts-row parts-hand-row" style={{ "--part-color": `var(--hand-${hand})` } as CSSProperties}>
                    <span className="parts-hand-dot" aria-hidden="true" />
                    <div className="parts-name">
                      <strong>{name}</strong>
                      <small>{count.toLocaleString()}</small>
                    </div>
                    <div className="parts-sound">
                      <button className="ui-icon-button" aria-label={level === 0 ? `开启${name}声音` : `${name}静音`} aria-pressed={level === 0} disabled={locked || t.mode === "mute"} onClick={() => void parts.setSound(t, { [hand]: level === 0 ? null : 0 })}>
                        {level === 0 ? <VolumeX /> : <Volume2 />}
                      </button>
                      <VolumeSlider label={`${name}音量`} value={level} disabled={locked || t.mode === "mute" || level === 0} commit={(value) => void parts.setSound(t, { [hand]: value === 100 ? null : value })} />
                    </div>
                  </li>
                );
              })}
              </Fragment>
            );
          })}
        </ul>
      {picker && pickerTrack && (
        <Dialog
          title={picker.kind === "color" ? `${pickerTrack.name} · 音符颜色` : `${pickerTrack.name} · 乐器`}
          wide={picker.kind === "instrument"}
          close={() => {
            if (!pending) {
              parts.setPreview(false);
              setPicker(null);
            }
          }}
        >
          {picker.kind === "color" && (
            <>
              <div className="parts-colors" role="group" aria-label="音符颜色">
                {trackColors.map((c, i) => (
                  <button key={c} style={{ background: c }} aria-label={`颜色 ${i + 1}`} aria-pressed={pickerTrack.color === c && pickerTrack.visible} disabled={locked} onClick={() => void parts.setColor(pickerTrack, c)} />
                ))}
              </div>
              <div className="settings-row-actions">
                <button disabled={locked} onClick={() => void parts.setColor(pickerTrack, null)}>
                  按手别配色
                </button>
                <button disabled={locked} aria-pressed={!pickerTrack.visible} onClick={() => void parts.hideNotes(pickerTrack)}>
                  隐藏音符
                </button>
              </div>
            </>
          )}
          {picker.kind === "instrument" &&
            (!builtin ? (
              <p>音色由当前外部音源管理，请在设置 → 声音与设备中选择音源。</p>
            ) : (
              <>
                <div className="ui-row">
                  <span>原曲：{pickerTrack.sourceInstrument ?? pickerTrack.sourceName}</span>
                  <button disabled={locked} aria-pressed={parts.preview} onClick={() => parts.setPreview((v) => !v)}>
                    {parts.preview ? "停止试听" : "试听"}
                  </button>
                </div>
                <nav className="parts-groups" aria-label="乐器分类">
                  {groups.map((label, i) => (
                    <button
                      key={label}
                      aria-pressed={i === parts.group}
                      disabled={pending || (pianoOnly && i !== 0) || !(song.soundPresets ?? []).some((p) => pianoOnly || Math.floor(p.program / 8) === i)}
                      onClick={() => parts.setGroup(i)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className="parts-instruments">
                  <button aria-pressed={parts.soundOf(pickerTrack)?.program == null} disabled={locked} onClick={() => void parts.setSound(pickerTrack, { program: null })}>
                    跟随原曲
                  </button>
                  {song.soundPresets
                    ?.filter((p) => pianoOnly || Math.floor(p.program / 8) === parts.group)
                    .map((p) => (
                      <button key={p.program} aria-pressed={parts.soundOf(pickerTrack)?.program === p.program} disabled={locked} onClick={() => void parts.setSound(pickerTrack, { program: p.program })}>
                        {p.name}
                      </button>
                    ))}
                </div>
              </>
            ))}
        </Dialog>
      )}
    </div>
  );
}

/** A volume slider that sends its value once, when released. */
function VolumeSlider({ label, value, disabled, commit }: { label: string; value: number; disabled: boolean; commit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const done = () => draft !== value && commit(draft);
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={done}
      onKeyUp={done}
      onBlur={done}
    />
  );
}
