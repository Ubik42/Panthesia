import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeviceScanStatus } from "../../engine/deviceCatalog";

export function DeviceScanNotice({
  label,
  count,
  empty,
  status,
  requesting,
  legacyReady,
  legacyRefreshing,
  refresh,
}: {
  label: string;
  count: number;
  empty: string;
  status?: DeviceScanStatus;
  requesting: boolean;
  legacyReady: boolean;
  legacyRefreshing: boolean;
  refresh: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const scanning = !!status?.scanning;
  useEffect(() => {
    if (!scanning) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [scanning, status?.startedAt]);
  const ready = status?.ready ?? legacyReady;
  const refreshing = requesting || (status?.refreshing ?? legacyRefreshing);
  const slow =
    scanning &&
    status?.startedAt != null &&
    Math.max(0, now - status.startedAt) >= 8000;
  const unavailable = status?.available === false;
  const error = status?.error;
  const state = unavailable
    ? "读取已停止"
    : slow
      ? "读取时间较长"
      : refreshing
        ? "正在刷新"
        : error
          ? count > 0
            ? "部分清单未读齐"
            : "读取失败"
          : ready
            ? `已找到 ${count} 项`
            : "正在读取";
  return (
    <div
      className={`device-scan ${error || slow || unavailable ? "device-scan-warning" : ""}`}
    >
      <div className="device-scan-row">
        <span role="status">
          <strong>{label}</strong>
          <span>{state}</span>
        </span>
        <button
          disabled={refreshing || unavailable}
          onClick={refresh}
          aria-label={`刷新${label}`}
        >
          <RefreshCw
            size={13}
            className={refreshing ? "device-refreshing" : undefined}
          />
          刷新
        </button>
      </div>
      {slow && <p>本次读取仍在等待设备响应。其他清单与已有连接可继续使用。</p>}
      {error && (
        <p role="alert">
          {error}
          {status?.lastSuccessAt != null
            ? "。已保留此前读取的项目。"
            : count > 0
              ? "。已保留读取到的项目。"
              : ""}
        </p>
      )}
      {ready && !refreshing && !error && count === 0 && <p>{empty}</p>}
    </div>
  );
}
