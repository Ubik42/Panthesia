import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const base = "http://127.0.0.1:32124";
async function command(request: APIRequestContext, data: unknown) {
  const response = await request.post(`${base}/api/command`, {
    headers: { "X-Panthesia-Client": "web" },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function installRenderProbe(page: Page) {
  await page.addInitScript(() => {
    type Fiber = {
      type?: { name?: string };
      flags: number;
      child?: Fiber;
      sibling?: Fiber;
    };
    const counts: Record<string, number> = {};
    let previousCommit = new Set<Fiber>();
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (
        this.canvas.getAttribute("aria-label") ===
        "按小节排列的音符与可演奏键盘"
      )
        counts.canvasPaints = (counts.canvasPaints ?? 0) + 1;
      return clear.apply(this, args);
    };
    // React 19's development renderer reports committed fibers to DevTools.
    // PerformedWork (bit 1) records render work, including an unchanged DOM.
    Object.assign(window, {
      practiceRenderCounts: counts,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map<number, unknown>(),
        inject(renderer: unknown) {
          this.renderers.set(1, renderer);
          return 1;
        },
        onCommitFiberUnmount: () => {},
        onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
          const pending = [root.current];
          const currentCommit = new Set<Fiber>();
          while (pending.length) {
            const fiber = pending.pop()!;
            currentCommit.add(fiber);
            const name = fiber.type?.name;
            // A bailed-out subtree can retain an earlier PerformedWork flag.
            // Count only fibers newly committed since the previous traversal.
            if (name && fiber.flags & 1 && !previousCommit.has(fiber))
              counts[name] = (counts[name] ?? 0) + 1;
            if (fiber.child) pending.push(fiber.child);
            if (fiber.sibling) pending.push(fiber.sibling);
          }
          previousCommit = currentCommit;
        },
      },
    });
  });
}
const readCounts = (page: Page) =>
  page.evaluate(() => ({
    ...(window as unknown as { practiceRenderCounts: Record<string, number> })
      .practiceRenderCounts,
  }));

test("播放显示持续更新，主界面与设置窗口保持独立订阅", async ({
  page,
  request,
}, info) => {
  await installRenderProbe(page);
  await command(request, {
    type: "generate",
    spec: {
      tonic: 0,
      tonality: "Major",
      minor_form: "Natural",
      pattern: "Scale",
      direction: "UpAndDown",
      hands: "Both",
      octaves: 2,
      repetitions: 2,
      tempo_bpm: 60,
    },
  });
  await command(request, { type: "countIn", bars: 0 });
  await command(request, { type: "mode", value: "listen" });
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始练习", exact: true }).click();
  await expect(page.locator(".stage-status")).toContainText("正在播放");
  await page.getByLabel("显示与电脑键盘设置").click();
  const settings = page.getByRole("dialog", { name: "显示与电脑键盘" });
  await settings
    .getByLabel("布局名称", { exact: true })
    .fill("持续播放中的布局草稿");
  const before = await readCounts(page);
  const observationStart = Date.now();
  expect(before.App).toBeGreaterThan(0);
  expect(before.DisplaySettingsDialog).toBeGreaterThan(0);
  const start = (await (await request.get(`${base}/api/state`)).json())
    .position;
  await expect
    .poll(
      async () =>
        (await (await request.get(`${base}/api/state`)).json()).position,
    )
    .toBeGreaterThan(start + 0.6);
  const after = await readCounts(page);
  const observedMs = Date.now() - observationStart;
  expect(after.Piano).toBeGreaterThan(before.Piano);
  expect(after.PracticeTimeline).toBeGreaterThan(before.PracticeTimeline);
  expect(after.canvasPaints).toBeGreaterThan(before.canvasPaints);
  expect(after.App).toBe(before.App);
  expect(after.DisplaySettingsDialog).toBe(before.DisplaySettingsDialog);
  expect(after.WorkspaceNavigation).toBe(before.WorkspaceNavigation);
  expect(after.LayoutSettings).toBe(before.LayoutSettings);
  await expect(settings.getByLabel("布局名称", { exact: true })).toHaveValue(
    "持续播放中的布局草稿",
  );
  await info.attach("播放期间组件更新次数", {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: "application/json",
  });
  // A settings change must still reach the shell immediately.
  await command(request, { type: "speed", value: 0.75 });
  await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue("75");
  expect((await readCounts(page)).App).toBeGreaterThan(after.App);
  await settings.getByRole("button", { name: "完成", exact: true }).click();
  await command(request, { type: "pause" });
  await expect(page.locator(".stage-status")).toContainText("已暂停");
  // This fixed observation window measures idle paint work after the final frame.
  await page.waitForTimeout(150);
  const paused = await readCounts(page);
  await page.waitForTimeout(400);
  const idle = await readCounts(page);
  expect(idle.canvasPaints).toBe(paused.canvasPaints);
  const output = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  await writeFile(
    join(output, "playback-render-counts.json"),
    JSON.stringify({ observedMs, before, after, paused, idle }, null, 2),
  );
  await page.screenshot({
    path: join(output, "playback-isolated-desktop.png"),
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(async () => (await readCounts(page)).canvasPaints)
    .toBeGreaterThan(idle.canvasPaints);
  await page.screenshot({ path: join(output, "playback-isolated-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "曲库管理", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "曲库管理", exact: true }),
  ).toBeVisible();
  const hidden = (await readCounts(page)).canvasPaints;
  await page.waitForTimeout(250);
  expect((await readCounts(page)).canvasPaints).toBe(hidden);
  await page.getByRole("button", { name: "练习工作区", exact: true }).click();
  await expect
    .poll(async () => (await readCounts(page)).canvasPaints)
    .toBeGreaterThan(hidden);
});

test("设定循环与导航快捷键读取最新小节", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await command(request, { type: "mode", value: "wait" });
  await command(request, { type: "seekMeasure", measure: 3 });
  await expect(page.getByLabel("播放位置", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "设 A", exact: true }).click();
  await expect(page.getByLabel("循环起始小节", { exact: true })).toHaveValue(
    "3",
  );
  await command(request, { type: "seekMeasure", measure: 4 });
  await expect(page.getByLabel("播放位置", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "设 B", exact: true }).click();
  await expect(page.getByLabel("循环结束小节", { exact: true })).toHaveValue(
    "4",
  );
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByLabel("播放位置", { exact: true })).toHaveValue("5");
});
