import { test, expect } from "@playwright/test";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";

test("容量上限内的历史回放支持取消、重试与独立止音", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const data = process.env.PANTHESIA_BASELINE_DATA_ROOT;
  if (!data || basename(data) !== "data-history-replay-background") throw Error("需要独立回放检查目录");
  const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  const headers = { "X-Panthesia-Client": "web" };
  const command = async (body: unknown) => {
    const response = await request.post("http://127.0.0.1:32124/api/command", { headers, data: body, timeout: 60_000 });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  };
  const state = async () => (await request.get("http://127.0.0.1:32124/api/state")).json();
  const title = "回放后台容量检查";
  const xml = `<score-partwise><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
  const song = await command({ type: "importScore", name: `${title}.musicxml`, bytes: Array.from(Buffer.from(xml)), default_bpm: 120 });
  await command({ type: "mode", value: "wait" }); await command({ type: "countIn", bars: 0 });
  await command({ type: "play" }); await expect.poll(async () => (await state()).required).toEqual([60]);
  await command({ type: "note", pitch: 60, active: true, velocity: 83 });
  await command({ type: "note", pitch: 60, active: false, velocity: 0 });
  await expect.poll(async () => (await state()).status).toBe("finished");
  const history = await command({ type: "historyQuery", query: title, limit: 10 });
  expect(history.entries).toHaveLength(1); const record = history.entries[0];
  // Expand only this run's constructed archive to its supported capacity.
  const directory = join(data, "performance-history");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  expect(files).toHaveLength(1);
  const archivePath = join(directory, files[0]);
  const archive = JSON.parse(await readFile(archivePath, "utf8"));
  const target = archive.references[0];
  archive.version = 1; archive.judgments = null; archive.measures = null; archive.referencePedals = [];
  archive.duration = 101;
  archive.references = Array.from({ length: 50_000 }, (_, i) => ({ ...target, at: i * .002, end: i * .002 + .001 }));
  archive.inputs = archive.references.flatMap((note: any) => [
    { at: note.at, judgedAt: note.at, songTime: target.songTime, bytes: [144, 60, 83], synthetic: false },
    { at: note.end, judgedAt: note.end, songTime: target.songTime, bytes: [128, 60, 0], synthetic: false },
  ]);
  const archived = JSON.stringify(archive); expect(Buffer.byteLength(archived)).toBeLessThan(32_000_000);
  await writeFile(archivePath, archived);
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "练习历史", exact: true }).click();
  await page.locator(".history-record").first().click();
  const pane = page.locator(".history-performance"); await pane.locator("summary").click();
  await pane.getByRole("button", { name: "查看这次演奏", exact: true }).click();
  const timeline = pane.getByLabel("参考与实际按键时间线");
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await expect(timeline).toHaveAttribute("data-reference-notes", "50000");
  await expect(timeline).toHaveAttribute("data-actual-notes", "50000");
  const geometry = await timeline.locator("path").evaluateAll((paths) => ({
    paths: paths.length, rectangles: paths.reduce((count, path) => count + (path.getAttribute("d")?.match(/M/g)?.length ?? 0), 0),
  }));
  expect(geometry.rectangles).toBe(100_000); expect(geometry.paths).toBe(2);
  await page.setViewportSize({ width: 1024, height: 768 });
  let releaseReply!: () => void;
  const held = new Promise<void>((resolve) => { releaseReply = resolve; });
  let preparationReady!: (value: any) => void;
  const prepared = new Promise<any>((resolve) => { preparationReady = resolve; });
  let replyDelivered!: () => void;
  const delivered = new Promise<void>((resolve) => { replyDelivered = resolve; });
  const holdStart = async (route: import("@playwright/test").Route) => {
    if (route.request().postDataJSON()?.type !== "startHistoryReplay") return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    preparationReady(await response.json()); await held; await route.fulfill({ response }); replyDelivered();
  };
  await page.route("**/api/command", holdStart);
  await pane.getByRole("button", { name: "回放声音", exact: true }).click();
  const ready = await prepared;
  expect(ready.id).toMatch(/^history-start-/);
  await expect(pane.getByRole("button", { name: "正在准备回放…", exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, "history-replay-preparing.png") });
  const stopped = page.waitForResponse((response) => response.url().endsWith("/api/control") &&
    response.request().postDataJSON()?.type === "stopFingerDemo" && response.request().postDataJSON()?.id === ready.id);
  await pane.getByRole("button", { name: "停止回放", exact: true }).click();
  expect((await stopped).ok()).toBeTruthy();
  expect((await command({ type: "fingerDemoState" })).id).toBeNull();
  releaseReply(); await delivered; await page.unroute("**/api/command", holdStart);
  await expect(pane.getByRole("button", { name: "回放声音", exact: true })).toBeEnabled();
  const before = await state();
  await pane.getByRole("button", { name: "回放声音", exact: true }).click();
  await expect(pane).toContainText("正在回放", { timeout: 30_000 });
  // Observe the UI clock beyond the backend's three-second lease without a
  // test-side audio-state heartbeat that could hide a blocked browser.
  await expect.poll(async () => Number((await pane.locator(".history-transport > span").innerText()).split("/")[0]), { timeout: 12_000 }).toBeGreaterThan(3.2);
  const jobs = await command({ type: "tasks" });
  expect(jobs.filter((job: any) => job.label === "准备历史声音回放").map((job: any) => job.state)).toEqual(["succeeded", "succeeded"]);
  const replay = await command({ type: "fingerDemoState" }); expect(replay.end).toBe(101);
  await pane.getByRole("button", { name: "暂停回放", exact: true }).click();
  await pane.getByLabel("历史回放定位秒数").fill("50");
  await pane.getByRole("button", { name: "定位回放", exact: true }).click();
  expect((await command({ type: "fingerDemoState" })).position).toBe(50);
  expect((await state()).position).toBe(before.position); expect((await state()).score).toEqual(before.score);
  await page.screenshot({ path: join(artifacts, "history-replay-ready.png") });
  const started = Date.now();
  expect((await request.post("http://127.0.0.1:32124/api/control", { headers, data: { type: "panic" }, timeout: 2000 })).ok()).toBeTruthy();
  const panicMilliseconds = Date.now() - started;
  expect((await command({ type: "fingerDemoState" })).id).toBeNull();
  expect((await command({ type: "historyQuery", query: title, limit: 10 })).entries).toEqual(history.entries);
  expect(await readFile(archivePath, "utf8")).toBe(archived);
  await writeFile(join(artifacts, "history-replay-background-result.json"), JSON.stringify({ inputs: archive.inputs.length, references: archive.references.length, bytes: Buffer.byteLength(archived), geometry, heartbeatObservedPastSeconds: 3.2, stoppedBeforeReply: true, retried: true, panicMilliseconds, historyUnchanged: true }, null, 2));
});
