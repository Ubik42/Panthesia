import { useSyncExternalStore, type ReactNode } from "react";
interface PreparationState {
  phase: string;
  busy: boolean;
  refreshPending: boolean;
  error: string;
}
interface PreparationStore {
  getSnapshot: () => PreparationState;
  subscribe: (listener: () => void) => () => void;
}
/** Pending work stays visible after its dialog closes, without subscribing the app to progress ticks. */
export function PreparationButton({
  store,
  name,
  readyLabel,
  icon,
  disabled,
  open,
}: {
  store: PreparationStore;
  name: string;
  readyLabel: string;
  icon?: ReactNode;
  disabled?: boolean;
  open: () => void;
}) {
  const snapshot = () => {
    const state = store.getSnapshot();
    return `${state.phase}:${state.busy ? 1 : 0}:${state.refreshPending ? 1 : 0}:${state.error ? 1 : 0}`;
  };
  const [phase, busy, refresh, error] = useSyncExternalStore(
    store.subscribe,
    snapshot,
    snapshot,
  ).split(":");
  const label =
    busy === "1"
      ? "进行中"
      : phase === "review"
        ? "待确认"
        : refresh === "1"
          ? readyLabel
          : phase === "error" && error === "1"
            ? "可重试"
            : "";
  const detail =
    phase === "review"
      ? `上次${name}结果待确认，打开后可继续读取原请求`
      : refresh === "1"
        ? `${name}结果已保存，打开后可重新读取练习室`
        : `打开${name}，继续使用保留的参数与结果`;
  return (
    <button
      disabled={disabled}
      onClick={open}
      aria-label={name}
      aria-description={label ? `${label}。${detail}` : detail}
      title={detail}
    >
      {icon}
      {name}
      {label && (
        <span
          aria-hidden="true"
          className={`preparation-button-status ${phase === "review" ? "needs-review" : ""}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}
