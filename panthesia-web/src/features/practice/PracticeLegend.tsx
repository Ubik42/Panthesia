import type { LoadedSong } from "../../api";
import { handColor, type DisplayPreferences } from "../settings/displayPreferences";
import { effectPalettes } from "./pianoEffects";
import "./practiceLegend.css";

export function PracticeLegend({
  song,
  display,
}: {
  song: LoadedSong | null;
  display: DisplayPreferences;
}) {
  const palette = effectPalettes[display.effectsPalette];
  const color = (part: string) => display.palette === "accessible"
    ? handColor(part, display)
    : part.toLowerCase().includes("left") ? palette.left : palette.right;
  return (
    <span
      className="view-legend"
      role="group"
      aria-label="键盘声部颜色"
      title={song?.tracks
        .filter((track) => track.visible)
        .map((track) => track.name)
        .join(" · ")}
    >
      {(display.palette === "accessible" ||
        !song ||
        song.tracks.some((track) => track.visible && !track.color)) && (
        <>
          <i
            className="low"
            style={{ background: color("left") }}
          />
          左手
          <i
            className="high"
            style={{ background: color("right") }}
          />
          {display.palette === "accessible" ? "右手" : "右手 / 未分手"}
          {display.palette === "accessible" && (
            <>
              <i style={{ background: handColor("other", display) }} />
              未分手
            </>
          )}
        </>
      )}
      {display.palette === "standard" &&
        song?.tracks
          .filter((track) => track.color && track.visible)
          .slice(0, 2)
          .map((track) => (
            <span className="track-legend" key={track.id} title={track.name}>
              <i style={{ background: track.appearanceCustom ? track.color! : color(track.part) }} />
              {track.name}
            </span>
          ))}
    </span>
  );
}
