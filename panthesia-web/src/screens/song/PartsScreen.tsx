import { useEffect, useState, type CSSProperties } from "react";
import { KeyboardMusic, Palette, Volume2, VolumeX } from "lucide-react";
import type { LoadedSong, EngineCommand } from "../../api";
import type { PracticePart } from "../../engine/commands.generated";
import { trackColors } from "../../features/screens/partPalette";
import { Dialog } from "../../ui/Dialog";
import { PageHeader } from "../../ui/PageHeader";
import { usePartSettings } from "./usePartSettings";
import "../../ui/forms.css";
import "./partsScreen.css";

const groups = ["钢琴", "半音打击乐", "风琴", "吉他", "贝斯", "弦乐", "合奏", "铜管", "簧管", "长笛", "合成主音", "合成音垫", "合成效果", "民族乐器", "打击乐", "音效"];
const HANDS: [PracticePart, "left" | "right" | "other", string][] = [
  ["LeftHand", "left", "左手"],
  ["RightHand", "right", "右手"],
  ["Other", "other", "伴奏"],
];

/** Parts of the song (song page → 声部与手别): for each track its hand, note colour, sound and
 * instrument, set in place; hand by hand note splitting opens the split page. */
export function PartsScreen({
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
  /** The built-in synthesizer plays the song (instruments can be chosen). */
  builtin: boolean;
  /** Only the piano sound bank is installed. */
  pianoOnly: boolean;
  back: () => void;
  custom: (track: number) => void;
  command: (value: EngineCommand) => Promise<boolean>;
}) {
  const parts = usePartSettings(song, disabled, command);
  const { picker, setPicker, pickerTrack, pending } = parts;
  const locked = disabled || pending;
  const instrumentName = (t: LoadedSong["tracks"][number]) => {
    const program = parts.soundOf(t)?.program;
    return program != null ? (song.soundPresets?.find((p) => p.program === program)?.name ?? `音色 ${program + 1}`) : (t.sourceInstrument ?? t.name);
  };
  const tracks = song.tracks.filter((t) => t.notes > 0);
  return (
    <main className="ui-screen ui-page parts-screen">
      <PageHeader title="声部与手别" subtitle={`${tracks.length} 个声部 · 手别决定谁弹、谁伴奏`} back={back} backLabel="歌曲" backDisabled={pending}>
        <button className="ui-button" disabled={locked} onClick={() => void parts.autoColor()}>
          自动配色
        </button>
        <button className="ui-button" disabled={locked} onClick={() => void parts.resetAll()}>
          全部恢复默认
        </button>
      </PageHeader>
      <div className="ui-page-body">
        {parts.error && (
          <p className="parts-error" role="alert">
            {parts.error}
          </p>
        )}
        <ul className="parts-list">
          {tracks.map((t) => {
            const custom_ = song.notes.some((n) => n.track === t.id && n.manualHand);
            const color = t.color ?? (t.part === "left" ? "var(--hand-left)" : t.part === "right" ? "var(--hand-right)" : "var(--text-muted)");
            const sound = parts.soundOf(t);
            return (
              <li key={t.id} className="parts-row ui-card" style={{ "--part-color": color } as CSSProperties} data-hidden={!t.visible || undefined}>
                <button className="parts-swatch" aria-label={`${t.name}音符颜色`} disabled={locked} onClick={() => setPicker({ track: t.id, kind: "color" })}>
                  <Palette aria-hidden="true" />
                </button>
                <div className="parts-name">
                  <strong>{t.name}</strong>
                  <small>
                    {t.notes.toLocaleString()} 个音符{!t.visible ? " · 音符已隐藏" : ""}
                  </small>
                </div>
                <div className="ui-segmented parts-hand" role="group" aria-label={`${t.name}手别`}>
                  {HANDS.map(([part, id, label]) => (
                    <button key={id} aria-pressed={!custom_ && t.part === id} disabled={locked} onClick={() => void parts.setHand(t, part)}>
                      {label}
                    </button>
                  ))}
                  <button aria-pressed={custom_} disabled={locked} onClick={() => custom(t.id)} title="按音符分配左右手">
                    逐音…
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
            );
          })}
        </ul>
      </div>
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
    </main>
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
