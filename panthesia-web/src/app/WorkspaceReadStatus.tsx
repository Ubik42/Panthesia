import { RefreshCw } from "lucide-react";
import "./workspaceReadStatus.css";

export function WorkspaceReadStatus({
  label,
  pending,
  error,
  hasData,
  current = true,
  readAt,
  disabled = false,
  pendingDetail = "",
  compact = false,
  retry,
}: {
  label: string;
  pending: boolean;
  error: string;
  hasData: boolean;
  current?: boolean;
  readAt: number | null;
  disabled?: boolean;
  retry: () => void;
  pendingDetail?: string;
  compact?: boolean;
}) {
  const state = pending ? "pending" : error ? "failed" : "ready";
  const summary = pending
    ? `正在${hasData ? "更新" : "读取"}${label}`
    : error
      ? `${label}读取未完成`
      : hasData && current
        ? `${label}已就绪`
        : `等待更新${label}`;
  const context = hasData
    ? current
      ? "显示上次读取的内容。"
      : "下方保留上次读取的列表。"
    : "读取完成后会显示内容。";
  return (
    <div
      className="workspace-read-status"
      data-state={state}
      data-compact={compact || undefined}
      role={error && !pending ? "alert" : "status"}
    >
      <RefreshCw
        size={15}
        className={pending ? "is-reading" : undefined}
        aria-hidden="true"
      />
      <div>
        <strong>{summary}</strong>
        {(pending || error) && <span>{context}</span>}
        {pending && pendingDetail && <span>仍在更新：{pendingDetail}</span>}
        {error && (
          <span className="workspace-read-detail">
            {pending ? "上次读取：" : ""}
            {error}
          </span>
        )}
        {hasData && readAt !== null && (
          <small>
            读取于{" "}
            {new Date(readAt).toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
      </div>
      <button disabled={disabled || pending} onClick={retry}>
        {pending ? "更新中…" : error ? "重新读取" : "刷新"}
      </button>
    </div>
  );
}
