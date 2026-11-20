type Sprite = {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  pad: number;
  ratio: number;
  bytes: number;
};

/** Common note lengths use one cached blit; very tall notes retain bounded nine-slice textures. */
export class WaterfallSprites {
  private notes = new Map<string, Sprite>();
  private bytes = 0;
  private background = document.createElement("canvas");
  private backgroundKey = "";
  private labels = new Map<string, { size: number; color: string }>();
  private labelImages = new Map<
    string,
    { image: HTMLCanvasElement; width: number; height: number; descent: number }
  >();

  backdrop(
    ctx: CanvasRenderingContext2D,
    key: string,
    width: number,
    height: number,
    ratio: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ) {
    if (key !== this.backgroundKey) {
      this.background.width = Math.max(1, Math.ceil(width * ratio));
      this.background.height = Math.max(1, Math.ceil(height * ratio));
      const cached = this.background.getContext("2d")!;
      cached.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(cached);
      this.backgroundKey = key;
    }
    ctx.drawImage(this.background, 0, 0, width, height);
  }

  note(
    ctx: CanvasRenderingContext2D,
    x: number,
    bottom: number,
    width: number,
    height: number,
    fill: string,
    glow: number,
    ratio: number,
    alpha: number,
  ) {
    // Most visible piano notes fit this bound. Cache their complete shape so
    // each frame sends one image operation instead of three. Very long notes
    // keep the fixed-size texture, preventing offscreen-sized allocations.
    const complete = height <= 512;
    const bodyHeight = complete ? Math.round(height * ratio) / ratio : 40;
    const bodyWidth = Math.max(1, Math.round(width * ratio) / ratio);
    const pad = glow > 0 ? Math.ceil(glow * 2) + 2 : 1;
    const key = `${fill}:${bodyWidth}:${bodyHeight}:${glow}:${ratio}`;
    let sprite = this.notes.get(key);
    if (!sprite) {
      const image = document.createElement("canvas");
      image.width = Math.ceil((bodyWidth + pad * 2) * ratio);
      image.height = Math.ceil((bodyHeight + pad * 2) * ratio);
      const cached = image.getContext("2d")!;
      cached.setTransform(ratio, 0, 0, ratio, pad * ratio, pad * ratio);
      const surface = cached.createLinearGradient(0, 0, bodyWidth, 0);
      surface.addColorStop(0, fill);
      surface.addColorStop(0.45, fill);
      surface.addColorStop(1, `${fill}b0`);
      cached.fillStyle = surface;
      cached.shadowColor = fill;
      cached.shadowBlur = glow * ratio;
      cached.beginPath();
      cached.roundRect(0, 0, bodyWidth, bodyHeight, Math.min(5, bodyWidth / 4));
      cached.fill();
      cached.shadowBlur = 0;
      cached.strokeStyle = "#ffffff55";
      cached.lineWidth = 0.7;
      cached.beginPath();
      cached.moveTo(3, 2);
      cached.lineTo(Math.max(3, bodyWidth - 3), 2);
      cached.stroke();
      sprite = {
        image,
        width: bodyWidth,
        height: bodyHeight,
        pad,
        ratio,
        bytes: image.width * image.height * 4,
      };
      while (
        this.notes.size &&
        (this.bytes + sprite.bytes > 8 * 1024 * 1024 || this.notes.size >= 128)
      ) {
        const first = this.notes.keys().next().value!;
        this.bytes -= this.notes.get(first)!.bytes;
        this.notes.delete(first);
      }
      this.notes.set(key, sprite);
      this.bytes += sprite.bytes;
    }
    const top = bottom - height;
    ctx.globalAlpha = alpha;
    const sourceWidth = sprite.image.width;
    const destinationWidth = width + pad * 2;
    if (complete)
      ctx.drawImage(
        sprite.image,
        x - pad,
        top - pad,
        destinationWidth,
        height + pad * 2,
      );
    else {
      const cap = 8,
        r = sprite.ratio;
      ctx.drawImage(
        sprite.image,
        0,
        0,
        sourceWidth,
        (pad + cap) * r,
        x - pad,
        top - pad,
        destinationWidth,
        pad + cap,
      );
      ctx.drawImage(
        sprite.image,
        0,
        (pad + cap) * r,
        sourceWidth,
        (sprite.height - cap * 2) * r,
        x - pad,
        top + cap,
        destinationWidth,
        height - cap * 2,
      );
      ctx.drawImage(
        sprite.image,
        0,
        (pad + sprite.height - cap) * r,
        sourceWidth,
        (pad + cap) * r,
        x - pad,
        bottom - cap,
        destinationWidth,
        pad + cap,
      );
    }
    ctx.globalAlpha = 1;
  }

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
