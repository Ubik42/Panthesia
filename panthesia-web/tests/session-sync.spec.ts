import { test, expect, type APIRequestContext } from "@playwright/test";
const base = "http://127.0.0.1:32124";
async function command(request: APIRequestContext, data: unknown) {
  const response = await request.post(`${base}/api/command`, {
    headers: { "X-Panthesia-Client": "web" },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("切换曲目后丢弃延迟到达的旧播放快照", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接")).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "五指热身 · 从中央 C 开始" })
    .click();
  await command(request, { type: "speed", value: 0.75 });
  await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue("75");
  let release!: () => void, captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let held = false;
  await page.route(`${base}/api/state`, async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await ready;
    await page
      .getByRole("listitem")
      .filter({ hasText: "C 大调音阶 · 一个八度" })
      .click();
    await expect(page.locator("h1")).toHaveText("C 大调音阶 · 一个八度");
    await page.getByLabel("播放速度", { exact: true }).focus();
    await page.keyboard.press("End");
    await expect
      .poll(
        async () => (await command(request, { type: "session" })).state.speed,
      )
      .toBe(2);
    await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue(
      "200",
    );
    await page.evaluate(() => {
      const values: string[] = [];
      (window as unknown as { observedSpeeds: string[] }).observedSpeeds =
        values;
      const observer = new MutationObserver(() => {
        values.push(
          (
            document.querySelector(
              '[aria-label="播放速度"]',
            ) as HTMLInputElement
          ).value,
        );
      });
      observer.observe(document.querySelector(".transport-bar")!, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    });
    let responses = 0;
    page.on("response", (response) => {
      if (response.url() === `${base}/api/state`) responses++;
    });
    release();
    await expect.poll(() => responses).toBeGreaterThanOrEqual(3);
    await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue(
      "200",
    );
    const observed = await page.evaluate(
      () => (window as unknown as { observedSpeeds: string[] }).observedSpeeds,
    );
    expect(observed).not.toContain("75");
  } finally {
    release();
  }
});

test("后端切曲后重新读取成组曲目与状态", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接")).toBeVisible();
  const song = await command(request, {
    type: "generate",
    spec: {
      tonic: 2,
      tonality: "Major",
      minor_form: "Natural",
      pattern: "Arpeggio",
      direction: "Ascending",
      hands: "Right",
      octaves: 1,
      repetitions: 1,
      tempo_bpm: 90,
    },
  });
  await command(request, { type: "speed", value: 1.25 });
  await expect(page.locator("h1")).toHaveText(song.title);
  await expect(page.getByLabel("播放速度", { exact: true })).toHaveValue("125");
  const session = await command(request, { type: "session" });
  expect(session.song.contentId).toBe(song.contentId);
  expect(session.state.contentId).toBe(song.contentId);
  expect(session.state.status).not.toBe("playing");
});
