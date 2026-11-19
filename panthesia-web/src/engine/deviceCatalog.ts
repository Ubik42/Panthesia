export type DeviceScanTarget = "input" | "output" | "plugins" | "all";
export interface DeviceScanStatus {
  available: boolean;
  ready: boolean;
  refreshing: boolean;
  scanning: boolean;
  startedAt: number | null;
  lastFinishedAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
}
export interface DeviceSnapshot {
  catalogId?: string;
  inputs: string[];
  outputs: string[];
  vst3: string[];
  revision: number;
  ready: boolean;
  refreshing: boolean;
  inputError: string | null;
  outputError: string | null;
  scans?: {
    input: DeviceScanStatus;
    output: DeviceScanStatus;
    plugins: DeviceScanStatus;
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const names = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 100_000 &&
  value.every((name) => typeof name === "string" && name.length <= 32768);
const message = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length <= 65536);
const timestamp = (value: unknown): value is number | null =>
  value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
function scan(value: unknown): DeviceScanStatus {
  if (
    !object(value) ||
    (value.available !== undefined && typeof value.available !== "boolean") ||
    typeof value.ready !== "boolean" ||
    typeof value.refreshing !== "boolean" ||
    typeof value.scanning !== "boolean" ||
    !timestamp(value.startedAt) ||
    !timestamp(value.lastFinishedAt) ||
    !timestamp(value.lastSuccessAt) ||
    !message(value.error)
  )
    throw new Error("设备读取状态尚未读齐，请刷新对应清单。");
  return {
    available: value.available !== false,
    ready: value.ready,
    refreshing: value.refreshing,
    scanning: value.scanning,
    startedAt: value.startedAt,
    lastFinishedAt: value.lastFinishedAt,
    lastSuccessAt: value.lastSuccessAt,
    error: value.error,
  };
}
export function readDeviceSnapshot(value: unknown): DeviceSnapshot {
  if (
    !object(value) ||
    !names(value.inputs) ||
    !names(value.outputs) ||
    !names(value.vst3) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.ready !== "boolean" ||
    typeof value.refreshing !== "boolean" ||
    !message(value.inputError) ||
    !message(value.outputError)
  )
    throw new Error("设备清单尚未读齐，请重新读取。");
  const catalogId = value.catalogId;
  if (
    catalogId !== undefined &&
    (typeof catalogId !== "string" ||
      catalogId.length < 1 ||
      catalogId.length > 256)
  )
    throw new Error("设备清单来源无法识别，请重新读取。");
  let scans: DeviceSnapshot["scans"];
  if (value.scans !== undefined) {
    if (!object(value.scans))
      throw new Error("设备读取状态尚未读齐，请重新读取。");
    scans = {
      input: scan(value.scans.input),
      output: scan(value.scans.output),
      plugins: scan(value.scans.plugins),
    };
  }
  return {
    catalogId,
    inputs: value.inputs,
    outputs: value.outputs,
    vst3: value.vst3,
    revision: value.revision as number,
    ready: value.ready,
    refreshing: value.refreshing,
    inputError: value.inputError,
    outputError: value.outputError,
    scans,
  };
}
