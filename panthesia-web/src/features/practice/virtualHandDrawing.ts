import type { HandPose, V3 } from "./virtualHandPose";
import { handSkin } from "./stageTheme";

type Point = { x: number; y: number };

/** Widths of the three phalanges of each finger (thumb … little), in white-key widths: slender
 * and tapering toward the tip. */
const PHALANX = [
  [0.68, 0.6, 0.52],
  [0.56, 0.5, 0.44],
  [0.58, 0.52, 0.45],
  [0.54, 0.48, 0.42],
  [0.47, 0.42, 0.37],
];

/** Top-down view of slender white hands: a palm and five jointed fingers, one continuous
 * silhouette with a soft edge, joint creases and a shadow on the keys. Original Canvas
 * drawing; no code, parameters or images from other projects. */
export class HandDrawing {
  private ctx: CanvasRenderingContext2D;
  private size = "";
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }
  draw(poses: HandPose[], width: number, height: number, baseline: number, opacity: number) {
    const ratio = Math.min(devicePixelRatio || 1, 1.75, Math.sqrt(4_000_000 / Math.max(1, width * height)));
    const size = `${width}:${height}:${ratio}`;
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = Math.ceil(width * ratio);
      this.canvas.height = Math.ceil(height * ratio);
    }
    const c = this.ctx;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, width, height);
    c.save();
    c.beginPath();
    c.rect(0, baseline, width, height - baseline);
    c.clip();
    this.canvas.style.opacity = String(opacity);
    for (const h of poses) this.hand(h);
    c.restore();
    this.canvas.style.visibility = poses.length ? "visible" : "hidden";
    this.canvas.dataset.handRenderer = "top-down-slender";
    this.canvas.dataset.handPoses = String(poses.length);
  }

  private hand(h: HandPose) {
    const c = this.ctx;
    const u = h.unit;
    const project = (p: V3): Point => ({ x: h.wrist.x + p.x * u, y: h.baseline + (p.y - p.z * 0.16) * h.vertical });
    const chains = h.fingers.map((f) => f.points.map(project));
    const wrist = project({ x: 0, y: h.wrist.y, z: h.wrist.z });
    const knuckles = chains.slice(1).map((p) => p[0]).sort((a, b) => a.x - b.x);
    const palm = this.palm(knuckles, chains[0][0], wrist, u, h.side);
    // Fingers as round-capped strokes, one stroke per phalanx, narrowing toward the tip.
    const strokeFinger = (i: number, extra: number) => {
      const pts = chains[i];
      for (let k = 0; k < 3; k++) {
        c.lineWidth = PHALANX[i][k] * u + extra;
        c.beginPath();
        c.moveTo(pts[k].x, pts[k].y);
        c.lineTo(pts[k + 1].x, pts[k + 1].y);
        c.stroke();
      }
    };
    const order = h.thumbUnder ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 0];
    const edge = Math.max(1.2, u * 0.07);
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    // Shadow on the keys, below and to the side of the hand.
    c.save();
    c.translate(u * 0.12, u * 0.22);
    c.filter = `blur(${Math.max(2, u * 0.25)}px)`;
    c.fillStyle = handSkin.shadow;
    c.strokeStyle = handSkin.shadow;
    c.fill(palm);
    for (const i of order) strokeFinger(i, 0);
    c.restore();
    // Outline pass, then fill pass: the parts merge into one silhouette without seams.
    c.strokeStyle = handSkin.outline;
    c.fillStyle = handSkin.outline;
    c.lineWidth = edge * 2;
    c.stroke(palm);
    for (const i of order) strokeFinger(i, edge * 2);
    const light = c.createLinearGradient(wrist.x - u * 2, 0, wrist.x + u * 2, 0);
    light.addColorStop(0, handSkin.shade);
    light.addColorStop(h.side === "right" ? 0.35 : 0.65, handSkin.fill);
    light.addColorStop(1, handSkin.shade);
    c.fillStyle = light;
    c.strokeStyle = light;
    c.fill(palm);
    for (const i of order) strokeFinger(i, 0);
    // Joint creases and a pale nail at each tip.
    c.strokeStyle = handSkin.crease;
    c.lineWidth = Math.max(0.6, u * 0.03);
    for (let i = 0; i < 5; i++) {
      if (i === 0 && h.thumbUnder) continue;
      const pts = chains[i];
      for (const j of [1, 2]) {
        const a = pts[j - 1], b = pts[j + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, r = PHALANX[i][j] * u * 0.32;
        c.beginPath();
        c.moveTo(pts[j].x - nx * r, pts[j].y - ny * r);
        c.lineTo(pts[j].x + nx * r, pts[j].y + ny * r);
        c.stroke();
      }
      const tip = pts[3], near = pts[2], d = Math.hypot(tip.x - near.x, tip.y - near.y) || 1;
      const w = PHALANX[i][2] * u;
      c.save();
      c.translate(tip.x - ((tip.x - near.x) / d) * w * 0.18, tip.y - ((tip.y - near.y) / d) * w * 0.18);
      c.rotate(Math.atan2(tip.y - near.y, tip.x - near.x));
      c.fillStyle = handSkin.nail;
      c.beginPath();
      c.ellipse(0, 0, w * 0.32, w * 0.27, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.restore();
  }

  /** The palm: the four knuckles, the thumb's base (thenar) on the index side, and a short wrist. */
  private palm(knuckles: Point[], thumb: Point, wrist: Point, u: number, side: "left" | "right") {
    const s = side === "right" ? 1 : -1;
    const [a, , , d] = knuckles;
    const index = side === "right" ? a : d;
    const little = side === "right" ? d : a;
    const half = u * 1.05;
    const path = new Path2D();
    const start = { x: wrist.x - s * half, y: wrist.y + u * 0.9 };
    path.moveTo(start.x, start.y);
    // Thenar: bulge out to the thumb's base, then in to the index knuckle.
    path.quadraticCurveTo(thumb.x - s * u * 0.45, thumb.y + u * 0.9, thumb.x - s * u * 0.25, thumb.y);
    path.quadraticCurveTo(thumb.x + s * u * 0.1, index.y + u * 0.2, index.x - s * u * 0.2, index.y);
    // Across the knuckles.
    path.quadraticCurveTo((a.x + d.x) / 2, Math.min(a.y, d.y) - u * 0.25, little.x + s * u * 0.22, little.y);
    // Little-finger edge down to the wrist.
    path.quadraticCurveTo(little.x + s * u * 0.4, (little.y + wrist.y) / 2, wrist.x + s * half * 0.92, wrist.y);
    path.lineTo(wrist.x + s * half * 0.85, wrist.y + u * 0.9);
    path.closePath();
    return path;
  }

  hide() {
    this.canvas.style.visibility = "hidden";
    this.canvas.dataset.handPoses = "0";
  }
  dispose() {
    this.hide();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
