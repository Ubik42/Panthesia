import { test, expect } from "@playwright/test";
import { join } from "node:path";

test("备份窗口显示后台阶段，窄窗可取消，并能发送实际止音命令", async ({ page, request }) => {
  // Hold the response to inspect the UI; backend lock/cancel behavior has separate engine tests.
  let pending = false;
  let stage = "reading";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/practice-backup/export", async (route) => {
    pending = true;
    await held;
    await route.fulfill({ status: 400, json: { error: "后台任务已取消" } });
  });
  await page.route("**/api/control", async (route) => {
    const command = route.request().postDataJSON();
    if (command.type === "tasks") {
      await route.fulfill({ json: pending ? [{ id: "backup-ui-test", label: "导出练习资料", state: "running", stage, contentId: null, fingerprint: null, error: null }] : [] });
    } else if (command.type === "cancelTask" && command.id === "backup-ui-test") {
      pending = false;
      release();
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.continue();
    }
  });
  try {
    await page.goto("/");
    await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "练习计划", exact: true }).click();
    await page.getByRole("button", { name: "练习资料备份", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "练习资料备份" });
    await dialog.getByRole("button", { name: "导出练习备份", exact: true }).click();
    const activity = dialog.getByRole("region", { name: "后台任务" });
    await expect(activity).toContainText("正在读取备份资料");
    await expect(page.getByLabel("关闭练习资料备份")).toBeDisabled();
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份.png") });
    stage = "encoding";
    await expect(activity).toContainText("正在校验与压缩");
    await page.setViewportSize({ width: 480, height: 820 });
    await activity.scrollIntoViewIfNeeded();
    const bounds = await activity.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480);
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份-窄窗.png") });
    await activity.getByRole("button", { name: "暂停并停止发声" }).click();
    await expect.poll(async () => (await (await request.get("http://127.0.0.1:32124/api/state")).json()).status).toBe("paused");
    await activity.getByRole("button", { name: "取消本次备份" }).click();
    await expect(dialog.getByRole("alert")).toContainText("后台任务已取消");
    await expect(page.getByLabel("关闭练习资料备份")).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "导出练习备份", exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test("后台导入可以取消并重试，保存阶段停用取消且实际合并后保留成绩", async ({ page, request }) => {
  const command = async (data: unknown) => {
    const response = await request.post("http://127.0.0.1:32124/api/command", { headers: { "X-Panthesia-Client": "web" }, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const before = await command({ type: "historyQuery", limit: 100 });
  const exported = await request.post("http://127.0.0.1:32124/api/practice-backup/export", { headers: { "X-Panthesia-Client": "web" }, data: { plans: true, records: true, presets: true, days: 0 } });
  expect(exported.ok()).toBeTruthy();
  const bytes = await exported.body();
  let pending = false;
  let attempt = 0;
  let releaseCancel!: () => void;
  let releaseSave!: () => void;
  const cancelled = new Promise<void>((resolve) => { releaseCancel = resolve; });
  const saving = new Promise<void>((resolve) => { releaseSave = resolve; });
  // Hold two responses to inspect UI states. The second request then reaches the real service.
  await page.route("**/api/command", async (route) => {
    const data = route.request().postDataJSON();
    if (data.type !== "importStagedPracticeBackup") { await route.continue(); return; }
    pending = true;
    attempt += 1;
    if (attempt === 1) {
      await cancelled;
      await route.fulfill({ status: 400, json: { error: "后台任务已取消" } });
    } else {
      await saving;
      const response = await route.fetch();
      pending = false;
      await route.fulfill({ response });
    }
  });
  await page.route("**/api/control", async (route) => {
    const data = route.request().postDataJSON();
    if (data.type === "tasks" && pending) {
      await route.fulfill({ json: [{ id: "import-ui-test", label: "导入练习资料", state: attempt === 1 ? "running" : "committing", stage: attempt === 1 ? "merging" : "committing", contentId: null, fingerprint: null, error: null }] });
    } else if (data.type === "cancelTask" && data.id === "import-ui-test") {
      pending = false;
      releaseCancel();
      await route.fulfill({ json: { ok: true } });
    } else { await route.continue(); }
  });
  try {
    await page.goto("/");
    await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "练习计划", exact: true }).click();
    await page.getByRole("button", { name: "练习资料备份", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "练习资料备份" });
    await dialog.getByLabel("练习备份文件").setInputFiles({ name: "真实导出样本.neopractice", mimeType: "application/zip", buffer: bytes });
    const apply = dialog.getByRole("button", { name: "按所选范围导入", exact: true });
    await expect(apply).toBeEnabled();
    await apply.click();
    const activity = dialog.getByRole("region", { name: "后台任务" });
    await expect(activity).toContainText("正在合并练习资料");
    await expect(activity).toContainText("导入期间暂时停用演奏和资料修改");
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份导入.png") });
    await activity.getByRole("button", { name: "取消本次备份" }).click();
    await expect(dialog.getByRole("alert")).toContainText("后台任务已取消");
    expect(await command({ type: "historyQuery", limit: 100 })).toEqual(before);
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(activity).toContainText("正在保存");
    await expect(activity.getByRole("button", { name: "取消本次备份" })).toBeDisabled();
    await page.setViewportSize({ width: 480, height: 820 });
    await activity.scrollIntoViewIfNeeded();
    const bounds = await activity.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480);
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份导入-窄窗.png") });
    await activity.getByRole("button", { name: "暂停并停止发声" }).click();
    releaseSave();
    await expect(dialog.getByText(/导入完成：曲目资料历史新增/)).toBeVisible();
    expect(await command({ type: "historyQuery", limit: 100 })).toEqual(before);
    await expect(page.getByLabel("关闭练习资料备份")).toBeEnabled();
  } finally { releaseCancel(); releaseSave(); }
});

test("备份预览显示解包与比较阶段，取消后恢复选择且保留本机资料", async ({ page, request }) => {
  // Task presentation uses a held response; real decode/lock/cancel is covered by engine tests.
  let pending = false;
  let stage = "decoding";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/practice-backup/stage", async (route) => {
    pending = true;
    await held;
    await route.fulfill({ status: 400, json: { error: "后台任务已取消" } });
  });
  await page.route("**/api/control", async (route) => {
    const command = route.request().postDataJSON();
    if (command.type === "tasks") {
      await route.fulfill({ json: pending ? [{ id: "preview-ui-test", label: "预览练习备份", state: "running", stage, contentId: null, fingerprint: null, error: null }] : [] });
    } else if (command.type === "cancelTask" && command.id === "preview-ui-test") {
      pending = false;
      release();
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.continue();
    }
  });
  const command = async (type: string) => {
    const response = await request.post("http://127.0.0.1:32124/api/command", { headers: { "X-Panthesia-Client": "web" }, data: { type, query: "", limit: 100 } });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const before = await command("historyQuery");
  try {
    await page.goto("/");
    await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "练习计划", exact: true }).click();
    await page.getByRole("button", { name: "练习资料备份", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "练习资料备份" });
    await dialog.getByLabel("练习备份文件").setInputFiles({ name: "UI等待样本.neopractice", mimeType: "application/zip", buffer: Buffer.from("held-response-ui-only") });
    const activity = dialog.getByRole("region", { name: "后台任务" });
    await expect(activity).toContainText("正在解包与校验备份");
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份预览.png") });
    stage = "comparing";
    await expect(activity).toContainText("正在比较本机资料");
    await page.setViewportSize({ width: 480, height: 820 });
    await activity.scrollIntoViewIfNeeded();
    const bounds = await activity.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480);
    await activity.screenshot({ path: join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? "../outputs", "Panthesia-后台备份预览-窄窗.png") });
    await activity.getByRole("button", { name: "取消本次备份" }).click();
    await expect(dialog.getByRole("alert")).toContainText("后台任务已取消");
    await expect(dialog.getByRole("button", { name: "选择练习备份", exact: true })).toBeEnabled();
    await expect(page.getByLabel("关闭练习资料备份")).toBeEnabled();
    expect(await command("historyQuery")).toEqual(before);
  } finally {
    release();
  }
});
