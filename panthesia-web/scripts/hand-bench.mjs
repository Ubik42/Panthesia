// Virtual-hands benchmark: plays songs through the stage's own hand code (virtualHandPlan.ts,
// virtualHandPose.ts) at 60 frames per second, as the stage does, and measures accuracy,
// anatomy and smoothness. See docs/development/hand-benchmark.md for what each number means.
//
//   node scripts/hand-bench.mjs [--baseline <git ref>] [--songs a,b] [--seconds 90] [--refresh] [--out report.json]
//
// Songs are copied (manifest and MIDI files only) from the corpus into work/hand-bench/songs and
// opened there through the browser debug service (http://127.0.0.1:32124), which the script
// starts with PANTHESIA_DATA_ROOT under work/hand-bench when it is not running. Each opened song
// is cached as work/hand-bench/cache/<song>.json (notes with hand and finger, finger changes,
// sustain pedal); --refresh opens them again (after a change to the fingering).
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const WORK = join(ROOT, "work", "hand-bench");
const CORPUS = "D:/Music/MIDI/B站纯钢琴演奏视频转MIDI";
const SONGS = ["Love Song - 方大同", "你好吗 - 周杰伦", "爱爱爱 - 方大同", "Just The Two Of Us - Bill Withers", "花 - 藤井风", "皎洁的笑颜 - HOYO-MiX"];
const service = "http://127.0.0.1:32124";

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const baseline = option("--baseline");
const songs = option("--songs")?.split(",") ?? SONGS;
const seconds = Number(option("--seconds") ?? 90);
const out = option("--out");
const refresh = args.includes("--refresh");

// ---- Songs ---------------------------------------------------------------------------------
async function call(path, body) {
  const r = await fetch(service + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Panthesia-Client": "web" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || path);
  return data;
}
async function ensureService() {
  try {
    await fetch(service + "/api/session", { headers: { "X-Panthesia-Client": "web" } });
    return;
  } catch {}
  const exe = join(ROOT, "target", "debug", "panthesia-service.exe");
  await mkdir(join(WORK, "data"), { recursive: true });
  spawn(exe, [], { env: { ...process.env, PANTHESIA_DATA_ROOT: join(WORK, "data") }, detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      await fetch(service + "/api/session", { headers: { "X-Panthesia-Client": "web" } });
      return;
    } catch {}
  }
  throw Error("调试服务没有启动：先运行 cargo build -p panthesia-engine --bin panthesia-service");
}
async function loadSong(name) {
  const cache = join(WORK, "cache", `${name}.json`);
  if (!refresh)
    try {
      return JSON.parse(await readFile(cache, "utf8"));
    } catch {}
  await ensureService();
  const folder = join(WORK, "songs", name);
  await mkdir(folder, { recursive: true });
  for (const f of await readdir(join(CORPUS, name)))
    if (/\.(panthesia|midi?|musicxml)$/i.test(f)) await copyFile(join(CORPUS, name, f), join(folder, f));
  await call("/api/command", { type: "openFile", path: join(folder, `${name}.panthesia`).split("\\").join("/") });
  const { song } = await call("/api/session");
  const planned = await call("/api/command", { type: "planVirtualFingers", content_id: song.contentId });
  const byNote = new Map(planned.map((p) => [`${p.track}:${p.index}`, p]));
  const notes = song.notes.map((n) => {
    const p = byNote.get(`${n.track}:${n.index}`);
    return p ? { ...n, part: p.part === "left" ? "left" : "right", finger: n.finger ?? p.finger } : n;
  });
  const data = { title: song.title, notes, fingerActions: song.fingerActions ?? [], sustain: song.sustain ?? [] };
  await mkdir(join(WORK, "cache"), { recursive: true });
  await writeFile(cache, JSON.stringify(data));
  return data;
}

// ---- Hand code, current and baseline ---------------------------------------------------------
async function bundle(label, read) {
  const temp = await mkdtemp(join(tmpdir(), "hand-bench-"));
  const dir = join(temp, "practice");
  await mkdir(dir);
  for (const f of ["virtualHandPlan.ts", "virtualHandPose.ts"]) await writeFile(join(dir, f), read(f));
  const entry = join(temp, "entry.ts");
  await writeFile(entry, `export { planHands } from "./practice/virtualHandPlan";\nexport { handPose } from "./practice/virtualHandPose";\n`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: join(temp, "hands.mjs"), logLevel: "error", external: ["../../engine/*"] });
  const mod = await import(pathToFileURL(join(temp, "hands.mjs")).href);
  await rm(temp, { recursive: true, force: true });
  return { label, ...mod };
}
const practice = join(ROOT, "panthesia-web", "src", "features", "practice");
const variants = [];
if (baseline)
  variants.push(
    await bundle(baseline, (f) => execFileSync("git", ["show", `${baseline}:panthesia-web/src/features/practice/${f}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 })),
  );
variants.push(await bundle("当前", (f) => readFileSync(join(practice, f), "utf8")));

// ---- Keyboard ------------------------------------------------------------------------------
// Millimetres at one pixel per millimetre: white keys 23.5 mm, black 13.7 mm, keys 150 mm long.
const WHITE = 23.5,
  BLACK = 13.7,
  KEY_DEPTH = 150;
const black = (p) => [1, 3, 6, 8, 10].includes(p % 12);
const whiteIndex = (p) => Math.floor(p / 12) * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][p % 12];
const geometry = (p) => {
  if (p < 21 || p > 108) return undefined;
  const x = whiteIndex(p) * WHITE;
  return black(p) ? { x: x + WHITE - BLACK / 2, w: BLACK } : { x, w: WHITE };
};
const band = { top: 0, bottom: KEY_DEPTH };
/** On its key: inside the key's width (2 mm margin) and at most 3 mm above its surface. */
const onKey = (tip, pitch) => {
  const g = geometry(pitch);
  return g && tip.x >= g.x - 2 && tip.x <= g.x + g.w + 2 && tip.z <= (black(pitch) ? 10 : 0) + 3;
};

// ---- Measures ------------------------------------------------------------------------------
const FPS = 60;
const elevation = (a, b) => Math.atan2(b.z - a.z, Math.hypot(b.x - a.x, b.y - a.y));
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (norm(u) * norm(v) || 1))));
/** Joint angles of a pose (radians): per finger the knuckle's lift and sideways turn in the
 * hand's frame and the two finger joints; the thumb's metacarpal turn and lift and its joints. */
function joints(pose) {
  const c = Math.cos(pose.yaw),
    s = Math.sin(pose.yaw),
    m = pose.side === "right" ? 1 : -1;
  const out = [];
  for (const f of pose.fingers) {
    const [a, b, d, e] = f.points;
    const u = sub(b, a);
    const across = m * (c * u.x + s * u.y),
      ahead = -s * u.x + c * u.y;
    out.push(Math.atan2(across, ahead), elevation(a, b), angle(u, sub(d, b)), angle(sub(d, b), sub(e, d)));
  }
  return out;
}
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const sorted = Float64Array.from(xs).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

function measure(hands, song) {
  const plan = hands.planHands(song.notes, song.fingerActions, 1, song.sustain);
  const m = {
    notes: 0, strikeHit: 0, holdFrames: 0, holdPressed: 0, frames: 0,
    cross: 0, thumbBack: 0, fingerUp: 0, folded: 0, pressed: 0,
    wristSpeeds: [], wristAccels: [], wristJerks: [], yawRates: [], jolts: 0, tipAccels: [], tipJolts: 0,
    jointRates: [], jointAccels: [], jointSpikes: 0, ms: 0,
    thumbRates: [], thumbAccels: [], thumbSpikes: 0, thumbMcp: [], thumbFrames: 0,
  };
  for (const track of plan.hands) {
    const mirror = track.side === "right" ? 1 : -1;
    const memory = { time: Number.NaN, tips: [] };
    const end = Math.min(seconds, track.notes.reduce((x, n) => Math.max(x, n.end), 0));
    // Strike accuracy: each note looked at a little after it starts (playing straight through,
    // with memory, so the stage's own smoothing is included).
    const strikes = track.notes.filter((n) => n.start < end).map((n) => ({ n, t: n.start + Math.min(0.04, (n.end - n.start) / 2) }));
    strikes.sort((a, b) => a.t - b.t);
    let si = 0;
    let hist = [];
    for (let k = 0; k * (1 / FPS) <= end; k++) {
      const t = k / FPS;
      const t0 = performance.now();
      const pose = hands.handPose(track, t, 1, band, geometry, memory);
      m.ms += performance.now() - t0;
      // Strikes due before the next frame are checked on this frame's pose.
      while (si < strikes.length && strikes[si].t < t + 1 / FPS) {
        const { n } = strikes[si++];
        m.notes++;
        const f = pose?.fingers[n.finger - 1];
        if (f?.pressed && onKey(f.points.at(-1), n.pitch)) m.strikeHit++;
        else if (process.env.HAND_BENCH_DEBUG) {
          const why = !f ? "无手" : !f.pressed ? "未按" : "偏离";
          (m.missBy ??= {})[`${n.finger}${why}`] = (m.missBy[`${n.finger}${why}`] ?? 0) + 1;
          if (n.finger === 1 && f && (m.thumbShown = (m.thumbShown ?? 0) + 1) <= 12) {
            const g = geometry(n.pitch), tip = f.points.at(-1), c = f.points[0];
            const yc = Math.cos(pose.yaw), ys = Math.sin(pose.yaw), mir = track.side === "right" ? 1 : -1;
            const loc = (p) => ({ x: +(mir * (yc * (p.x - c.x) + ys * (p.y - c.y))).toFixed(0), y: +(-ys * (p.x - c.x) + yc * (p.y - c.y)).toFixed(0), z: +(p.z - c.z).toFixed(0) });
            console.log("拇指未中", track.side, t.toFixed(2), black(n.pitch) ? "黑" : "白", "横偏", (tip.x - (g.x + g.w / 2)).toFixed(1), "高", (tip.z - (black(n.pitch) ? 10 : 0)).toFixed(1), "指尖(拇根系)", JSON.stringify(loc(tip)), "按住", pose.fingers.map((q) => (q.pressed ? 1 : 0)).join(""));
          }
        }
      }
      if (!pose) {
        hist = [];
        continue;
      }
      m.frames++;
      if (process.env.HAND_BENCH_TRACE && Math.abs(t - Number(process.env.HAND_BENCH_TRACE)) < 0.13)
        console.log(track.side, t.toFixed(3), [pose.wrist.x, pose.wrist.y, pose.wrist.z].map((x) => x.toFixed(1)).join(" "), pose.yaw.toFixed(3), pose.fingers.map((f) => (f.pressed ? "P" : ".")).join(""));
      // Keys that must still be held (before the pedal or the release lets them go).
      for (let i = 0; i < 5; i++) {
        const held = track.fingers[i].find((c) => c.start <= t && t < (c.free ?? c.end));
        if (held) {
          m.holdFrames++;
          if (pose.fingers[i].pressed) m.holdPressed++;
        }
      }
      const c = Math.cos(pose.yaw),
        s = Math.sin(pose.yaw);
      const across = (p) => mirror * (c * (p.x - pose.wrist.x) + s * (p.y - pose.wrist.y));
      const tips = pose.fingers.map((f) => f.points.at(-1));
      // Neighbours out of order across the hand (the thumb only while it is not passing under).
      if (tips.some((q, i) => i > 0 && (i > 1 || !pose.thumbUnder) && across(q) - across(tips[i - 1]) < -1)) m.cross++;
      const th = pose.fingers[0].points;
      const e1 = elevation(th[0], th[1]),
        e2 = elevation(th[1], th[2]),
        e3 = elevation(th[2], th[3]);
      if (e2 - e1 > 0.175 || e3 - e2 > 0.175) m.thumbBack++;
      // The thumb's MCP extension (positive: the proximal phalanx above the metacarpal's line).
      m.thumbMcp.push(((e2 - e1) * 180) / Math.PI);
      let up = false;
      pose.fingers.forEach((f, i) => {
        if (i === 0) return;
        const [b, j] = f.points,
          q = f.points[3];
        const length = norm(sub(j, b)) + norm(sub(f.points[2], j)) + norm(sub(q, f.points[2]));
        if (f.pressed) {
          m.pressed++;
          if (Math.hypot(q.x - b.x, q.y - b.y) / length < 0.5) m.folded++;
        } else if (q.z > b.z + 2 || q.y > KEY_DEPTH * 0.98 || elevation(b, j) > 0.14) up = true;
      });
      if (up) m.fingerUp++;
      const frame = { wrist: pose.wrist, yaw: pose.yaw, tips, free: pose.fingers.map((f) => !f.pressed), joints: joints(pose) };
      hist.push(frame);
      if (hist.length > 4) hist.shift();
      const h = hist.length;
      if (h >= 2) {
        const [a, b] = [hist[h - 2], hist[h - 1]];
        m.wristSpeeds.push(Math.hypot(b.wrist.x - a.wrist.x, b.wrist.y - a.wrist.y, b.wrist.z - a.wrist.z) * FPS);
        m.yawRates.push(Math.abs(b.yaw - a.yaw) * FPS);
        b.joints.forEach((x, i) => m.jointRates.push(Math.abs(x - a.joints[i]) * FPS));
      }
      if (h >= 3) {
        const [a, b, d] = [hist[h - 3], hist[h - 2], hist[h - 1]];
        const acc = Math.hypot(d.wrist.x - 2 * b.wrist.x + a.wrist.x, d.wrist.y - 2 * b.wrist.y + a.wrist.y, d.wrist.z - 2 * b.wrist.z + a.wrist.z) * FPS * FPS;
        m.wristAccels.push(acc);
        if (acc > 20000) {
          m.jolts++;
          if (process.env.HAND_BENCH_DEBUG) (m.joltTimes ??= []).push(+t.toFixed(3));
        }
        let tipJolt = false,
          spike = false;
        d.tips.forEach((q, i) => {
          if (!d.free[i] || !b.free[i] || !a.free[i]) return;
          const x = Math.hypot(q.x - 2 * b.tips[i].x + a.tips[i].x, q.y - 2 * b.tips[i].y + a.tips[i].y, q.z - 2 * b.tips[i].z + a.tips[i].z) * FPS * FPS;
          m.tipAccels.push(x);
          if (x > 60000) tipJolt = true;
        });
        d.joints.forEach((x, i) => {
          const finger = i >> 2;
          if (!d.free[finger] || !b.free[finger] || !a.free[finger]) return;
          m.jointAccels.push(Math.abs(x - 2 * b.joints[i] + a.joints[i]) * FPS * FPS);
          if (Math.abs(x - b.joints[i]) * FPS > 20) {
            spike = true;
            if (process.env.HAND_BENCH_DEBUG) (m.spikeJoints ??= {})[i] = (m.spikeJoints[i] ?? 0) + 1;
          }
        });
        // The thumb, pressing or not (unless it starts or stops pressing within the three frames).
        if (d.free[0] === b.free[0] && b.free[0] === a.free[0]) {
          m.thumbFrames++;
          let thumbSpike = false;
          for (let i = 0; i < 4; i++) {
            const rate = Math.abs(d.joints[i] - b.joints[i]) * FPS;
            m.thumbRates.push(rate);
            m.thumbAccels.push(Math.abs(d.joints[i] - 2 * b.joints[i] + a.joints[i]) * FPS * FPS);
            if (rate > 10) thumbSpike = true;
          }
          if (thumbSpike) m.thumbSpikes++;
        }
        if (tipJolt) m.tipJolts++;
        if (spike) m.jointSpikes++;
      }
      if (h >= 4) {
        const [a, b, d, e] = hist;
        m.wristJerks.push(Math.hypot(e.wrist.x - 3 * d.wrist.x + 3 * b.wrist.x - a.wrist.x, e.wrist.y - 3 * d.wrist.y + 3 * b.wrist.y - a.wrist.y) * FPS ** 3);
      }
    }
  }
  return m;
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ROWS = [
  ["击键命中 %", (m) => (100 * m.strikeHit) / m.notes, 1, "up"],
  ["保持覆盖 %", (m) => (100 * m.holdPressed) / m.holdFrames, 1, "up"],
  ["手指交叉 ‰", (m) => (1000 * m.cross) / m.frames, 2, "down"],
  ["拇指反折 ‰", (m) => (1000 * m.thumbBack) / m.frames, 1, "down"],
  ["空闲手指上翘 ‰", (m) => (1000 * m.fingerUp) / m.frames, 1, "down"],
  ["按键手指蜷缩 ‰", (m) => (1000 * m.folded) / m.pressed, 1, "down"],
  ["手腕速度 p99 mm/s", (m) => quantile(m.wristSpeeds, 0.99), 0, "down"],
  ["手腕加速度 p99 mm/s²", (m) => quantile(m.wristAccels, 0.99), 0, "down"],
  ["手腕急动度 均值 m/s³", (m) => mean(m.wristJerks) / 1000, 1, "down"],
  ["手腕突变 ‰（>20 m/s²）", (m) => (1000 * m.jolts) / m.frames, 2, "down"],
  ["手掌转速 p99 rad/s", (m) => quantile(m.yawRates, 0.99), 2, "down"],
  ["空闲指尖加速度 均值 mm/s²", (m) => mean(m.tipAccels), 0, "down"],
  ["空闲指尖突变 ‰（>60 m/s²）", (m) => (1000 * m.tipJolts) / m.frames, 1, "down"],
  ["关节角速度 p99 rad/s", (m) => quantile(m.jointRates, 0.99), 2, "down"],
  ["关节角加速度 均值 rad/s²", (m) => mean(m.jointAccels), 0, "down"],
  ["关节突变 ‰（>20 rad/s）", (m) => (1000 * m.jointSpikes) / m.frames, 1, "down"],
  ["拇指角速度 p99 rad/s", (m) => quantile(m.thumbRates, 0.99), 2, "down"],
  ["拇指角加速度 均值 rad/s²", (m) => mean(m.thumbAccels), 0, "down"],
  ["拇指突变 ‰（>10 rad/s）", (m) => (1000 * m.thumbSpikes) / m.thumbFrames, 1, "down"],
  ["拇指 MCP 过伸 p99 °", (m) => quantile(m.thumbMcp, 0.99), 1, "down"],
  ["每帧耗时 ms", (m) => m.ms / m.frames, 3, "down"],
];

// ---- Run -----------------------------------------------------------------------------------
const merged = variants.map(() => null);
const report = { seconds, songs: {} };
const fmt = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : "—");
for (const name of songs) {
  const song = await loadSong(name);
  report.songs[name] = {};
  variants.forEach((v, i) => {
    const m = measure(v, song);
    report.songs[name][v.label] = Object.fromEntries(ROWS.map(([label, f]) => [label, f(m)]));
    if (!merged[i]) merged[i] = m;
    else for (const [k, x] of Object.entries(m)) merged[i][k] = Array.isArray(x) ? merged[i][k].concat(x) : merged[i][k] + x;
  });
  if (process.env.HAND_BENCH_DEBUG) variants.forEach((v) => {
    const m = measure(v, song);
    const times = m.joltTimes ?? [];
    const phase = times.map((t) => t % 4);
    console.log(v.label, "未命中（手指+原因）", JSON.stringify(m.missBy));
    console.log(v.label, "关节突变分布（手指×[侧摆,抬起,近节,远节]）", JSON.stringify(m.spikeJoints));
    console.log(v.label, "突变帧", times.length, "块边界±0.05s", phase.filter((p) => p < 0.05 || p > 3.95).length, times.slice(0, 30).join(" "));
  });
  console.log(`${name}：${variants.map((v) => `${v.label} 击键 ${fmt(report.songs[name][v.label]["击键命中 %"], 1)}%`).join("，")}`);
}
console.log(`\n合计（${songs.length} 首，每首前 ${seconds} 秒，60 帧/秒）`);
const head = ["指标".padEnd(26), ...variants.map((v) => v.label.padStart(12)), variants.length > 1 ? "  变化" : ""].join("");
console.log(head);
report.total = {};
for (const [label, f, d, better] of ROWS) {
  const xs = merged.map((m) => f(m));
  report.total[label] = Object.fromEntries(variants.map((v, i) => [v.label, xs[i]]));
  let change = "";
  if (xs.length > 1) {
    const [a, b] = [xs[0], xs.at(-1)];
    const pct = a ? ((b - a) / Math.abs(a)) * 100 : 0;
    const good = better === "up" ? b >= a : b <= a;
    change = `  ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% ${Math.abs(pct) < 2 ? "" : good ? "✓" : "✗"}`;
  }
  console.log([label.padEnd(26), ...xs.map((x) => fmt(x, d).padStart(12)), change].join(""));
}
if (out) await writeFile(out, JSON.stringify(report, null, 1));
