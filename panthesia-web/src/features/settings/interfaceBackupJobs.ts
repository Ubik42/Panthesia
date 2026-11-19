import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  decodeInterfaceBackup,
  interfaceBaseline,
  interfaceSnapshot,
  restoreInterface,
} from "./interfaceBackupModel";
import { getInterfaceSettings } from "./interfaceSettingsStore";
import {
  getInterfaceWorkbench,
  type InterfaceExport,
} from "./interfaceWorkbenchStore";

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
async function exclusive(job: () => Promise<void>) {
  const workbench = getInterfaceWorkbench();
  if (workbench.getSnapshot().busy) return;
  workbench.update({ busy: true, error: "" });
  try {
    await job();
  } catch (failure) {
    workbench.update({ error: message(failure) });
  } finally {
    workbench.update({ busy: false });
  }
}
export function loadInterfaceBackup(file: File) {
  return exclusive(async () => {
    if (file.size > 1_000_000) throw new Error("界面设置备份超过 1 MB。");
    const backup = decodeInterfaceBackup(await file.text()),
      settings = getInterfaceSettings(),
      current = settings.getSnapshot();
    getInterfaceWorkbench().update({
      preview: {
        backup,
        baseline: interfaceBaseline(current.preferences),
        current: current.preferences,
        layouts: current.layouts,
        filename: file.name,
      },
      groups: { display: true, keyboard: true, shortcuts: true },
      policies: Object.fromEntries(
        backup.layouts.map((row) => [row.id, "keep" as const]),
      ),
      status: "已读取备份，请核对恢复内容。",
    });
  });
}
async function savePrepared(record: InterfaceExport) {
  const workbench = getInterfaceWorkbench();
  workbench.update({
    preparedExport: { ...record, phase: "saving" },
    status: "正在另存已准备的界面备份…",
  });
  try {
    if (isTauri()) {
      const path = await invoke<string | null>("export_interface_settings", {
        contents: record.contents,
      });
      workbench.update({
        preparedExport: { ...record, phase: path ? "saved" : "prepared", path },
        exportPath: path ?? "",
        status: path
          ? `界面设置备份已导出：${path}`
          : "已取消另存，这份备份继续保留。",
      });
    } else {
      const url = URL.createObjectURL(
          new Blob([record.contents], { type: "application/json" }),
        ),
        anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = "Panthesia-界面设置.neosettings";
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      workbench.update({
        preparedExport: { ...record, phase: "requested", path: null },
        status: "已请求下载界面备份，请在浏览器下载位置查看。",
      });
    }
  } catch (failure) {
    workbench.update({
      preparedExport: { ...record, phase: "unknown" },
      status: "这份备份继续保留，可核对导出位置后重新另存。",
    });
    throw failure;
  }
}
export function exportCurrentInterface() {
  return exclusive(async () => {
    const workbench = getInterfaceWorkbench(),
      previous = workbench.getSnapshot().preparedExport;
    if (previous && !["saved", "requested"].includes(previous.phase))
      throw new Error("上次准备的备份仍在保留，可继续另存或清除此导出记录。");
    const contents = JSON.stringify(
      interfaceSnapshot(getInterfaceSettings().getSnapshot().preferences),
      null,
      2,
    );
    if (new Blob([contents]).size > 1_000_000)
      throw new Error(
        "当前界面备份超过 1 MB，请先复制当前设置或保留本机原文。",
      );
    await savePrepared({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      contents,
      path: null,
      phase: "prepared",
    });
  });
}
export function savePreparedInterface() {
  return exclusive(async () => {
    const record = getInterfaceWorkbench().getSnapshot().preparedExport;
    if (!record) throw new Error("请先准备一份界面设置备份。");
    await savePrepared(record);
  });
}
export function applyInterfaceBackup() {
  return exclusive(async () => {
    const workbench = getInterfaceWorkbench(),
      draft = workbench.getSnapshot(),
      preview = draft.preview;
    if (!preview) throw new Error("请先读取界面设置备份。");
    await restoreInterface(
      preview.backup,
      getInterfaceSettings().getSnapshot().preferences,
      preview.baseline,
      draft.groups,
      draft.policies,
    );
    workbench.update({
      preview: null,
      error: "",
      status: "所选界面设置和布局已恢复并保存在本机。",
    });
  });
}
