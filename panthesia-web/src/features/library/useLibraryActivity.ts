import { useEffect, useRef, useState } from "react";
import { api, type EngineCommand, type LibraryMonitorStatus } from "../../api";
import { shareWireValue } from "../../engine/wireValues";

export interface IndexProgress {
  status: string;
  done: number;
  total: number;
  errors: number;
  current: string;
  message: string;
}
type IndexCommand = Extract<
  EngineCommand,
  { type: "indexLibrary" | "pauseIndex" | "resumeIndex" | "cancelIndex" }
>;
type Row<T> = { epoch: number; value: T };
type Channel = "index" | "monitor";

/** Read activity without replaying writes or letting an older poll undo a user action. */
export function useLibraryActivity(
  engineId: string | undefined,
  reload: () => Promise<unknown>,
  canRefresh: () => boolean = () => true,
) {
  const [indexRow, setIndexRow] = useState<Row<IndexProgress> | null>(null);
  const [monitorRow, setMonitorRow] =
    useState<Row<LibraryMonitorStatus> | null>(null);
  const [errors, setErrors] = useState({ epoch: 0, index: "", monitor: "" });
  const epoch = useRef(0),
    engine = useRef(engineId),
    alive = useRef(true);
  const writes = useRef({ index: 0, monitor: 0 });
  const changing = useRef({ index: false, monitor: false });
  const readAgain = useRef(reload);
  const refreshAllowed = useRef(canRefresh);
  const wake = useRef<(() => void) | null>(null);
  readAgain.current = reload;
  refreshAllowed.current = canRefresh;
  if (engine.current !== engineId) {
    engine.current = engineId;
    epoch.current++;
    writes.current = {
      index: writes.current.index + 1,
      monitor: writes.current.monitor + 1,
    };
    changing.current = { index: false, monitor: false };
  }
  const report = (source: number, channel: Channel, message: string) => {
    if (!alive.current || source !== epoch.current) return;
    setErrors((previous) => {
      if (source !== epoch.current) return previous;
      const current =
        previous.epoch === source
          ? previous
          : { epoch: source, index: "", monitor: "" };
      return current[channel] === message
        ? current
        : { ...current, [channel]: message };
    });
  };
  const installIndex = (source: number, value: IndexProgress) => {
    if (!alive.current || source !== epoch.current) return;
    setIndexRow((previous) => {
      if (source !== epoch.current) return previous;
      const next = previous ? shareWireValue(previous.value, value) : value;
      return previous?.epoch === source && next === previous.value
        ? previous
        : { epoch: source, value: next };
    });
    report(source, "index", "");
  };
  const installMonitor = (source: number, value: LibraryMonitorStatus) => {
    if (!alive.current || source !== epoch.current) return;
    setMonitorRow((previous) => {
      if (source !== epoch.current) return previous;
      const next = previous ? shareWireValue(previous.value, value) : value;
      return previous?.epoch === source && next === previous.value
        ? previous
        : { epoch: source, value: next };
    });
    report(source, "monitor", "");
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false,
      requested = false;
    const source = epoch.current;
    let lastReload = 0,
      previousStatus: string | undefined,
      refreshedRevision: number | undefined,
      refreshPending = false,
      failures = 0;
    const poll = async () => {
      if (polling || stopped || source !== epoch.current) return;
      polling = true;
      const versions = { ...writes.current },
        writable = {
          index: !changing.current.index,
          monitor: !changing.current.monitor,
        };
      const current = () =>
        !stopped && alive.current && source === epoch.current;
      const [index, monitor] = await Promise.allSettled([
        api.commandForEngine<IndexProgress>(engineId, { type: "indexStatus" }),
        api.commandForEngine<LibraryMonitorStatus>(engineId, {
          type: "libraryMonitorStatus",
        }),
      ]);
      if (!current()) {
        polling = false;
        return;
      }
      const accept = (channel: Channel) =>
        writable[channel] &&
        !changing.current[channel] &&
        versions[channel] === writes.current[channel];
      let progress: IndexProgress | undefined,
        watch: LibraryMonitorStatus | undefined,
        failed = false;
      if (accept("index")) {
        if (index.status === "fulfilled") {
          progress = index.value;
          installIndex(source, progress);
        } else {
          failed = true;
          report(
            source,
            "index",
            `后台索引状态：${index.reason instanceof Error ? index.reason.message : String(index.reason)}`,
          );
        }
      }
      if (accept("monitor")) {
        if (monitor.status === "fulfilled") {
          watch = monitor.value;
          installMonitor(source, watch);
        } else {
          failed = true;
          report(
            source,
            "monitor",
            `自动更新状态：${monitor.reason instanceof Error ? monitor.reason.message : String(monitor.reason)}`,
          );
        }
      }
      const now = Date.now();
      if (!lastReload) lastReload = now;
      if (refreshedRevision === undefined && watch)
        refreshedRevision = watch.revision;
      const changed =
        progress &&
        previousStatus !== undefined &&
        previousStatus !== progress.status;
      const working =
        progress?.status === "running" ||
        (watch && refreshedRevision !== watch.revision);
      if (changed || working) refreshPending = true;
      if (
        refreshPending &&
        (changed || now - lastReload > 2000) &&
        refreshAllowed.current() &&
        !changing.current.index &&
        !changing.current.monitor
      ) {
        try {
          await readAgain.current();
        } catch {
          /* The owning library reader retains its own failure and retry action. */
        }
        if (!current()) {
          polling = false;
          return;
        }
        lastReload = Date.now();
        refreshPending = false;
        if (watch) refreshedRevision = watch.revision;
      }
      if (progress) previousStatus = progress.status;
      failures = failed ? failures + 1 : 0;
      const active =
        progress?.status === "running" ||
        (watch && ["loading", "scanning", "updating"].includes(watch.phase));
      const delay = document.hidden
        ? 5000
        : failures
          ? Math.min(5000, 750 * 2 ** Math.min(failures, 3))
          : active
            ? 750
            : 2000;
      polling = false;
      if (current())
        timer = setTimeout(() => void poll(), requested ? 0 : delay);
      requested = false;
    };
    const refresh = () => {
      if (stopped || source !== epoch.current) return;
      failures = 0;
      clearTimeout(timer);
      if (polling) requested = true;
      else void poll();
    };
    wake.current = refresh;
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wake.current === refresh) wake.current = null;
    };
  }, [engineId]);
  const mutate = async <T>(
    channel: Channel,
    command: EngineCommand,
    install: (source: number, value: T) => void,
  ) => {
    if (!alive.current || engine.current !== engineId)
      throw new Error("曲库连接已改变，请等待重新读取后再操作。");
    if (changing.current[channel])
      throw new Error("这项曲库操作仍在处理，请等待完成。");
    const source = epoch.current;
    const version = ++writes.current[channel];
    changing.current[channel] = true;
    try {
      const value = await api.commandForEngine<T>(engineId, command);
      if (!alive.current || source !== epoch.current)
        throw new Error("曲库连接已改变，原操作的结果将重新读取。");
      install(source, value);
      return value;
    } finally {
      if (writes.current[channel] === version) {
        changing.current[channel] = false;
        if (alive.current && source === epoch.current) wake.current?.();
      }
    }
  };
  const currentErrors =
    errors.epoch === epoch.current ? errors : { index: "", monitor: "" };
  return {
    background: indexRow?.value ?? null,
    monitor: monitorRow?.value ?? null,
    backgroundCurrent:
      indexRow?.epoch === epoch.current && !currentErrors.index,
    monitorCurrent:
      monitorRow?.epoch === epoch.current && !currentErrors.monitor,
    error: [currentErrors.index, currentErrors.monitor]
      .filter(Boolean)
      .join("；"),
    refresh: () => wake.current?.(),
    index: (command: IndexCommand) =>
      mutate<IndexProgress>("index", command, installIndex),
    setMonitoring: (enabled: boolean) =>
      mutate<LibraryMonitorStatus>(
        "monitor",
        { type: "setLibraryMonitor", enabled },
        installMonitor,
      ),
  };
}
