import type { Contact, HandTrack } from "./virtualHandPlan";
export type V3 = {
    x: number;
    y: number;
    z: number;
};
export type FingerPose = {
    finger: number;
    points: V3[];
    pressed: boolean;
    substitution: boolean;
};
export type HandPose = {
    side: "left" | "right";
    wrist: V3;
    fingers: FingerPose[];
    thumbUnder: boolean;
    unit: number;
    vertical: number;
    baseline: number;
    alpha: number;
    motion: number;
};
type Geometry = (pitch: number) => {
    x: number;
    w: number;
} | undefined;
const smooth = (x: number) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
};
const blend = (a: number, b: number, t: number) => a + (b - a) * t;
function at<T>(rows: readonly T[], time: number, key: (x: T) => number) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (key(rows[mid]) <= time)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo - 1;
}
/** Three rigid phalanges with coupled distal flexion; solve a scalar bend then orient the chain. */
export function fingerChain(base: V3, target: V3, lengths: number[]): V3[] {
    const dx = target.x - base.x, dy = target.y - base.y, dz = target.z - base.z, d = Math.max(0.0001, Math.hypot(dx, dy, dz));
    const e = { x: dx / d, y: dy / d, z: dz / d };
    let q = { x: -e.x * e.z, y: -e.y * e.z, z: 1 - e.z * e.z };
    const qn = Math.hypot(q.x, q.y, q.z);
    q =
        qn > 0.0001
            ? { x: q.x / qn, y: q.y / qn, z: q.z / qn }
            : { x: 1, y: 0, z: 0 };
    const total = lengths.reduce((a, b) => a + b, 0), stretch = Math.max(1, d / total), ls = lengths.map((l) => l * stretch);
    const reach = (b: number) => {
        const x = ls[0] + ls[1] * Math.cos(b) + ls[2] * Math.cos(1.6 * b), y = ls[1] * Math.sin(b) + ls[2] * Math.sin(1.6 * b);
        return { x, y, r: Math.hypot(x, y) };
    };
    let lo = 0, hi = 2.3;
    for (let k = 0; k < 16; k++) {
        const m = (lo + hi) / 2;
        if (reach(m).r > d)
            lo = m;
        else
            hi = m;
    }
    const bend = (lo + hi) / 2, shape = reach(bend), orientation = Math.atan2(shape.y, shape.x), points = [base];
    let p = base;
    for (let k = 0; k < 3; k++) {
        const angle = orientation - [0, bend, 1.6 * bend][k], u = Math.cos(angle) * ls[k], v = Math.sin(angle) * ls[k];
        p = {
            x: p.x + e.x * u + q.x * v,
            y: p.y + e.y * u + q.y * v,
            z: p.z + e.z * u + q.z * v,
        };
        points.push(p);
    }
    return points;
}
const offset = [-1.65, -0.8, 0, 0.8, 1.5], depth = [0.57, 0.31, 0.24, 0.31, 0.44], lengths = [
    [1.05, 0.8, 0.65],
    [1.3, 0.85, 0.6],
    [1.45, 0.95, 0.65],
    [1.35, 0.85, 0.6],
    [1.05, 0.7, 0.5],
];
export function handPose(track: HandTrack, time: number, rate: number, baseline: number, height: number, geometry: Geometry): HandPose | null {
    if (!track.notes.length)
        return null;
    const ni = at(track.notes, time, (n) => n.start), last = track.notes[Math.max(0, ni)], next = track.notes[ni + 1];
    if (time > last.end + 1.2 * rate && (!next || next.start - time > 1.2 * rate))
        return null;
    const sign = track.side === "right" ? 1 : -1;
    const sample = (pitch: number) => {
        const k = geometry(pitch);
        return k ? { x: k.x + k.w / 2, unit: k.w } : null;
    };
    let unit = 0;
    for (const n of [last, next])
        if (n)
            for (let pitch = n.pitch - 1; pitch <= n.pitch + 1; pitch++) {
                const g = sample(pitch);
                if (g)
                    unit = Math.max(unit, g.unit);
            }
    if (!unit)
        return null;
    const candidates: {
        x: number;
        weight: number;
        unit: number;
    }[] = [];
    const chosen = track.fingers.map((rows, i) => {
        const index = at(rows, time, (n) => n.start), prev = rows[index], future = rows[index + 1], held = prev && time < prev.end;
        const nextReady = future && future.start - time < 0.34 * rate;
        const c = held
            ? prev
            : nextReady
                ? future
                : prev && time - prev.end < 0.55 * rate
                    ? prev
                    : undefined;
        const anchor = (contact: Contact | undefined, weight: number) => {
            if (!contact || weight <= 0.0001)
                return;
            const g = sample(contact.pitch);
            if (g)
                candidates.push({ x: g.x - sign * offset[i] * unit, weight, unit });
        };
        // A key held long ago (usually sustained by the pedal) barely pulls the wrist: the
        // hand moves on to what it plays now.
        anchor(prev, prev
            ? held
                ? time - prev.start > 0.6 * rate ? 0.3 : 3
                : 3 * (1 - smooth((time - prev.end) / (0.22 * rate)))
            : 0);
        anchor(future, future ? 3 * smooth(1 - (future.start - time) / (0.34 * rate)) : 0);
        return { prev, future, held: !!held, c };
    });
    // Keep a faint resting anchor through rests; anticipation stays continuous.
    const restKey = sample(last.pitch);
    if (restKey)
        candidates.push({ x: restKey.x - sign * offset[last.finger - 1] * unit, weight: 0.06, unit });
    if (!candidates.length)
        return null;
    const weight = candidates.reduce((s, c) => s + c.weight, 0), center = candidates.reduce((s, c) => s + c.x * c.weight, 0) / weight;
    const vertical = height / 5.8, ci = at(track.crossings, time, (c) => c.start), cross = track.crossings[ci];
    const thumbUnder = !!cross && time < cross.end, crossPhase = thumbUnder
        ? Math.sin((Math.PI * (time - cross.start)) / (cross.end - cross.start))
        : 0;
    const world = (pitch: number, finger: number, z: number): V3 | null => {
        const g = sample(pitch);
        if (!g)
            return null;
        const black = [1, 3, 6, 8, 10].includes(pitch % 12);
        return {
            x: (g.x - center) / unit,
            y: (black ? 0.2 : depth[finger - 1]) * 5.8,
            z,
        };
    };
    const fingers = chosen.map(({ prev, future, held, c }, i) => {
        let target: V3 = { x: sign * offset[i], y: depth[i] * 5.8, z: 0.4 };
        let pressed = false, substitution = false;
        // Out of reach of this finger's place in the hand: the key is left to the pedal.
        const reachable = (goal: V3 | null) => !!goal && Math.abs(goal.x - sign * offset[i]) <= 3;
        if (c) {
            const goal = world(c.pitch, i + 1, held ? -0.04 : 0.35);
            if (goal && reachable(goal)) {
                target = goal;
                pressed = held;
                substitution = c.substitution;
                if (!held && future === c) {
                    const start = Math.max(prev?.end ?? -Infinity, c.start - 0.34 * rate), u = smooth((time - start) / Math.max(0.001, c.start - start)), from = prev ? world(prev.pitch, i + 1, 0.12) : null;
                    if (from)
                        target = {
                            x: blend(from.x, goal.x, u),
                            y: blend(from.y, goal.y, u),
                            z: 0.12 + Math.sin(Math.PI * u) * 0.65,
                        };
                    else
                        target.z = 0.3 * (1 - u);
                    if (c.substitution) {
                        target.z = Math.max(0.02, (c.start - time) / (0.12 * rate)) * 0.18;
                        substitution = true;
                    }
                }
                else if (!held && prev === c) {
                    const u = smooth((time - c.end) / (0.16 * rate));
                    target.z = u * 0.5;
                }
            }
        }
        const base = {
            x: sign * offset[i] + (i === 0 ? sign * crossPhase * 0.7 : 0),
            y: i === 0 ? 4.05 : 3.35 + Math.abs(i - 2) * 0.1,
            z: i === 0 && thumbUnder ? 0.25 : 0.65,
        };
        return {
            finger: i + 1,
            points: fingerChain(base, target, lengths[i]),
            pressed,
            substitution,
        };
    });
    return {
        side: track.side,
        wrist: { x: center, y: 5.4, z: 0.45 },
        fingers,
        thumbUnder,
        unit,
        vertical,
        baseline,
        alpha: Math.min(1, weight / 3),
        motion: next && sample(next.pitch) && sample(last.pitch)
            ? Math.abs(sample(next.pitch)!.x - sample(last.pitch)!.x) /
                Math.max(0.1, next.start - last.start)
            : 0,
    };
}
/** Deterministic depth ordering at overlap; the moving hand passes above its partner. */
export function arrangeHands(poses: HandPose[]) {
    if (poses.length !== 2)
        return poses;
    const [left, right] = poses, span = (left.unit + right.unit) * 1.7, gap = Math.abs(left.wrist.x - right.wrist.x), overlap = smooth(1 - gap / span);
    if (overlap <= 0)
        return poses;
    const upper = left.motion > right.motion ? left : right;
    for (const finger of upper.fingers)
        finger.points.forEach((p, i) => (p.z += overlap * 0.85 * (finger.pressed ? 1 - i / 3 : 1)));
    upper.wrist.z += overlap * 0.85;
    return poses.filter((p) => p !== upper).concat(upper);
}
