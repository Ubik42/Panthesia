import { api, type EngineCommand, type Snapshot } from "../../api";
import type { RecoveryAction, RecoveryIssue } from "./sessionRecoveryModel";
import type { SessionRecoveryStore } from "./sessionRecoveryStore";
import type { WorkOpenResult } from "../../features/activity/WorkProgress";

export interface RecoveryHost {
  snapshot: () => Snapshot;
  commandPending: () => boolean;
  command: (value: EngineCommand, changesSong?: boolean) => Promise<boolean>;
  refresh: (
    kind: "session" | "library" | "collection",
  ) => Promise<"refreshed" | "superseded">;
  practice: (signal?: AbortSignal) => Promise<boolean>;
  work: (id: string, signal: AbortSignal) => Promise<WorkOpenResult | null>;
  devices: () => void;
  syncState: () => Promise<void>;
  startupSong: (
    warning: import("../../engine/commands.generated").StartupWarning,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  library: (signal?: AbortSignal) => Promise<boolean>;
  locateStartupSong: (
    warning: import("../../engine/commands.generated").StartupWarning,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  progress: () => void;
  close: () => void;
}
/** Reading refreshes only the requested source. Writes retain their original engine and current state checks. */
export async function performRecoveryAction(
  store: SessionRecoveryStore,
  host: () => RecoveryHost,
  issue: RecoveryIssue,
  action: RecoveryAction,
  signal?: AbortSignal,
) {
  await store.perform(issue, action, async (origin, originalIssue) => {
    if (action === "openWork") {
      const result = originalIssue.workId
        ? await host().work(
            originalIssue.workId,
            signal ?? new AbortController().signal,
          )
        : null;
      if (!result) return "这项工作已更新，可从工作进度查看当前结果。";
      if (!result.ok)
        throw new Error(result.error || "对应工作台暂未打开，原输入继续保留。");
      host().close();
      return "对应工作台已打开，原输入与提交条件继续保留。";
    }
    if (action === "workProgress") {
      host().progress();
      return "工作进度已打开，可返回原提交继续处理。";
    }
    if (action === "library") {
      if (!(await host().library(signal)))
        throw new Error("请先处理当前工作区中的编辑，再进入曲库。");
      host().close();
      return "曲库已打开，可选择其他曲目或重新定位原文件。";
    }
    if (action === "devices") {
      host().devices();
      return "声音与键盘设置已打开。";
    }
    if (action === "dismissAction") {
      if (
        !originalIssue.channelVersion ||
        !store.health.dismissAction(originalIssue.channelVersion)
      )
        throw new Error("操作提示已经更新，请查看最新说明。");
      return "这条操作提示已收起。已有资料与待处理工作继续保留。";
    }
    if (action === "dataFolder") {
      await api.openDataFolder();
      return "资料文件夹已打开。完成文件处理后可重新读取对应资料。";
    }
    if (
      action === "readSession" ||
      action === "readLibrary" ||
      action === "readCollection"
    ) {
      const result = await host().refresh(
        action === "readSession"
          ? "session"
          : action === "readLibrary"
            ? "library"
            : "collection",
      );
      return result === "superseded"
        ? "原读取已由更新的请求接续，请查看最新显示。"
        : "原资料已重新读取。请查看当前状态；仍需处理的工作继续保留。";
    }
    if (signal?.aborted) return "已停止等待打开来源，原资料继续保留。";
    const fresh = await api.state();
    if (signal?.aborted) return "已停止等待打开来源，原资料继续保留。";
    const current = host(),
      live = current.snapshot();
    if (fresh.stateOrder?.engineId !== live.stateOrder?.engineId)
      throw new Error("这次读取来自上次连接，请重新读取当前练习室后继续。");
    if (store.getContext()?.closing)
      throw new Error("练习室正在准备退出，返回窗口后可继续。");
    if (
      fresh.stateOrder?.engineId !== origin.engineId ||
      (!origin.engineId &&
        (fresh.contentId !== origin.state.contentId ||
          live.contentId !== origin.state.contentId))
    )
      throw new Error(
        "练习室连接或来源已改变，请重新读取当前状态后再处理原保存。",
      );
    if (current.commandPending())
      throw new Error("当前操作仍在处理，请等待原结果后继续。");
    const failure = (fallback: string) =>
      new Error(store.health.getMessages().action || fallback);
    if (
      ["dismissStartup", "reopenStartupSong", "locateStartupSong"].includes(
        action,
      )
    ) {
      const warning = originalIssue.startupWarning;
      const latest = fresh.startup?.warnings?.find(
        (row) => row.id === warning?.id,
      );
      if (
        !warning ||
        !latest ||
        JSON.stringify(latest) !== JSON.stringify(warning)
      )
        throw new Error("启动提示已更新，请查看当前结果后再处理。");
      if (action === "dismissStartup") {
        await api.commandForEngine(origin.engineId, {
          type: "dismissStartupWarning",
          id: warning.id,
        });
        await host().syncState();
        return "这条启动提示已收起，原资料和设备设置继续保留。";
      }
      if (!latest.source)
        throw new Error("原曲目来源尚未读到，请从曲库重新选择。");
      const opened =
        action === "locateStartupSong"
          ? await host().locateStartupSong(latest, signal)
          : await host().startupSong(latest, signal);
      if (signal?.aborted) return "已停止等待读取上次曲目，原来源继续保留。";
      if (!opened) {
        if (action === "locateStartupSong")
          return "已保留原文件位置，可以稍后重新选择。";
        throw new Error("上次曲目尚未打开，请查看当前练习与保存状态。");
      }
      host().close();
      return "上次曲目的打开请求已保留，可从曲目打开进度继续查看。";
    }
    if (action === "retryStartup" || action === "skipStartup") {
      if (fresh.startup?.ready) return "练习资料已恢复，可以查看当前练习室。";
      if (
        (action === "retryStartup" &&
          (!fresh.startup || fresh.startup.active)) ||
        (action === "skipStartup" && !fresh.startup?.canSkip)
      )
        throw new Error("启动阶段已经改变，请查看最新状态后继续。");
      if (
        !(await current.command({
          type: action === "skipStartup" ? "skipStartupSong" : "retryStartup",
        }))
      )
        throw failure("启动处理尚未确认，请查看当前说明。");
      return action === "retryStartup"
        ? "已请求重新恢复原资料，进度会继续显示。"
        : "已请求跳过上次曲目，当前读取结束后继续。";
    }
    if (action === "saveRecording") {
      if (
        !fresh.recordingUnsaved ||
        !live.recordingUnsaved ||
        fresh.recording !== origin.state.recording ||
        live.recording !== origin.state.recording ||
        fresh.recordingPath !== origin.state.recordingPath ||
        live.recordingPath !== origin.state.recordingPath
      )
        throw new Error("原录音的状态已经改变，请查看当前录音结果后再操作。");
      if (!(await current.command({ type: "recording", active: false }, true)))
        throw failure("这份录音尚未确认保存，请保留练习室并查看当前状态。");
      return "录音保存请求已处理，保存完成后可打开回放。";
    }
    if (action === "openRecording") {
      if (
        !fresh.recordingPath ||
        fresh.recordingUnsaved ||
        fresh.recordingPath !== origin.state.recordingPath ||
        fresh.recording ||
        live.recording
      )
        throw new Error(
          "录音或当前练习的状态已经改变，请查看最新结果后再打开回放。",
        );
      if (!(await current.practice(signal)) || signal?.aborted)
        throw failure("录音尚未打开，请先处理当前工作区中的提示。");
      const destination = host(),
        beforeOpen = destination.snapshot();
      if (
        beforeOpen.stateOrder?.engineId !== fresh.stateOrder?.engineId ||
        beforeOpen.recording ||
        beforeOpen.recordingUnsaved ||
        destination.commandPending()
      )
        throw new Error(
          "当前连接或演奏状态已经改变，请重新读取录音结果后再打开。",
        );
      if (
        !(await destination.command(
          { type: "openFile", path: fresh.recordingPath },
          true,
        ))
      )
        throw failure("录音尚未打开，请先处理练习室中的提示。");
      if (signal?.aborted) return "原录音打开请求已返回，当前界面继续保留。";
      host().close();
      return "已打开这份录音回放。";
    }
  });
}
