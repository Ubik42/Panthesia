import type { WorkEntry } from "../activity/workProgressStore";
import { getInterfaceSettings } from "./interfaceSettingsStore";
import {
  getInterfaceWorkbench,
  hasLayoutNameInput,
} from "./interfaceWorkbenchStore";

export function collectInterfaceWork(): WorkEntry | null {
  const store = getInterfaceSettings(),
    settings = store.getSnapshot();
  const workbench = getInterfaceWorkbench(),
    draft = workbench.getSnapshot();
  const layoutInput = hasLayoutNameInput(draft, settings.layouts);
  const exportWaiting =
    draft.preparedExport &&
    !["saved", "requested"].includes(draft.preparedExport.phase);
  const running = settings.saving || settings.maintenance || draft.busy;
  const error =
    settings.error ||
    draft.storageError ||
    draft.error ||
    (draft.preparedExport?.phase === "unknown"
      ? "上次界面备份导出的回复尚未确认，原备份内容已保留。"
      : "");
  if (
    !layoutInput &&
    !exportWaiting &&
    !error &&
    !settings.pending &&
    !running &&
    !settings.protected &&
    !draft.preview
  )
    return null;
  const detail =
    error ||
    (settings.pending
      ? "当前调整已生效，等待完成本机保存。"
      : draft.preview
        ? "界面备份及恢复选择已保留，可返回核对差异。"
        : exportWaiting
          ? "已准备的界面备份仍待另存，可返回继续。"
          : layoutInput
            ? "布局名称输入已暂存，可返回继续编辑方案。"
            : "界面设置文件正在处理。");
  return {
    id: "interface-settings",
    title: "界面与按键设置",
    target: "interface-settings",
    subject:
      draft.preview?.filename ||
      (exportWaiting
        ? "已准备的界面备份"
        : layoutInput
          ? draft.name
          : "本机界面设置"),
    phase: running
      ? "running"
      : error || settings.protected
        ? "attention"
        : "waiting",
    detail,
    problem: error ? { kind: "input", detail: error } : undefined,
    copy: () =>
      JSON.stringify(
        {
          settings: JSON.parse(store.copyInput()),
          workbench: JSON.parse(workbench.copyInput()),
        },
        null,
        2,
      ),
    version: JSON.stringify([
      settings.revision,
      draft.preview?.filename,
      draft.preview?.backup.createdAt,
      draft.groups,
      draft.policies,
      draft.busy,
      draft.name,
      draft.selected,
      draft.preparedExport?.id,
      draft.preparedExport?.phase,
      error,
    ]),
  };
}
