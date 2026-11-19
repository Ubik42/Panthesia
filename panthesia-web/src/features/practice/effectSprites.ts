/** Reuse glow textures while their placement and opacity animate. */
export class EffectSprites {
  private images = new Map<string, HTMLCanvasElement>();
  private bytes = 0;
  private get(
    key: string,
    width: number,
    height: number,
    ratio: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ) {
    let image = this.images.get(key);
    if (!image) {
      image = document.createElement("canvas");
      image.width = Math.max(1, Math.ceil(width * ratio));
      image.height = Math.max(1, Math.ceil(height * ratio));
      const ctx = image.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(ctx);
      const bytes = image.width * image.height * 4;
      while (
        this.images.size &&
        (this.images.size >= 64 || this.bytes + bytes > 8 * 1024 * 1024)
      ) {
        const first = this.images.keys().next().value!;
        const previous = this.images.get(first)!;
        this.bytes -= previous.width * previous.height * 4;
        this.images.delete(first);
      }
      this.images.set(key, image);
      this.bytes += bytes;
    }
    return image;
  }
  glow(
    ctx: CanvasRenderingContext2D,
    color: string,
    center: number,
    baseline: number,
    radius: number,
    ratio: number,
  ) {
    const image = this.get(
      `glow:${color}:${radius}:${ratio}`,
      radius * 2,
      radius,
      ratio,
      (paint) => {
        const gradient = paint.createRadialGradient(
          radius,
          radius,
          0,
          radius,
          radius,
          radius,
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "transparent");
        paint.fillStyle = gradient;
        paint.fillRect(0, 0, radius * 2, radius);
      },
    );
    ctx.drawImage(
      image,
      center - radius,
      baseline - radius,
      radius * 2,
      radius,
    );
  }
  beam(
    ctx: CanvasRenderingContext2D,
    color: string,
    x: number,
    baseline: number,
    width: number,
    height: number,
  ) {
    const image = this.get(`beam:${color}`, 1, 256, 1, (paint) => {
      const gradient = paint.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(1, color);
      paint.fillStyle = gradient;
      paint.fillRect(0, 0, 1, 256);
    });
    ctx.drawImage(image, x, baseline - height, width, height);
  }
}
