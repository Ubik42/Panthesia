import "./taskActivity.css";

export function SavedEditNotice({
  message,
  busy,
  blocked = false,
  refresh,
}: {
  message: string | null;
  busy: boolean;
  blocked?: boolean;
  refresh: () => void;
}) {
  if (!message) return null;
  return (
    <div className="saved-edit-notice" role="status">
      <span>{message}，正在等待界面刷新。</span>
      <button disabled={busy || blocked} onClick={refresh}>
        {busy ? "正在处理…" : "重试刷新"}
      </button>
    </div>
  );
}
