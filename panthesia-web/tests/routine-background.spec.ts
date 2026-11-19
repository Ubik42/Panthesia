import { test, expect } from "@playwright/test";
import { largeScore } from "./fixtures/large-score";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

test("大谱面计划项目可取消重试，完成后保留当天进度", async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const headers = { "X-Panthesia-Client": "web" };
  const base = "http://127.0.0.1:32124";
  const command = async (data: unknown) => {
    const response = await request.post(`${base}/api/command`, { headers, data, timeout: 60_000 });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  };
  const state = async () => (await request.get(`${base}/api/state`)).json();
  const bytes = largeScore("计划后台大谱面");
  const song = await command({ type: "importScore", name: "计划后台大谱面.musicxml", bytes: Array.from(bytes), default_bpm: 120 });
  await command({ type: "mode", value: "wait" }); await command({ type: "countIn", bars: 0 });
  await command({ type: "speed", value: .75 }); await command({ type: "measureLoop", start: 1, end: 1, enabled: true });
  const plan = await command({ type: "saveRoutine", id: null, day: null, name: "后台日课", notes: "保留日课进度", copy_of: null });
  const item = await command({ type: "saveRoutineItem", content_id: song.contentId, routine_id: plan.id, day: null, id: null,
    source: "current", source_id: null, title: "大谱选段", notes: "先慢练第一小节",
    goal: { passes: 3, accuracy: 90, onTime: null, consecutive: false, attemptLimit: 20 } });
  const day = "2026-11-13";
  const originalPlan = (await command({ type: "routines", day })).plans; expect(originalPlan).toHaveLength(1);
  await page.goto("/"); await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "五指热身 · 从中央 C 开始" }).click();
  await expect(page.getByRole("heading", { name: "五指热身 · 从中央 C 开始", exact: true })).toBeVisible();
  const original = await (await request.get(`${base}/api/song`)).json();
  await page.getByRole("button", { name: "练习计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "练习计划", exact: true });
  await dialog.getByLabel("练习计划日期").fill(day);
  await dialog.locator(".routine-plan").filter({ hasText: "后台日课" }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await dialog.getByRole("button", { name: "练习项目：大谱选段", exact: true }).click();
  const task = dialog.getByRole("region", { name: "后台任务", exact: true });
  await expect(task).toContainText("准备计划练习项目");
  const started = Date.now();
  expect((await request.post(`${base}/api/control`, { headers, data: { type: "panic" }, timeout: 2000 })).ok()).toBeTruthy();
  const panicMilliseconds = Date.now() - started;
  const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  await page.screenshot({ path: join(artifacts, "routine-background-preparing.png") });
  await task.getByRole("button", { name: "取消这次计算", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "后台任务已取消" })).toBeVisible();
  expect((await (await request.get(`${base}/api/song`)).json()).contentId).toBe(original.contentId);
  const cancelled = await command({ type: "routines", day });
  expect(cancelled.runs).toHaveLength(0); expect(cancelled.plans).toEqual(originalPlan);
  const reply = page.waitForResponse((r) => r.url().endsWith("/api/command") && r.request().postDataJSON()?.type === "openRoutineItem");
  await dialog.getByRole("button", { name: "练习项目：大谱选段", exact: true }).click();
  const response = await reply; expect(response.ok(), await response.text()).toBeTruthy(); const opened = await response.json();
  expect(opened.contentId).toBe(song.contentId); expect(opened.notes).toHaveLength(22_000);
  await expect(dialog).toHaveCount(0); await expect(page.locator(".routine-status")).toContainText("大谱选段");
  expect((await state()).speed).toBe(.75); expect((await state()).routine.itemId).toBe(item.id);
  const score = await command({ type: "score" }); expect(Buffer.from(score.bytes)).toEqual(bytes);
  await page.getByRole("button", { name: "开始练习", exact: true }).click();
  for (const pitch of [48, 50, 52, 53]) {
    await expect.poll(async () => (await state()).required).toEqual([pitch]);
    await command({ type: "note", pitch, active: true, velocity: 90 }); await command({ type: "note", pitch, active: false, velocity: 0 });
  }
  await expect.poll(async () => (await state()).routine.progress.passed).toBe(1);
  await command({ type: "pause" });
  await expect(page.getByRole("button", { name: "开始练习", exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, "routine-background-ready.png") });
  await command({ type: "stopRoutine" });
  await command({ type: "openRoutineItem", routine_id: plan.id, day, item_id: item.id, resume: true });
  const resumed = (await state()).routine.progress; expect(resumed.passed).toBe(1); expect(resumed.attempts).toBe(1);
  expect((await command({ type: "routines", day })).plans).toEqual(originalPlan);
  await command({ type: "stopRoutine" });
  await writeFile(join(artifacts, "routine-background-result.json"), JSON.stringify({ bytes: bytes.length, notes: opened.notes.length,
    panicMilliseconds, cancelled: true, retried: true, cancelledCreatedDay: false, originalScoreBytes: true, resumedPasses: resumed.passed, resumedAttempts: resumed.attempts }, null, 2));
});
