import { useEffect, useMemo } from "react";
import { api, type HistoryReadCommand } from "../api";
import type {
  CommandOf,
  HistoryPage,
  HistoryCalendar,
} from "./commands.generated";

interface HistoryReadTask<T> {
  result: Promise<T>;
  isCurrent: () => boolean;
}

// Readers own independent channels. Caller sequences protect success, failure
// and loading state even when transport responses arrive in a different order.
export function createHistoryReader(engineId?: string) {
  const channel = `review-${crypto.randomUUID()}`;
  let sequence = 0;
  const pending = new Set<number>();
  const invalidate = () => {
    sequence++;
    if (pending.size)
      void api
        .commandForEngine(engineId, {
          type: "cancelHistoryRead",
          channel,
          sequence,
        })
        .catch(() => {
          // Local generations remain invalid when the connection is unavailable.
        });
  };
  function request(
    command: CommandOf<"readHistoryPage">,
    signal?: AbortSignal,
  ): HistoryReadTask<HistoryPage>;
  function request(
    command: CommandOf<"practiceCalendar">,
    signal?: AbortSignal,
  ): HistoryReadTask<HistoryCalendar>;
  function request<T>(
    command: HistoryReadCommand,
    signal?: AbortSignal,
  ): HistoryReadTask<T>;
  function request<T>(
    command: HistoryReadCommand,
    signal?: AbortSignal,
  ): HistoryReadTask<T> {
    if (signal?.aborted)
      return {
        result: Promise.reject(
          new DOMException("这次读取已取消。", "AbortError"),
        ),
        isCurrent: () => false,
      };
    const current = ++sequence;
    pending.add(current);
    const cancel = () => {
      if (sequence === current) invalidate();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    let result: Promise<T>;
    try {
      result = api.readHistory<T>(
        command,
        { channel, sequence: current },
        engineId,
      );
    } catch (failure) {
      result = Promise.reject(failure);
    }
    const settled = () => {
      pending.delete(current);
      signal?.removeEventListener("abort", cancel);
    };
    void result.then(settled, settled);
    return {
      result,
      isCurrent: () => sequence === current,
    };
  }
  return {
    request,
    invalidate,
  };
}

export function useHistoryRead(engineId?: string) {
  const reader = useMemo(() => createHistoryReader(engineId), [engineId]);
  useEffect(() => () => reader.invalidate(), [reader]);
  return reader;
}
