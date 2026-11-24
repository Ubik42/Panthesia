import { api } from "../api";

/** The desktop window itself goes full screen (a page-level fullscreen in the webview would
 * not resize the window); the browser debug build uses the page fullscreen. */
export function toggleFullscreen(fail: (message: string) => void) {
  if (api.desktop) {
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const window = getCurrentWindow();
        await window.setFullscreen(!(await window.isFullscreen()));
      })
      .catch(() => fail("当前窗口无法进入全屏"));
  } else if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => fail("当前窗口无法进入全屏"));
}
