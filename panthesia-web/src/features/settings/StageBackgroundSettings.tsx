import { Ban, ImagePlus, Music } from "lucide-react";
import type { ReactNode } from "react";
import { BACKGROUND_PRESETS, presetUrl, type BackgroundImage } from "../../stage/backgroundPresets";
import { chooseStageBackground, useStageBackground } from "../../stage/stageBackground";
import type { DisplayPreferences } from "./displayPreferences";
import { StageColorPicker } from "./StageColorPicker";
import "./stageBackgroundSettings.css";

type Value = Pick<DisplayPreferences, "stageColor" | "backgroundOpacity" | "backgroundImage">;

/** The stage background in one place (stage bar panel and settings page): the colour, a picture
 * behind the waterfall (none, the song's cover, a preset or the player's own) and how much the
 * colour covers the picture. */
export function StageBackgroundSettings({ value, change, cover }: { value: Value; change: (patch: Partial<Value>) => void; /** The current song's cover, when it has one. */ cover?: string | null }) {
  const own = useStageBackground();
  const pick = (backgroundImage: BackgroundImage) =>
    // A picture under a fully opaque colour would not show: let it through.
    change(backgroundImage !== "none" && value.backgroundOpacity === 100 ? { backgroundImage, backgroundOpacity: 55 } : { backgroundImage });
  return (
    <section className="stage-background" aria-label="背景">
      <h3>背景</h3>
      <div className="stage-background-row">
        <span>颜色</span>
        <StageColorPicker value={value.stageColor} change={(stageColor) => change({ stageColor })} />
      </div>
      <div className="stage-background-row stage-background-images">
        <span>图片</span>
        <div className="stage-background-tiles" role="radiogroup" aria-label="背景图片">
          <Tile label="无" on={value.backgroundImage === "none"} pick={() => change({ backgroundImage: "none" })}>
            <Ban aria-hidden="true" />
          </Tile>
          <Tile label={cover ? "歌曲封面" : "歌曲封面（这首歌没有封面）"} on={value.backgroundImage === "cover"} pick={() => pick("cover")} image={cover ?? undefined}>
            {!cover && <Music aria-hidden="true" />}
          </Tile>
          {BACKGROUND_PRESETS.map((preset) => (
            <Tile key={preset.id} label={preset.name} on={value.backgroundImage === `preset:${preset.id}`} pick={() => pick(`preset:${preset.id}`)} image={presetUrl(preset.id)} />
          ))}
          {own && <Tile label="自选图片" on={value.backgroundImage === "custom"} pick={() => pick("custom")} image={own} />}
          <label className="stage-background-tile stage-background-add" title={own ? "换一张图片…" : "选择图片…"}>
            <ImagePlus aria-hidden="true" />
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
      </div>
      <div className="stage-background-row" title="颜色盖住图片的程度：100% 只见颜色，调低后图片透出">
        <span>颜色浓度</span>
        <span className="settings-range">
          <input type="range" aria-label="背景颜色浓度" min={0} max={100} value={value.backgroundOpacity} onChange={(e) => change({ backgroundOpacity: Number(e.target.value) })} />
          <output>{value.backgroundOpacity}%</output>
        </span>
      </div>
    </section>
  );
}

function Tile({ label, on, pick, image, children }: { label: string; on: boolean; pick: () => void; image?: string; children?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="stage-background-tile" title={label} aria-label={label} style={image ? { backgroundImage: `url("${image}")` } : undefined} onClick={pick}>
      {children}
    </button>
  );
}
