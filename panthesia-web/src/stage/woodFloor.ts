/** The floor under the keyboard where the virtual hands rest: warm wooden planks running along
 * the keys, drawn once into a tile (seeded, so it never changes between frames) and repeated. */
const TILE_W = 960;
const PLANK = 34;
const ROWS = 6;

/** Plank tones (oak, a little variation); the ink of a painted surface, not interface colour. */
const TONES = ["#8a5a36", "#93623c", "#7f5231", "#9a6a42", "#865734", "#8f5f39"];

let tile: HTMLCanvasElement | null = null;

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeTile() {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_W;
  canvas.height = PLANK * ROWS;
  const ctx = canvas.getContext("2d")!;
  const rnd = random(7);
  for (let row = 0; row < ROWS; row++) {
    const y = row * PLANK;
    // Planks of different lengths, staggered from row to row.
    let x = -rnd() * 300;
    while (x < TILE_W) {
      const length = 260 + rnd() * 360;
      const tone = TONES[Math.floor(rnd() * TONES.length)];
      ctx.fillStyle = tone;
      ctx.fillRect(x, y, length, PLANK);
      // Grain: long thin wavy lines, lighter and darker than the plank.
      for (let g = 0; g < 9; g++) {
        const gy = y + 2 + rnd() * (PLANK - 4);
        const amp = 0.6 + rnd() * 1.6,
          freq = 0.004 + rnd() * 0.01,
          phase = rnd() * 6.28;
        ctx.strokeStyle = rnd() < 0.5 ? "rgba(255,225,190,0.10)" : "rgba(40,20,8,0.16)";
        ctx.lineWidth = 0.6 + rnd() * 0.9;
        ctx.beginPath();
        for (let gx = x; gx <= x + length; gx += 6) {
          const yy = gy + Math.sin(gx * freq + phase) * amp;
          if (gx === x) ctx.moveTo(gx, yy);
          else ctx.lineTo(gx, yy);
        }
        ctx.stroke();
      }
      // A knot now and then.
      if (rnd() < 0.25) {
        const kx = x + 40 + rnd() * (length - 80),
          ky = y + 8 + rnd() * (PLANK - 16);
        const knot = ctx.createRadialGradient(kx, ky, 0, kx, ky, 7);
        knot.addColorStop(0, "rgba(50,25,10,0.45)");
        knot.addColorStop(1, "rgba(50,25,10,0)");
        ctx.fillStyle = knot;
        ctx.fillRect(kx - 8, ky - 8, 16, 16);
      }
      // Seam at the plank's end.
      ctx.fillStyle = "rgba(30,15,6,0.55)";
      ctx.fillRect(x + length - 1, y, 1.5, PLANK);
      x += length;
    }
    // Seam between rows, with a faint highlight under it.
    ctx.fillStyle = "rgba(30,15,6,0.6)";
    ctx.fillRect(0, y + PLANK - 1.5, TILE_W, 1.5);
    ctx.fillStyle = "rgba(255,230,200,0.08)";
    ctx.fillRect(0, y + PLANK, TILE_W, 1);
  }
  // A satin finish: soft light across the boards.
  const sheen = ctx.createLinearGradient(0, 0, TILE_W, canvas.height);
  sheen.addColorStop(0, "rgba(255,240,220,0.06)");
  sheen.addColorStop(0.5, "rgba(255,240,220,0)");
  sheen.addColorStop(1, "rgba(255,240,220,0.05)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, TILE_W, canvas.height);
  return canvas;
}

/** The plank tile (for the 3D floor's texture). */
export function woodTile() {
  tile ??= makeTile();
  return tile;
}

/** Paint the floor in `ctx` over (x, y, w, h), with the keyboard's shadow along its top edge. */
export function paintWoodFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale = 1) {
  tile ??= makeTile();
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix().translate(x, y).scale(scale, scale));
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  const shade = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 28));
  shade.addColorStop(0, "rgba(0,0,0,0.55)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, Math.min(h, 28));
  ctx.restore();
}
