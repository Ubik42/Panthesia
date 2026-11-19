import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { largeScore } from "./fixtures/large-score";

const base = "http://127.0.0.1:32124";
const headers = { "X-Panthesia-Client": "web" };

test("曲库重开大谱面时可止音和取消，重试恢复原谱与演奏", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const command = async (data: unknown) => {
    const response = await request.post(`${base}/api/command`, { headers, data, timeout: 60_000 });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const title = "后台加载检查";
  const bytes = largeScore(title);
  const imported = await command({ type: "importScore", bytes: Array.from(bytes), name: `${title}.musicxml`, default_bpm: 120 });
  expect(imported.notes).toHaveLength(22_000);
  expect(imported.hasScore).toBe(true);
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "五指热身 · 从中央 C 开始" }).click();
  const original = await (await request.get(`${base}/api/song`)).json();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Panthesia", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: title }).click();
  const task = page.getByRole("region", { name: "后台任务", exact: true });
  await expect(task).toContainText("加载曲目与谱面");
  const start = Date.now();
  const panic = await request.post(`${base}/api/control`, { headers, data: { type: "panic" }, timeout: 2000 });
  expect(panic.ok()).toBeTruthy();
  const panicMilliseconds = Date.now() - start;
  const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  await page.screenshot({ path: join(artifacts, "load-background-running.png") });
  await task.getByRole("button", { name: "取消这次计算", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("后台任务已取消");
  expect((await (await request.get(`${base}/api/song`)).json()).contentId).toBe(original.contentId);
  // Hold only the completed HTTP reply to deterministically exercise a resize
  // during the caller's pending operation. Rust parsing/controls are real.
  await page.setViewportSize({ width: 1440, height: 960 });
  let responseReady!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { responseReady = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${base}/api/command`, async (route) => {
    if (route.request().postDataJSON()?.type !== "openRecent") return route.continue();
    const response = await route.fetch();
    responseReady();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("listitem").filter({ hasText: title }).click();
    await ready;
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole("button", { name: "Panthesia", exact: true }).click();
    await expect(page.locator(".library-panel")).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".library-panel")).toHaveCount(0);
  const restored = await (await request.get(`${base}/api/song`)).json();
  expect(restored.contentId).toBe(imported.contentId);
  expect(restored.notes).toHaveLength(22_000);
  expect(restored.hasScore).toBe(true);
  const score = await command({ type: "score" });
  expect(Buffer.from(score.bytes)).toEqual(bytes);
  const tasks = await (await request.post(`${base}/api/control`, { headers, data: { type: "tasks" } })).json();
  expect(tasks.some((task: { label: string; state: string }) => task.label === "加载曲目与谱面" && task.state === "cancelled")).toBeTruthy();
  expect(tasks.some((task: { label: string; state: string }) => task.label === "加载曲目与谱面" && task.state === "succeeded")).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(artifacts, "load-background-restored.png") });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator(".library-panel")).toBeVisible();
  const result = JSON.stringify({ panicMilliseconds, restoredNotes: restored.notes.length, contentId: restored.contentId, originalScoreBytes: bytes.length, cancelled: true, retried: true, resizedWhilePending: true, desktopPanelPreserved: true }, null, 2);
  await writeFile(join(artifacts, "load-background-result.json"), result);
  await test.info().attach("后台加载控制响应", { body: result, contentType: "application/json" });
});
