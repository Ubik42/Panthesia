import { registerCloseParticipant } from "../app/closePreparation";
export interface RetainedSessionValue<T> {
  key: string;
  value: T | null;
  original: string | null;
  error: string;
  unread: boolean;
}
const warnings = new Set<() => boolean>();
let listening = false;
const listen = () => {
  if (listening || typeof window === "undefined") return;
  listening = true;
  registerCloseParticipant("retained-plan-requests", { label: "待核对的计划请求", pending: () =>
    [...warnings].some((pending) => pending()) ? "有仅保留在当前会话中的计划请求与原提交编号，可返回核对或复制后再退出。" : null });
  window.addEventListener("beforeunload", (event) => {
    if ([...warnings].some((pending) => pending())) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
};

/** Session fallback preserves retry identity; unreadable originals require explicit replacement. */
export class RetainedSession<T> {
  private rows = new Map<string, RetainedSessionValue<T>>();
  constructor(private validate: (value: unknown, key: string) => value is T) {
    warnings.add(() =>
      [...this.rows.values()].some((row) => row.value !== null || row.original !== null || row.unread),
    );
  }
  read(key: string): RetainedSessionValue<T> {
    listen();
    const cached = this.rows.get(key);
    if (cached) return cached;
    const row: RetainedSessionValue<T> = {
      key,
      value: null,
      original: null,
      error: "",
      unread: false,
    };
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      row.unread = true;
      row.error =
        "暂时无法读取上次加入请求。请重试读取，或核对计划后再开始新的加入。";
      this.rows.set(key, row);
      return row;
    }
    if (raw !== null) {
      try {
        const value: unknown = JSON.parse(raw);
        if (!this.validate(value, key))
          throw new Error("invalid retained value");
        row.value = value;
      } catch {
        row.original = raw;
        row.error = "旧请求无法完整读取，原始内容已保留。请核对计划后再清理。";
      }
    }
    this.rows.set(key, row);
    return row;
  }
  retry(key: string): RetainedSessionValue<T> {
    const row = this.read(key);
    if (row.unread && row.value === null) {
      this.rows.delete(key);
      return this.read(key);
    }
    return this.write(key, row.value);
  }
  write(
    key: string,
    value: T | null,
    replace = false,
  ): RetainedSessionValue<T> {
    const row = { ...this.read(key), value };
    if (replace) {
      row.original = null;
      row.unread = false;
    }
    try {
      if (row.unread) {
        const raw = sessionStorage.getItem(key);
        row.unread = false;
        if (raw !== null) row.original = raw;
      }
      if (row.original !== null && !replace) {
        row.error =
          "旧请求原文仍被保留，当前请求暂留本次会话。请先核对旧计划。";
      } else {
        if (value === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(value));
        row.original = null;
        row.error = "";
      }
    } catch {
      row.error =
        value === null
          ? "旧缓存暂未清理，本次会话已保留核对结果。可重试清理；新的请求将先保留在当前会话中。"
          : "窗口暂存失败，请求及其编号已保留在本次会话中，可复制后保存。";
    }
    // An empty fallback prevents a failed removal from resurrecting an acknowledged request.
    this.rows.set(key, row);
    return row;
  }
}
