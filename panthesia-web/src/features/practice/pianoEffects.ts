/** Read-only visual state. Musical timing, input and grading stay in the engine. */
export const effectPalettes = {
  aurora: { right: "#66edce", left: "#96a3ff", glow: "#a0fff0" },
  ember: { right: "#ffc478", left: "#ff819f", glow: "#ffe4ba" },
  violet: { right: "#d6a0ff", left: "#79cfff", glow: "#eedcff" },
};
type Strike = { pitch: number; color: string; wrong?: boolean };
type Pulse = Strike & { born: number; life: number };
type Particle = { pitch: number; x: number; y: number; vx: number; vy: number; size: number; born: number; life: number; color: string };
export class PianoEffects {
  private pulses: Pulse[] = [];
  private particles: Particle[] = [];
  private held = new Set<number>();
  private source = "";
  private position = 0;
  private time = 0;
  private status = "";
  private epoch: number | undefined;
  clear() { this.pulses = []; this.particles = []; this.held.clear(); this.time = 0; }
  update(input: { now: number; position: number; status: string; epoch?: number; source: string; strikes: Strike[]; performance: boolean; strength: number; reduced: boolean }) {
    const { now, position, status, source, strikes, performance, strength, reduced } = input;
    const elapsed = this.time ? (now - this.time) / 1000 : 0;
    const changed = source !== this.source || input.epoch !== this.epoch || (this.status === "playing" && status !== "playing") ||
      position < this.position - .025 || Math.abs(position - this.position) > Math.max(.35, elapsed * 4) || elapsed > .5;
    if (changed) this.clear();
    const seconds = Math.min(.04, Math.max(0, elapsed));
    this.source = source; this.epoch = input.epoch; this.position = position; this.status = status; this.time = now;
    this.pulses = this.pulses.filter(p => now - p.born < p.life);
    this.particles = reduced ? [] : this.particles.filter(p => now - p.born < p.life);
    for (const p of this.particles) { p.x += p.vx * seconds; p.y += p.vy * seconds; p.vy += 32 * seconds; p.vx *= Math.exp(-seconds * 1.4); }
    for (const strike of strikes) {
      if (this.held.has(strike.pitch) || changed || strength === 0) continue;
      this.pulses.push({ ...strike, born: now, life: reduced ? 110 : performance ? 850 : 330 });
      if (reduced) continue;
      const count = performance ? Math.round(8 + strength * 18) : 3;
      for (let n = 0; n < count && this.particles.length < 420; n++) {
        const angle = Math.random() * Math.PI;
        const speed = performance ? 70 + Math.random() * 200 : 18 + Math.random() * 28;
        this.particles.push({ pitch: strike.pitch, x: (Math.random() - .5) * 12, y: 0, vx: Math.cos(angle) * speed * .65,
          vy: -Math.sin(angle) * speed - (performance ? 45 : 24), size: performance ? 1 + Math.random() * 2.2 : 1.1,
          born: now, life: performance ? 500 + Math.random() * 1000 : 260 + Math.random() * 100, color: strike.color });
      }
    }
    if (this.pulses.length > 88) this.pulses.splice(0, this.pulses.length - 88);
    this.held = new Set(strikes.map(s => s.pitch));
  }
  paint(ctx: CanvasRenderingContext2D, now: number, baseline: number, width: number,
    geometry: (pitch: number) => { x: number; w: number } | undefined, performance: boolean, strength: number, reduced: boolean, style: "bloom" | "ripple" | "comet" = "bloom") {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, baseline + 1); ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pulses) {
      const key = geometry(p.pitch); if (!key) continue;
      const t = Math.min(1, (now - p.born) / p.life), fade = (1 - t) ** 2 * strength;
      const center = key.x + key.w / 2, radius = key.w * (performance ? 2.6 : 1.5);
      const glow = ctx.createRadialGradient(center, baseline, 0, center, baseline, Math.max(1, radius));
      glow.addColorStop(0, p.color); glow.addColorStop(1, "transparent");
      ctx.globalAlpha = fade * .65; ctx.fillStyle = glow; ctx.fillRect(center - radius, baseline - radius, radius * 2, radius);
      if ((performance || style !== "bloom") && !reduced) {
        const height = 220 * (1 - t), beam = ctx.createLinearGradient(0, baseline - height, 0, baseline);
        beam.addColorStop(0, "transparent"); beam.addColorStop(1, p.color);
        ctx.globalAlpha = fade * .22; ctx.fillStyle = beam; ctx.fillRect(key.x, baseline - height, key.w, height);
        ctx.globalAlpha = fade * .55; ctx.strokeStyle = p.color; ctx.lineWidth = 1.4;
        if (style === "ripple") {
          for (let ring=0; ring<3; ring++) {const wave=(t+ring/3)%1;ctx.globalAlpha=fade*(1-wave)*.8;ctx.beginPath();ctx.ellipse(center,baseline,key.w*(.4+wave*5),6+wave*30,0,Math.PI,Math.PI*2);ctx.stroke();}
        } else {ctx.beginPath(); ctx.ellipse(center, baseline, key.w * (.7 + t * 3.2), 5 + t * 15, 0, Math.PI, Math.PI * 2); ctx.stroke();}
      }
    }
    for (const p of this.particles) {
      const key = geometry(p.pitch); if (!key) continue;
      const fade = 1 - (now - p.born) / p.life;
      ctx.globalAlpha = fade * strength * .85; ctx.fillStyle = p.color;
      const x = key.x + key.w / 2 + p.x, y = baseline + p.y;
      if (style === "comet") {ctx.strokeStyle=p.color;ctx.lineWidth=p.size;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-p.vx*.065,y-p.vy*.065);ctx.stroke();ctx.beginPath();ctx.arc(x,y,p.size,0,Math.PI*2);ctx.fill();}
      else if (style === "ripple") {ctx.beginPath();ctx.arc(x,y,p.size*1.5,0,Math.PI*2);ctx.fill();}
      else ctx.fillRect(x, y, p.size, Math.max(p.size, performance ? p.size * 2.5 : p.size));
    }
    ctx.restore();
  }
  get active() { return this.pulses.length > 0 || this.particles.length > 0; }
  get particleCount() { return this.particles.length; }
}
