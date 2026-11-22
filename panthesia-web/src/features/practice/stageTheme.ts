import type { DisplayPreferences } from "../settings/displayPreferences";

/** Colors of the waterfall area. Canvas and WebGL read them from here, not from inline literals. */
export const stageBackdrops = {
  studio: { top: "#0a111e", middle: "#101d2a", bottom: "#162d36" },
  midnight: { top: "#100e20", middle: "#1e1839", bottom: "#31264d" },
  rosewood: { top: "#211811", middle: "#30261d", bottom: "#413328" },
} as const satisfies Record<DisplayPreferences["skin"], unknown>;

/** Glow that rises from the keyboard, keyed by the effect palette. */
export const stageAtmospheres = {
  aurora: "#245a6150",
  ember: "#58372755",
  violet: "#44336055",
} as const satisfies Record<DisplayPreferences["effectsPalette"], string>;

export const stageInk = {
  grid: "#ccd7ea",
  keyColumn: "#a6b9d2",
  measureLabel: "#aab8cc",
  required: "#efd484",
};

export type Rgba = readonly [number, number, number, number];

const parsed = new Map<string, Rgba>();
let probe: CanvasRenderingContext2D | null = null;

/** Straight (not premultiplied) RGBA in 0..1. Accepts any CSS color; hex is parsed without the DOM. */
export function rgba(color: string): Rgba {
  let value = parsed.get(color);
  if (value) return value;
  let hex = /^#([0-9a-f]{3,8})$/i.exec(color)?.[1];
  if (!hex) {
    probe ??= document.createElement("canvas").getContext("2d");
    if (probe) {
      probe.fillStyle = "#000";
      probe.fillStyle = color;
      const normal = String(probe.fillStyle);
      hex = /^#([0-9a-f]{6})$/i.exec(normal)?.[1];
      const channels = /rgba?\(([^)]+)\)/.exec(normal)?.[1].split(",").map(Number);
      if (!hex && channels)
        value = [channels[0] / 255, channels[1] / 255, channels[2] / 255, channels[3] ?? 1];
    }
  }
  if (!value) {
    const full =
      hex && hex.length <= 4 ? [...hex].map((c) => c + c).join("") : (hex ?? "66edce");
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    value = [n(0), n(2), n(4), full.length >= 8 ? n(6) : 1];
  }
  if (parsed.size >= 256) parsed.clear();
  parsed.set(color, value);
  return value;
}
