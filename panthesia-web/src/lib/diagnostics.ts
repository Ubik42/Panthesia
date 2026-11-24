import { invoke, isTauri } from "@tauri-apps/api/core";
const recent = new Map<string, number>();
export function reportDiagnostic(source: string, error: unknown) {
  const detail =
    error instanceof Error ? error.stack || error.message : String(error);
  const key = `${source}:${detail}`,
    now = Date.now();
  if (now - (recent.get(key) ?? 0) < 30_000) return;
  recent.set(key, now);
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
  if (isTauri())
    void invoke("record_diagnostic", { source, detail }).catch(() => {});
  else console.error(`[${source}]`, detail);
}
export function installDiagnostics() {
  const error = (event: ErrorEvent) =>
    reportDiagnostic("界面", event.error || event.message);
  const rejection = (event: PromiseRejectionEvent) =>
    reportDiagnostic("异步操作", event.reason);
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  return () => {
    window.removeEventListener("error", error);
    window.removeEventListener("unhandledrejection", rejection);
  };
}
