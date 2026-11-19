import { test, expect, type APIRequestContext } from "@playwright/test";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

test.skip(process.env.PANTHESIA_BASELINE !== "1", "由独立流程检查脚本启动，使用专用数据目录");
const state = async (request: APIRequestContext) =>
  (await request.get("http://127.0.0.1:32124/api/state")).json();
async function command(request: APIRequestContext, data: unknown) {
  const reply = await request.post("http://127.0.0.1:32124/api/command", {
    headers: { "X-Panthesia-Client": "web" }, data,
  });
  expect(reply.ok(), await reply.text()).toBeTruthy();
  return reply.json();
}

test("保存日常练习：选段、调速、完成两轮、从历史重练", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接")).toBeVisible();
  await expect(page.locator(".song-expression-goal")).toHaveCount(0);
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS)
    await page.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS, "start.png") });
  await page.getByRole("listitem").filter({ hasText: "五指热身 · 从中央 C 开始" }).click();
  await page.getByLabel("预备拍", { exact: true }).selectOption("0");
  await expect(page.locator(".song-expression-goal summary")).toContainText("未设置");
  await expect(page.getByLabel("当前曲目要求逐音力度差")).not.toBeVisible();
  await page.getByLabel("循环结束小节").fill("1");
  await page.getByRole("button", { name: "开始循环", exact: true }).click();
  await command(request, { type: "speed", value: 0.75 });
  await page.getByRole("button", { name: "开始练习", exact: true }).click();
  for (let round = 1; round <= 2; round++) {
    for (const [pitch, key] of [["C4", "a"], ["D4", "s"], ["E4", "d"], ["F4", "f"]]) {
      await expect(page.locator(".required-notes strong")).toHaveText(pitch);
      await page.locator("h1").click();
      await page.keyboard.press(key);
    }
    await expect.poll(async () => (await state(request)).repetitions).toBe(round);
    if (round === 1 && process.env.PANTHESIA_ROUND_RECOVERY === "1") {
      const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS!;
      const first = await command(request, { type: "historyQuery", limit: 10 });
      expect(first.entries).toHaveLength(1);
      await writeFile(join(artifacts, "round-before.json"), JSON.stringify({ contentId: first.entries[0].contentId, ids: first.entries.map((entry: {id: string}) => entry.id) }));
      await writeFile(join(artifacts, "round-history-before.ron"), await readFile(join(artifacts, "data", "web-practice-history.ron")));
    }
  }
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS) {
    await page.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS, "practice.png") });
    await page.setViewportSize({ width: 1024, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS, "practice-narrow.png") });
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  const before = await state(request);
  const history = await command(request, { type: "historyQuery", limit: 10 });
  expect(history.entries.length).toBeGreaterThanOrEqual(2);
  const latest = history.entries[0];
  expect(latest.score.matched_notes).toBe(4);
  await page.getByRole("button", { name: "练习历史", exact: true }).click();
  await expect(page.getByRole("region", { name: "练习历史", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await command(request, { type: "speed", value: 1.25 });
  await command(request, { type: "historyOpen", content_id: latest.contentId, id: latest.id, restore: true });
  const restored = await state(request);
  expect(restored.speed).toBe(0.75);
  expect(restored.passage).toEqual(before.passage);
  expect(restored.status).not.toBe("playing");
  await page.reload();
  await expect(page.getByRole("heading", { name: "五指热身 · 从中央 C 开始", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始练习", exact: true })).toBeEnabled();
});

test("重启恢复日常练习：曲目、范围、速度、记录保留且保持暂停", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接")).toBeVisible();
  await expect(page.getByRole("heading", { name: "五指热身 · 从中央 C 开始", exact: true })).toBeVisible();
  const restored = await state(request);
  expect(restored.status).not.toBe("playing");
  expect(restored.speed).toBe(0.75);
  expect(restored.passage).not.toBeNull();
  await expect(page.getByLabel("循环起始小节")).toHaveValue("1");
  await expect(page.getByLabel("循环结束小节")).toHaveValue("1");
  const history = await command(request, { type: "historyQuery", limit: 10 });
  expect(history.entries.filter((entry: { score: { matched_notes: number } }) => entry.score.matched_notes === 4).length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "开始练习", exact: true }).click();
  await expect(page.locator(".required-notes strong")).toHaveText("C4");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
});
