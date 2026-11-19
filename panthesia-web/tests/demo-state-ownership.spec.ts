import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

test("旧示范的状态失败不接管新示范，当前状态失败会停止并清理", async ({ page, request }) => {
  const command = async (data: unknown) => {
    const response = await request.post("http://127.0.0.1:32124/api/command", { headers: { "X-Panthesia-Client": "web" }, data });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  };
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join("")}</measure></part></score-partwise>`;
  const song = await command({ type: "importScore", bytes: [...Buffer.from(xml)], name: "示范状态归属.musicxml", default_bpm: 120 });
  await command({ type: "track", id: song.notes[0].track, mode: "human", part: "right", visible: true });
  const before = await (await request.get("http://127.0.0.1:32124/api/state")).json();
  await page.goto("/");
  await page.getByRole("button", { name: "指法建议", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "指法建议", exact: true });
  await dialog.getByLabel("指法起始小节").fill("1"); await dialog.getByLabel("指法结束小节").fill("1");
  await dialog.getByRole("button", { name: "生成建议", exact: true }).click();
  await expect(dialog.locator(".finger-demo-controls")).toBeVisible();
  await dialog.getByLabel("指法示范速度").selectOption("0.25");
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  let hold = true, failCurrent = false;
  await page.route("**/api/command", async route => {
    if (route.request().postDataJSON()?.type === "fingerDemoState") {
      if (hold) { hold = false; entered(); await gate; await route.abort("failed"); return; }
      if (failCurrent) { failCurrent = false; await route.abort("failed"); return; }
    }
    await route.continue();
  });
  const demo = dialog.locator(".finger-demo-controls");
  try {
    await demo.getByRole("button", { name: "示范整个建议选段", exact: true }).click();
    await held;
    const first = await command({ type: "fingerDemoState" });
    await demo.getByRole("button", { name: "停止指法示范", exact: true }).click();
    await expect.poll(async () => (await command({ type: "fingerDemoState" })).id).toBeNull();
    await demo.getByRole("button", { name: "示范整个建议选段", exact: true }).click();
    await expect(demo.getByRole("status")).toHaveText("正在示范");
    const second = await command({ type: "fingerDemoState" });
    expect(second.id).not.toBe(first.id); expect(second.active).toBe(true);
    const observed = page.waitForResponse(response => response.request().postDataJSON()?.type === "fingerDemoState" && response.ok());
    release(); await observed;
    await expect(demo.getByRole("status")).toHaveText("正在示范");
    await expect(demo.getByRole("alert")).toHaveCount(0);
    expect((await command({ type: "fingerDemoState" })).id).toBe(second.id);
    const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? test.info().outputDir;
    await page.screenshot({ path: join(artifacts, "demo-state-ownership.png") });
    failCurrent = true;
    await expect(demo.getByRole("status")).toHaveText("示范已停止");
    await expect(demo.getByRole("alert")).toBeVisible();
    await expect.poll(async () => (await command({ type: "fingerDemoState" })).id).toBeNull();
    expect(await command({ type: "fingerDemoState" })).toEqual({ id: null, active: false });
    const after = await (await request.get("http://127.0.0.1:32124/api/state")).json();
    expect(after.position).toBe(before.position); expect(after.score).toEqual(before.score);
    expect((await command({ type: "currentSong" })).contentId).toBe(song.contentId);
    await writeFile(join(artifacts, "demo-state-ownership-result.json"), JSON.stringify({ oldFailureIgnored: true, currentFailureStops: true, newOwnerRetained: true, mainPracticeUnchanged: true }, null, 2));
  } finally { release(); await page.unroute("**/api/command"); }
});
