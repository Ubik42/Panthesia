import type { Contact, HandTrack } from "./virtualHandPlan";

/** Millimetres in the keyboard's frame: X along the keys, Y forward from the keys' front edge
 * toward the fallboard, Z up from the key surface. */
export type V3 = { x: number; y: number; z: number };
export type FingerPose = {
  finger: number;
  /** Joints from the finger's base (MCP; the thumb's CMC) to the tip, in millimetres. */
  points: V3[];
  pressed: boolean;
  substitution: boolean;
};
export type HandPose = {
  side: "left" | "right";
  wrist: V3;
  /** Turn of the hand about the vertical (radians, counter-clockwise seen from above). */
  yaw: number;
  /** Base of each finger's metacarpal (index to little), fixed in the hand. */
  metacarpals: V3[];
  fingers: FingerPose[];
  thumbUnder: boolean;
  /** Pixels per millimetre and the screen position of the keys' front edge. */
  scale: number;
  front: number;
  alpha: number;
  motion: number;
};
type Geometry = (pitch: number) => { x: number; w: number } | undefined;
/** Screen layout of the keys: top (fallboard side) and bottom (front edge) in pixels. */
export type KeyBand = { top: number; bottom: number };

const WHITE_KEY_MM = 23.5;

/** A right hand at rest, palm down, wrist at the origin, thumb toward -X, millimetres. The
 * joints are those of the WebXR `generic-hand` model (immersive-web/webxr-input-profiles, W3C
 * licence) that the hands are drawn with, so the skeleton and the mesh agree. The left hand is
 * the mirror image. */
const ANATOMY = {
  // Thumb: CMC (base of the metacarpal). Fingers: MCP (the knuckle).
  bases: [
    { x: -28, y: 36, z: -19.2 },
    { x: -23.6, y: 88.5, z: -7.3 },
    { x: -1.7, y: 91.6, z: -2.5 },
    { x: 17.5, y: 84.7, z: -6.5 },
    { x: 35.1, y: 73.9, z: -13.7 },
  ],
  /** Base of the metacarpal of the index, middle, ring and little finger. */
  metacarpals: [
    { x: -10.2, y: 29.2, z: -7.1 },
    { x: -3.4, y: 29.1, z: -6.1 },
    { x: 8.1, y: 27, z: -6.1 },
    { x: 23, y: 34.1, z: -9.4 },
  ],
  // Thumb: metacarpal, proximal, distal phalanx. Fingers: proximal, middle, distal phalanx (to
  // the tip joint at the pad).
  bones: [
    [32.5, 33.7, 14.9],
    [45.4, 24.2, 11.6],
    [46.9, 27.6, 12.2],
    [42.9, 26.6, 11.9],
    [34.6, 20.3, 11.9],
  ],
  // Where each fingertip rests, relative to its base, when nothing is played: the model's own
  // fan of the fingers, with the tips lowered toward the keys.
  rest: [
    { x: -48, y: 56, z: -8 },
    { x: 4.2, y: 76, z: -16 },
    { x: 9, y: 80, z: -17 },
    { x: 14, y: 74, z: -16 },
    { x: 14, y: 60, z: -13 },
  ],
  /** The thumb metacarpal turns outward between these angles (degrees from straight ahead). */
  thumbSpread: [18, 70] as const,
  thumbRestSpread: 36,
};
/** The wrist sits this far behind the keys' front edge (toward the player), at this height. */
const WRIST_Y = -115;
const WRIST_Z = 30;
const LIFT = 16;

const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const blend = (a: number, b: number, t: number) => a + (b - a) * t;
function at<T>(rows: readonly T[], time: number, key: (x: T) => number) {
  let lo = 0,
    hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(rows[mid]) <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Rigid three-bone finger reaching for `target` from `base`. The finger turns sideways at its
 * base (abduction) and bends in its own plane; the last joint bends with the middle one (2/3 of
 * it, as real fingers do). Bones never change length: a target out of reach leaves the finger
 * stretched toward it. Returns the four joints, base first. */
export function fingerChain(base: V3, target: V3, bones: readonly number[], coupling = 0.67): V3[] {
  const dx = target.x - base.x,
    dy = target.y - base.y;
  const horizontal = Math.max(0.001, Math.hypot(dx, dy));
  const ux = dx / horizontal,
    uy = dy / horizontal;
  const down = base.z - target.z;
  const reach = Math.hypot(horizontal, down);
  const [l1, l2, l3] = bones;
  // The chain beyond the base, for a middle-joint bend b, as a vector in the finger plane.
  const tail = (b: number) => ({
    x: l2 * Math.cos(b) + l3 * Math.cos(b * (1 + coupling)),
    y: l2 * Math.sin(b) + l3 * Math.sin(b * (1 + coupling)),
  });
  const span = (b: number) => {
    const t = tail(b);
    return Math.hypot(l1 + t.x, t.y);
  };
  let lo = 0,
    hi = 1.75;
  if (reach >= span(0)) hi = 0;
  else if (reach <= span(hi)) lo = hi;
  else
    for (let k = 0; k < 22; k++) {
      const m = (lo + hi) / 2;
      if (span(m) > reach) lo = m;
      else hi = m;
    }
  const bend = (lo + hi) / 2;
  const t = tail(bend);
  // Rotate the bent chain so its tip points at the target (angles measured downward).
  const aim = Math.atan2(down, horizontal) - Math.atan2(t.y, l1 + t.x);
  const angles = [aim, aim + bend, aim + bend * (1 + coupling)];
  const points = [base];
  let p = base;
  for (let k = 0; k < 3; k++) {
    const len = [l1, l2, l3][k];
    const along = Math.cos(angles[k]) * len,
      fall = Math.sin(angles[k]) * len;
    p = { x: p.x + ux * along, y: p.y + uy * along, z: p.z - fall };
    points.push(p);
  }
  return points;
}

/** Two rigid bones from `base` to `target`; the joint between them rises above the line. */
function twoBone(base: V3, target: V3, l1: number, l2: number): V3[] {
  const dx = target.x - base.x,
    dy = target.y - base.y,
    dz = target.z - base.z;
  const d = Math.max(0.001, Math.hypot(dx, dy, dz));
  const reach = Math.min(d, l1 + l2 - 0.001);
  const u = { x: dx / d, y: dy / d, z: dz / d };
  // Angle at the base between the line to the target and the first bone.
  const cos = Math.max(-1, Math.min(1, (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach)));
  const angle = Math.acos(cos);
  // "Up", perpendicular to the line in the vertical plane through it.
  const h = Math.hypot(u.x, u.y) || 1;
  const up = { x: (-u.z * u.x) / h, y: (-u.z * u.y) / h, z: h };
  const joint = {
    x: base.x + l1 * (Math.cos(angle) * u.x + Math.sin(angle) * up.x),
    y: base.y + l1 * (Math.cos(angle) * u.y + Math.sin(angle) * up.y),
    z: base.z + l1 * (Math.cos(angle) * u.z + Math.sin(angle) * up.z),
  };
  const len = Math.hypot(target.x - joint.x, target.y - joint.y, target.z - joint.z) || 1;
  const tip = {
    x: joint.x + ((target.x - joint.x) / len) * l2,
    y: joint.y + ((target.y - joint.y) / len) * l2,
    z: joint.z + ((target.z - joint.z) / len) * l2,
  };
  return [base, joint, tip];
}

/** The thumb: its metacarpal turns at the CMC joint beside the wrist, within the thumb's range,
 * so that the two phalanges reach `target` comfortably bent; then the phalanges reach it. Seen
 * from above this keeps the web between thumb and index finger open. */
export function thumbChain(cmc: V3, target: V3, bones: readonly number[], mirror: number, yaw = 0): V3[] {
  const [l0, l1, l2] = bones;
  const [low, high] = ANATOMY.thumbSpread;
  const drop = 0.18;
  let best: V3 = cmc,
    score = Infinity;
  for (let deg = low; deg <= high; deg += 1.5) {
    const a = (deg * Math.PI) / 180;
    // The metacarpal's direction in the hand, turned with the hand.
    const hx = -mirror * Math.sin(a),
      hy = Math.cos(a);
    const m = {
      x: cmc.x + (Math.cos(yaw) * hx - Math.sin(yaw) * hy) * l0 * Math.cos(drop),
      y: cmc.y + (Math.sin(yaw) * hx + Math.cos(yaw) * hy) * l0 * Math.cos(drop),
      z: cmc.z - l0 * Math.sin(drop),
    };
    const d = Math.hypot(target.x - m.x, target.y - m.y, target.z - m.z);
    const s = Math.abs(d - (l1 + l2) * 0.9) + 0.25 * Math.abs(deg - ANATOMY.thumbRestSpread);
    if (s < score) {
      score = s;
      best = m;
    }
  }
  return [cmc, ...twoBone(best, target, l1, l2)];
}

/** The hand of `track` at `time`: where the wrist is and where each fingertip goes. */
const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

/** How far a fingertip can be from its base, horizontally, at a drop of `down` millimetres:
 * from curled to almost straight (rigid bones, see `fingerChain`). */
function reachRange(finger: number, down: number) {
  const length = ANATOMY.bones[finger].reduce((s, b) => s + b, 0) * (finger === 0 ? 0.92 : 0.97);
  const max = Math.sqrt(Math.max(0, length * length - down * down));
  return { min: Math.min(max, length * 0.42), max };
}
/** Sideways range of a finger (degrees from the hand's forward direction, toward the little
 * finger positive) beyond its rest direction. */
const SPLAY = [0, 20, 14, 14, 20];
const YAW_LIMIT = (20 * Math.PI) / 180;
const FINGER_GAP = 12;

type Placement = { x: number; y: number; yaw: number; weight: number; forward: number };
type Aim = {
  contact: Contact | undefined;
  prev: Contact | undefined;
  future: Contact | undefined;
  held: boolean;
  /** When the finger leaves `prev`: its end, or earlier when the same finger plays another key
   * next and needs time to get there (the sound goes on; only the finger moves). */
  release: number;
  need: number;
};
/** Approximate key distance in millimetres from the pitch difference (7 white keys an octave). */
const keyDistance = (a: number, b: number) => (Math.abs(a - b) * 7 * WHITE_KEY_MM) / 12;

/** Each finger's current or coming key at `time`, and how much it should shape the hand. */
function aims(track: HandTrack, time: number, rate: number): Aim[] {
  return track.fingers.map((rows) => {
    const index = at(rows, time, (n) => n.start),
      prev = rows[index],
      future = rows[index + 1];
    let release = prev ? prev.end : -Infinity;
    if (prev && future && future.pitch !== prev.pitch) {
      const travel = Math.max(0.06, keyDistance(prev.pitch, future.pitch) / 1500) * rate;
      release = Math.max(prev.start + 0.03 * rate, Math.min(prev.end, future.start - travel));
    }
    const held = !!prev && time < release;
    const nextReady = !!future && future.start - time < 0.34 * rate;
    const contact = held ? prev : nextReady ? future : prev && time - release < 0.55 * rate ? prev : undefined;
    // A key held long ago (often sustained by the pedal) barely shapes the hand.
    const heldNeed = held ? (time - prev!.start > 0.6 * rate ? 0.3 : 3) : 0;
    const releasedNeed = prev && !held ? 3 * (1 - smooth((time - release) / (0.22 * rate))) : 0;
    const comingNeed = future ? 3 * smooth(1 - (future.start - time) / (0.34 * rate)) : 0;
    const need = contact === future ? Math.max(comingNeed, heldNeed) : Math.max(heldNeed, releasedNeed, comingNeed * 0.5);
    return { contact, prev, future, held, release, need };
  });
}

/** Grid step, block length and the context computed around each block, in song seconds. */
const STEP = 1 / 120,
  BLOCK = 4,
  CONTEXT = 1;
/** Wrist speed limit (millimetres and radians per second). */
const WRIST_SPEED = 2500,
  YAW_SPEED = 4;
type Block = Float64Array; // x, y, yaw, weight per grid point; NaN where the hand is away
const trajectories = new WeakMap<HandTrack, { layout: string; blocks: Map<number, Block> }>();

/** The hand's placement at `time` from its precomputed path. Each block is computed with a
 * second of context on both sides: raw placements, a triangle smoothing window, then the speed
 * limit run forward and backward and averaged (so the hand neither lags nor leads). */
function trajectory(track: HandTrack, layout: string, raw: (t: number) => { x: number; y: number; yaw: number; weight: number } | null, time: number) {
  let cache = trajectories.get(track);
  if (!cache || cache.layout !== layout) {
    cache = { layout, blocks: new Map() };
    trajectories.set(track, cache);
  }
  const index = Math.floor(time / BLOCK);
  let block = cache.blocks.get(index);
  if (!block) {
    block = computeBlock(index, raw);
    if (cache.blocks.size > 64) cache.blocks.clear();
    cache.blocks.set(index, block);
  }
  const from = index * BLOCK - CONTEXT;
  const f = (time - from) / STEP,
    k = Math.floor(f),
    u = f - k;
  const read = (j: number, c: number) => block![j * 4 + c];
  if (k < 0 || (k + 1) * 4 + 3 >= block.length) return null;
  const a = read(k, 0),
    b = read(k + 1, 0);
  if (Number.isNaN(a) && Number.isNaN(b)) return null;
  const j = Number.isNaN(a) ? k + 1 : Number.isNaN(b) ? k : -1;
  if (j >= 0) return { x: read(j, 0), y: read(j, 1), yaw: read(j, 2), weight: read(j, 3) };
  return { x: blend(a, b, u), y: blend(read(k, 1), read(k + 1, 1), u), yaw: blend(read(k, 2), read(k + 1, 2), u), weight: blend(read(k, 3), read(k + 1, 3), u) };
}

function computeBlock(index: number, raw: (t: number) => { x: number; y: number; yaw: number; weight: number } | null): Block {
  const from = index * BLOCK - CONTEXT;
  const n = Math.round((BLOCK + 2 * CONTEXT) / STEP) + 2;
  const out = new Float64Array(n * 4).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    const p = raw(from + i * STEP);
    if (p) out.set([p.x, p.y, p.yaw, p.weight], i * 4);
  }
  // Smoothing over ±50 ms (triangle weights), within each run of samples where the hand is shown.
  const R = 6;
  const smoothed = new Float64Array(out);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(out[i * 4])) continue;
    let sx = 0, sy = 0, syaw = 0, sw = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= n || Number.isNaN(out[j * 4])) continue;
      const w = (R + 1 - Math.abs(k)) * Math.min(1, out[j * 4 + 3]);
      sx += out[j * 4] * w;
      sy += out[j * 4 + 1] * w;
      syaw += out[j * 4 + 2] * w;
      sw += w;
    }
    if (sw > 0) smoothed.set([sx / sw, sy / sw, syaw / sw], i * 4);
  }
  // Speed limit, forward and backward, averaged.
  const limit = (dir: 1 | -1) => {
    const path = new Float64Array(smoothed);
    const start = dir === 1 ? 1 : n - 2;
    for (let i = start; dir === 1 ? i < n : i >= 0; i += dir) {
      const j = i - dir;
      if (Number.isNaN(path[i * 4]) || Number.isNaN(path[j * 4])) continue;
      for (const [c, v] of [[0, WRIST_SPEED], [1, WRIST_SPEED], [2, YAW_SPEED]] as const) {
        const max = v * STEP;
        path[i * 4 + c] = path[j * 4 + c] + Math.max(-max, Math.min(max, path[i * 4 + c] - path[j * 4 + c]));
      }
    }
    return path;
  };
  const forward = limit(1),
    backward = limit(-1);
  for (let i = 0; i < n * 4; i++) if ((i & 3) !== 3 && !Number.isNaN(smoothed[i])) smoothed[i] = (forward[i] + backward[i]) / 2;
  return smoothed;
}

export function handPose(track: HandTrack, time: number, rate: number, band: KeyBand, geometry: Geometry): HandPose | null {
  if (!track.notes.length) return null;
  const ni = at(track.notes, time, (n) => n.start),
    last = track.notes[Math.max(0, ni)],
    next = track.notes[ni + 1];
  if (time > last.end + 1.2 * rate && (!next || next.start - time > 1.2 * rate)) return null;
  const mirror = track.side === "right" ? 1 : -1;
  let keyPx = 0;
  for (const n of [last, next])
    if (n) for (let pitch = n.pitch - 1; pitch <= n.pitch + 1; pitch++) keyPx = Math.max(keyPx, geometry(pitch)?.w ?? 0);
  if (!keyPx) return null;
  const scale = keyPx / WHITE_KEY_MM;
  const keyHeight = (band.bottom - band.top) / scale;
  /** Where a fingertip presses a key, in millimetres. The thumb plays near the front of a white
   * key; the other fingers further in. */
  const keyPoint = (pitch: number, finger = 2): V3 | null => {
    const g = geometry(pitch);
    if (!g) return null;
    const white = finger === 1 ? Math.min(keyHeight * 0.08, 9) : Math.min(keyHeight * 0.36, 55);
    return { x: (g.x + g.w / 2) / scale, y: isBlack(pitch) ? keyHeight * 0.55 : white, z: 0 };
  };
  const base = (i: number) => ANATOMY.bases[i];
  const restTip = (i: number) => ({ x: mirror * (base(i).x + ANATOMY.rest[i].x), y: base(i).y + ANATOMY.rest[i].y });

  const goalsOf = (rows: Aim[]) => rows.map((a, i) => (a.contact ? keyPoint(a.contact.pitch, i + 1) : null));
  // Keys the fingers must reach: held ones (fresh ones most), and ones about to be struck.
  const mustOf = (rows: Aim[], goals: (V3 | null)[], t: number) =>
    rows.map((a, i) => {
      if (!goals[i] || !a.contact) return 0;
      // A fresh key holds the hand firmly; an older one (often kept by the pedal) gives way.
      if (a.held) return blend(20, 0.5, smooth((t - a.contact.start - 0.12 * rate) / (0.5 * rate)));
      // Rises to the held weight as the strike comes, so nothing jumps at the strike.
      if (a.contact === a.future) return 10 * smooth(1 - (a.future.start - t) / (0.25 * rate));
      return 0;
    });
  /** Key fix: move the hand (damped steps) until every finger that must reach its key can,
   * within its reach and sideways range. */
  const fix = (w: { x: number; y: number }, yaw: number, goals: (V3 | null)[], must: number[], iterations: number) => {
    const cos = Math.cos(yaw),
      sin = Math.sin(yaw);
    for (let iteration = 0; iteration < iterations; iteration++) {
    let dx = 0,
      dy = 0,
      total = 0;
    goals.forEach((_, i) => {
      const g = goals[i];
      if (!g || must[i] <= 0) return;
      const r = base(i);
      const b = { x: w.x + cos * mirror * r.x - sin * r.y, y: w.y + sin * mirror * r.x + cos * r.y, z: WRIST_Z + r.z };
      const ox = g.x - b.x,
        oy = g.y - b.y;
      const d = Math.hypot(ox, oy) || 0.001;
      const { min, max } = reachRange(i, b.z - g.z);
      let cx = 0,
        cy = 0;
      if (d > max) {
        cx = (ox / d) * (d - max);
        cy = (oy / d) * (d - max);
      } else if (d < min) {
        cx = (ox / d) * (d - min);
        cy = (oy / d) * (d - min);
      }
      if (i > 0) {
        // Sideways reach: the angle from the hand's forward direction, beyond the finger's range.
        const local = Math.atan2(cos * ox + sin * oy, -sin * ox + cos * oy);
        const off = mirror * local - Math.atan2(ANATOMY.rest[i].x, ANATOMY.rest[i].y);
        const limit = (SPLAY[i] * Math.PI) / 180;
        if (Math.abs(off) > limit) {
          const excess = (Math.abs(off) - limit) * Math.sign(off);
          // Move sideways (along the hand's own x axis) by the arc the finger cannot cover.
          const side = excess * d * mirror;
          cx += cos * side;
          cy += sin * side;
        }
      }
      dx += cx * must[i];
      dy += cy * must[i];
      total += must[i];
    });
    if (!total) break;
    const ux = dx / total,
      uy = dy / total;
    if (Math.hypot(ux, uy) < 0.2) break;
    w.x += ux * 0.85;
    w.y += Math.max(-25, Math.min(25, uy * 0.85));
  }
    w.y = Math.max(WRIST_Y - 20, Math.min(WRIST_Y + 45, w.y));
  };
  /** The hand's place at time `t` before smoothing: the rigid fit (weighted Procrustes) of the
   * fingers' rest tips onto their keys; the turn is held near straight when few keys pull. */
  const raw = (t: number): Placement | null => {
    const rows = aims(track, t, rate);
    const pts: { r: { x: number; y: number }; k: { x: number; y: number }; w: number; forward: number }[] = [];
    rows.forEach((a, i) => {
      const k = a.contact && keyPoint(a.contact.pitch, i + 1);
      // A thumb on a black key brings the whole hand in toward the fallboard.
      if (k && a.need > 0.0001) pts.push({ r: restTip(i), k, w: a.need, forward: isBlack(a.contact!.pitch) ? (i === 0 ? 34 : 8) : 0 });
    });
    const li = at(track.notes, t, (n) => n.start),
      resting = track.notes[Math.max(0, li)],
      rk = resting && keyPoint(resting.pitch);
    if (rk) pts.push({ r: restTip(resting.finger - 1), k: rk, w: 0.06, forward: 0 });
    if (!pts.length) return null;
    const W = pts.reduce((s, p) => s + p.w, 0);
    const rc = { x: pts.reduce((s, p) => s + p.r.x * p.w, 0) / W, y: pts.reduce((s, p) => s + p.r.y * p.w, 0) / W };
    const kc = { x: pts.reduce((s, p) => s + p.k.x * p.w, 0) / W, y: pts.reduce((s, p) => s + p.k.y * p.w, 0) / W };
    let S = 0,
      C = 0;
    for (const p of pts) {
      const ax = p.r.x - rc.x,
        ay = p.r.y - rc.y,
        bx = p.k.x - kc.x,
        by = p.k.y - kc.y;
      S += p.w * (ax * by - ay * bx);
      C += p.w * (ax * bx + ay * by);
    }
    // The prior keeps the hand straight when the keys hardly decide its turn.
    const yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, Math.atan2(S, C + 600 * W)));
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const forward = pts.reduce((sum, p) => sum + p.forward * p.w, 0) / W;
    const place = { x: kc.x - (c * rc.x - s * rc.y), y: WRIST_Y + forward };
    const goals = goalsOf(rows);
    fix(place, yaw, goals, mustOf(rows, goals, t), 8);
    return { ...place, yaw, weight: W, forward };
  };
  // The hand's path: placements on a 1/120 s grid, smoothed and speed-limited per block (see
  // `trajectory`), read here between grid points.
  const layout = `${rate}:${Math.round(keyHeight)}:${Math.round(scale * 1000)}:${Math.round((geometry(60)?.x ?? 0) / scale)}`;
  const placed = trajectory(track, layout, raw, time);
  if (!placed) return null;
  const weight = placed.weight;
  const wrist: V3 = { x: placed.x, y: placed.y, z: WRIST_Z };
  const yaw = placed.yaw;
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  /** Hand frame (millimetres from the wrist, right-hand coordinates) to the keyboard. */
  const world = (p: V3): V3 => ({
    x: wrist.x + cos * mirror * p.x - sin * p.y,
    y: wrist.y + sin * mirror * p.x + cos * p.y,
    z: wrist.z + p.z,
  });

  const rows = aims(track, time, rate);
  const goals = goalsOf(rows);
  // No key fix here: the path already carries it, and a fix after smoothing makes the hand jump.
  const must = mustOf(rows, goals, time);

  const ci = at(track.crossings, time, (c) => c.start),
    cross = track.crossings[ci];
  const thumbUnder = !!cross && time < cross.end;
  const crossPhase = thumbUnder ? Math.sin((Math.PI * (time - cross.start)) / (cross.end - cross.start)) : 0;

  // Each finger's target: its key when it can reach it, else its rest place in the hand.
  /** `priority`: who yields when two fingers would cross (pressed 3, striking soon up to 2). */
  type Target = { target: V3; pressed: boolean; substitution: boolean; priority: number };
  const targets: Target[] = rows.map(({ prev, future, held, contact, release }, i) => {
    const b = world(base(i));
    const rest = world({ x: restTip(i).x * mirror, y: restTip(i).y, z: base(i).z + ANATOMY.rest[i].z });
    const goal = goals[i];
    if (!contact || !goal) return { target: rest, pressed: false, substitution: false, priority: 0 };
    const { max } = reachRange(i, b.z);
    // Out of reach even after the key fix: the finger lets the key go (the pedal keeps it
    // sounding) and returns to its place in the hand, smoothly as the distance grows.
    const away = smooth((Math.hypot(goal.x - b.x, goal.y - b.y) - max) / 25) * (1 - smooth((must[i] - 3) / 7));
    if (away >= 0.999) return { target: rest, pressed: false, substitution: false, priority: 0 };
    let target: V3 = { ...goal };
    let pressed = held && away < 0.5;
    if (!held && future === contact) {
      // Travel to the coming key in an arc and come down on it.
      const start = Math.max(prev ? release : -Infinity, contact.start - 0.34 * rate);
      const u = smooth((time - start) / Math.max(0.001, contact.start - start));
      // From the previous key while the finger is still near it, else from its rest place.
      const fromKey = prev && start - release < 0.3 * rate ? keyPoint(prev.pitch, i + 1) : null;
      const from = fromKey ?? rest;
      target = from
        ? { x: blend(from.x, goal.x, u), y: blend(from.y, goal.y, u), z: Math.sin(Math.PI * u) * LIFT + (1 - u) * 2 }
        : { ...goal, z: LIFT * (1 - u) };
      if (contact.substitution) target.z = Math.max(0, (contact.start - time) / (0.12 * rate)) * 4;
    } else if (!held && prev === contact) {
      // Lift off the released key, then drift back to the rest place before the hand lets go.
      const since = time - release;
      target.z = smooth(since / (0.16 * rate)) * LIFT;
      const back = smooth((since - 0.12 * rate) / (0.4 * rate));
      if (back > 0) target = { x: blend(target.x, rest.x, back), y: blend(target.y, rest.y, back), z: blend(target.z, rest.z, back) };
      pressed = false;
    }
    if (away > 0) target = { x: blend(target.x, rest.x, away), y: blend(target.y, rest.y, away), z: blend(target.z, rest.z, away) };
    return { target, pressed, substitution: contact.substitution, priority: pressed ? 3 : Math.min(2, must[i] / 5) };
  });

  // Fingers 2-5 keep their order across the hand with room between them: free fingers make way
  // for the ones on keys and lift a little when pushed.
  const lateral = (p: V3) => mirror * (cos * (p.x - wrist.x) + sin * (p.y - wrist.y));
  const shiftLateral = (t: Target, by: number) => {
    t.target = { ...t.target, x: t.target.x + mirror * cos * by, y: t.target.y + mirror * sin * by, z: t.target.z + Math.min(8, Math.abs(by) * 0.5) };
  };
  const separate = (a: Target, b: Target) => {
    const need = FINGER_GAP - (lateral(b.target) - lateral(a.target));
    if (need <= 0) return;
    if (a.priority >= 3 && b.priority >= 3) return; // both on keys: the fingering's own crossing
    const share = b.priority === a.priority ? 0.5 : b.priority < a.priority ? 1 : 0;
    if (share > 0) shiftLateral(b, need * share);
    if (share < 1) shiftLateral(a, -need * (1 - share));
  };
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2; i <= 4; i++) separate(targets[i - 1], targets[i]);
    for (let i = 4; i >= 2; i--) separate(targets[i - 1], targets[i]);
  }

  const fingers = targets.map(({ target, pressed, substitution }, i) => {
    const b = world(base(i));
    if (i === 0 && thumbUnder) {
      // Passing under the hand: the thumb's base swings toward the palm and drops.
      b.x += mirror * cos * crossPhase * 14;
      b.y += mirror * sin * crossPhase * 14;
      b.z -= crossPhase * 10;
    }
    return {
      finger: i + 1,
      points: i === 0 ? thumbChain(b, target, ANATOMY.bones[0], mirror, yaw) : fingerChain(b, target, ANATOMY.bones[i], 0.67),
      pressed,
      substitution,
    };
  });

  return {
    side: track.side,
    wrist,
    yaw,
    metacarpals: ANATOMY.metacarpals.map(world),
    fingers,
    thumbUnder,
    scale,
    front: band.bottom,
    alpha: Math.min(1, weight / 3),
    motion:
      next && keyPoint(next.pitch) && keyPoint(last.pitch)
        ? Math.abs(keyPoint(next.pitch)!.x - keyPoint(last.pitch)!.x) / Math.max(0.1, next.start - last.start)
        : 0,
  };
}

/** Deterministic depth ordering when the hands overlap: the moving hand passes above. */
export function arrangeHands(poses: HandPose[]) {
  if (poses.length !== 2) return poses;
  const [left, right] = poses;
  const overlap = smooth(1 - Math.abs(left.wrist.x - right.wrist.x) / 150);
  if (overlap <= 0) return poses;
  const upper = left.motion > right.motion ? left : right;
  for (const finger of upper.fingers) finger.points.forEach((p, i) => (p.z += overlap * 22 * (finger.pressed ? 1 - i / 3 : 1)));
  upper.metacarpals.forEach((p) => (p.z += overlap * 22));
  upper.wrist.z += overlap * 22;
  return poses.filter((p) => p !== upper).concat(upper);
}
