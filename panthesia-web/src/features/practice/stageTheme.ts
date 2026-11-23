import type { DisplayPreferences } from "../settings/displayPreferences";

/** Colors of the waterfall area. Canvas and WebGL read them from here, not from inline literals. */
export const stageBackdrops = {
  studio: { top: "#0a111e", middle: "#101d2a", bottom: "#162d36" },
  midnight: { top: "#100e20", middle: "#1e1839", bottom: "#31264d" },
  rosewood: { top: "#211811", middle: "#30261d", bottom: "#413328" },
} as const satisfies Record<DisplayPreferences["skin"], unknown>;

/** One colour per pitch class (C, C#, … B) for the "按音高" note palette: a colour wheel around
 * the circle of fifths, so neighbouring keys of a scale stay distinct. */
export const pitchColors = [
  "#ff6b6b", "#5ec8f5", "#ffd166", "#b38cf0", "#7ee08a", "#ff9f5a",
  "#4f8ff7", "#ffe873", "#f07ad8", "#5be0c4", "#ffb35c", "#8fa2ff",
] as const;

/** Virtual hands: slender white hands with soft grey edges and joint creases. */
export const handSkin = {
  fill: "#f7f8fa",
  shade: "#dde2ea",
  outline: "#a9b0bd",
  crease: "#7d879a66",
  nail: "#ffffff",
  shadow: "#0b0e1466",
} as const;

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
  fingerOnBlack: "#f2d694",
  chord: "#c9d7ff",
  currentChord: "#f4f7ff",
  lyric: "#aebbd3",
  lyricSung: "#ffe7a3",
  shadow: "#000000c0",
  ledBase: "#ffffff1a",
  handBay: "#0c0f15",
  sectionTag: "#ffd27a",
  sectionText: "#2a1d05",
  fingerOnWhite: "#294432",
};

/** Fallboard and rail above the keys, keyed by skin. */
export const keyboardFrames = {
  studio: { fallboard: "#303544", edge: "#777b91" },
  midnight: { fallboard: "#303544", edge: "#777b91" },
  rosewood: { fallboard: "#70523a", edge: "#b78458" },
} as const satisfies Record<DisplayPreferences["skin"], unknown>;

/** White key surface from the front edge (top) to the key bottom, keyed by material. */
export const keyMaterials = {
  ivory: { edge: "#c3c1b1", face: "#fff6df", foot: "#dfd4b9", label: "#53635e" },
  porcelain: { edge: "#dce4ef", face: "#ffffff", foot: "#dae4f2", label: "#53635e" },
  glass: { edge: "#789bac", face: "#abcbd8", foot: "#496c83", label: "#eff7ff" },
} as const satisfies Record<DisplayPreferences["pianoMaterial"], unknown>;

export const keyInk = {
  rail: "#a6475a",
  required: "#f4db9e",
  activeFoot: "#e0fff3",
  activeLabel: "#53635e",
  seam: "#101b3025",
  lip: "#ffffff80",
  activeLip: "#ffffffa0",
  black: { top: "#303b4d", middle: "#182230", activeMiddle: "#3f807e", bottom: "#080d15", required: "#b68e43" },
  blackShine: ["#ffffff20", "#ffffff04", "#ffffff0c"] as const,
  blackEdge: "#ffffff25",
  blackLabel: "#e9edf1",
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
