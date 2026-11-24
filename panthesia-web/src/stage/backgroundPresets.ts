import { useEffect, useState } from "react";

/** Built-in stage background pictures (public/backgrounds): abstract colour fields. */
export const BACKGROUND_PRESETS: { id: string; name: string }[] = [
  { id: "mist", name: "晨雾" },
  { id: "paper", name: "纸面" },
  { id: "dusk", name: "暮色" },
  { id: "ocean", name: "深海" },
  { id: "aurora", name: "极光" },
  { id: "night", name: "夜空" },
];
export const presetUrl = (id: string) => `/backgrounds/${id}.svg`;

/** What the stage shows behind the waterfall: nothing, the song's cover, a preset or the
 * player's own picture (kept in this browser profile, stageBackground.ts). */
export type BackgroundImage = "none" | "cover" | "custom" | `preset:${string}`;
export const isBackgroundImage = (value: unknown): value is BackgroundImage =>
  value === "none" || value === "cover" || value === "custom" || (typeof value === "string" && /^preset:[a-z-]+$/.test(value) && BACKGROUND_PRESETS.some((p) => `preset:${p.id}` === value));

const tones = new Map<string, string>();
/** The average colour of a picture (hex), so lines and labels on it pick light or dark ink. */
export function useImageTone(src: string | null | undefined) {
  const [tone, setTone] = useState<string | null>(src ? (tones.get(src) ?? null) : null);
  useEffect(() => {
    if (!src) return setTone(null);
    if (tones.has(src)) return setTone(tones.get(src)!);
    let live = true;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const hex = (v: number) => Math.round(v / 64).toString(16).padStart(2, "0");
      const value = `#${hex(r)}${hex(g)}${hex(b)}`;
      tones.set(src, value);
      if (live) setTone(value);
    };
    image.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return tone;
}
