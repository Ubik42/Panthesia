import type { WorkEntry } from "../../features/activity/workProgressStore";
import { startupStages, startupFailureTitles } from "../startupStages";
import type { Snapshot } from "../../api";
import type { SessionHealth } from "../../features/practice/sessionHealthStore";

export type RecoveryAction =
  | "readSession"
  | "retryStartup"
  | "skipStartup"
  | "saveRecording"
  | "openRecording"
  | "devices"
  | "dataFolder"
  | "workProgress"
  | "openWork"
  | "dismissAction"
  | "dismissStartup"
  | "reopenStartupSong"
  | "locateStartupSong"
  | "library";
export type RecoverySeverity = "blocking" | "attention" | "info";
export interface RecoveryIssue {
  id: string;
  version: string;
  severity: RecoverySeverity;
  title: string;
  detail: string;
  guidance: string;
  actions: RecoveryAction[];
  workId?: string;
  channelVersion?: number;
  startupWarning?: import("../../engine/commands.generated").StartupWarning;
  firstAt?: number;
  occurrences?: number;
}
export interface RecoveryContext {
  engineId?: string;
  connected: boolean;
  binding: boolean;
  reading: boolean;
  busy: boolean;
  commandPending: boolean;
  closing: boolean;
  title?: string;
  path?: string;
  state: Pick<
    Snapshot,
    | "contentId"
    | "startup"
    | "soundfontWarning"
    | "storage"
    | "recordingUnsaved"
    | "recordingPath"
    | "recording"
    | "error"
    | "sound"
    | "input"
    | "inputConnected"
    | "output"
  >;
}
export const recoveryActionLabels: Record<RecoveryAction, string> = {
  openWork: "返回对应工作台",
  readSession: "重新读取练习室",
  retryStartup: "重新恢复资料",
  skipStartup: "跳过上次曲目",
  saveRecording: "保存这份录音",
  openRecording: "打开录音回放",
  devices: "查看声音与键盘",
  dataFolder: "打开资料文件夹",
  workProgress: "查看工作进度",
  dismissAction: "收起操作提示",
  dismissStartup: "已了解，收起提示",
  reopenStartupSong: "重新打开上次曲目",
  locateStartupSong: "重新定位原文件",
  library: "回到主页",
};
export const savingLabels: Record<string, string> = {
  asset: "正在保存谱面与原谱资料",
  song: "正在准备并切换曲目",
  practice: "正在保存练习标注",
  recording: "正在保存录音并准备回放",
  closing: "正在保存并关闭练习室",
};
const samePath = (a?: string | null, b?: string | null) =>
  !!a &&
  !!b &&
  a.replaceAll("\\", "/").toLocaleLowerCase() ===
    b.replaceAll("\\", "/").toLocaleLowerCase();
export function projectRecovery(
  context: RecoveryContext,
  health: SessionHealth,
  work: readonly WorkEntry[] = [],
): RecoveryIssue[] {
  const { state } = context,
    rows: RecoveryIssue[] = [];
  const add = (row: Omit<RecoveryIssue, "version">) => {
    const source = row.startupWarning
      ? [row.startupWarning]
      : row.id === "storage"
        ? [state.storage?.version]
        : row.id === "recording" || row.id === "recording-saved"
          ? [state.recording, state.recordingUnsaved, state.recordingPath]
          : row.id === "sound"
            ? [state.output]
            : row.id === "keyboard"
              ? [state.input]
              : [];
    rows.push({
      ...row,
      version: JSON.stringify([
        context.engineId,
        row.title,
        row.detail,
        row.guidance,
        row.channelVersion,
        row.actions,
        source,
      ]),
    });
  };
  if (!context.connected)
    add({
      id: "connection",
      severity: health.connection.lostAt ? "blocking" : "info",
      title: health.connection.lostAt ? "练习室连接中断" : "正在连接练习室",
      detail: health.connection.lastFailure || "正在读取本地练习室的状态。",
      guidance:
        "连接恢复后，原曲目与已提交工作的结果会重新核对。当前窗口中的输入继续保留。",
      actions: ["readSession", "workProgress"],
      firstAt: health.connection.lostAt ?? undefined,
      occurrences: health.connection.failures,
    });
  if (state.startup?.ready) {
    for (const warning of state.startup.warnings ?? []) {
      const song = [
        "song",
        "skippedSong",
        "songAssets",
        "songLocation",
      ].includes(warning.kind);
      const devices = ["input", "output", "soundfont"].includes(warning.kind);
      const source = warning.source;
      const songRestored =
        warning.kind !== "songAssets" &&
        song &&
        !!source &&
        (source.kind === "recent"
          ? state.contentId === source.contentId
          : source.kind === "file" &&
            (source.contentId
              ? state.contentId === source.contentId
              : samePath(context.path, source.path)));
      const keyboardRestored = warning.kind === "input" && state.inputConnected;
      const fontRestored =
        warning.kind === "soundfont" &&
        !state.soundfontWarning &&
        state.sound?.ready;
      const resolved = songRestored || keyboardRestored || fontRestored;
      const sourceDetail =
        source?.kind === "file" && !warning.detail.includes(source.path)
          ? `\n曲目：${source.title || "上次练习"}\n位置：${source.path}`
          : "";
      const detail = warning.detail + sourceDetail;
      add({
        id: `startup-warning:${warning.id}`,
        severity:
          ["skippedSong", "songLocation"].includes(warning.kind) || resolved
            ? "info"
            : "attention",
        title: songRestored
          ? warning.kind === "songLocation"
            ? warning.title
            : "上次曲目已重新打开"
          : keyboardRestored
            ? "MIDI 键盘已连接"
            : fontRestored
              ? "钢琴音源已重新准备"
              : warning.title,
        detail: resolved
          ? `启动时的提示：${detail}`
          : warning.kind === "input" && state.input
            ? `${state.input}：${detail}`
            : detail,
        guidance: song
          ? "原曲目位置与已保存的记录保留。可重新打开，也可回到主页选择其他曲目。"
          : devices
            ? "设备设置保留，可连接原设备或重新选择。"
            : "原资料保留，可核对具体原因后继续处理。",
        actions: [
          ...(song && warning.source && !songRestored
            ? ["reopenStartupSong" as const]
            : []),
          ...(song &&
          warning.kind !== "songLocation" &&
          source?.kind === "file" &&
          source.contentId &&
          !songRestored
            ? ["locateStartupSong" as const]
            : []),
          ...(song ? ["library" as const] : []),
          ...(devices ? ["devices" as const] : []),
          ...(!song && !devices ? ["dataFolder" as const] : []),
          "dismissStartup",
        ],
        startupWarning: warning,
      });
    }
  }
  if (
    state.startup?.ready &&
    state.startup.error &&
    state.startup.warnings === undefined
  ) {
    add({
      id: "startup-legacy",
      severity: "attention",
      title: "启动恢复提示",
      detail: state.startup.error,
      guidance: "启动时的读取说明保留在此。可查看当前设备，或回到主页选择曲目。",
      actions: ["devices", "library", "dataFolder"],
    });
  }
  if (state.startup && !state.startup.ready && !state.startup.active)
    add({
      id: "startup",
      severity: "blocking",
      title: startupFailureTitles[state.startup.stage] || "练习室准备未完成",
      detail: state.startup.error || "上次练习资料暂时无法读取。",
      guidance: state.startup.canSkip
        ? "可跳过本次曲目读取，稍后从主页继续。"
        : "重新读取会继续处理原资料；已保存的文件与设置保留。",
      actions: [
        "retryStartup",
        ...(state.startup.canSkip ? ["skipStartup" as const] : []),
        ...(["preparingSound", "connectingInput", "connectingOutput"].includes(
          state.startup.stage,
        ) || state.sound?.error
          ? ["devices" as const]
          : []),
        "dataFolder",
        "workProgress",
      ],
    });
  else if (
    context.connected &&
    state.startup &&
    !state.startup.ready &&
    state.startup.active
  )
    add({
      id: "startup-progress",
      severity: "info",
      title: startupStages[state.startup.stage]?.[0] || "正在恢复练习室",
      detail:
        startupStages[state.startup.stage]?.[1] || "正在准备上次练习的资料。",
      guidance: state.startup.canSkip
        ? "可以跳过上次曲目，当前读取结束后进入练习室。"
        : "原资料正在读取，完成后可以继续练习。",
      actions: [
        ...(state.startup.canSkip ? ["skipStartup" as const] : []),
        "workProgress",
      ],
    });
  else if (
    context.connected &&
    context.binding &&
    state.startup?.ready !== false
  )
    add({
      id: "binding",
      severity: "info",
      title: "正在读取曲目与练习状态",
      detail: "音符与练习资料正在交接，完成后可以继续演奏。",
      guidance: "再次读取会核对当前来源；较旧的返回不会覆盖新的曲目。",
      actions: ["readSession"],
    });
  if (state.storage?.error)
    add({
      id: "storage",
      severity: "blocking",
      title: "练习资料尚未保存完成",
      detail: state.error?.includes(state.storage.error)
        ? state.error
        : state.storage.error,
      guidance:
        "请保留当前窗口，并查看资料文件夹或复制问题说明。完成资料处理后可重新读取练习室。",
      actions: ["dataFolder", "workProgress", "readSession"],
    });
  else if (state.storage?.pending && state.startup?.ready !== false)
    add({
      id: "saving",
      severity: "info",
      title:
        savingLabels[state.storage.operation ?? ""] ??
        "正在保存设置与练习资料",
      detail: "保存正在处理，完成结果会自动更新。",
      guidance: "可在工作进度中查看相关任务。",
      actions: ["workProgress"],
    });
  if (
    state.recordingUnsaved &&
    !(state.storage?.pending && !state.storage.error)
  )
    add({
      id: "recording",
      severity: "blocking",
      title: "自由演奏录音尚未保存",
      detail: "这份演奏仍保留在当前练习室中。",
      guidance: "保存完成后可打开录音回放；处理期间请保留练习室。",
      actions: ["saveRecording", "dataFolder"],
    });
  if (
    state.recordingPath &&
    !state.recordingUnsaved &&
    !samePath(state.recordingPath, context.path)
  )
    add({
      id: "recording-saved",
      severity: "info",
      title: "自由演奏录音已保存",
      detail: state.recordingPath,
      guidance: "可打开这份录音回放。",
      actions: ["openRecording"],
    });
  if (
    state.sound?.changing &&
    !state.storage?.pending &&
    state.startup?.ready !== false
  )
    add({
      id: "sound-changing",
      severity: "info",
      title: "正在准备声音设备",
      detail: "音源与输出正在交接，完成后可以继续演奏。",
      guidance: "可以在声音与键盘设置中查看原选择。",
      actions: ["devices"],
    });
  if (
    state.sound?.error &&
    !state.sound.changing &&
    !rows.some((row) => row.detail === state.sound?.error)
  )
    add({
      id: "sound",
      severity: "attention",
      title: "声音设备需要处理",
      detail: state.sound.error,
      guidance: "在声音与键盘设置中核对输出、音源和程序位置。",
      actions: ["devices", "readSession"],
    });
  if (
    state.input &&
    !state.inputConnected &&
    state.startup?.ready !== false &&
    !rows.some((issue) => issue.startupWarning?.kind === "input")
  )
    add({
      id: "keyboard",
      severity: "attention",
      title: "所选 MIDI 键盘尚未连接",
      detail: state.input,
      guidance: "接好设备后，可在声音与键盘设置中重新选择输入。",
      actions: ["devices", "readSession"],
    });
  for (const entry of work) {
    if (!entry.problem) continue;
    add({
      id: `work:${entry.id}`,
      workId: entry.id,
      severity: "attention",
      title: `${entry.title} · ${entry.problem.kind === "input" ? "输入暂存未完成" : entry.problem.kind === "refresh" ? "后台同步" : "需要继续处理"}`,
      detail: entry.problem.detail,
      guidance:
        (entry.stale ? "这项工作来自上次连接。" : "") +
        (entry.problem.kind === "input"
          ? `${entry.subject}的当前输入保留在工作台中，可返回重试暂存或复制原输入。`
          : `${entry.subject}的原请求与保留结果可从对应工作台继续核对。`),
      actions: ["openWork", "workProgress"],
    });
  }
  for (const row of health.issues) {
    const title =
      row.kind === "action" ? "上次操作需要处理" : "练习室资料读取未完成";
    if (rows.some((issue) => issue.detail === row.detail)) continue;
    add({
      id: `read:${row.kind}`,
      severity: "attention",
      title,
      detail: row.detail,
      guidance:
        row.kind === "action"
          ? "请查看原操作说明。重新读取只更新界面；需要继续的提交可从工作进度返回原入口。"
          : "重新读取对应资料会保留当前输入和已保存结果。",
      actions: [
        "readSession",
        "workProgress",
        ...(row.kind === "action" ? ["dismissAction" as const] : []),
      ],
      channelVersion: row.version,
      firstAt: row.firstAt,
      occurrences: row.occurrences,
    });
  }
  if (
    state.error &&
    !rows.some((row) => row.detail === state.error) &&
    !state.storage?.error &&
    state.error !== state.startup?.error
  )
    add({
      id: "engine",
      severity: "attention",
      title: "练习室需要处理",
      detail: state.error,
      guidance: "可重新读取当前状态，或打开工作进度查看原操作。",
      actions: ["readSession", "workProgress"],
    });
  const priority = { blocking: 0, attention: 1, info: 2 };
  return rows.sort((a, b) => priority[a.severity] - priority[b.severity]);
}

export function recoveryActionDisabled(
  context: RecoveryContext,
  action: RecoveryAction,
  desktop: boolean,
): string | null {
  if (context.closing) return "练习室正在准备退出，返回窗口后可继续。";
  if (action === "dataFolder")
    return desktop ? null : "资料文件夹需要从桌面版打开。";
  if (
    [
      "devices",
      "workProgress",
      "openWork",
      "dismissAction",
      "library",
    ].includes(action)
  )
    return null;
  if (action === "readSession")
    return context.reading ? "正在读取原请求，请等待本次读取结束。" : null;
  if (!context.connected) return "请先重新连接练习室。";
  if (action === "dismissStartup")
    return context.commandPending
      ? "正在处理当前操作，完成后可收起提示。"
      : context.state.startup?.ready
        ? null
        : "请等待启动恢复完成。";
  if (action === "locateStartupSong" && !desktop)
    return "重新定位原文件需要使用桌面版。";
  if (
    ["reopenStartupSong", "locateStartupSong"].includes(action) &&
    context.state.startup?.ready === false
  )
    return "请等待启动恢复完成。";
  if (action === "skipStartup")
    return context.commandPending
      ? "正在处理当前操作，请稍后再跳过。"
      : context.state.startup?.canSkip
        ? null
        : "当前启动阶段不能跳过上次曲目。";
  if (action === "retryStartup")
    return context.commandPending
      ? "正在处理当前操作，请稍后重试恢复。"
      : context.state.startup &&
          !context.state.startup.ready &&
          !context.state.startup.active
        ? null
        : "启动恢复的状态已经改变，请查看最新说明。";
  if (context.busy) return "当前保存或资料处理尚未结束，请等待原操作完成。";
  if (context.reading) return "正在读取练习状态，完成后可以继续。";
  if (context.binding) return "正在交接曲目资料，完成后可以继续。";
  if (action === "saveRecording")
    return context.state.recordingUnsaved
      ? null
      : "原录音的保存状态已经改变，请查看最新结果。";
  if (
    action === "openRecording" &&
    context.state.recording
  )
    return "请先完成录音或当前练习计划，再打开这份录音。";
  return null;
}
