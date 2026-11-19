import { test, expect } from "@playwright/test";
import { request as httpRequest } from "node:http";

const base = "http://127.0.0.1:32124";
const headers = { "X-Panthesia-Client": "web" };

test("指法窗口等待结果时仍可执行已配置的停止发声快捷键", async ({
  page,
  request,
}) => {
  const command = async (data: unknown) => {
    const response = await request.post(`${base}/api/command`, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await command({
    type: "generate",
    spec: {
      tonic: 0,
      tonality: "Major",
      minor_form: "Natural",
      pattern: "Scale",
      direction: "UpAndDown",
      hands: "Both",
      octaves: 1,
      repetitions: 1,
      tempo_bpm: 120,
    },
  });
  await page.goto("/");
  await expect(page.getByText("本地引擎已连接", { exact: true })).toBeVisible();
  await page.getByLabel("显示与电脑键盘设置").click();
  const settings = page.getByRole("dialog", { name: "显示与电脑键盘" });
  await settings
    .getByLabel("修改快捷键：暂停并停止发声", { exact: true })
    .click();
  await page.keyboard.press("Control+Shift+q");
  const binding = settings.getByLabel("修改快捷键：暂停并停止发声", {
    exact: true,
  });
  await binding.click();
  await page.keyboard.press("Control+Shift+q");
  await expect(binding).toHaveAttribute("aria-pressed", "false");
  await settings.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "指法建议", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "指法建议", exact: true });
  let captured!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${base}/api/command`, async (route) => {
    if (route.request().postDataJSON()?.type !== "suggestFingerPlans")
      return route.continue();
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await dialog.getByRole("button", { name: "生成建议", exact: true }).click();
    await ready;
    await expect(
      dialog.getByRole("button", { name: "关闭指法建议", exact: true }),
    ).toBeDisabled();
    await command({ type: "countIn", bars: 0 });
    await command({ type: "mode", value: "listen" });
    await command({ type: "play" });
    await page.keyboard.press("Control+Shift+q");
    await expect
      .poll(
        async () =>
          (await (await request.get(`${base}/api/state`)).json()).status,
      )
      .toBe("paused");
  } finally {
    release();
  }
  await expect(
    dialog.getByRole("button", { name: "关闭指法建议", exact: true }),
  ).toBeEnabled();
});

test("文件上传未完成时仍能读取状态、暂停和停止发声", async ({ request }) => {
  const upload = httpRequest(`${base}/api/score-attachment/add`, {
    method: "POST",
    headers: {
      ...headers,
      "X-Panthesia-Song": "held-upload",
      "X-Panthesia-Name": "held.pdf",
      "Content-Length": "2048",
    },
  });
  upload.on("error", () => {});
  upload.on("response", (response) => response.resume());
  upload.write(Buffer.from([0]));
  try {
    await expect
      .poll(async () => {
        const response = await request.get(`${base}/api/service-status`, {
          timeout: 2000,
        });
        return (await response.json()).businessActive;
      })
      .toBe(1);
    for (const type of ["pause", "panic", "tasks"]) {
      const response = await request.post(`${base}/api/control`, {
        headers,
        data: { type },
        timeout: 2000,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const state = await request.get(`${base}/api/state`, { timeout: 2000 });
    expect(state.ok()).toBeTruthy();
    expect((await state.json()).status).toBe("paused");
  } finally {
    upload.destroy();
  }
  await expect
    .poll(
      async () =>
        (await (await request.get(`${base}/api/service-status`)).json())
          .businessActive,
    )
    .toBe(0);
});

test("控制通道保留来源、命令种类和请求大小检查", async ({ request }) => {
  for (const options of [
    { headers: {}, data: { type: "pause" } },
    {
      headers: { ...headers, Origin: "https://example.com" },
      data: { type: "panic" },
    },
    { headers, data: { type: "speed", value: 0.5 } },
    { headers, data: " ".repeat(4097) },
  ]) {
    const response = await request.post(`${base}/api/control`, options);
    expect(response.ok()).toBeFalsy();
    expect([400, 403]).toContain(response.status());
  }
  const response = await request.post(`${base}/api/control`, {
    headers,
    data: { type: "tasks" },
  });
  expect(response.ok()).toBeTruthy();
  expect(Array.isArray(await response.json())).toBeTruthy();
});
