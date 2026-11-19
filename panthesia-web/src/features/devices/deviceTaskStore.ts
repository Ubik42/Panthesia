import { api } from "../../api";
import { taskMonitor, type Task } from "../../engine/taskStore";

const labels = new Set([
  "连接 MIDI 键盘",
  "连接演奏音源",
  "准备钢琴音源",
  "打开音源窗口",
]);
const running = (task: Task) =>
  ["queued", "running", "committing"].includes(task.state);
export interface DeviceWork {
  engineId: string;
  task: Task;
  lost?: boolean;
  readError?: string;
}
export function deviceTaskMessage(task: Task): string {
  if (task.state === "queued") return "设备请求已排队，等待后台处理。";
  switch (task.stage) {
    case "connectingInput":
      return "正在后台准备键盘连接，原有选择继续保留。";
    case "connectingSound":
      return "正在准备演奏音源，准备完成后保存所选设备。";
    case "readingSound":
      return "正在读取并准备钢琴音色。";
    case "openingEditor":
      return "正在准备乐器窗口。";
    default:
      return "设备工作在后台继续，可返回设置查看或取消。";
  }
}
export function createDeviceTaskStore() {
  const records = new Map<string, DeviceWork>();
  const listeners = new Set<() => void>();
  let snapshot: readonly DeviceWork[] = [];
  let signature = "[]";
  let context: { engineId?: string; connected: boolean; closing: boolean } = {
    connected: false,
    closing: false,
  };
  let monitor: ReturnType<typeof taskMonitor> | undefined;
  let release: (() => void) | undefined;
  const publish = () => {
    while (records.size > 128) {
      const removable = [...records].find(
        ([, record]) =>
          !running(record.task) || record.engineId !== context.engineId,
      );
      records.delete(removable?.[0] ?? records.keys().next().value!);
    }
    const next = [...records.values()];
    const key = JSON.stringify(next);
    if (key === signature) return;
    signature = key;
    snapshot = next;
    for (const notify of [...listeners]) notify();
  };
  const bind = () => {
    release?.();
    release = undefined;
    monitor = undefined;
    const engineId = context.engineId;
    if (!listeners.size || !engineId || !context.connected || context.closing)
      return;
    const current = taskMonitor(engineId);
    monitor = current;
    const update = () => {
      if (monitor !== current || context.engineId !== engineId) return;
      const frame = current.getSnapshot();
      if (frame.observed && !frame.error) {
        const present = new Set(frame.tasks.map((task) => task.id));
        for (const [key, record] of records) {
          if (
            record.engineId === engineId &&
            running(record.task) &&
            !present.has(record.task.id)
          )
            records.set(key, { ...record, lost: true, readError: undefined });
        }
        for (const task of frame.tasks) {
          if (labels.has(task.label))
            records.set(`${engineId}:${task.id}`, { engineId, task });
        }
      } else if (frame.error) {
        for (const [key, record] of records) {
          if (record.engineId === engineId && running(record.task))
            records.set(key, { ...record, readError: frame.error });
        }
      }
      publish();
    };
    release = current.subscribe(update);
    update();
  };
  return {
    getSnapshot: () => snapshot,
    setContext(next: typeof context) {
      if (JSON.stringify(next) !== JSON.stringify(context)) {
        context = next;
        bind();
      }
    },
    refresh: async () => {
      await monitor?.refresh();
    },
    cancel: async (record: DeviceWork) => {
      await api.commandForEngine(record.engineId, {
        type: "cancelTask",
        id: record.task.id,
      });
      await monitor?.refresh();
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      if (listeners.size === 1) bind();
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          release?.();
          release = undefined;
          monitor = undefined;
        }
      };
    },
  };
}
