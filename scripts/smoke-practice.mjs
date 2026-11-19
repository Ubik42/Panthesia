import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = join(root, "panthesia-web");
const requested = process.argv.filter((value) => value.startsWith("--spec=")).map((value) => value.slice(7));
for (const name of requested) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw Error("检查名称无效，请使用 tests 内的用例名，不含 .spec.ts");
  await access(join(web, "tests", `${name}.spec.ts`));
}
const work = join(root, "work", "practice-baseline");
await mkdir(work, { recursive: true });
const run = await mkdtemp(join(work, "run-"));
const children = new Set();
const logs = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function indexLibraryFixture() {
  const directory = join(run, "index-library");
  await mkdir(directory);
  const events = Buffer.alloc(5000 * 8 + 4);
  for (let i = 0; i < 5000; i++) events.set([0, 144, 60 + i % 12, 80, 1, 128, 60 + i % 12, 0], i * 8);
  events.set([0, 255, 47, 0], 5000 * 8);
  const size = Buffer.alloc(4); size.writeUInt32BE(events.length);
  const midi = Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224]), Buffer.from("MTrk"), size, events]);
  for (let i = 0; i < 512; i += 16) await Promise.all(Array.from({ length: 16 }, (_, offset) => writeFile(join(directory, `${i + offset}.mid`), midi)));
  await writeFile(join(directory, "catalog.csv"), "Title,Composer,Source,Category,License,SourceUrl,LocalPath\n" +
    Array.from({ length: 512 }, (_, i) => `索引测试 ${i},,索引测试,测试资料,本地生成,,${i}.mid\n`).join(""));
  return directory;
}

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
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    pause(5000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}
async function ready(child, url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`检查服务提前退出，日志：${run}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Wait only for the service owned by this run. */ }
    await pause(150);
  }
  throw Error(`检查服务启动超时，日志：${run}`);
}
async function check(phase) {
  const child = spawn(process.execPath, [
    join(web, "node_modules/@playwright/test/cli.js"), "test", "daily-baseline.spec.ts",
    "--grep", phase, "--output", join(run, `browser-${phase}`),
  ], {
    cwd: web, windowsHide: true, stdio: "inherit",
    env: { ...process.env, PANTHESIA_BASELINE: "1", PANTHESIA_BASELINE_ARTIFACTS: run, PANTHESIA_ROUND_RECOVERY: process.argv.includes("--round-recovery") ? "1" : "" },
  });
  children.add(child);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  children.delete(child);
  if (code !== 0) throw Error(`日常练习检查失败：${phase}，结果保留在 ${run}`);
}

async function stageRoundRecovery() {
  const child = launch("round-recovery-fixture", "python", [join(root, "scripts/stage-round-recovery.py"), run]);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  children.delete(child);
  if (code !== 0) throw Error(`轮次恢复样本准备失败：${run}`);
}
async function verifyRoundRecovery() {
  const fixture = JSON.parse(await readFile(join(run, "round-recovery-fixture.json"), "utf8"));
  if (!/^[a-f0-9]{64}\.json$/.test(fixture.archive)) throw Error("恢复检查回放位置无效");
  const history = await readFile(join(run, "data/web-practice-history.ron"));
  if (!history.equals(await readFile(join(run, "round-history-after.ron")))) throw Error("新进程未恢复完整历史及计时账本");
  const archive = await readFile(join(run, "data/performance-history", fixture.archive));
  if (!archive.equals(await readFile(join(run, "round-archive-after.json")))) throw Error("恢复改变了已写入的演奏回放");
  const response = await fetch("http://127.0.0.1:32124/api/command", { method: "POST", headers: { "Content-Type": "application/json", "X-Panthesia-Client": "web" }, body: JSON.stringify({type:"historyQuery",limit:10}) });
  if (!response.ok) throw Error("恢复后的历史无法读取");
  const records = (await response.json()).entries;
  if (records.length !== 2 || !records.some(r=>r.id===fixture.pendingId) || !records.some(r=>fixture.beforeIds.includes(r.id))) throw Error("恢复后的轮次缺失或重复");
  try { await access(join(run,"data/round-save-pending/intent.json")); throw Error("恢复后仍有待处理提交"); }
  catch(error) { if (error.code !== "ENOENT") throw error; }
  await writeFile(join(run,"round-recovery-result.json"),JSON.stringify({status:"pass",actualServiceRestart:true,simulatedInterruption:fixture.interruption,historyAndLedgerRestored:true,archiveBytesPreserved:true,restoredRounds:records.length,duplicateRounds:0},null,2));
}

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  for (const child of children) child.kill();
});

try {
  await freePort(5173);
  await freePort(32124);
  const library = join(run, "library");
  await mkdir(library);
  await writeFile(join(library, "catalog.csv"), "Title,Composer,Source,Category,License,SourceUrl,LocalPath\n");
  const env = { PANTHESIA_DATA_ROOT: join(run, "data"), PANTHESIA_LIBRARY_ROOT: library,
    PANTHESIA_SERVICE_ADDR: "127.0.0.1:32124" };
  const executable = join(root, "target/debug", process.platform === "win32" ? "panthesia-service.exe" : "panthesia-service");
  let service = launch("engine-first", executable, ["--silent"], env);
  const vite = launch("web", process.execPath, [join(web, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  await Promise.all([ready(service, "http://127.0.0.1:32124/api/state"), ready(vite, "http://127.0.0.1:5173")]);
  await check("保存日常练习");
  await stop(service);
  if (process.argv.includes("--round-recovery")) await stageRoundRecovery();
  if (interrupted) throw Error("检查已中止");
  service = launch("engine-restarted", executable, ["--silent"], env);
  await ready(service, "http://127.0.0.1:32124/api/state");
  if (process.argv.includes("--round-recovery")) await verifyRoundRecovery();
  await check("重启恢复日常练习");
  const specs = [...new Set([
    ...(process.argv.includes("--expression") ? ["song-expression-goal", "note-expression-goal", "note-pedal-goal", "velocity-next-practice"] : []),
    ...(process.argv.includes("--workspaces") ? ["workspaces", "session-sync", "history-notes", "practice-time", "history-background"] : []),
    ...(process.argv.includes("--background") ? ["background-control", "finger-review", "finger-pair"] : []),
    ...(process.argv.includes("--playback") ? ["playback-store", "playback-rendering", "shortcuts", "navigation-performance"] : []),
    ...(process.argv.includes("--imports") ? ["import-background", "load-background", "import-index", "batch-score-import", "score-sources", "package"] : []),
    ...(process.argv.includes("--loads") && !process.argv.includes("--imports") ? ["load-background"] : []),
    ...(process.argv.includes("--history") ? ["history-actions-background", "history-paper-focus", "history-finger-review", "history-score-review", "history-score-focus", "history-repractice", "history-performance"] : []),
    ...requested,
  ])];
  if (specs.length) {
    for (const spec of specs) {
      await stop(service);
      if (interrupted) throw Error("检查已中止");
      // Several fixtures intentionally generate identical MIDI content. Give
      // each spec its own store so saved per-song goals cannot leak across tests.
      service = launch(`engine-${spec}`, executable, ["--silent"], {
        ...env, PANTHESIA_DATA_ROOT: join(run, `data-${spec}`),
        ...(spec === "import-index" ? { PANTHESIA_LIBRARY_ROOT: await indexLibraryFixture() } : {}),
      });
      await ready(service, "http://127.0.0.1:32124/api/state");
      const child = spawn(process.execPath, [
        join(web, "node_modules/@playwright/test/cli.js"), "test", `${spec}.spec.ts`,
        "--output", join(run, `browser-${spec}`),
      ], { cwd: web, windowsHide: true, stdio: "inherit", env: { ...process.env, PANTHESIA_BASELINE_ARTIFACTS: run, PANTHESIA_BASELINE_DATA_ROOT: join(run, `data-${spec}`), PANTHESIA_INDEX_FIXTURE: spec === "import-index" ? "1" : "" } });
      children.add(child);
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject); child.once("exit", resolve);
      });
      children.delete(child);
      if (code !== 0) throw Error(`工作流程检查失败：${spec}，结果：${run}`);
    }
  }
  console.log(`日常练习和真实引擎重启检查通过。数据与日志：${run}`);
} finally {
  await Promise.all([...children].map(stop));
  for (const log of logs) log.end();
}
