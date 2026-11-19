import { test, expect, type APIRequestContext } from "@playwright/test";
import { join } from "node:path";

const base = "http://127.0.0.1:32124";
async function command(request: APIRequestContext, data: unknown) {
  const response = await request.post(`${base}/api/command`, {
    headers: { "X-Panthesia-Client": "web" },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
const snapshot = async (request: APIRequestContext) =>
  (await request.get(`${base}/api/state`)).json();
async function importPiece(request: APIRequestContext) {
  const events = [0, 144, 60, 90, 131, 96, 128, 60, 0, 0, 255, 47, 0];
  return command(request, {
    type: "importMidi",
    name: "工作区验收曲.mid",
    bytes: [
      77,
      84,
      104,
      100,
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      1,
      224,
      77,
      84,
      114,
      107,
      0,
      0,
      0,
      events.length,
      ...events,
    ],
  });
}

test("三个工作区共享曲目，曲库页不占用弹窗，窄窗以抽屉显示参数", async ({
  page,
  request,
}) => {
  const song = await importPiece(request);
  await command(request, { type: "speed", value: 0.75 });
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(song.title);
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  const library = page.getByRole("region", { name: "曲库管理", exact: true });
  await expect(library).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".workspace")).toBeHidden();
  await page.keyboard.press("Control+f");
  await expect(library.getByLabel("管理曲库搜索")).toBeFocused();
  await library.getByLabel("管理曲库搜索").fill(song.title);
  await expect(library.locator("tbody tr")).toHaveCount(1);
  await library.locator("tbody tr").first().click();
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS)
    await page.screenshot({
      path: join(
        process.env.PANTHESIA_BASELINE_ARTIFACTS,
        "workspace-library.png",
      ),
    });
  await page.setViewportSize({ width: 1024, height: 768 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS)
    await page.screenshot({
      path: join(
        process.env.PANTHESIA_BASELINE_ARTIFACTS,
        "workspace-library-narrow.png",
      ),
    });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "练习历史", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "练习历史", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "练习工作区", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(song.title);
  expect((await snapshot(request)).speed).toBe(0.75);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".library-panel")).toHaveCount(0);
  await expect(page.locator(".practice-inspector")).toHaveCount(0);
  const width = await page
    .locator(".piano-stage")
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  await page.getByRole("button", { name: "练习参数", exact: true }).click();
  await expect(page.locator(".practice-inspector")).toBeVisible();
  expect(
    await page
      .locator(".piano-stage")
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBe(width);
  expect(
    await page
      .locator(".practice-inspector")
      .evaluate((node) => getComputedStyle(node).position),
  ).toBe("absolute");
  await page.keyboard.press("Escape");
  await expect(page.locator(".practice-inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Panthesia", exact: true }).click();
  await expect(page.locator(".library-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "返回练习画面", exact: true })
    .click({ position: { x: 600, y: 100 } });
  await expect(page.locator(".library-panel")).toHaveCount(0);
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS)
    await page.screenshot({
      path: join(
        process.env.PANTHESIA_BASELINE_ARTIFACTS,
        "workspace-practice-narrow.png",
      ),
    });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator(".library-panel")).toBeVisible();
  await expect(page.locator(".practice-inspector")).toBeVisible();
});

test("曲库编辑阻止离开，子窗口关闭后仍留在曲库", async ({ page, request }) => {
  const song = await importPiece(request);
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(song.title);
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  const library = page.getByRole("region", { name: "曲库管理", exact: true });
  await library.getByLabel("管理曲库搜索").fill(song.title);
  await library.locator("tbody tr").first().click();
  await library.getByRole("button", { name: "编辑信息", exact: true }).click();
  await library.getByLabel("管理曲名", { exact: true }).fill("暂存的曲名");
  await expect(
    page.getByRole("button", { name: "练习工作区", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "练习历史", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(library.getByLabel("管理曲名", { exact: true })).toHaveValue(
    "暂存的曲名",
  );
  await library
    .getByRole("button", { name: "取消信息编辑", exact: true })
    .click();
  await library.getByRole("button", { name: "文件位置", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(library).toBeVisible();
  await page.getByRole("button", { name: "练习工作区", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(song.title);
});

test("回顾评语保存前阻止切换，保存后可回到练习", async ({ page, request }) => {
  await importPiece(request);
  await command(request, { type: "countIn", bars: 0 });
  await command(request, { type: "speed", value: 2 });
  await command(request, { type: "play" });
  await expect
    .poll(async () => (await snapshot(request)).required)
    .toContain(60);
  await command(request, {
    type: "note",
    pitch: 60,
    active: true,
    velocity: 90,
  });
  await command(request, {
    type: "note",
    pitch: 60,
    active: false,
    velocity: 0,
  });
  await expect
    .poll(async () => (await snapshot(request)).status)
    .toBe("finished");
  await command(request, { type: "pause" });
  await page.goto("/");
  await page.getByRole("button", { name: "练习历史", exact: true }).click();
  const review = page.getByRole("region", { name: "练习历史", exact: true });
  await review.locator(".history-record").first().click();
  await review
    .getByLabel("练习备注", { exact: true })
    .fill("下一次先练清楚起音");
  await expect(
    page.getByRole("button", { name: "曲库管理", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "练习工作区", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(review.getByLabel("练习备注", { exact: true })).toHaveValue(
    "下一次先练清楚起音",
  );
  await review.getByRole("button", { name: "保存评语", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "练习工作区", exact: true }),
  ).toBeEnabled();
  if (process.env.PANTHESIA_BASELINE_ARTIFACTS)
    await page.screenshot({
      path: join(
        process.env.PANTHESIA_BASELINE_ARTIFACTS,
        "workspace-review.png",
      ),
    });
  await page.getByRole("button", { name: "练习工作区", exact: true }).click();
  await expect(review).toHaveCount(0);
});

test("切换等待暂停回执时，新开始的信息编辑仍会阻止离开", async ({ page, request }) => {
  const song = await importPiece(request);
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(song.title);
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  const library = page.getByRole("region", { name: "曲库管理", exact: true });
  await library.getByLabel("管理曲库搜索").fill(song.title);
  await library.locator("tbody tr").first().click();
  let release!: () => void, ready!: () => void;
  const held = new Promise<void>((resolve) => { ready = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/(?:command|control)$/, async (route) => {
    if (route.request().postDataJSON()?.type !== "pause") return route.continue();
    const response = await route.fetch();
    ready();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "练习历史", exact: true }).click();
    await held;
    await library.getByRole("button", { name: "编辑信息", exact: true }).click();
    await library.getByLabel("管理曲名", { exact: true }).fill("暂停回执到达前的草稿");
    const completed = page.waitForResponse((response) => response.url() === `${base}/api/state`);
    release();
    await completed;
    await expect(library).toBeVisible();
    await expect(library.getByLabel("管理曲名", { exact: true })).toHaveValue("暂停回执到达前的草稿");
    await expect(page.getByRole("button", { name: "练习历史", exact: true })).toBeDisabled();
    await library.getByRole("button", { name: "取消信息编辑", exact: true }).click();
  } finally { release(); }
});
