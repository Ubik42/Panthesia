import { useEffect, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DesktopCloseStatus, DesktopCloseIssue, DesktopCloseReport, DesktopCloseReview } from "../engine/commands.generated";
import { prepareFrontendClose } from "../lib/closePreparation";

interface State { status: DesktopCloseStatus | null; issues: DesktopCloseIssue[]; error: string; returning: boolean }
let state: State = { status: null, issues: [], error: "", returning: false };
let allowUnload = false;
const listeners = new Set<() => void>(), ended = new Set<string>(), working = new Set<string>();
const reports = new Map<string, DesktopCloseReport>();
const reviews = new Map<string, DesktopCloseReport>();
const notify = () => { for (const listener of [...listeners]) listener(); };
const rank = { preparing: 0, saving: 1, finalizing: 2, reviewing: 3, returning: 4 };
function acceptReview(review: DesktopCloseReview) {
  if (state.status?.id !== review.id || ended.has(review.id) || state.returning) return;
  reviews.set(review.id, review.report);
  state = { ...state, issues: review.report.issues }; notify();
}
async function readReview(id: string) {
  if (reviews.has(id)) return;
  const review = await invoke<DesktopCloseReview | null>("desktop_close_review");
  if (review?.id === id) acceptReview(review);
}
function rememberEnded(id: string) {
  reviews.delete(id);
  ended.add(id);
  while (ended.size > 32) ended.delete(ended.values().next().value!);
}
function update(status: DesktopCloseStatus) {
  if (!status || typeof status.id !== "string" || status.id.length > 160 || ended.has(status.id)
    || !Object.hasOwn(rank, status.phase) || !Number.isInteger(status.pass) || typeof status.message !== "string") return false;
  if (state.status?.id === status.id && state.returning && status.phase !== "returning") return false;
  if (state.status?.id === status.id && (state.status.pass > status.pass || (state.status.pass === status.pass && rank[state.status.phase] > rank[status.phase]))) return false;
  if (state.status && state.status.id !== status.id) rememberEnded(state.status.id);
  state = { ...state, status, returning: status.phase === "returning" };
  notify();
  return true;
}
async function prepare(status: DesktopCloseStatus) {
  if (!update(status) || status.phase === "returning") return;
  const key = `${status.id}:${status.pass}`;
  if (working.has(key)) return;
  working.add(key);
  try {
    let report = reports.get(key);
    if (!report) {
      try { report = await prepareFrontendClose(); }
      catch (error) { report = { issues: [{ key: "ui-preparation", label: "当前输入", detail: error instanceof Error ? error.message : String(error) }], checked: [] }; }
      reports.set(key, report);
      while (reports.size > 8) reports.delete(reports.keys().next().value!);
    }
    if (ended.has(status.id) || state.status?.id !== status.id || state.returning) return;
    state = { ...state, issues: reviews.get(status.id)?.issues ?? report.issues, error: "" }; notify();
    await invoke("desktop_close_ready", { id: status.id, pass: status.pass, report });
  } catch (error) {
    if (state.status?.id === status.id && !ended.has(status.id)) {
      state = { ...state, error: `退出准备回复未完成：${error instanceof Error ? error.message : String(error)}` }; notify();
    }
  } finally { working.delete(key); }
}
export async function returnFromDesktopClose() {
  const status = state.status;
  if (!status || state.returning) return;
  state = { ...state, returning: true, error: "" }; notify();
  try { await invoke("cancel_desktop_close", { id: status.id }); }
  catch (error) {
    if (state.status?.id === status.id) { state = { ...state, returning: false, error: `返回请求未完成：${error instanceof Error ? error.message : String(error)}` }; notify(); }
  }
}
export async function decideDesktopClose(action: "close" | "retry") {
  if (!state.status || state.returning) return;
  try { await invoke("decide_desktop_close", {id: state.status.id, action}); }
  catch (error) { state = {...state, error: String(error)}; notify(); }
}
export function useDesktopClose() {
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    const releases: (() => void)[] = [];
    const subscribe = async <T>(event: string, handler: (payload: T) => void) => {
      const release = await listen<T>(event, (event) => { if (!stopped) handler(event.payload); });
      if (stopped) release(); else releases.push(release);
    };
    const unload = (event: BeforeUnloadEvent) => { if (state.status) event.stopImmediatePropagation(); };
    const keyboard = (event: KeyboardEvent) => {
      if (!state.status) return;
      event.stopImmediatePropagation(); event.preventDefault();
      if (event.key === "Escape") void returnFromDesktopClose();
      else if (event.key === "Tab") document.querySelector<HTMLButtonElement>(".desktop-close-dialog button:not(:disabled)")?.focus();
      else if (["Enter", " "].includes(event.key) && document.activeElement instanceof HTMLButtonElement && document.activeElement.closest(".desktop-close-dialog")) document.activeElement.click();
    };
    window.addEventListener("beforeunload", unload, true);
    window.addEventListener("keydown", keyboard, true);
    void (async () => {
      // Arm draft protection before installing event listeners. If subscription fails,
      // native close must wait for a report instead of treating the window as unloaded.
      await invoke("attach_desktop_close");
      if (stopped) return;
      await subscribe<DesktopCloseStatus>("neothesia-close-prepare", (status) => { void prepare(status); });
      await subscribe<DesktopCloseStatus>("neothesia-close-status", update);
      await subscribe<DesktopCloseReview>("neothesia-close-review", acceptReview);
      await subscribe<string>("neothesia-close-resumed", (id) => {
        rememberEnded(id);
        if (state.status?.id === id) { state = { status: null, issues: [], error: "", returning: false }; allowUnload = false; notify(); }
      });
      await subscribe<string>("neothesia-close-allowed", (id) => { if (state.status?.id === id && !ended.has(id)) allowUnload = true; });
      if (stopped) return;
      const current = await invoke<DesktopCloseStatus | null>("desktop_close_status");
      if (stopped) return;
      if (current) {
        if (["preparing", "finalizing"].includes(current.phase) && current.pass > 0) void prepare(current);
        else { update(current); if (current.phase === "reviewing") await readReview(current.id); }
      } else if (state.status) {
        rememberEnded(state.status.id); state = { status: null, issues: [], error: "", returning: false }; allowUnload = false; notify();
      }
    })().catch((error) => {
      if (!stopped && state.status) {
        state = { ...state, error: `退出准备连接中断：${error instanceof Error ? error.message : String(error)}` }; notify();
      }
    });
    return () => { stopped = true; releases.forEach((release) => release()); window.removeEventListener("beforeunload", unload, true); window.removeEventListener("keydown", keyboard, true); };
  }, []);
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
  useEffect(() => {
    const id = current.status?.id;
    if (!id || !isTauri()) return;
    let stopped = false, reading = false;
    // Events drive the normal flow. Reconcile an interrupted reply or missed resume
    // while this one close attempt is active, including a frontend reload.
    const timer = window.setInterval(() => {
      if (reading) return;
      reading = true;
      void invoke<DesktopCloseStatus | null>("desktop_close_status").then(async (status) => {
        if (stopped || state.status?.id !== id) return;
        if (!status) {
          rememberEnded(id); allowUnload = false;
          state = { status: null, issues: [], error: "", returning: false }; notify();
        } else if (status.id === id) {
          if (["preparing", "finalizing"].includes(status.phase) && status.pass > 0) void prepare(status);
          else { update(status); if (status.phase === "reviewing") await readReview(status.id); }
        }
      }).catch((error) => {
        if (!stopped && state.status?.id === id) {
          state = { ...state, error: `退出状态暂时无法读取：${error instanceof Error ? error.message : String(error)}` }; notify();
        }
      }).finally(() => { reading = false; });
    }, 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [current.status?.id]);
  return current;
}
