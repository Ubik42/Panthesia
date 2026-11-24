import { ImagePlus, Music } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BACKGROUND_PRESETS, presetUrl, type BackgroundImage } from "../../stage/backgroundPresets";
import { chooseStageBackground, useStageBackground } from "../../stage/stageBackground";
import type { DisplayPreferences } from "./displayPreferences";
import { StageColorPicker } from "./StageColorPicker";
import "./stageBackgroundSettings.css";

type Value = Pick<DisplayPreferences, "stageColor" | "backgroundOpacity" | "backgroundImage" | "backgroundImageOpacity">;

/** The stage background (stage bar panel and settings page): either a plain colour or a picture
 * (the song's cover, a preset or the player's own), each with its own strength. The two do not
 * mix: a picture shows as it is, and the lines and labels on it follow its brightness. */
export function StageBackgroundSettings({ value, change, cover, heading }: { value: Value; change: (patch: Partial<Value>) => void; /** The current song's cover, when it has one. */ cover?: string | null; /** A section heading (the settings page; the stage panel has its own title). */ heading?: string }) {
  const own = useStageBackground();
  const picture = value.backgroundImage !== "none";
  // The last picture, so switching back from the colour restores it.
  const [lastPicture, setLastPicture] = useState<BackgroundImage>(picture ? value.backgroundImage : "preset:mist");
  const pick = (backgroundImage: BackgroundImage) => {
    setLastPicture(backgroundImage);
    change({ backgroundImage });
  };
  return (
    <section className="stage-background" aria-label="背景">
      {heading && <h3>{heading}</h3>}
      <span className="ui-segmented stage-background-mode" role="group" aria-label="背景方式">
        <button type="button" aria-pressed={!picture} onClick={() => change({ backgroundImage: "none" })}>
          纯色
        </button>
        <button type="button" aria-pressed={picture} onClick={() => change({ backgroundImage: lastPicture })}>
          图片
        </button>
      </span>
      {!picture ? (
        <>
          <div className="stage-background-row">
            <span>颜色</span>
            <StageColorPicker value={value.stageColor} change={(stageColor) => change({ stageColor })} />
          </div>
          <Strength label="不透明度" value={value.backgroundOpacity} min={0} change={(backgroundOpacity) => change({ backgroundOpacity })} />
        </>
      ) : (
        <>
          <div className="stage-background-tiles" role="radiogroup" aria-label="背景图片">
            <Tile label={cover ? "歌曲封面" : "歌曲封面（这首歌没有封面）"} caption="封面" on={value.backgroundImage === "cover"} pick={() => pick("cover")} image={cover ?? undefined}>
              {!cover && <Music aria-hidden="true" />}
            </Tile>
            {BACKGROUND_PRESETS.map((preset) => (
              <Tile key={preset.id} label={preset.name} caption={preset.name} on={value.backgroundImage === `preset:${preset.id}`} pick={() => pick(`preset:${preset.id}`)} image={presetUrl(preset.id)} />
            ))}
            {own && <Tile label="自选图片" caption="自选" on={value.backgroundImage === "custom"} pick={() => pick("custom")} image={own} />}
            <label className="stage-background-tile stage-background-add" title={own ? "换一张图片…" : "选择图片…"}>
              <span className="stage-background-thumb">
                <ImagePlus aria-hidden="true" />
              </span>
              <span className="stage-background-caption">选择…</span>
              <input
                type="file"
                accept="image/*"
                hidden
                aria-label="选择背景图片"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void chooseStageBackground(file).then(() => pick("custom"));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <Strength label="图片浓度" value={value.backgroundImageOpacity} min={10} change={(backgroundImageOpacity) => change({ backgroundImageOpacity })} />
        </>
      )}
    </section>
  );
}

function Strength({ label, value, min, change }: { label: string; value: number; min: number; change: (value: number) => void }) {
  return (
    <div className="stage-background-row">
      <span>{label}</span>
      <span className="settings-range">
        <input type="range" aria-label={label} min={min} max={100} value={value} onChange={(e) => change(Number(e.target.value))} />
        <output>{value}%</output>
      </span>
    </div>
  );
}

function Tile({ label, caption, on, pick, image, children }: { label: string; caption: string; on: boolean; pick: () => void; image?: string; children?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="stage-background-tile" title={label} aria-label={label} onClick={pick}>
      <span className="stage-background-thumb" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
        {children}
      </span>
      <span className="stage-background-caption">{caption}</span>
    </button>
  );
}
