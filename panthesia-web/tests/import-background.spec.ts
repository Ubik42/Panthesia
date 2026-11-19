import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { largeScore } from "./fixtures/large-score";

const base = "http://127.0.0.1:32124";
const headers = { "X-Panthesia-Client": "web" };

test("实际乐谱准备期间显示任务，可取消并保留当前曲目", async ({
  page,
  request,
}, info) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "五指热身 · 从中央 C 开始" })
    .click();
  const original = await (await request.get(`${base}/api/song`)).json();
  await page.setViewportSize({ width: 1024, height: 768 });
  const xml = largeScore("后台导入检查");
  expect(xml.length).toBeLessThan(3_000_000);
  await page.getByRole("button", { name: "导入曲目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入曲目与乐谱" });
  await dialog.getByLabel("导入曲目文件").setInputFiles({
    name: "后台导入检查.musicxml",
    mimeType: "application/xml",
    buffer: xml,
  });
  await dialog.getByRole("button", { name: "开始导入", exact: true }).click();
  const task = dialog.getByRole("region", { name: "后台任务" });
  await expect(task).toContainText("准备导入曲目");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const pause = await request.post(`${base}/api/control`, {
    headers,
    data: { type: "panic" },
    timeout: 2000,
  });
  expect(pause.ok()).toBeTruthy();
  await page.screenshot({
    path: join(
      process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir,
      "import-background-running.png",
    ),
  });
  await task.getByRole("button", { name: "取消这次计算", exact: true }).click();
  await expect(dialog).toContainText("后台任务已取消");
  await expect(
    dialog.getByRole("button", { name: "关闭导入", exact: true }),
  ).toBeEnabled();
  const song = await (await request.get(`${base}/api/song`)).json();
  expect(song.contentId).toBe(original.contentId);
  const tasks = await (
    await request.post(`${base}/api/control`, {
      headers,
      data: { type: "tasks" },
    })
  ).json();
  expect(
    tasks.some(
      (task: { label: string; state: string }) =>
        task.label === "准备导入曲目" && task.state === "cancelled",
    ),
  ).toBeTruthy();
});
