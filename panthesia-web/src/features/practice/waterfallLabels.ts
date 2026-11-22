/** Note labels rendered once to small canvases and blitted each frame. */
export class WaterfallLabels {
  private labels = new Map<string, { size: number; color: string }>();
  private labelImages = new Map<
    string,
    { image: HTMLCanvasElement; width: number; height: number; descent: number }
  >();

  label(
    ctx: CanvasRenderingContext2D,
    text: string,
    width: number,
    size: number,
    fill: string,
  ) {
    const key = `${text}:${width}:${size}:${fill}`;
    let label = this.labels.get(key);
    if (!label) {
      ctx.font = `${size}px sans-serif`;
      const luminance =
        parseInt(fill.slice(1, 3), 16) * 0.299 +
        parseInt(fill.slice(3, 5), 16) * 0.587 +
        parseInt(fill.slice(5, 7), 16) * 0.114;
      label = {
        size: Math.min(
          size,
          (size * (width - 4)) / Math.max(1, ctx.measureText(text).width),
        ),
        color: luminance < 145 ? "#fff" : "#18362e",
      };
      if (this.labels.size >= 512) this.labels.clear();
      this.labels.set(key, label);
    }
    return label;
  }
  paintLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    baseline: number,
    width: number,
    size: number,
    fill: string,
    ratio: number,
  ) {
    const key = `${text}:${width}:${size}:${fill}:${ratio}`;
    let sprite = this.labelImages.get(key);
    if (!sprite) {
      const fitted = this.label(ctx, text, width, size, fill);
      if (fitted.size < 8) return;
      const image = document.createElement("canvas");
      const height = Math.ceil(fitted.size * 1.8),
        descent = Math.ceil(fitted.size * 0.4);
      image.width = Math.max(1, Math.ceil(width * ratio));
      image.height = Math.max(1, Math.ceil(height * ratio));
      const paint = image.getContext("2d")!;
      paint.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint.font = `${fitted.size}px sans-serif`;
      paint.fillStyle = fitted.color;
      paint.textAlign = "center";
      paint.fillText(text, width / 2, height - descent);
      sprite = { image, width, height, descent };
      if (this.labelImages.size >= 256) this.labelImages.clear();
      this.labelImages.set(key, sprite);
    }
    ctx.drawImage(
      sprite.image,
      x - sprite.width / 2,
      baseline - sprite.height + sprite.descent,
      sprite.width,
      sprite.height,
    );
  }
}
