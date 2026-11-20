import {
  displayPitch,
  type DisplayPreferences,
} from "../../displayPreferences";

type Geometry = (pitch: number, width: number) => { x: number; w: number };
type Frame = {
  width: number;
  height: number;
  dpr: number;
  keyboardHeight: number;
  pressed: readonly number[];
  required: readonly number[];
  played: ReadonlySet<number>;
  colors: ReadonlyMap<number, string>;
};

/** Keyboard materials and live highlights have their own repaint lifetime. */
export class PianoKeyboard {
  private baseImage = document.createElement("canvas");
  private activeImage = document.createElement("canvas");
  private baseKey = "";
  private activeKey = "";
  constructor(
    private display: DisplayPreferences,
    private white: readonly number[],
    private black: readonly number[],
    private geometry: Geometry,
    private defaultColor: string,
  ) {}
  configure(
    display: DisplayPreferences,
    white: readonly number[],
    black: readonly number[],
    geometry: Geometry,
    defaultColor: string,
  ) {
    if (
      this.display === display &&
      this.white === white &&
      this.black === black &&
      this.geometry === geometry &&
      this.defaultColor === defaultColor
    )
      return;
    this.display = display;
    this.white = white;
    this.black = black;
    this.geometry = geometry;
    this.defaultColor = defaultColor;
    this.baseKey = "";
    this.activeKey = "";
  }
  paint(ctx: CanvasRenderingContext2D, input: Frame) {
    const {
      width,
      height,
      dpr,
      keyboardHeight,
      pressed,
      required: requiredPitches,
      played,
      colors,
    } = input;
    const baseline = height - keyboardHeight;
    const { display, white, black, geometry } = this;
    const keyboardImage = this.baseImage,
      activeKeyboard = this.activeImage;
    const paintKeys = (ctx: CanvasRenderingContext2D, base: boolean) => {
      // A raised fallboard and felt rail give the keyboard a physical edge.
      if (base) {
        ctx.fillStyle = display.skin === "rosewood" ? "#70523a" : "#303544";
        ctx.fillRect(0, baseline - 7, width, 5);
        ctx.fillStyle = display.skin === "rosewood" ? "#b78458" : "#777b91";
        ctx.fillRect(0, baseline - 7, width, 1);
        ctx.fillStyle = "#a6475a";
        ctx.fillRect(0, baseline - 2, width, 2);
      }
      for (const pitch of white) {
        const { x, w } = geometry(pitch, width);
        const active = !base && (pressed.includes(pitch) || played.has(pitch));
        const required = !base && requiredPitches.includes(pitch);
        if (!base && !active && !required) continue;
        const keys = ctx.createLinearGradient(0, baseline, 0, height);
        keys.addColorStop(
          0,
          active
            ? (colors.get(pitch) ?? this.defaultColor)
            : required
              ? "#f4db9e"
              : display.pianoMaterial === "glass"
                ? "#789bac"
                : display.pianoMaterial === "porcelain"
                  ? "#dce4ef"
                  : "#c3c1b1",
        );
        keys.addColorStop(
          0.14,
          active
            ? (colors.get(pitch) ?? this.defaultColor)
            : display.pianoMaterial === "glass"
              ? "#abcbd8"
              : display.pianoMaterial === "porcelain"
                ? "#ffffff"
                : "#fff6df",
        );
        keys.addColorStop(
          1,
          active
            ? "#e0fff3"
            : display.pianoMaterial === "glass"
              ? "#496c83"
              : display.pianoMaterial === "porcelain"
                ? "#dae4f2"
                : "#dfd4b9",
        );
        ctx.fillStyle = keys;
        ctx.fillRect(x + 1, baseline, w - 2, keyboardHeight - 2);
        ctx.fillStyle = "#101b3025";
        ctx.fillRect(x + w - 3, baseline, 1, keyboardHeight - 2);
        ctx.fillStyle = active ? "#ffffffa0" : "#ffffff80";
        ctx.fillRect(x + 2, height - 6, w - 4, 2);
        if (
          display.keyLabels !== "none" &&
          (display.keyLabels !== "c" || pitch % 12 === 0)
        ) {
          ctx.fillStyle =
            display.pianoMaterial === "glass" && !active
              ? "#eff7ff"
              : "#53635e";
          ctx.font = `${display.fontSize}px sans-serif`;
          const label = displayPitch(pitch, display);
          const size = Math.min(
            display.fontSize,
            (display.fontSize * (w - 3)) /
              Math.max(1, ctx.measureText(label).width),
          );
          if (size < 8) continue;
          ctx.font = `${size}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(label, x + w / 2, height - 14);
        }
      }
      for (const pitch of black) {
        const { x, w } = geometry(pitch, width);
        const active = !base && (pressed.includes(pitch) || played.has(pitch));
        const required = !base && requiredPitches.includes(pitch);
        const covered =
          !base &&
          [pitch - 1, pitch + 1].some(
            (p) =>
              pressed.includes(p) ||
              played.has(p) ||
              requiredPitches.includes(p),
          );
        if (!base && !active && !required && !covered) continue;
        const darkKey = ctx.createLinearGradient(
          x,
          baseline,
          x + w,
          baseline + keyboardHeight * 0.62,
        );
        darkKey.addColorStop(
          0,
          active ? (colors.get(pitch) ?? this.defaultColor) : "#303b4d",
        );
        darkKey.addColorStop(0.4, active ? "#3f807e" : "#182230");
        darkKey.addColorStop(1, "#080d15");
        ctx.fillStyle = active ? darkKey : required ? "#b68e43" : darkKey;
        ctx.beginPath();
        ctx.roundRect(x, baseline, w, keyboardHeight * 0.62, [0, 0, 3, 3]);
        ctx.fill();
        const topFace = ctx.createLinearGradient(
          0,
          baseline,
          0,
          baseline + keyboardHeight * 0.56,
        );
        topFace.addColorStop(0, "#ffffff20");
        topFace.addColorStop(0.3, "#ffffff04");
        topFace.addColorStop(1, "#ffffff0c");
        ctx.fillStyle = topFace;
        ctx.fillRect(
          x + 2,
          baseline + 1,
          Math.max(1, w - 4),
          keyboardHeight * 0.54,
        );
        ctx.strokeStyle = "#ffffff25";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x + 2, baseline + keyboardHeight * 0.56);
        ctx.lineTo(x + w - 2, baseline + keyboardHeight * 0.56);
        ctx.stroke();
        if (display.keyLabels === "all") {
          const label = displayPitch(pitch, display);
          ctx.font = `${display.fontSize}px sans-serif`;
          const size = Math.min(
            display.fontSize,
            (display.fontSize * (w - 3)) /
              Math.max(1, ctx.measureText(label).width),
          );
          if (size >= 8) {
            ctx.font = `${size}px sans-serif`;
            ctx.fillStyle = "#e9edf1";
            ctx.textAlign = "center";
            ctx.fillText(
              label,
              x + w / 2,
              baseline + keyboardHeight * 0.62 - 10,
            );
          }
        }
      }
    };
    const cacheKey = `${width}:${height}:${keyboardHeight}:${dpr}`;
    if (this.baseKey !== cacheKey) {
      const targetWidth = Math.ceil(width * dpr),
        targetHeight = Math.ceil((keyboardHeight + 7) * dpr);
      if (
        keyboardImage.width !== targetWidth ||
        keyboardImage.height !== targetHeight
      ) {
        keyboardImage.width = targetWidth;
        keyboardImage.height = targetHeight;
      }
      const cached = keyboardImage.getContext("2d")!;
      cached.setTransform(1, 0, 0, 1, 0, 0);
      cached.clearRect(0, 0, targetWidth, targetHeight);
      cached.setTransform(dpr, 0, 0, dpr, 0, -(baseline - 7) * dpr);
      paintKeys(cached, true);
      this.baseKey = cacheKey;
    }
    const keyState = `${cacheKey}|${pressed.join(",")}|${requiredPitches.join(",")}|${[...played].join(",")}|${[...colors].map(([pitch, color]) => `${pitch}:${color}`).join(",")}`;
    if (this.activeKey !== keyState) {
      if (
        activeKeyboard.width !== keyboardImage.width ||
        activeKeyboard.height !== keyboardImage.height
      ) {
        activeKeyboard.width = keyboardImage.width;
        activeKeyboard.height = keyboardImage.height;
      }
      const cached = activeKeyboard.getContext("2d")!;
      cached.setTransform(1, 0, 0, 1, 0, 0);
      cached.clearRect(0, 0, activeKeyboard.width, activeKeyboard.height);
      cached.drawImage(keyboardImage, 0, 0);
      cached.setTransform(dpr, 0, 0, dpr, 0, -(baseline - 7) * dpr);
      paintKeys(cached, false);
      this.activeKey = keyState;
    }
    ctx.drawImage(activeKeyboard, 0, baseline - 7, width, keyboardHeight + 7);
  }
}
