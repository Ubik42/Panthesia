import type { Contact, HandTrack } from "./virtualHandPlan";

/** Millimetres in the keyboard's frame: X along the keys, Y forward from the keys' front edge
 * toward the fallboard, Z up from the key surface. */
export type V3 = { x: number; y: number; z: number };
export type FingerPose = {
  finger: number;
  /** Joints from the finger's base (MCP; the thumb's CMC) to the tip, in millimetres. */
  points: V3[];
  /** Bone widths (mm), one per bone. */
  widths: number[];
  pressed: boolean;
  substitution: boolean;
};
export type HandPose = {
  side: "left" | "right";
  wrist: V3;
  /** Palm outline corners in order (wrist, thumb side, knuckles, little side), millimetres. */
  palm: V3[];
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

/** A right hand at rest, palm down, wrist at the origin (thumb toward −X). Bone lengths and
 * widths follow common adult hand measurements; the left hand is its mirror image. */
const ANATOMY = {
  // Base of each finger relative to the wrist centre: the thumb's CMC, then the MCP heads.
  bases: [
    { x: -24, y: 14, z: 16 },
    { x: -21, y: 70, z: 20 },
    { x: -3, y: 73, z: 21 },
    { x: 15, y: 68, z: 20 },
    { x: 31, y: 59, z: 18 },
  ],
  bones: [
    [46, 32, 24],
    [40, 23, 17],
    [45, 26, 18],
    [41, 26, 18],
    [33, 19, 16],
  ],
  // Drawn a little narrower than a bare hand: a slender glove reads better over the keys.
  widths: [
    [17, 15, 13],
    [13.5, 12, 10.5],
    [14, 12.5, 11],
    [13, 11.5, 10.5],
    [11.5, 10.5, 9.5],
  ],
  // Where each fingertip rests, relative to its base (mm), when nothing is played.
  rest: [
    { x: -30, y: 62, z: -12 },
    { x: -3, y: 62, z: -16 },
    { x: 0, y: 68, z: -17 },
    { x: 3, y: 63, z: -16 },
    { x: 6, y: 52, z: -14 },
  ],
  wristHalf: 27,
};
/** The knuckles sit this far behind the keys' front edge (toward the player), at this height. */
const WRIST_Y = -100;
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

/** The hand of `track` at `time`: where the wrist is and where each fingertip goes. */
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
  /** Where a fingertip presses a key, in millimetres. */
  const keyPoint = (pitch: number): V3 | null => {
    const g = geometry(pitch);
    if (!g) return null;
    const black = [1, 3, 6, 8, 10].includes(pitch % 12);
    return { x: (g.x + g.w / 2) / scale, y: black ? keyHeight * 0.5 : Math.min(keyHeight * 0.22, 36), z: 0 };
  };
  const base = (i: number) => ANATOMY.bases[i];
  const restTip = (i: number) => ({ x: base(i).x + ANATOMY.rest[i].x, y: base(i).y + ANATOMY.rest[i].y });

  // Wrist position along the keys: each finger's current and coming key pulls the hand so that
  // finger lands where it rests in the hand.
  const pulls: { x: number; weight: number }[] = [];
  const chosen = track.fingers.map((rows, i) => {
    const index = at(rows, time, (n) => n.start),
      prev = rows[index],
      future = rows[index + 1],
      held = !!prev && time < prev.end;
    const nextReady = future && future.start - time < 0.34 * rate;
    const contact: Contact | undefined = held ? prev : nextReady ? future : prev && time - prev.end < 0.55 * rate ? prev : undefined;
    const pull = (c: Contact | undefined, weight: number) => {
      const k = c && keyPoint(c.pitch);
      if (k && weight > 0.0001) pulls.push({ x: k.x - mirror * restTip(i).x, weight });
    };
    // A key held long ago (often sustained by the pedal) barely pulls the wrist.
    pull(prev, prev ? (held ? (time - prev.start > 0.6 * rate ? 0.3 : 3) : 3 * (1 - smooth((time - prev.end) / (0.22 * rate)))) : 0);
    pull(future, future ? 3 * smooth(1 - (future.start - time) / (0.34 * rate)) : 0);
    return { prev, future, held, contact };
  });
  const resting = keyPoint(last.pitch);
  if (resting) pulls.push({ x: resting.x - mirror * restTip(last.finger - 1).x, weight: 0.06 });
  if (!pulls.length) return null;
  const weight = pulls.reduce((s, p) => s + p.weight, 0);
  const wrist: V3 = { x: pulls.reduce((s, p) => s + p.x * p.weight, 0) / weight, y: WRIST_Y, z: 30 };
  const world = (p: V3): V3 => ({ x: wrist.x + mirror * p.x, y: wrist.y + p.y, z: p.z });

  const ci = at(track.crossings, time, (c) => c.start),
    cross = track.crossings[ci];
  const thumbUnder = !!cross && time < cross.end;
  const crossPhase = thumbUnder ? Math.sin((Math.PI * (time - cross.start)) / (cross.end - cross.start)) : 0;

  const fingers = chosen.map(({ prev, future, held, contact }, i) => {
    const b = world(base(i));
    if (i === 0 && thumbUnder) {
      // Passing under the hand: the thumb's base swings toward the palm and drops.
      b.x += mirror * crossPhase * 14;
      b.z -= crossPhase * 10;
    }
    const rest = world({ x: restTip(i).x, y: restTip(i).y, z: base(i).z + ANATOMY.rest[i].z });
    let target: V3 = rest;
    let pressed = false,
      substitution = false;
    const goal = contact && keyPoint(contact.pitch);
    // A key beyond this finger's reach from where the hand is stays with the pedal.
    const reachable = !!goal && Math.abs(goal.x - rest.x) < (i === 0 ? 70 : 45);
    if (contact && goal && reachable) {
      target = { ...goal };
      pressed = held;
      substitution = contact.substitution;
      if (!held && future === contact) {
        // Travel to the coming key in an arc and come down on it.
        const start = Math.max(prev?.end ?? -Infinity, contact.start - 0.34 * rate);
        const u = smooth((time - start) / Math.max(0.001, contact.start - start));
        const from = prev ? keyPoint(prev.pitch) : null;
        target = from
          ? { x: blend(from.x, goal.x, u), y: blend(from.y, goal.y, u), z: Math.sin(Math.PI * u) * LIFT + (1 - u) * 2 }
          : { ...goal, z: LIFT * (1 - u) };
        if (contact.substitution) target.z = Math.max(0, (contact.start - time) / (0.12 * rate)) * 4;
      } else if (!held && prev === contact) {
        target.z = smooth((time - contact.end) / (0.16 * rate)) * LIFT;
      }
    }
    return {
      finger: i + 1,
      points: fingerChain(b, target, ANATOMY.bones[i], i === 0 ? 0.5 : 0.67),
      widths: ANATOMY.widths[i],
      pressed,
      substitution,
    };
  });

  const half = ANATOMY.wristHalf;
  const palm = [
    world({ x: half, y: 0, z: 26 }),
    world({ x: -half, y: 0, z: 26 }),
    world({ x: base(0).x - 8, y: base(0).y + 8, z: base(0).z }),
    fingers[0].points[1],
    ...[1, 2, 3, 4].map((i) => fingers[i].points[0]),
  ];
  return {
    side: track.side,
    wrist,
    palm,
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
  upper.palm.forEach((p) => (p.z += overlap * 22));
  upper.wrist.z += overlap * 22;
  return poses.filter((p) => p !== upper).concat(upper);
}
