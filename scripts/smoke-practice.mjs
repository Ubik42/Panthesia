// Run browser specs against the real engine service: one fresh data root per spec.
// Usage: node scripts/smoke-practice.mjs --spec=<name> [--spec=<name> …]
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir, mkdtemp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = join(root, "panthesia-web");
const specs = process.argv.filter((value) => value.startsWith("--spec=")).map((value) => value.slice(7));
for (const name of specs) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error("检查名称无效，请使用 tests 内的用例名，不含 .spec.ts");
  await access(join(web, "tests", `${name}.spec.ts`));
}
const work = join(root, "work", "practice-baseline");
await mkdir(work, { recursive: true });
const run = await mkdtemp(join(work, "run-"));
const children = new Set();
const logs = [];

async function freePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(Error(`端口 ${port} 已被使用，请先结束现有开发服务后再运行检查`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
function launch(name, executable, args, env = {}) {
  const log = createWriteStream(join(run, `${name}.log`));
  logs.push(log);
  const child = spawn(executable, args, {
    cwd: web, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.on("error", (error) => { child.launchError = error; });
  child.on("exit", () => children.delete(child));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}
async function ready(child, url) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null) throw Error(`服务提前退出，日志：${run}`);
    try { if ((await fetch(url)).ok) return; } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error(`服务未在 60 秒内就绪：${url}`);
}

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  for (const child of children) child.kill();
});

try {
  await freePort(5173);
  await freePort(32124);
  const executable = join(root, "target/debug", process.platform === "win32" ? "panthesia-service.exe" : "panthesia-service");
  const vite = launch("web", process.execPath, [join(web, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  await ready(vite, "http://127.0.0.1:5173");
  for (const spec of specs) {
    if (interrupted) throw Error("检查已中止");
    const data = join(run, `data-${spec}`);
    const service = launch(`engine-${spec}`, executable, ["--silent"], { PANTHESIA_DATA_ROOT: data, PANTHESIA_SERVICE_ADDR: "127.0.0.1:32124" });
    await ready(service, "http://127.0.0.1:32124/api/state");
    const child = spawn(process.execPath, [
      join(web, "node_modules/@playwright/test/cli.js"), "test", `${spec}.spec.ts`, "--output", join(run, `browser-${spec}`),
    ], { cwd: web, windowsHide: true, stdio: "inherit", env: { ...process.env, PANTHESIA_BASELINE_ARTIFACTS: run, PANTHESIA_BASELINE_DATA_ROOT: data } });
    children.add(child);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    children.delete(child);
    await stop(service);
    if (code !== 0) throw Error(`检查失败：${spec}，结果：${run}`);
  }
  console.log(`检查通过：${specs.join("、") || "（未指定用例）"}。数据与日志：${run}`);
} finally {
  await Promise.all([...children].map(stop));
  for (const log of logs) log.end();
}
