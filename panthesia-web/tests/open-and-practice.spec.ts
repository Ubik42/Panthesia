import { test, expect } from "@playwright/test";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The key flow of the product: open a file from its own location, set up the practice, play
// on the stage, see the song's files, return home and find it under recent files.
test("打开乐曲、跟随练习、查看歌曲文件并回到最近打开", async ({ page }) => {
  const folder = mkdtempSync(join(process.env.PANTHESIA_BASELINE_ARTIFACTS ?? tmpdir(), "songs-"));
  const song = join(folder, "five-finger.mid");
  copyFileSync(fileURLToPath(new URL("../../panthesia-engine/assets/five-finger.mid", import.meta.url)), song);

  await page.goto("/");
  const open = page.getByRole("button", { name: "打开乐曲…" }).first();
  await expect(open).toBeEnabled();
  page.once("dialog", (dialog) => void dialog.accept(song));
  await open.click();

  // Song setup: choose following practice with both hands and start.
  await expect(page.getByText("five-finger", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "双手", exact: true }).click();
  await page.getByRole("button", { name: "开始双手练习" }).click();
  await expect(page.locator(".required-notes strong")).toHaveText("C4");
  await page.getByRole("button", { name: "暂停", exact: true }).click();

  // Back to the setup screen; the song's files list its performance.
  await page.getByRole("button", { name: "返回" }).first().click();
  await page.locator("summary", { hasText: "更多" }).click();
  await page.getByRole("button", { name: "歌曲文件与版本…" }).click();
  const files = page.getByRole("dialog");
  await expect(files).toContainText("five-finger.mid");
  await page.keyboard.press("Escape");
  await expect(files).toHaveCount(0);

  // Home lists the song under recent files and opens it again.
  await page.getByRole("button", { name: "歌曲" }).first().click();
  const recent = page.getByTitle(song, { exact: true });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(page.locator(".product-setup-start button")).toHaveText(/^开始/);
});

test("设置页列出音乐设备并打开设备设置", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "音乐输入" })).toBeVisible();
  await page.getByText("内置 MIDI 音源").click();
  await expect(page.getByRole("heading", { name: "内置 MIDI 音源" })).toBeVisible();
});
