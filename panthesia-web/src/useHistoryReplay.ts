import { isLiveDemo } from "./engine/demoApi";
import type {
  DemoState as ReplayState,
  EngineCommand,
} from "./engine/commands.generated";
import { requireValue } from "./engine/requireValue";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  historySourceApi,
  requireHistorySource,
  historyFailure,
  HistorySourceError,
  type HistorySource,
  type HistorySourceIssue,
} from "./features/review/historySource";
interface ReplayOwner {
  id: string;
  engineId: string;
}
export function useHistoryReplay(
  contentId: string,
  id: string,
  enabled = true,
  onPosition?: (position: number | null) => void,
  onActivity?: (active: boolean) => void,
  engineId?: string,
  historySource?: HistorySource,
) {
  const [phase, setPhase] = useState<
      "idle" | "running" | "paused" | "finished"
    >("idle"),
    [busy, setBusy] = useState(false),
    [stopPending, setStopPending] = useState(false),
    [error, setError] = useState(""),
    [sourceIssue, setSourceIssue] = useState<HistorySourceIssue | null>(null),
    [position, setPosition] = useState(0),
    [end, setEnd] = useState(0),
    [loop, setLoop] = useState<{ start: number; end: number } | null>(null),
    [loopRounds, setLoopRounds] = useState(0),
    [boundEngine, setBoundEngine] = useState(engineId);
  const owner = useRef<ReplayOwner | null>(null),
    stopping = useRef<ReplayOwner | null>(null),
    preparing = useRef<ReplayOwner | null>(null),
    epoch = useRef(0),
    alive = useRef(true),
    working = useRef<number | null>(null),
    callbacks = useRef({ onPosition, onActivity }),
    sourceRef = useRef("");
  const source = JSON.stringify([
    contentId,
    id,
    engineId,
    historySource?.conditionsRevision,
    historySource?.performanceRevision,
  ]);
  sourceRef.current = source;
  callbacks.current = { onPosition, onActivity };
  const current = (request: number) =>
    alive.current && sourceRef.current === source && epoch.current === request;
  const stopOwner = (own: ReplayOwner) =>
    api.commandForEngine(own.engineId, { type: "stopFingerDemo", id: own.id });
  const stop = async () => {
    const request = ++epoch.current;
    const own = owner.current ?? preparing.current ?? stopping.current;
    preparing.current = null;
    owner.current = null;
    working.current = null;
    callbacks.current.onPosition?.(null);
    callbacks.current.onActivity?.(false);
    if (alive.current) {
      setPhase("idle");
      setBusy(false);
      setLoop(null);
      setLoopRounds(0);
    }
    if (!own) return true;
    stopping.current = own;
    if (alive.current) setStopPending(true);
    try {
      await stopOwner(own);
      if (stopping.current === own) {
        stopping.current = null;
        if (alive.current) setStopPending(false);
      }
      return true;
    } catch (failure) {
      if (current(request)) setError(String(failure));
      return false;
    }
  };
  const apply = (v: ReplayState, own: ReplayOwner) => {
    if (!isLiveDemo(v) || !v.history || v.id !== own.id) {
      void stop();
      return false;
    }
    setPosition(v.position);
    setEnd(v.end);
    setLoop(v.loop ?? null);
    setLoopRounds(v.loopRounds ?? 0);
    setPhase(v.active ? "running" : v.paused ? "paused" : "finished");
    callbacks.current.onPosition?.(v.position);
    callbacks.current.onActivity?.(v.active || v.paused);
    return true;
  };
  const actions = useRef({ stop, apply });
  actions.current = { stop, apply };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void actions.current.stop();
    };
  }, []);
  useEffect(() => {
    const old = owner.current ?? preparing.current ?? stopping.current;
    if (engineId && old && old.engineId !== engineId) {
      owner.current = null;
      preparing.current = null;
      stopping.current = null;
      setStopPending(false);
      void stopOwner(old).catch(() => {});
    }
    void actions.current.stop();
    setPosition(0);
    setEnd(0);
    setError("");
    setBoundEngine(engineId);
    setSourceIssue(null);
  }, [source]);
  useEffect(() => {
    if (!enabled) void actions.current.stop();
  }, [enabled]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) void actions.current.stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (phase === "idle") return;
    let polling = false,
      disposed = false;
    const tick = async () => {
      if (polling || working.current !== null || !owner.current) return;
      polling = true;
      const own = owner.current,
        request = epoch.current;
      try {
        const value = await api.commandForEngine<ReplayState>(own.engineId, {
          type: "fingerDemoState",
        });
        if (!disposed && current(request) && owner.current === own)
          actions.current.apply(value, own);
      } catch (failure) {
        if (!disposed && current(request) && owner.current === own) {
          setError(String(failure));
          void actions.current.stop();
        }
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void tick(), 80);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [phase, source]);
  async function play(
    replaySource: string,
    rate: number,
    range?: { start: number; end: number },
  ) {
    if (working.current !== null || !enabled) return false;
    const request = ++epoch.current;
    working.current = request;
    setBusy(true);
    setError("");
    setSourceIssue(null);
    const previous = owner.current ?? preparing.current ?? stopping.current;
    owner.current = null;
    preparing.current = null;
    setPhase("idle");
    setLoop(null);
    setLoopRounds(0);
    callbacks.current.onPosition?.(null);
    callbacks.current.onActivity?.(false);
    let own: ReplayOwner | null = null;
    try {
      if (previous) {
        stopping.current = previous;
        setStopPending(true);
        await stopOwner(previous);
        if (stopping.current === previous) {
          stopping.current = null;
          if (alive.current) setStopPending(false);
        }
      }
      if (!current(request) || working.current !== request) return false;
      const origin = engineId ?? (await api.state()).stateOrder?.engineId;
      if (!origin) throw new Error("练习室连接尚未准备好，请稍后开始回放。");
      if (!current(request) || working.current !== request) return false;
      setBoundEngine(origin);
      own = { id: `history-start-${crypto.randomUUID()}`, engineId: origin };
      preparing.current = own;
      const value = historySource
        ? await historySourceApi.replay(origin, {
            source: requireHistorySource(historySource, contentId, id, true),
            sound: replaySource as "actual" | "reference",
            rate,
            selection: range ?? null,
            requestId: own.id,
          })
        : await api.commandForEngine<ReplayState>(origin, {
            ...(range
              ? { type: "startHistoryReplayRange" as const, ...range }
              : { type: "startHistoryReplay" as const }),
            content_id: contentId,
            id,
            source: replaySource,
            rate,
            request_id: own.id,
          });
      if (!current(request) || working.current !== request) {
        await stopOwner({ ...own, id: value.id ?? own.id }).catch(() => {});
        return false;
      }
      if (!isLiveDemo(value) || !value.history || value.id !== own.id)
        throw new Error("回放准备回复不完整，请重新开始。");
      owner.current = own;
      return apply(value, own);
    } catch (failure) {
      if (current(request)) {
        const error = historyFailure(failure);
        setError(error.message);
        setSourceIssue(
          error instanceof HistorySourceError ? error.issue : null,
        );
      }
      if (own) await stopOwner(own).catch(() => {});
      return false;
    } finally {
      if (preparing.current === own) preparing.current = null;
      if (working.current === request) {
        working.current = null;
        if (current(request)) setBusy(false);
      }
    }
  }
  async function control(
    action: string,
    value?: number,
    extra?: { end: number; enabled: boolean },
  ) {
    if (working.current !== null || !owner.current || !enabled) return false;
    const own = owner.current,
      request = ++epoch.current;
    working.current = request;
    setBusy(true);
    setError("");
    try {
      const command: EngineCommand =
        action === "loop"
          ? {
              type: "historyReplayLoop",
              id: own.id,
              start: requireValue(value, "循环起点"),
              end: requireValue(extra?.end, "循环终点"),
              enabled: requireValue(extra?.enabled, "循环状态"),
            }
          : {
              type: "historyReplayControl",
              id: own.id,
              action,
              ...(action === "rate"
                ? { rate: requireValue(value, "回放速度") }
                : action === "seek"
                  ? { position: requireValue(value, "回放位置") }
                  : {}),
            };
      const result = await api.commandForEngine<ReplayState>(
        own.engineId,
        command,
      );
      return current(request) && owner.current === own
        ? apply(result, own)
        : false;
    } catch (failure) {
      if (current(request)) setError(String(failure));
      return false;
    } finally {
      if (working.current === request) {
        working.current = null;
        if (current(request)) setBusy(false);
      }
    }
  }
  const latest = useRef({ play, stop, control });
  latest.current = { play, stop, control };
  const stable = useMemo(
    () => ({
      play: (...args: Parameters<typeof play>) => latest.current.play(...args),
      stop: () => latest.current.stop(),
      control: (...args: Parameters<typeof control>) =>
        latest.current.control(...args),
    }),
    [],
  );
  return {
    contentId,
    historyId: id,
    engineId: engineId ?? boundEngine,
    historySource,
    phase,
    busy,
    stopPending,
    error,
    sourceIssue,
    position,
    end,
    loop,
    loopRounds,
    ...stable,
  };
}
export type HistoryReplay = ReturnType<typeof useHistoryReplay>;
