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
/** Height of a black key's top above the white keys, millimetres. */
export const BLACK_KEY_TOP = 10;
/** The drawn hand's size against the model's. The model's hand is large (about 190 mm from the
 * wrist to the middle fingertip, a large man's hand); 0.94 makes it about 179 mm, the adult
 * average. Smaller hands miss more keys: the fingering's spans are a full-size hand's (0.9 lost
 * 2.5 points of strikes in the hand benchmark). The mesh is drawn at the same scale. */
export const HAND_SCALE = 0.94;
/** How far the wrist may come in toward the fallboard (black keys with the short fingers). */
const WRIST_IN = 110;

/** A right hand at rest, palm down, wrist at the origin, thumb toward -X, millimetres. The
 * joints are those of the WebXR `generic-hand` model (immersive-web/webxr-input-profiles, W3C
 * licence) that the hands are drawn with, so the skeleton and the mesh agree. The left hand is
 * the mirror image. Sizes are the model's; `ANATOMY` below is scaled by `HAND_SCALE`. */
const MODEL = {
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
  thumbSpread: [26, 76] as const,
  thumbRestSpread: 46,
};
const scaled = (p: { x: number; y: number; z: number }) => ({ x: p.x * HAND_SCALE, y: p.y * HAND_SCALE, z: p.z * HAND_SCALE });
const ANATOMY = {
  ...MODEL,
  bases: MODEL.bases.map(scaled),
  metacarpals: MODEL.metacarpals.map(scaled),
  bones: MODEL.bones.map((bone) => bone.map((b) => b * HAND_SCALE)),
  rest: MODEL.rest.map(scaled),
};
/** The wrist sits this far behind the keys' front edge (toward the player), at this height. */
const WRIST_Y = -115 * HAND_SCALE;
/** Wrist height above the white keys (mm): high enough that the fingers hang down to the keys. */
const WRIST_Z = 40;
/** Free fingers hover this far above the key surface. */
const HOVER = 8;
const LIFT = 9;
/** Free fingers start moving over their next key this long before it (real seconds), and get
 * this close (fraction of the way from their rest place). */
/** Wrist arc: starts at ARC_FROM and is full (ARC_MAX mm higher) at ARC_FULL mm per second. */
const ARC_FROM = 150,
  ARC_FULL = 700,
  ARC_MAX = 18;
const PREPARE = 0.9,
  PREPARE_REACH = 0.75;

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
export type FingerLimit = {
  /** The hand's forward direction and its sideways axis (toward the little finger), on the keys. */
  forward: { x: number; y: number };
  side: { x: number; y: number };
  /** The finger's rest direction (radians from forward, toward the little finger positive). */
  rest: number;
  /** How far it may turn sideways from its rest direction (radians). */
  splay: number;
};
/** Joint ranges (radians): knuckle flexion from slightly hyperextended to well bent, and the
 * least curl a finger keeps (a straight finger never plays). */
const KNUCKLE = [0, 1.45] as const;
const MIN_CURL = 0.22;

export function fingerChain(base: V3, target: V3, bones: readonly number[], coupling = 0.67, limit?: FingerLimit): V3[] {
  let dx = target.x - base.x,
    dy = target.y - base.y;
  if (limit) {
    // Sideways turn at the knuckle within the finger's range: beyond it the finger points along
    // the limit (and reaches what it can along that line) instead of twisting.
    const lx = dx * limit.side.x + dy * limit.side.y,
      ly = dx * limit.forward.x + dy * limit.forward.y;
    const angle = Math.atan2(lx, ly);
    const clamped = Math.max(limit.rest - limit.splay, Math.min(limit.rest + limit.splay, angle));
    if (clamped !== angle) {
      const along = Math.hypot(lx, ly) * Math.max(0.2, Math.cos(angle - clamped));
      const sx = Math.sin(clamped) * along,
        sy = Math.cos(clamped) * along;
      dx = sx * limit.side.x + sy * limit.forward.x;
      dy = sx * limit.side.y + sy * limit.forward.y;
    }
  }
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
  let lo = MIN_CURL,
    hi = 1.25;
  if (reach >= span(MIN_CURL)) hi = MIN_CURL;
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
  const aim = Math.max(KNUCKLE[0], Math.min(KNUCKLE[1], Math.atan2(down, horizontal) - Math.atan2(t.y, l1 + t.x)));
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
/** The thumb metacarpal's turn (degrees) and drop (radians) last chosen (see `thumbChain`). */
export type ThumbState = { deg: number; drop: number };
export function thumbChain(cmc: V3, target: V3, bones: readonly number[], mirror: number, yaw = 0, prev?: ThumbState): { points: V3[]; state: ThumbState } {
  const [l0, l1, l2] = bones;
  const [low, high] = ANATOMY.thumbSpread;
  const elevation = (a: V3, b: V3) => (Math.atan2(b.z - a.z, Math.hypot(b.x - a.x, b.y - a.y)) * 180) / Math.PI;
  let best: V3[] = [cmc, ...twoBone(cmc, target, l1, l2)],
    score = Infinity,
    state: ThumbState = { deg: ANATOMY.thumbRestSpread, drop: 0.34 };
  const pose = (deg: number, drop: number) => {
    const a = (deg * Math.PI) / 180;
    const hx = -mirror * Math.sin(a),
      hy = Math.cos(a);
    const m = {
      x: cmc.x + (Math.cos(yaw) * hx - Math.sin(yaw) * hy) * l0 * Math.cos(drop),
      y: cmc.y + (Math.sin(yaw) * hx + Math.cos(yaw) * hy) * l0 * Math.cos(drop),
      z: cmc.z - l0 * Math.sin(drop),
    };
    const [, joint, tip] = twoBone(m, target, l1, l2);
    return [cmc, m, joint, tip];
  };
  // The metacarpal's turn outward (the web between thumb and index) and its drop; the phalanges
  // then reach the key. A thumb never bends backward: the proximal phalanx may not rise above
  // the metacarpal's line (MCP hyperextension) nor the tip above the proximal's (IP), and the
  // IP joint bends at most 40 degrees.
  // The search covers the metacarpal's range finely; the choice also stays near the last one
  // (a joint does not leap between frames).
  for (let drop = 0.18; drop <= 0.501; drop += 0.04) {
    for (let deg = low; deg <= high; deg += 1) {
      const [, m, joint, tip] = pose(deg, drop);
      const d = Math.hypot(target.x - m.x, target.y - m.y, target.z - m.z);
      const e1 = elevation(cmc, m),
        e2 = elevation(m, joint),
        e3 = elevation(joint, tip);
      const backward = Math.max(0, e2 - e1 - 4) + Math.max(0, e3 - e2 - 2) + Math.max(0, e2 - e3 - 40);
      const stay = prev ? 0.6 * Math.abs(deg - prev.deg) + 40 * Math.abs(drop - prev.drop) : 0;
      const s = Math.abs(d - (l1 + l2) * 0.93) + 0.2 * Math.abs(deg - ANATOMY.thumbRestSpread) + 10 * backward + stay;
      if (s < score) {
        score = s;
        state = { deg, drop };
      }
    }
  }
  best = pose(state.deg, state.drop);
  return { points: best, state };
}

/** The hand of `track` at `time`: where the wrist is and where each fingertip goes. */
const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

/** How far a fingertip can be from its base, horizontally, at a drop of `down` millimetres:
 * from curled to almost straight (rigid bones, see `fingerChain`). */
function reachRange(finger: number, down: number) {
  const length = ANATOMY.bones[finger].reduce((s, b) => s + b, 0) * (finger === 0 ? 0.92 : 0.97);
  const max = Math.sqrt(Math.max(0, length * length - down * down));
  // Pianists play with the fingers gently curved, not folded straight down: the hand keeps the
  // fingertip at least 60% of the finger's length out from its base.
  return { min: Math.min(max, length * 0.6), max };
}
/** The horizontal reach of a finger in its relaxed curve (its rest shape, see ANATOMY.rest) at
 * a drop of `down`: a key at this distance is pressed by turning the finger at the knuckle, the
 * curve itself hardly changing. */
function relaxedReach(finger: number, down: number) {
  const r = ANATOMY.rest[finger];
  const length = Math.hypot(r.x, r.y, WRIST_Z + ANATOMY.bases[finger].z - HOVER);
  return Math.sqrt(Math.max(0, length * length - down * down));
}
/** How strongly the hand moves to give each finger on a key its relaxed reach (against the hard
 * limits, which count fully). */
const RELAX = 0.6;
/** Sideways range of a finger (degrees from the hand's forward direction, toward the little
 * finger positive) beyond its rest direction. */
const SPLAY = [0, 20, 14, 14, 20];
const YAW_LIMIT = (20 * Math.PI) / 180;
const FINGER_GAP = 12;
/** How far the thumb's key stays outside the index finger's resting tip, across the hand (mm). */
const THUMB_CLEAR = 22;

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
    // So does one the sustain pedal has caught (its finger may leave; the sound stays).
    const heldNeed = held ? blend(3, 0.3, Math.max(smooth((time - prev!.start - 0.45 * rate) / (0.3 * rate)), smooth((time - prev!.free) / (0.2 * rate)))) : 0;
    const releasedNeed = prev && !held ? 3 * (1 - smooth((time - release) / (0.22 * rate))) : 0;
    const comingNeed = future ? 3 * smooth(1 - (future.start - time) / (0.34 * rate)) : 0;
    const need = contact === future ? Math.max(comingNeed, heldNeed) : Math.max(heldNeed, releasedNeed, comingNeed * 0.5);
    return { contact, prev, future, held, release, need };
  });
}

/** Grid step, block length and the context computed around each block, in song seconds. */
const STEP = 1 / 120,
  BLOCK = 4,
  CONTEXT = 1.5,
  /** Neighbouring blocks are blended over this long around their boundary. */
  SEAM = 0.8;
/** How smooth the wrist's path is: the shortest period (real seconds) it follows where the keys
 * pull with weight 1. Heavier pulls (keys being struck or held) are followed more closely, light
 * ones hardly at all, so between keys the hand glides instead of chasing every small change. */
const WRIST_PERIOD = 0.8;
/** Weight of the correction where keys are out of reach on the smooth path (see `computeBlock`). */
const REACH_FIRM = 40;
/** Fingertip speed limit (millimetres per real second) and the fingertip spring's rate. */
const TIP_SPEED = 1200,
  TIP_OMEGA = 26;
type Block = Float64Array; // x, y, yaw, weight per grid point; NaN where the hand is away
const trajectories = new WeakMap<HandTrack, { layout: string; blocks: Map<number, Block> }>();

/** The hand's placement at `time` from its precomputed path (see `computeBlock`), blended
 * across block boundaries so nothing jumps where one block ends and the next begins. */
function trajectory(track: HandTrack, layout: string, raw: (t: number) => { x: number; y: number; yaw: number; weight: number } | null, reach: Reach, time: number, rate: number) {
  let cache = trajectories.get(track);
  if (!cache || cache.layout !== layout) {
    cache = { layout, blocks: new Map() };
    trajectories.set(track, cache);
  }
  const blockAt = (index: number) => {
    let block = cache!.blocks.get(index);
    if (!block) {
      block = computeBlock(index, raw, reach, rate);
      if (cache!.blocks.size > 64) cache!.blocks.clear();
      cache!.blocks.set(index, block);
    }
    return block;
  };
  const read = (index: number) => {
    const block = blockAt(index);
    const from = index * BLOCK - CONTEXT;
    const f = (time - from) / STEP,
      k = Math.floor(f),
      u = f - k;
    if (k < 0 || (k + 1) * 4 + 3 >= block.length) return null;
    const at = (j: number, c: number) => block[j * 4 + c];
    const a = at(k, 0),
      b = at(k + 1, 0);
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    const j = Number.isNaN(a) ? k + 1 : Number.isNaN(b) ? k : -1;
    if (j >= 0) return { x: at(j, 0), y: at(j, 1), yaw: at(j, 2), weight: at(j, 3) };
    return { x: blend(a, b, u), y: blend(at(k, 1), at(k + 1, 1), u), yaw: blend(at(k, 2), at(k + 1, 2), u), weight: blend(at(k, 3), at(k + 1, 3), u) };
  };
  const index = Math.floor(time / BLOCK);
  const here = read(index);
  const into = time - index * BLOCK;
  // Near a boundary, blend with the neighbouring block (both cover the time: CONTEXT > SEAM / 2).
  const other = into < SEAM / 2 ? index - 1 : into > BLOCK - SEAM / 2 ? index + 1 : null;
  if (other === null || !here) return here;
  const there = read(other);
  if (!there) return here;
  // Weight of the later block, rising across the seam.
  const boundary = other < index ? index * BLOCK : (index + 1) * BLOCK;
  const late = smooth((time - boundary + SEAM / 2) / SEAM);
  const [early, later] = other < index ? [there, here] : [here, there];
  return {
    x: blend(early.x, later.x, late),
    y: blend(early.y, later.y, late),
    yaw: blend(early.yaw, later.yaw, late),
    weight: blend(early.weight, later.weight, late),
  };
}

/** The wrist's path over one block (with context on both sides): the raw placements on a grid,
 * then the path nearest them (weighted by how strongly the keys pull) with the least jerk
 * (third difference): a minimum-jerk path, as human reaching moves are (Flash & Hogan 1985). */
/** Where the wrist must be at time `t`, from `x, y, yaw`, for the fingers to reach their keys. */
type Reach = (t: number, x: number, y: number, yaw: number) => { x: number; y: number; short: boolean };
function computeBlock(index: number, raw: (t: number) => { x: number; y: number; yaw: number; weight: number } | null, reach: Reach, rate: number): Block {
  const from = index * BLOCK - CONTEXT;
  const n = Math.round((BLOCK + 2 * CONTEXT) / STEP) + 2;
  const out = new Float64Array(n * 4).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    const p = raw(from + i * STEP);
    if (p) out.set([p.x, p.y, p.yaw, p.weight], i * 4);
  }
  // Where the hand is away, the nearest placement stands in, with (almost) no weight.
  const weights = new Float64Array(n);
  const xs = new Float64Array(n),
    ys = new Float64Array(n),
    yaws = new Float64Array(n);
  let last = -1;
  for (let i = 0; i < n; i++) if (!Number.isNaN(out[i * 4])) last = i;
  if (last < 0) return out;
  let near = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(out[i * 4])) near = i;
    const j = near >= 0 ? near : out.findIndex((_, k) => k % 4 === 0 && !Number.isNaN(out[k])) / 4;
    xs[i] = out[j * 4];
    ys[i] = out[j * 4 + 1];
    yaws[i] = out[j * 4 + 2];
    weights[i] = Number.isNaN(out[i * 4]) ? 1e-4 : Math.max(1e-4, out[i * 4 + 3]);
  }
  // The period is in real seconds; the grid in song seconds (rate times as fast).
  const lambda = (WRIST_PERIOD / Math.max(0.1, rate) / (2 * Math.PI * STEP)) ** 6;
  const sx = minimumJerk(xs, weights, lambda),
    sy = minimumJerk(ys, weights, lambda),
    syaw = minimumJerk(yaws, weights, lambda);
  // Keys must still be reached on the smooth path: where a frame cannot reach its firm keys,
  // the move that lets it (see `fix`) is found, smoothed the same way (pinned where needed, near
  // zero elsewhere) and added, up to three times.
  for (let pass = 0; pass < 3; pass++) {
    const cx = new Float64Array(n),
      cy = new Float64Array(n),
      cw = new Float64Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      cw[i] = 1;
      if (Number.isNaN(out[i * 4])) continue;
      const to = reach(from + i * STEP, sx[i], sy[i], syaw[i]);
      cx[i] = to.x - sx[i];
      cy[i] = to.y - sy[i];
      // A key out of reach pins the correction firmly; a relaxed reach only gently.
      if (to.short || Math.hypot(cx[i], cy[i]) > 0.5) {
        cw[i] = to.short ? REACH_FIRM : 5;
        any = true;
      }
    }
    if (!any) break;
    const dx = minimumJerk(cx, cw, lambda),
      dy = minimumJerk(cy, cw, lambda);
    for (let i = 0; i < n; i++) {
      sx[i] += dx[i];
      sy[i] += dy[i];
    }
  }
  for (let i = 0; i < n; i++) if (!Number.isNaN(out[i * 4])) out.set([sx[i], sy[i], syaw[i]], i * 4);
  return out;
}

/** The sequence nearest `values` (each weighted) with the least squared third difference times
 * `lambda`: a banded linear system, solved by banded Cholesky. */
function minimumJerk(values: Float64Array, weights: Float64Array, lambda: number) {
  const n = values.length,
    p = 3,
    w = p + 1;
  if (n < 4) return values;
  // A = diag(weights) + lambda D'D, upper band: A[i * w + d] = A(i, i + d).
  const A = new Float64Array(n * w);
  for (let i = 0; i < n; i++) A[i * w] = weights[i];
  const c = [-1, 3, -3, 1];
  for (let i = 0; i + 3 < n; i++)
    for (let a = 0; a < 4; a++) for (let b = a; b < 4; b++) A[(i + a) * w + (b - a)] += lambda * c[a] * c[b];
  // Cholesky A = L L', lower band: L[i * w + d] = L(i, i - d).
  const L = new Float64Array(n * w);
  for (let j = 0; j < n; j++) {
    let s = A[j * w];
    for (let d = 1; d <= p && j - d >= 0; d++) s -= L[j * w + d] ** 2;
    const diagonal = Math.sqrt(Math.max(s, 1e-12));
    L[j * w] = diagonal;
    for (let i = j + 1; i <= Math.min(n - 1, j + p); i++) {
      let t = A[j * w + (i - j)];
      for (let k = Math.max(0, i - p); k < j; k++) t -= L[i * w + (i - k)] * L[j * w + (j - k)];
      L[i * w + (i - j)] = t / diagonal;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = weights[i] * values[i];
    for (let d = 1; d <= p && i - d >= 0; d++) s -= L[i * w + d] * y[i - d];
    y[i] = s / L[i * w];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let d = 1; d <= p && i + d < n; d++) s -= L[(i + d) * w + d] * x[i + d];
    x[i] = s / L[i * w];
  }
  return x;
}

/** What a hand remembers between frames: its fingertips' last targets (see `handPose`). */
export type HandMemory = { time: number; tips: V3[]; velocity?: V3[]; thumb?: ThumbState };

/** Weighted isotonic regression with minimum gaps (pool adjacent violators): the positions
 * nearest `want` (weighted) such that each is at least `gaps[i]` after the one before. */
function orderLaterals(want: number[], weight: number[], gaps: number[]) {
  const offset = [0];
  for (let i = 1; i < want.length; i++) offset[i] = offset[i - 1] + gaps[i - 1];
  const blocks: { sum: number; weight: number; count: number }[] = [];
  want.forEach((w, i) => {
    blocks.push({ sum: (w - offset[i]) * weight[i], weight: weight[i], count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1],
        a = blocks[blocks.length - 2];
      if (a.sum / a.weight <= b.sum / b.weight) break;
      blocks.pop();
      a.sum += b.sum;
      a.weight += b.weight;
      a.count += b.count;
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.sum / b.weight + offset[out.length]);
  return out;
}

export function handPose(track: HandTrack, time: number, rate: number, band: KeyBand, geometry: Geometry, memory?: HandMemory): HandPose | null {
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
    // Fingers land well onto the key (toward the fallboard), the thumb nearer the front.
    const white = finger === 1 ? Math.min(keyHeight * 0.2, 28) : Math.min(keyHeight * 0.52, 78);
    // Black keys stand BLACK_KEY_TOP above the white keys' surface.
    return { x: (g.x + g.w / 2) / scale, y: isBlack(pitch) ? keyHeight * 0.7 : white, z: isBlack(pitch) ? BLACK_KEY_TOP : 0 };
  };
  const base = (i: number) => ANATOMY.bases[i];
  const restTip = (i: number) => ({ x: mirror * (base(i).x + ANATOMY.rest[i].x), y: base(i).y + ANATOMY.rest[i].y });

  const goalsOf = (rows: Aim[]) => rows.map((a, i) => (a.contact ? keyPoint(a.contact.pitch, i + 1) : null));
  // Keys the fingers must reach: held ones (fresh ones most), and ones about to be struck.
  const mustOf = (rows: Aim[], goals: (V3 | null)[], t: number) =>
    rows.map((a, i) => {
      if (!goals[i] || !a.contact) return 0;
      // A fresh key holds the hand firmly; an older one (often kept by the pedal) gives way.
      // A key the sustain pedal has caught lets the hand go sooner (see `Contact.free`).
      if (a.held) return blend(20, 0.5, Math.max(smooth((t - a.contact.start - 0.12 * rate) / (0.5 * rate)), smooth((t - a.contact.free) / (0.15 * rate))));
      // Rises to the held weight as the strike comes, so nothing jumps at the strike.
      if (a.contact === a.future) return 10 * smooth(1 - (a.future.start - t) / (0.25 * rate));
      return 0;
    });
  /** Key fix: move the hand (damped steps) until every finger that must reach its key can,
   * within its reach and sideways range. */
  const fix = (w: { x: number; y: number }, yaw: number, goals: (V3 | null)[], must: number[], iterations: number, relax = true) => {
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
      } else if (i > 0 && relax) {
        // Within reach: the hand still moves toward where the finger keeps its relaxed curve, so
        // it plays from the knuckle rather than folding up or straightening out (Zhu et al. 2013:
        // a relaxed base pose plus small changes).
        const relaxed = Math.max(min, Math.min(max, relaxedReach(i, b.z - g.z)));
        cx = (ox / d) * (d - relaxed) * RELAX;
        cy = (oy / d) * (d - relaxed) * RELAX;
      }
      if (i === 0) {
        // The thumb's key stays on the thumb's side of the hand, clear of where the index finger
        // can reach: a thumb under the palm would put the fingers through each other.
        const thumbSide = mirror * (cos * (g.x - w.x) + sin * (g.y - w.y));
        const limit = (ANATOMY.bases[1].x + ANATOMY.rest[1].x) - THUMB_CLEAR;
        if (thumbSide > limit) {
          const side = (thumbSide - limit) * mirror;
          cx += cos * side;
          cy += sin * side;
        }
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
    w.y = Math.max(WRIST_Y - 20, Math.min(WRIST_Y + WRIST_IN, w.y));
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
  const reach: Reach = (t, x, y, yaw) => {
    const rows = aims(track, t, rate);
    const goals = goalsOf(rows);
    const must = mustOf(rows, goals, t);
    const place = { x, y },
      hard = { x, y };
    fix(place, yaw, goals, must, 8);
    fix(hard, yaw, goals, must, 8, false);
    return { ...place, short: Math.hypot(hard.x - x, hard.y - y) > 0.5 };
  };
  // The hand's path: placements on a 1/120 s grid, a minimum-jerk path through them that still
  // reaches the keys, per block (see `computeBlock`), read here between grid points.
  const layout = `${rate}:${Math.round(keyHeight)}:${Math.round(scale * 1000)}:${Math.round((geometry(60)?.x ?? 0) / scale)}`;
  const placed = trajectory(track, layout, raw, reach, time, rate);
  if (!placed) return null;
  const weight = placed.weight;
  // The wrist rises while the hand travels across the keys and comes down as it arrives: an arc
  // between positions, higher the faster the move (speed from the path, in real seconds); fingers
  // on fresh keys hold it down.
  const span = 0.04 * rate;
  const before = trajectory(track, layout, raw, reach, time - span, rate),
    after = trajectory(track, layout, raw, reach, time + span, rate);
  const speed = before && after ? Math.hypot(after.x - before.x, after.y - before.y) / (2 * span / rate) : 0;
  const rowsNow = aims(track, time, rate);
  const goalsNow = goalsOf(rowsNow);
  const holding = Math.max(0, ...mustOf(rowsNow, goalsNow, time));
  const arc = ARC_MAX * smooth((speed - ARC_FROM) / (ARC_FULL - ARC_FROM)) * (1 - smooth(holding / 12));
  const wrist: V3 = { x: placed.x, y: placed.y, z: WRIST_Z + arc };
  const yaw = placed.yaw;
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  /** Hand frame (millimetres from the wrist, right-hand coordinates) to the keyboard. */
  const world = (p: V3): V3 => ({
    x: wrist.x + cos * mirror * p.x - sin * p.y,
    y: wrist.y + sin * mirror * p.x + cos * p.y,
    z: wrist.z + p.z,
  });

  const rows = rowsNow;
  const goals = goalsNow;
  // No key fix here: the path already carries it, and a fix after smoothing makes the hand jump.
  const must = mustOf(rows, goals, time);

  const ci = at(track.crossings, time, (c) => c.start),
    cross = track.crossings[ci];
  const thumbUnder = !!cross && time < cross.end;
  const crossPhase = thumbUnder ? Math.sin((Math.PI * (time - cross.start)) / (cross.end - cross.start)) : 0;

  // Each finger's target: its key when it can reach it, else its rest place in the hand.
  /** `priority`: who yields when two fingers would cross (pressed 3, striking soon up to 2). */
  type Target = { target: V3; pressed: boolean; substitution: boolean; priority: number; since: number };
  const targets: Target[] = rows.map(({ prev, future, held, contact, release }, i) => {
    const b = world(base(i));
    // A finger not playing hovers a little above the keys at its place in the hand.
    const restAt = world({ x: restTip(i).x * mirror, y: restTip(i).y, z: 0 });
    // Over the black keys' part of the keyboard it hovers above their tops.
    let rest = { ...restAt, z: restAt.y > keyHeight * 0.37 ? BLACK_KEY_TOP + 4 : HOVER };
    // A finger whose next key comes within PREPARE seconds moves over it early, hovering, as
    // pianists place the hand ahead (the strike itself starts 0.34 s before, see below).
    const coming = future && !held && keyPoint(future.pitch, i + 1);
    if (coming) {
      const ahead = (future.start - time) / rate;
      const ready = PREPARE_REACH * smooth((PREPARE - ahead) / (PREPARE - 0.34));
      if (ready > 0) {
        const over = { ...coming, z: (isBlack(future.pitch) ? BLACK_KEY_TOP : 0) + HOVER };
        // Only as far as the finger reaches from where the hand is now.
        const { max } = reachRange(i, b.z - over.z);
        const fits = 1 - smooth((Math.hypot(over.x - b.x, over.y - b.y) - max) / 20);
        const k = ready * fits;
        rest = { x: blend(rest.x, over.x, k), y: blend(rest.y, over.y, k), z: blend(rest.z, over.z, k) };
      }
    }
    const goal = goals[i];
    if (!contact || !goal) return { target: rest, pressed: false, substitution: false, priority: 0, since: -Infinity };
    const { max } = reachRange(i, b.z);
    // Out of reach even after the key fix: the finger lets the key go (the pedal keeps it
    // sounding) and returns to its place in the hand, smoothly as the distance grows.
    const away = smooth((Math.hypot(goal.x - b.x, goal.y - b.y) - max) / 25) * (1 - smooth((must[i] - 3) / 7));
    if (away >= 0.999) return { target: rest, pressed: false, substitution: false, priority: 0, since: -Infinity };
    let target: V3 = { ...goal };
    let pressed = held && away < 0.5;
    if (!held && future === contact) {
      // Travel to the coming key in an arc and come down on it.
      const start = Math.max(prev ? release : -Infinity, contact.start - 0.34 * rate);
      // Near-constant speed along the way (a light ease only at both ends).
      const linear = Math.max(0, Math.min(1, (time - start) / Math.max(0.001, contact.start - start)));
      const u = 0.7 * linear + 0.3 * smooth(linear);
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
    return { target, pressed, substitution: contact.substitution, priority: pressed ? 3 : Math.min(2, must[i] / 5), since: contact.start };
  });

  // Fingers keep their order across the hand with room between them. No collisions and no
  // pushing: one weighted projection (`orderLaterals`) puts each finger as near its own target
  // as the order allows; fingers on keys stay, fingers about to strike nearly so, free ones make
  // way. It is continuous in its inputs, so it never makes a finger jump or shake.
  const lateral = (p: V3) => mirror * (cos * (p.x - wrist.x) + sin * (p.y - wrist.y));
  const moveLateral = (p: V3, by: number): V3 => ({ ...p, x: p.x + mirror * cos * by, y: p.y + mirror * sin * by });
  /** A free finger's target turned into the sideways range it can reach from its knuckle; it
   * also stays over the keys (a finger not playing never reaches past them toward the fallboard). */
  const reachable = (i: number, t: Target) => {
    if (t.priority >= 3) return;
    if (t.target.y > keyHeight * 0.85) t.target = { ...t.target, y: keyHeight * 0.85 };
    if (i === 0) return;
    const kb = world(base(i));
    const dx = t.target.x - kb.x,
      dy = t.target.y - kb.y;
    const lx = mirror * (cos * dx + sin * dy),
      ly = -sin * dx + cos * dy;
    const rest = Math.atan2(ANATOMY.rest[i].x, ANATOMY.rest[i].y),
      limit = (SPLAY[i] * Math.PI) / 180;
    const angle = Math.atan2(lx, ly);
    const clamped = Math.max(rest - limit, Math.min(rest + limit, angle));
    if (clamped === angle) return;
    const r = Math.hypot(lx, ly);
    const nx = Math.sin(clamped) * r,
      ny = Math.cos(clamped) * r;
    t.target = { ...t.target, x: kb.x + mirror * cos * nx - sin * ny, y: kb.y + mirror * sin * nx + cos * ny };
  };
  // The thumb keeps to its side of the index finger too, except while it passes under the hand.
  const first = thumbUnder ? 1 : 0;
  // Two fingers on keys in the wrong order cannot both stay: the one that pressed first lets its
  // key go (the pedal or the sound's release carries it). Decided by the keys, not by motion.
  for (let i = first; i < 4; i++)
    for (let k = i + 1; k <= 4; k++) {
      const a = targets[i],
        b = targets[k];
      if (a.priority < 3 || b.priority < 3 || lateral(b.target) - lateral(a.target) > 0) continue;
      const older = a.since <= b.since ? a : b;
      older.pressed = false;
      older.priority = 1.5;
      older.target = { ...older.target, z: older.target.z + LIFT * 0.4 };
    }
  /** Orders the fingers' points (each as near its own place as its weight asks) and lifts free
   * fingers that are squeezed or moved aside, continuously, by how much. */
  const arrange = (points: V3[], fixed: boolean[], weights: number[], gap: number, lifting: boolean) => {
    const want = points.slice(first).map(lateral);
    const n = want.length;
    // Between two fixed fingers the room is shared out evenly when it is short.
    const gaps = Array.from({ length: n - 1 }, () => gap);
    let last = -1;
    for (let k = 0; k < n; k++) {
      if (!fixed[k + first]) continue;
      if (last >= 0 && k - last > 1) {
        const room = Math.max(0, want[k] - want[last]) / (k - last);
        for (let m = last; m < k; m++) gaps[m] = Math.min(gap, room);
      }
      last = k;
    }
    const got = orderLaterals(
      want,
      weights.slice(first).map((w, k) => (fixed[k + first] ? 1e6 : w)),
      gaps,
    );
    return points.map((p, i) => {
      if (i < first || fixed[i]) return p;
      const k = i - first,
        by = got[k] - want[k];
      const squeezed = Math.max(k > 0 ? 1 - gaps[k - 1] / gap : 0, k < n - 1 ? 1 - gaps[k] / gap : 0);
      // Lifted once, before the smoothing (the thumb stays low: lifting it bends it backward).
      const lift = lifting && i > 0 ? Math.min(HOVER, Math.abs(by) * 0.35 + squeezed * HOVER) : 0;
      return { ...moveLateral(p, by), z: p.z + lift };
    });
  };
  const weightOf = (t: Target) => 1 + 20 * t.priority;
  const orderTargets = (lifting: boolean) => {
    targets.forEach((t, i) => reachable(i, t));
    const placed = arrange(
      targets.map((t) => t.target),
      targets.map((t) => t.priority >= 3),
      targets.map(weightOf),
      FINGER_GAP,
      lifting,
    );
    targets.forEach((t, i) => (t.target = placed[i]));
  };
  orderTargets(true);

  // In the hand's own frame (across, forward, height from the wrist): the fingers' motion is
  // smoothed relative to the hand, so they move with it and never trail behind a moving hand.
  const toHand = (p: V3): V3 => {
    const dx = p.x - wrist.x,
      dy = p.y - wrist.y;
    return { x: mirror * (cos * dx + sin * dy), y: -sin * dx + cos * dy, z: p.z };
  };
  const fromHand = (l: V3): V3 => ({ x: wrist.x + mirror * cos * l.x - sin * l.y, y: wrist.y + mirror * sin * l.x + cos * l.y, z: l.z });
  /** Real seconds since the last frame (NaN without memory). */
  const elapsed = memory ? (time - memory.time) / Math.max(0.1, rate) : Number.NaN;
  // Continuous fingertips: each free fingertip follows its target as a critically damped spring
  // (it speeds up and slows down smoothly, keeps a steady speed behind a moving target, starts a
  // little late and arrives a little after: no sudden moves). A finger striking soon follows
  // more tightly; a finger on its key sits on it. A seek or a long gap starts over.
  if (memory) {
    const real = elapsed;
    const fresh = !(real > 0 && real < 0.15) || memory.tips.length !== targets.length;
    const velocity =
      fresh || !memory.velocity || memory.velocity.length !== targets.length ? targets.map(() => ({ x: 0, y: 0, z: 0 })) : memory.velocity;
    targets.forEach((t, i) => {
      const before = memory.tips[i];
      if (fresh || !before) return;
      const goal = toHand(t.target);
      if (t.pressed) {
        velocity[i] = { x: (goal.x - before.x) / real, y: (goal.y - before.y) / real, z: (goal.z - before.z) / real };
        return;
      }
      const omega = TIP_OMEGA * (1 + Math.min(1, t.priority / 2) * 1.2);
      let p = { ...before },
        v = { ...velocity[i] };
      const steps = Math.max(1, Math.ceil(real * 240)),
        dt = real / steps;
      for (let k = 0; k < steps; k++) {
        v = {
          x: v.x + (omega * omega * (goal.x - p.x) - 2 * omega * v.x) * dt,
          y: v.y + (omega * omega * (goal.y - p.y) - 2 * omega * v.y) * dt,
          z: v.z + (omega * omega * (goal.z - p.z) - 2 * omega * v.z) * dt,
        };
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > TIP_SPEED) v = { x: (v.x * TIP_SPEED) / speed, y: (v.y * TIP_SPEED) / speed, z: (v.z * TIP_SPEED) / speed };
        p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
      }
      // Never into the keys while not pressing.
      p.z = Math.max(p.z, Math.min(goal.z, 1));
      t.target = fromHand(p);
      velocity[i] = v;
    });
    memory.velocity = velocity;
    memory.time = time;
    // The order once more after smoothing (continuous, so it adds no jumps).
    orderTargets(false);
  }

  // The thumb's metacarpal continues from where it was (unless this is a seek or a long gap).
  const thumbPrev = memory && memory.thumb && elapsed > 0 && elapsed < 0.15 ? memory.thumb : undefined;
  let thumbState: ThumbState | undefined;
  const chain = (i: number, target: V3, loose = false) => {
    const b = world(base(i));
    if (i === 0 && thumbUnder) {
      // Passing under the hand: the thumb's base swings toward the palm and drops.
      b.x += mirror * cos * crossPhase * 14;
      b.y += mirror * sin * crossPhase * 14;
      b.z -= crossPhase * 10;
    }
    return i === 0
      ? (() => {
          const r = thumbChain(b, target, ANATOMY.bones[0], mirror, yaw, thumbPrev);
          thumbState = r.state;
          return r.points;
        })()
      : fingerChain(b, target, ANATOMY.bones[i], 0.67, {
          forward: { x: -sin, y: cos },
          side: { x: mirror * cos, y: mirror * sin },
          rest: Math.atan2(ANATOMY.rest[i].x, ANATOMY.rest[i].y),
          splay: ((SPLAY[i] + (loose ? 30 : 8)) * Math.PI) / 180,
        });
  };
  let fingers = targets.map(({ target, pressed, substitution }, i) => ({ finger: i + 1, points: chain(i, target), pressed, substitution }));
  // The same order on the real fingertips (a finger's own limits can bend it off its target):
  // the same projection, and a finger moved by it reaches its new place with a looser sideways
  // range. Fingers never pass through each other.
  const tips = fingers.map((f) => f.points[f.points.length - 1]);
  const placedTips = arrange(
    tips,
    fingers.map((f) => f.pressed),
    targets.map(weightOf),
    7,
    false,
  );
  fingers = fingers.map((f, i) => {
    const q = placedTips[i];
    if (Math.hypot(q.x - tips[i].x, q.y - tips[i].y, q.z - tips[i].z) < 0.3) return f;
    return { ...f, points: chain(i, q, true) };
  });
  if (memory) {
    memory.tips = targets.map((t) => toHand(t.target));
    memory.thumb = thumbState;
  }
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
