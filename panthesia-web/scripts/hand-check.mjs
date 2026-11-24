// Virtual-hands check: plays every note of a set of songs through the stage's own hand code
// (virtualHandPlan.ts, virtualHandPose.ts) and counts what a viewer would see as wrong.
//
//   node scripts/hand-check.mjs <folder of .mid copies> [--out report.json]
//
// Songs are opened through the browser debug service (http://127.0.0.1:32124, started with a
// PANTHESIA_DATA_ROOT under work/), which writes draft hands and fingering beside each file, so
// pass copies, never the corpus itself. Opened songs are cached as <name>.hands.json.
import { build } from "esbuild";
import { readdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const service = "http://127.0.0.1:32124";
const args = process.argv.slice(2);
const folder = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (!folder) throw Error("用法：node scripts/hand-check.mjs <歌曲副本文件夹> [--out 报告.json]");

async function call(path, body) {
  const r = await fetch(service + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Panthesia-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || path);
  return data;
}
async function exportSong(file) {
  const cache = file.replace(/\.midi?$/i, ".hands.json");
  try { return JSON.parse(await readFile(cache, "utf8")); } catch {}
  await call("/api/command", { type: "openFile", path: file });
  const { song } = await call("/api/session");
  const planned = await call("/api/command", { type: "planVirtualFingers", content_id: song.contentId });
  const byNote = new Map(planned.map((p) => [`${p.track}:${p.index}`, p]));
  const notes = song.notes.map((n) => {
    const p = byNote.get(`${n.track}:${n.index}`);
    return p ? { ...n, part: p.part === "left" ? "left" : "right", finger: n.finger ?? p.finger } : n;
  });
  const data = { title: song.title, notes, fingerActions: song.fingerActions ?? [] };
  await writeFile(cache, JSON.stringify(data));
  return data;
}

// Bundle the stage's hand code for Node.
const temp = await mkdtemp(join(tmpdir(), "hand-check-"));
const entry = join(temp, "entry.ts");
const src = resolve("src/features/practice").split("\\").join("/");
await writeFile(entry, `export { planHands } from "${src}/virtualHandPlan";\nexport { handPose, arrangeHands } from "${src}/virtualHandPose";\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(temp, "hands.mjs"), logLevel: "error" });
const { planHands, handPose, arrangeHands } = await import(pathToFileURL(join(temp, "hands.mjs")).href);
await rm(temp, { recursive: true, force: true });

// Keyboard in millimetres at one pixel per millimetre: white keys 23.5 mm, black 13.7 mm.
const WHITE = 23.5, BLACK = 13.7, KEY_DEPTH = 150;
const black = (p) => [1, 3, 6, 8, 10].includes(p % 12);
const whiteIndex = (p) => Math.floor(p / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][p % 12];
const geometry = (p) => {
  if (p < 21 || p > 108) return undefined;
  const x = whiteIndex(p) * WHITE;
  return black(p) ? { x: x + WHITE - BLACK / 2, w: BLACK } : { x, w: WHITE };
};
const band = { top: 0, bottom: KEY_DEPTH };
// A tip is on its key when it is inside the key's width (a 2 mm margin) and at most 3 mm above.
const onKey = (tip, pitch) => {
  const g = geometry(pitch);
  return g && tip.x >= g.x - 2 && tip.x <= g.x + g.w + 2 && tip.z <= (black(pitch) ? 10 : 0) + 3;
};

const report = [];
const misses = [];
const examples = [];
const solverFinger = [0, 0, 0, 0, 0];
const solverAxis = { x: 0, z: 0 };
const solverShow = [];
const solverOrder = { ok: 0, reversed: 0, sameFinger: 0 };
const crossExamples = [];
const crossCause = { bothPressed: 0, onePressed: 0, bothFree: 0 };
const cause = { chord: 0, span: 0, long: 0, solver: 0 };
const speedCause = { pressedChange: 0, travel: 0, rest: 0, wrist: 0, yaw: 0 };
const totals = { notes: 0, unpressed: 0, offKey: 0, crossed: 0, crowded: 0, overspeed: 0, missing: 0 };
for (const name of (await readdir(folder)).filter((f) => /\.midi?$/i.test(f)).sort()) {
  const song = await exportSong(join(folder, name));
  const plan = planHands(song.notes, song.fingerActions, 1);
  const stat = { name, notes: 0, unpressed: 0, offKey: 0, crossed: 0, crowded: 0, overspeed: 0, missing: plan.missing };
  for (const track of plan.hands) {
    const mirror = track.side === "right" ? 1 : -1;
    // Each note is looked at a little after it starts (or halfway through a short note).
    for (const c of track.notes) {
      const t = c.start + Math.min(0.04, (c.end - c.start) / 2);
      const pose = handPose(track, t, 1, band, geometry);
      stat.notes++;
      const finger = pose?.fingers[c.finger - 1];
      if (!finger || !finger.pressed) { stat.unpressed++; continue; }
      const tip = finger.points.at(-1);
      if (!onKey(tip, c.pitch)) {
        stat.offKey++;
        // Why: keys held together wider than a hand, a key held long (pedal), or the solver.
        const held = track.notes.filter((n) => n.start <= t && n.end > t);
        const xs = held.map((n) => geometry(n.pitch).x);
        const spread = Math.max(...xs) - Math.min(...xs);
        const chord = held.filter((n) => Math.abs(n.start - c.start) < 0.05).map((n) => geometry(n.pitch).x);
        const chordSpread = Math.max(...chord) - Math.min(...chord);
        cause[chordSpread > 200 ? "chord" : spread > 200 ? "span" : t - c.start > 0.6 ? "long" : "solver"]++;
        if (chordSpread <= 200 && spread <= 200) {
          solverFinger[c.finger - 1]++;
          // Held fingers whose order contradicts pitch order (thumb crossings aside).
          const sorted = [...held].sort((a, b) => a.pitch - b.pitch).map((n) => n.finger).filter((f) => f > 1);
          const ordered = sorted.every((f, k) => k === 0 || (track.side === "right" ? f > sorted[k - 1] : f < sorted[k - 1]));
          const dup = new Set(held.map((n) => n.finger)).size < held.length;
          solverOrder[dup ? "sameFinger" : ordered ? "ok" : "reversed"]++;
          if (process.env.HAND_DEBUG3 && !dup && ordered && solverShow.length < 8) solverShow.push({ name: name.slice(0, 10), side: track.side, t: +t.toFixed(3), finger: c.finger, pitch: c.pitch, miss: +(Math.abs(tip.x - (geometry(c.pitch).x + geometry(c.pitch).w / 2)) - geometry(c.pitch).w / 2).toFixed(1), held: held.map((n) => `${n.pitch}:${n.finger}@${(t - n.start).toFixed(2)}`).join(" "), near: track.notes.filter((n) => Math.abs(n.start - c.start) < 0.4).map((n) => `${n.pitch}:${n.finger}@${(n.start - c.start).toFixed(2)}`).join(" ") });
          const g = geometry(c.pitch);
          solverAxis[Math.abs(tip.x - (g.x + g.w / 2)) > g.w / 2 + 2 ? "x" : "z"]++;
          if (Math.abs(tip.x - (g.x + g.w / 2)) <= g.w / 2 + 2) solverAxis[black(c.pitch) ? "zBlack" : "zWhite"] = (solverAxis[black(c.pitch) ? "zBlack" : "zWhite"] ?? 0) + 1;
        }
        const g = geometry(c.pitch);
        misses.push(Math.max(Math.abs(tip.x - (g.x + g.w / 2)) - g.w / 2, tip.z - (black(c.pitch) ? 10 : 0)));
      }
    }
    // Every 1/60 s while the hand is shown: finger order, spacing and tip speed.
    const end = track.notes.reduce((m, n) => Math.max(m, n.end), 0);
    let previous = null,
      previousPressed = [],
      previousWrist = null,
      previousYaw = 0;
    for (let t = 0; t <= end; t += 1 / 60) {
      const pose = handPose(track, t, 1, band, geometry);
      if (!pose) { previous = null; previousWrist = null; continue; }
      const tips = pose.fingers.map((f) => f.points.at(-1));
      // Fingers 2-5 keep their order across the keys (the thumb may pass under).
      for (let i = 1; i < 4; i++) {
        // Across the hand (its own x axis, turned with the hand).
        const across = (p) => mirror * (Math.cos(pose.yaw) * (p.x - pose.wrist.x) + Math.sin(pose.yaw) * (p.y - pose.wrist.y));
        const gap = across(tips[i + 1]) - across(tips[i]);
        if (gap < -2) {
          stat.crossed++;
          const a = pose.fingers[i].pressed, b = pose.fingers[i + 1].pressed;
          crossCause[a && b ? "bothPressed" : a || b ? "onePressed" : "bothFree"]++;
          if (process.env.HAND_DEBUG2 && !a && !b && crossExamples.length < 4) crossExamples.push({ name, t: t.toFixed(3), side: track.side, i: i + 1, yaw: pose.yaw, wrist: pose.wrist, tips: tips.map((p) => [p.x, p.y, p.z]), bases: pose.fingers.map((f) => [f.points[0].x, f.points[0].y]) });
        }
        else if (gap < 8) stat.crowded++;
      }
      if (previous)
        for (let i = 0; i < 5; i++) {
          const d = Math.hypot(tips[i].x - previous[i].x, tips[i].y - previous[i].y, tips[i].z - previous[i].z);
          if (d * 60 > 3000) {
            stat.overspeed++;
            speedCause[pose.fingers[i].pressed !== previousPressed[i] ? "pressedChange" : pose.fingers[i].pressed ? "travel" : "rest"]++;
            if (process.env.HAND_DEBUG && examples.length < 12 && pose.fingers[i].pressed !== previousPressed[i]) examples.push({ song: name.slice(0, 12), side: track.side, t: t.toFixed(3), finger: i + 1, jump: d.toFixed(1), now: pose.fingers[i].pressed, from: previous[i], to: tips[i], wrist: pose.wrist });
          }
        }
      if (previousWrist && Math.hypot(pose.wrist.x - previousWrist.x, pose.wrist.y - previousWrist.y) * 60 > 3000) speedCause.wrist++;
      if (previousWrist && Math.abs(pose.yaw - previousYaw) * 60 > 6) speedCause.yaw++;
      previousWrist = pose.wrist;
      previousYaw = pose.yaw;
      previous = tips;
      previousPressed = pose.fingers.map((f) => f.pressed);
    }
  }
  for (const k of Object.keys(totals)) totals[k] += stat[k];
  report.push(stat);
  const pct = (n) => ((100 * n) / Math.max(1, stat.notes)).toFixed(1).padStart(5);
  console.log(`${name.slice(0, 34).padEnd(34)} 音 ${String(stat.notes).padStart(5)}  未按 ${pct(stat.unpressed)}%  不在键上 ${pct(stat.offKey)}%  交叉帧 ${String(stat.crossed).padStart(5)}  过近帧 ${String(stat.crowded).padStart(5)}  超速帧 ${String(stat.overspeed).padStart(4)}`);
}
const pct = (n) => ((100 * n) / Math.max(1, totals.notes)).toFixed(2);
console.log(`合计 ${totals.notes} 音：未按 ${pct(totals.unpressed)}%，不在键上 ${pct(totals.offKey)}%，交叉帧 ${totals.crossed}，过近帧 ${totals.crowded}，超速帧 ${totals.overspeed}，无指法 ${totals.missing}`);
misses.sort((a, b) => a - b);
if (crossExamples.length) console.log(JSON.stringify(crossExamples, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
if (examples.length) console.log(JSON.stringify(examples, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
for (const x of solverShow) console.log(JSON.stringify(x));
console.log("求解类未命中：手指", solverFinger, "方向", solverAxis, "按住的指序", solverOrder);
console.log("不在键上的归因：", cause, "超速帧的归因：", speedCause, "交叉帧的归因：", crossCause);
if (misses.length) console.log(`未命中距离（毫米，超出琴键边缘或高于键面）：中位 ${misses[misses.length >> 1].toFixed(1)}，90% ${misses[Math.floor(misses.length * 0.9)].toFixed(1)}`);
if (out) await writeFile(out, JSON.stringify({ totals, songs: report }, null, 1));
