import type { HandPose, V3 } from "./virtualHandPose";
import { handSkin } from "./stageTheme";

type Point = { x: number; y: number };

/** Top-down view of white-gloved hands. Every bone is a capsule of fixed length and width, so
 * the hand never deforms: only its joints turn. One scale (pixels per millimetre) applies to both
 * axes. Raised parts cast a longer shadow. Original Canvas drawing; no code, parameters or
 * images from other projects. */
export class HandDrawing {
  private ctx: CanvasRenderingContext2D;
  private size = "";
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }
  draw(poses: HandPose[], width: number, height: number, top: number, opacity: number) {
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
    c.rect(0, top, width, height - top);
    c.clip();
    this.canvas.style.opacity = String(opacity);
    for (const h of poses) this.hand(h);
    c.restore();
    this.canvas.style.visibility = poses.length ? "visible" : "hidden";
    this.canvas.dataset.handRenderer = "rigid-skeleton";
    this.canvas.dataset.handPoses = String(poses.length);
  }

  private hand(h: HandPose) {
    const c = this.ctx;
    const s = h.scale;
    const project = (p: V3): Point => ({ x: p.x * s, y: h.front - p.y * s });
    const edge = Math.max(1.2, s * 1.5);
    // Parts in drawing order: a thumb passing under first, then the palm, then fingers from the
    // lowest to the highest, so lifted fingers lie over the others.
    type Part = { z: number; draw: (extra: number) => void };
    const bone = (a: V3, b: V3, w: number) => (extra: number) => {
      const p = project(a),
        q = project(b);
      // A raised bone looks a little wider, as seen from above.
      c.lineWidth = w * s * (1 + Math.max(0, (a.z + b.z) / 2) * 0.004) + extra;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
    };
    // Palm outline through the midpoints of its corners, so corners round off and the web
    // between thumb and index finger stays a soft curve.
    const palmPath = () => {
      const pts = h.palm.map(project);
      const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const path = new Path2D();
      const start = mid(pts[pts.length - 1], pts[0]);
      path.moveTo(start.x, start.y);
      pts.forEach((p, i) => {
        const m = mid(p, pts[(i + 1) % pts.length]);
        path.quadraticCurveTo(p.x, p.y, m.x, m.y);
      });
      path.closePath();
      return path;
    };
    const palm = palmPath();
    const thumbBones = h.fingers[0];
    // The palm carries the thumb's metacarpal: the ball of the thumb.
    const palmPart: Part = {
      z: 0,
      draw: (extra) => {
        c.lineWidth = s * 6 + extra;
        c.stroke(palm);
        c.fill(palm);
        bone(thumbBones.points[0], thumbBones.points[1], thumbBones.widths[0])(extra);
      },
    };
    const fingerParts: Part[] = h.fingers.map((f) => ({
      z: Math.max(...f.points.slice(f.finger === 1 ? 1 : 0).map((p) => p.z)) + (f.finger === 1 ? -1 : 0),
      draw: (extra) => {
        for (let k = f.finger === 1 ? 1 : 0; k < 3; k++) bone(f.points[k], f.points[k + 1], f.widths[k])(extra);
      },
    }));
    const thumb = fingerParts[0];
    const others = fingerParts.slice(1).sort((a, b) => a.z - b.z);
    const parts = h.thumbUnder ? [thumb, palmPart, ...others] : [palmPart, ...[thumb, ...others].sort((a, b) => a.z - b.z)];

    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    // Shadow on the keys: offset grows with height.
    c.save();
    // Light from the upper left: the shadow falls to the right of the fingers, onto the keys.
    const lift = (h.wrist.z + 10) * s * 0.2;
    c.translate(lift, -lift * 0.15);
    c.filter = `blur(${Math.max(2, s * 6)}px)`;
    c.fillStyle = handSkin.shadow;
    c.strokeStyle = handSkin.shadow;
    for (const part of parts) part.draw(0);
    c.restore();
    // Each part: outline, then fill, so overlapping parts keep their own edge and joints read.
    // Flat fill with a pale halo around every part, as in a hand-drawn glove.
    const fill = handSkin.fill;
    for (const part of parts) {
      c.strokeStyle = handSkin.outline;
      c.fillStyle = handSkin.outline;
      part.draw(edge * 2);
      c.strokeStyle = fill;
      c.fillStyle = fill;
      part.draw(0);
    }
    // Faint lines on the back of the hand, from each knuckle toward the wrist.
    c.strokeStyle = handSkin.crease;
    c.lineWidth = Math.max(0.6, s * 0.7);
    const wristPoint = project(h.wrist);
    for (const f of h.fingers.slice(1)) {
      const k = project(f.points[0]);
      c.beginPath();
      c.moveTo(k.x + (wristPoint.x - k.x) * 0.15, k.y + (wristPoint.y - k.y) * 0.15);
      c.lineTo(k.x + (wristPoint.x - k.x) * 0.55, k.y + (wristPoint.y - k.y) * 0.55);
      c.stroke();
    }
    // Creases across the middle and end joints: two short parallel strokes each.
    for (const f of h.fingers) {
      if (f.finger === 1 && h.thumbUnder) continue;
      const pts = f.points.map(project);
      // The thumb's crease is at its one finger joint (IP); its MCP lies in the palm.
      for (const j of f.finger === 1 ? [2] : [1, 2]) {
        const a = pts[j - 1],
          b = pts[j + 1],
          len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len,
          ny = (b.x - a.x) / len,
          tx = (b.x - a.x) / len,
          ty = (b.y - a.y) / len,
          r = f.widths[j] * s * 0.22,
          gap = Math.max(1.2, s * 1.1);
        for (const o of [-gap / 2, gap / 2]) {
          c.beginPath();
          c.moveTo(pts[j].x - nx * r + tx * o, pts[j].y - ny * r + ty * o);
          c.lineTo(pts[j].x + nx * r + tx * o, pts[j].y + ny * r + ty * o);
          c.stroke();
        }
      }
    }
    c.restore();
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
