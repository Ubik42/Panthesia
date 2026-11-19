import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

test("生成练习切换双手和单手后，编辑、清除与撤销保留另一手指法", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const command = async (data: unknown) => {
    const response = await request.post("http://127.0.0.1:32124/api/command", {
      headers: { "X-Panthesia-Client": "web" }, data,
    });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  };
  const song = async () => (await request.get("http://127.0.0.1:32124/api/song")).json();
  const spec = { tonic: 0, tonality: "Major", minor_form: "Natural", pattern: "Scale", direction: "UpAndDown",
    hands: "Both", octaves: 1, repetitions: 1, tempo_bpm: 60 };
  const initial = await command({ type: "generate", spec });
  const original = initial.notes ? initial : await song();
  const right = original.notes.find((n: any) => n.part === "right" && n.index === 0);
  const left = original.notes.find((n: any) => n.part === "left" && n.index === 0);
  expect(right).toBeTruthy(); expect(left).toBeTruthy(); const leftDefault = left.finger;
  await command({ type: "finger", track: right.track, index: 0, finger: 4 });
  await command({ type: "finger", track: left.track, index: 0, finger: 2 });
  await page.goto("/"); await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByLabel("键盘显示范围").selectOption("49");
  const generate = async (hands: string) => {
    await page.getByRole("button", { name: "技术练习", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "技术练习", exact: true });
    await dialog.getByLabel("生成练习声部").selectOption(hands);
    await dialog.getByRole("button", { name: "生成并打开", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await song()).contentId).toBe(original.contentId);
  };
  const selectFirst = async (pitch: number) => {
    const edit = page.getByRole("button", { name: "编辑指法", exact: true });
    if (!(await edit.getAttribute("class"))?.includes("selected")) await edit.click();
    const canvas = page.getByLabel("按小节排列的音符与可演奏键盘");
    const size = await canvas.evaluate((e) => ({ width: e.clientWidth, height: e.clientHeight }));
    const bounds = (await canvas.boundingBox())!;
    const full = (await page.getByLabel("键盘显示范围").inputValue()) === "88";
    const white = Array.from({ length: full ? 88 : 49 }, (_, i) => i + (full ? 21 : 36)).filter((p) => ![1, 3, 6, 8, 10].includes(p % 12));
    // Select the first note immediately above the keyboard, in its white-key column.
    const x = (white.indexOf(pitch) + .5) * size.width / white.length;
    const y = size.height - Math.min(100, size.height * .45) - 3;
    await canvas.click({ position: { x: x * bounds.width / size.width, y: y * bounds.height / size.height } });
    const editor = page.locator(".finger-editor"); await expect(editor).toBeVisible();
    const current = (await song()).notes.find((n: any) => n.pitch === pitch && n.index === 0).finger;
    await expect(editor).toContainText(`当前指法 ${current}`);
    await expect(editor.getByRole("button", { name: String(current), exact: true })).toHaveAttribute("aria-pressed", "true");
    return editor;
  };
  const editFirst = async (pitch: number, value: number | null) => {
    const editor = await selectFirst(pitch);
    await editor.getByRole("button", { name: value == null ? "清除个人覆盖" : String(value), exact: true }).click();
    await expect(editor).toHaveCount(0);
  };
  const undo = async () => {
    await page.getByRole("button", { name: "指法建议", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "指法建议", exact: true });
    await dialog.getByRole("button", { name: "撤销上次指法修改", exact: true }).click();
    await dialog.getByRole("button", { name: "关闭指法建议", exact: true }).click();
  };
  const value = async (track: number) => (await song()).notes.find((n: any) => n.track === track && n.index === 0)?.finger;
  await generate("Left"); await editFirst(left.pitch, 3);
  await expect.poll(() => value(left.track)).toBe(3);
  await undo(); await expect.poll(() => value(left.track)).toBe(2);
  await editFirst(left.pitch, 3); await expect.poll(() => value(left.track)).toBe(3);
  await editFirst(left.pitch, null); await expect.poll(() => value(left.track)).toBe(leftDefault);
  await undo(); await expect.poll(() => value(left.track)).toBe(3);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByLabel("键盘显示范围").selectOption("88");
  await generate("Right"); await expect.poll(() => value(right.track)).toBe(4);
  await editFirst(right.pitch, 1); await expect.poll(() => value(right.track)).toBe(1);
  await generate("Both"); expect(await value(left.track)).toBe(3); expect(await value(right.track)).toBe(1);
  await page.reload(); await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  expect(await value(left.track)).toBe(3); expect(await value(right.track)).toBe(1);
  const artifacts = process.env.PANTHESIA_BASELINE_ARTIFACTS ?? info.outputDir;
  await selectFirst(left.pitch);
  await page.screenshot({ path: join(artifacts, "generated-finger-scope.png") });
  await page.getByRole("button", { name: "关闭指法编辑", exact: true }).click();
  await selectFirst(right.pitch);
  await page.screenshot({ path: join(artifacts, "generated-finger-scope-right.png") });
  await writeFile(join(artifacts, "generated-finger-scope-result.json"), JSON.stringify({ contentId: original.contentId,
    leftFinger: 3, rightFinger: 1, clearedToDefault: leftDefault, undoVerified: true, sharedIdentity: true, reopened: true }, null, 2));
});
