import { MidiVisualizerGpu } from "./midiVisualizerGpu";
import { EffectSprites } from "./effectSprites";
/** Read-only visual state. Musical timing, input stay in the engine. */
export const effectPalettes = {
  aurora: { right: "#66edce", left: "#96a3ff", glow: "#a0fff0" },
  ember: { right: "#ffc478", left: "#ff819f", glow: "#ffe4ba" },
  violet: { right: "#d6a0ff", left: "#79cfff", glow: "#eedcff" },
};
type Strike = {
  pitch: number;
  color: string;
  velocity?: number;
  identity?: string;
};
type Pulse = Strike & { born: number; life: number };
type Particle = {
  pitch: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  born: number;
  life: number;
  color: string;
};
export class PianoEffects {
  private sprites = new EffectSprites();
  private pulses: Pulse[] = [];
  private particles: Particle[] = [];
  private held = new Map<number, Strike>();
  private gpu?: MidiVisualizerGpu;
  constructor(canvas?: HTMLCanvasElement, wake: () => void = () => {}) {
    if (canvas) this.gpu = new MidiVisualizerGpu(canvas, wake);
  }
  dispose() {
    this.clear();
    this.gpu?.dispose();
  }
  get renderer() {
    return this.gpu?.available ? "midivisualizer-webgl2" : "canvas2d";
  }
  private source = "";
  private position = 0;
  private time = 0;
  private status = "";
  private epoch: number | undefined;
  clear() {
    this.pulses = [];
    this.particles = [];
    this.held.clear();
    this.time = 0;
    this.gpu?.clear();
  }
  update(input: {
    now: number;
    position: number;
    status: string;
    epoch?: number;
    source: string;
    strikes: Strike[];
    performance: boolean;
    strength: number;
    reduced: boolean;
    pedal?: number;
  }) {
    const {
      now,
      position,
      status,
      source,
      strikes,
      performance,
      strength,
      reduced,
    } = input;
    const elapsed = this.time ? (now - this.time) / 1000 : 0;
    const changed =
      source !== this.source ||
      input.epoch !== this.epoch ||
      (this.status === "playing" && status !== "playing") ||
      position < this.position - 0.025 ||
      Math.abs(position - this.position) > Math.max(0.35, elapsed * 4) ||
      elapsed > 0.5;
    const resetting = changed && this.source !== "";
    if (changed) this.clear();
    const seconds = Math.min(0.04, Math.max(0, elapsed));
    this.source = source;
    this.epoch = input.epoch;
    this.position = position;
    this.status = status;
    this.time = now;
    this.pulses = this.pulses.filter((p) => now - p.born < p.life);
    this.particles = reduced
      ? []
      : this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.vy += 32 * seconds;
      p.vx *= Math.exp(-seconds * 1.4);
    }
    for (const strike of strikes) {
      if (
        (this.held.has(strike.pitch) &&
          this.held.get(strike.pitch)?.identity === strike.identity) ||
        resetting ||
        strength === 0
      )
        continue;
      const energy =
        0.3 + (0.7 * Math.min(127, Math.max(1, strike.velocity ?? 88))) / 127;
      this.pulses.push({
        ...strike,
        born: now,
        life: reduced ? 110 : performance ? 850 * energy : 330,
      });
      if (reduced) continue;
      const count = performance ? Math.round((8 + strength * 24) * energy) : 3;
      for (
        let n = 0;
        n < count &&
        this.particles.length <
          (this.gpu?.available && performance ? 1536 : 420);
        n++
      ) {
        const angle = Math.random() * Math.PI;
        const speed = performance
          ? 70 + Math.random() * 200
          : 18 + Math.random() * 28;
        this.particles.push({
          pitch: strike.pitch,
          x: (Math.random() - 0.5) * 12,
          y: 0,
          vx: Math.cos(angle) * speed * 0.65,
          vy: -Math.sin(angle) * speed - (performance ? 45 : 24),
          size: performance ? 1 + Math.random() * 2.2 : 1.1,
          born: now,
          life: performance
            ? (500 + Math.random() * 1000) *
              (1 + ((input.pedal ?? 0) / 127) * 0.35)
            : 260 + Math.random() * 100,
          color: strike.color,
        });
      }
    }
    if (this.pulses.length > 88) this.pulses.splice(0, this.pulses.length - 88);
    this.held = new Map(strikes.map((s) => [s.pitch, s]));
  }
  paint(
    ctx: CanvasRenderingContext2D,
    now: number,
    baseline: number,
    width: number,
    geometry: (pitch: number) => { x: number; w: number } | undefined,
    performance: boolean,
    strength: number,
    reduced: boolean,
    style: "bloom" | "ripple" | "comet" = "bloom",
    ratio = 1,
  ) {
    if (this.gpu?.begin(width, ctx.canvas.height / ratio, baseline, ratio)) {
      for (const p of this.pulses) {
        const key = geometry(p.pitch);
        if (!key) continue;
        const t = Math.min(1, (now - p.born) / p.life),
          fade = (1 - t) ** 2 * strength,
          center = key.x + key.w / 2;
        const radius = key.w * (performance ? 3.1 : 1.6);
        this.gpu.sprite(
          center - radius,
          baseline - radius * 0.55,
          radius * 2,
          radius * 1.1,
          p.color,
          fade * 0.8,
          0,
        );
        if (!reduced && (performance || style !== "bloom")) {
          const h = 180 * (1 - t);
          this.gpu.sprite(
            center - key.w * 0.8,
            baseline - h,
            key.w * 1.6,
            h,
            p.color,
            fade * 0.35,
            3,
          );
          for (let ring = 0; ring < (style === "ripple" ? 3 : 1); ring++) {
            const wave = (t + ring / 3) % 1;
            this.gpu.sprite(
              center - radius * (0.5 + wave),
              baseline - radius * 0.18,
              radius * (1 + wave * 2),
              radius * 0.36,
              p.color,
              fade * 0.7,
              1,
              wave,
            );
          }
        }
      }
      if (!reduced)
        for (const p of this.particles) {
          const key = geometry(p.pitch);
          if (!key) continue;
          const t = Math.min(1, (now - p.born) / p.life),
            size = p.size * (performance ? 6 : 3),
            x = key.x + key.w / 2 + p.x,
            y = baseline + p.y;
          // MIDIVisualizer particles.vert fades color with 1-time*time.
          this.gpu.sprite(
            x - size / 2,
            y - size / 2,
            size,
            size * (style === "comet" ? 3 : 1),
            p.color,
            (1 - t * t) * strength * 0.85,
            style === "comet" ? 4 : 2,
            t,
          );
        }
      this.gpu.end();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, baseline + 1);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pulses) {
      const key = geometry(p.pitch);
      if (!key) continue;
      const t = Math.min(1, (now - p.born) / p.life),
        fade = (1 - t) ** 2 * strength;
      const center = key.x + key.w / 2,
        radius = key.w * (performance ? 2.6 : 1.5);
      ctx.globalAlpha = fade * 0.65;
      this.sprites.glow(
        ctx,
        p.color,
        center,
        baseline,
        Math.max(1, radius),
        ratio,
      );
      if ((performance || style !== "bloom") && !reduced) {
        const height = 220 * (1 - t);
        ctx.globalAlpha = fade * 0.22;
        this.sprites.beam(ctx, p.color, key.x, baseline, key.w, height);
        ctx.globalAlpha = fade * 0.55;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.4;
        if (style === "ripple") {
          for (let ring = 0; ring < 3; ring++) {
            const wave = (t + ring / 3) % 1;
            ctx.globalAlpha = fade * (1 - wave) * 0.8;
            ctx.beginPath();
            ctx.ellipse(
              center,
              baseline,
              key.w * (0.4 + wave * 5),
              6 + wave * 30,
              0,
              Math.PI,
              Math.PI * 2,
            );
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.ellipse(
            center,
            baseline,
            key.w * (0.7 + t * 3.2),
            5 + t * 15,
            0,
            Math.PI,
            Math.PI * 2,
          );
          ctx.stroke();
        }
      }
    }
    for (const p of this.particles) {
      const key = geometry(p.pitch);
      if (!key) continue;
      const fade = 1 - (now - p.born) / p.life;
      ctx.globalAlpha = fade * strength * 0.85;
      ctx.fillStyle = p.color;
      const x = key.x + key.w / 2 + p.x,
        y = baseline + p.y;
      if (style === "comet") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx * 0.065, y - p.vy * 0.065);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (style === "ripple") {
        ctx.beginPath();
        ctx.arc(x, y, p.size * 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else
        ctx.fillRect(
          x,
          y,
          p.size,
          Math.max(p.size, performance ? p.size * 2.5 : p.size),
        );
    }
    ctx.restore();
  }
  get active() {
    return this.pulses.length > 0 || this.particles.length > 0;
  }
  get particleCount() {
    return this.particles.length;
  }
}
