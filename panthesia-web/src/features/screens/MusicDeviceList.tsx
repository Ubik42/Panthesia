import { useDeviceCatalog } from "../devices/useDeviceCatalog";
import type { Snapshot } from "../../api";
export type DeviceObject = {
  kind: "input" | "output";
  name: string;
  label: string;
};
const pluginName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.vst3$/i, "") ?? path;
export function MusicDeviceList({
  engineId,
  state,
  disabled,
  open,
}: {
  engineId?: string;
  state: Pick<Snapshot, "input" | "inputConnected" | "output" | "outputId">;
  disabled: boolean;
  open: (device: DeviceObject) => void;
}) {
  const { devices, deviceError } = useDeviceCatalog(engineId);
  const output =
    state.outputId ?? (state.output === "内置钢琴" ? "" : state.output);
  const inputs = [
    ...new Set([...devices.inputs, ...(state.input ? [state.input] : [])]),
  ];
  const outputs: DeviceObject[] = [
    { kind: "output", name: "", label: "内置 MIDI 音源" },
    ...devices.vst3.map((path) => ({
      kind: "output" as const,
      name: `vst3:${path}`,
      label: pluginName(path),
    })),
    ...devices.outputs.map((name) => ({
      kind: "output" as const,
      name,
      label: /Microsoft GS Wavetable/i.test(name)
        ? "Windows 系统 MIDI 音源"
        : name,
    })),
  ];
  if (output && !outputs.some((d) => d.name === output))
    outputs.push({ kind: "output", name: output, label: state.output });
  const row = (device: DeviceObject, enabled: boolean) => (
    <button
      key={device.name}
      className="product-device-row"
      disabled={disabled}
      onClick={() => open(device)}
    >
      <span>{device.label}</span>
      <small>{enabled ? "正在使用" : "关闭"}</small>
      <b aria-hidden="true">›</b>
    </button>
  );
  return (
    <div className="product-device-list">
      <h2>音乐输入</h2>
      <div>
        {row(
          { kind: "input", name: "", label: "Panthesia 虚拟钢琴" },
          !state.input,
        )}
        {inputs.map((name) =>
          row(
            { kind: "input", name, label: name },
            state.input === name && state.inputConnected,
          ),
        )}
      </div>
      <h2>音乐输出</h2>
      <div>{outputs.map((device) => row(device, device.name === output))}</div>
      {!devices.ready && <p role="status">正在读取设备…</p>}
      {deviceError && <p role="status">{deviceError}</p>}
    </div>
  );
}
