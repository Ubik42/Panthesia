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
