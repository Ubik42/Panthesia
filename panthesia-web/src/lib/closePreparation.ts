import { useEffect, useRef } from "react";
import type { DesktopCloseIssue, DesktopCloseReport } from "../engine/commands.generated";

export interface CloseParticipant {
  label: string;
  prepare?: () => void | Promise<void>;
  pending: () => string | null;
}
const participants = new Map<string, CloseParticipant>();
const encoder = new TextEncoder(), decoder = new TextDecoder();
// Native wire limits count UTF-8 bytes, including names and platform error messages.
function boundedText(value: string, limit: number) {
  const bytes = encoder.encode(value);
  return bytes.length <= limit ? value : decoder.decode(bytes.subarray(0, limit - 8)) + "…";
}
function closeIssue(key: string, label: string, detail: string): DesktopCloseIssue {
  return { key, label: boundedText(label, 160), detail: boundedText(detail, 4096) };
}
let unloadListening = false;
export function registerCloseParticipant(key: string, participant: CloseParticipant) {
  if (!unloadListening && typeof window !== "undefined") {
    unloadListening = true;
    window.addEventListener("beforeunload", (event) => {
      for (const participant of participants.values()) {
        try { if (!participant.pending()) continue; } catch {}
        event.preventDefault(); event.returnValue = ""; return;
      }
    });
  }
  if (!key || encoder.encode(key).length > 160) throw new Error("退出准备来源编号无效");
  participants.set(key, participant);
  return () => { if (participants.get(key) === participant) participants.delete(key); };
}
export function useCloseParticipant(label: string, pending: () => string | null, prepare?: () => void | Promise<void>) {
  const current = useRef({ pending, prepare });
  current.current = { pending, prepare };
  useEffect(() => registerCloseParticipant(`editor-${crypto.randomUUID()}`, {
    label, pending: () => current.current.pending(), prepare: () => current.current.prepare?.(),
  }), [label]);
}
/** Persist inputs first. Reports describe only content the app still cannot retain or recover. */
export async function prepareFrontendClose(): Promise<DesktopCloseReport> {
  const checked = new Set<string>(), issues = new Map<string, DesktopCloseIssue>();
  // A completed preparation can admit another draft save; include newly mounted owners too.
  for (let pass = 0; pass < 3; pass++) {
    const batch = [...participants].filter(([key]) => !checked.has(key));
    for (const [key, participant] of batch) {
      if (participants.get(key) !== participant) continue;
      checked.add(key);
      try { await participant.prepare?.(); }
      catch (error) { issues.set(key, closeIssue(key, participant.label, error instanceof Error ? error.message : String(error))); }
    }
    await Promise.resolve();
    if (![...participants.keys()].some((key) => !checked.has(key))) break;
  }
  for (const [key, participant] of participants) {
    if (!checked.has(key)) issues.set(key, closeIssue(key, participant.label, "编辑界面仍在更新，暂存尚未完成。请返回等待后再退出。"));
    checked.add(key);
    try {
      const detail = participant.pending();
      if (detail) issues.set(key, closeIssue(key, participant.label, detail));
    } catch (error) { issues.set(key, closeIssue(key, participant.label, `退出前核对未完成：${error instanceof Error ? error.message : String(error)}`)); }
  }
  const values = [...issues.values()];
  if (values.length > 63 || checked.size > 128) values.unshift({ key: "close-capacity", label: "待处理窗口", detail: "打开的编辑窗口或临时内容较多，请返回关闭部分窗口后再退出。" });
  return { issues: values.slice(0, 64), checked: [...checked].slice(0, 128) };
}
