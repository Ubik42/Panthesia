import { useEffect, useRef, useState } from "react";
import { ReadCache, type ReadValue } from "./readCache";

type Result<T> = {
  key: string;
  epoch: number;
  row?: ReadValue<T>;
  error: string;
};
export function useCachedRead<T>({
  cache,
  key,
  load,
  enabled = true,
  delay = 0,
  scope,
}: {
  cache: ReadCache<T>;
  key: string;
  load: (signal: AbortSignal) => Promise<T>;
  enabled?: boolean;
  delay?: number;
  scope?: string;
}) {
  const [revision, setRevision] = useState(0);
  const target = useRef({
    key,
    enabled,
    revision,
    cache,
    delay,
    scope,
    epoch: 0,
  });
  if (
    target.current.key !== key ||
    target.current.enabled !== enabled ||
    target.current.revision !== revision ||
    target.current.cache !== cache ||
    target.current.delay !== delay ||
    target.current.scope !== scope
  ) {
    target.current = {
      key,
      enabled,
      revision,
      cache,
      delay,
      scope,
      epoch: target.current.epoch + 1,
    };
  }
  const epoch = target.current.epoch;
  const [result, setResult] = useState<Result<T>>(() => ({
    key,
    epoch: -1,
    row: cache.get(key),
    error: "",
  }));
  const loader = useRef(load);
  loader.current = load;
  const identity = useRef(0);
  const matches = result.key === key && result.epoch === epoch;
  const row = enabled
    ? matches
      ? result.row
      : (cache.get(key) ?? result.row)
    : undefined;
  const pending = enabled && !matches;
  const error = enabled && matches ? result.error : "";
  useEffect(() => {
    const request = ++identity.current;
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const requestLoad = loader.current;
    const current = () =>
      !cancelled &&
      request === identity.current &&
      target.current.enabled &&
      target.current.epoch === epoch;
    const timer = setTimeout(() => {
      if (!current()) return;
      void Promise.resolve()
        .then(() => {
          if (!current())
            throw new DOMException("这次读取已取消。", "AbortError");
          return requestLoad(controller.signal);
        })
        .then((value) => {
          if (!current()) return;
          setResult({ key, epoch, row: cache.put(key, value), error: "" });
        })
        .catch((cause) => {
          if (!current()) return;
          setResult((previous) => ({
            key,
            epoch,
            row: cache.get(key) ?? previous.row,
            error: cause instanceof Error ? cause.message : String(cause),
          }));
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [cache, key, revision, enabled, delay, scope, epoch]);
  return {
    value: row?.value ?? null,
    displayedKey: row?.key ?? null,
    current: !!row && row.key === key,
    readAt: row?.readAt ?? null,
    pending,
    error,
    verified: enabled && matches && !error,
    refresh: () => {
      identity.current++;
      setRevision((value) => value + 1);
    },
    patch: (change: (value: T) => T) => {
      cache.update(change);
      setResult((previous) =>
        previous.row
          ? {
              ...previous,
              row: { ...previous.row, value: change(previous.row.value) },
            }
          : previous,
      );
    },
  };
}
