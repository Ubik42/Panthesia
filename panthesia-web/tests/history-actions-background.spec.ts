import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { largeScore } from "./fixtures/large-score";
const base = "http://127.0.0.1:32124";
const headers = { "X-Panthesia-Client": "web" };

test("大谱面的历史问题重练和谱面批阅均可取消、止音并重试", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const command = async (data: unknown) => {
    const response = await request.post(`${base}/api/command`, { headers, data, timeout: 60_000 });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  };
  const state = async () => (await request.get(`${base}/api/state`)).json();
  const title = "历史问题后台检查";
  const bytes = largeScore(title);
  const imported = await command({ type: "importScore", bytes: Array.from(bytes), name: `${title}.musicxml`, default_bpm: 120 });
  await command({ type: "countIn", bars: 0 });
  await command({ type: "mode", value: "wait" });
  await command({ type: "speed", value: 0.75 });
  await command({ type: "measureLoop", start: 1, end: 1, enabled: true });
  await command({ type: "play" });
  for (const pitch of [48, 50, 52, 53]) {
    await expect.poll(async () => (await state()).required).toEqual([pitch]);
    await command({ type: "note", pitch, active: true, velocity: 90 });
    await command({ type: "note", pitch, active: false, velocity: 0 });
  }
  await expect.poll(async () => (await state()).repetitions).toBe(1);
  await command({ type: "pause" });
  const saved = await command({ type: "historyQuery", query: title, limit: 20 });
  expect(saved.entries).toHaveLength(1); expect(saved.entries[0].score.matched_notes).toBe(4);
  const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  const results: unknown[] = [];
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  for (const action of [
    { type: "historyPracticeRange", button: "重练演奏第 1 小节参考音 1", label: "准备历史问题重练", file: "history-problem" },
    { type: "historyScoreReview", button: "整轮谱面批阅", label: "准备历史谱面批阅", file: "history-review" },
  ]) {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("listitem").filter({ hasText: "五指热身 · 从中央 C 开始" }).click();
    await expect(page.getByRole("heading", { name: "五指热身 · 从中央 C 开始", exact: true })).toBeVisible();
    const original = await (await request.get(`${base}/api/song`)).json();
    await page.getByRole("button", { name: "练习历史", exact: true }).click();
    const history = page.getByRole("region", { name: "练习历史", exact: true });
    await history.locator(".history-record").filter({ hasText: title }).click();
    const performance = history.locator(".history-performance");
    await performance.locator("summary").click();
    await performance.getByRole("button", { name: "查看这次演奏", exact: true }).click();
    await expect(performance.locator("tbody tr")).toHaveCount(4);
    await performance.getByLabel("重练前置小节").selectOption("0");
    await performance.getByLabel("重练后置小节").selectOption("0");
    await page.setViewportSize({ width: 1024, height: 768 });
    await performance.getByRole("button", { name: action.button, exact: true }).click();
    const task = history.getByRole("region", { name: "后台任务", exact: true });
    await expect(task).toContainText(action.label);
    const start = Date.now();
    const panic = await request.post(`${base}/api/control`, { headers, data: { type: "panic" }, timeout: 2000 });
    expect(panic.ok()).toBeTruthy(); const panicMilliseconds = Date.now() - start;
    await page.screenshot({ path: join(artifacts, `${action.file}-running.png`) });
    await task.getByRole("button", { name: "取消这次计算", exact: true }).click();
    await expect(history.getByRole("alert")).toContainText("后台任务已取消");
    expect((await (await request.get(`${base}/api/song`)).json()).contentId).toBe(original.contentId);
    const reply = page.waitForResponse((response) => response.url() === `${base}/api/command` && response.request().postDataJSON()?.type === action.type);
    await performance.getByRole("button", { name: action.button, exact: true }).click();
    const response = await reply; expect(response.ok(), await response.text()).toBeTruthy(); const result = await response.json();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(result.contentId).toBe(imported.contentId); expect(result.notes).toHaveLength(22_000);
    let renderMilliseconds: number | null = null;
    if (action.type === "historyPracticeRange") {
      expect(result.practiceRange).toMatchObject({ start: 1, end: 1, measure: 1, reference: 0 });
      expect(result.paperFocus).toMatchObject({ historyId: saved.entries[0].id, reference: 0, pitch: 48 });
      expect(result.paperFocus.index).toBe(result.scoreFocus.index);
    } else {
      await expect(page.getByLabel("整轮历史谱面批阅")).toBeVisible();
      expect(result.scoreReview.exact).toBe(true); expect(result.scoreReview.notes).toHaveLength(4);
      expect(result.scoreReview.notes.every((note: { index: number | null }) => Number.isSafeInteger(note.index))).toBe(true);
      expect(result.scoreReview.historyId).toBe(saved.entries[0].id);
      const renderStart = Date.now();
      await expect(page.locator(".history-review-outline")).toHaveCount(4, { timeout: 60_000 });
      await expect(page.locator(".history-review-outline").first()).toBeInViewport({ ratio: 0.5 });
      renderMilliseconds = Date.now() - renderStart;
    }
    expect((await state()).speed).toBe(0.75);
    expect((await command({ type: "historyQuery", query: title, limit: 20 })).entries).toEqual(saved.entries);
    expect(Buffer.from((await command({ type: "score" })).bytes)).toEqual(bytes);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(artifacts, `${action.file}-ready.png`) });
    results.push({ action: action.type, panicMilliseconds, renderMilliseconds, cancelled: true, retried: true, historyUnchanged: true, restoredNotes: result.notes.length });
  }
  await writeFile(join(artifacts, "history-actions-result.json"), JSON.stringify(results, null, 2));
});
