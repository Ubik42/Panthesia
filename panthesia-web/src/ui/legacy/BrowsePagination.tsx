import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import "./browsePagination.css";

export function BrowsePagination({
  page,
  total,
  pageSize = 50,
  disabled,
  pending = false,
  known = true,
  label,
  unit,
  change,
  children,
}: {
  page: number;
  total: number;
  pageSize?: number;
  disabled: boolean;
  pending?: boolean;
  known?: boolean;
  label: string;
  unit: string;
  change: (page: number) => void;
  children?: ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  const [draft, setDraft] = useState(String(current + 1));
  const [message, setMessage] = useState("");
  const messageId = useId();
  const blocked = disabled || pending || !known;
  useEffect(() => {
    setDraft(String(current + 1));
    setMessage("");
  }, [current, pages]);
  const go = (next: number) => {
    if (blocked) return;
    setMessage("");
    setDraft(String(next + 1));
    if (next !== page) change(next);
  };
  const submit = () => {
    if (blocked) return;
    const text = draft.trim();
    const next = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(next) || next < 1 || next > pages) {
      setMessage(`请输入 1 到 ${pages} 之间的页码。`);
      return;
    }
    go(next - 1);
  };
  return (
    <div className="browse-pagination" role="group" aria-label={`${label}翻页`}>
      <div
        className="browse-pagination-summary"
        tabIndex={-1}
        data-browse-list-heading
      >
        <span>
          {pending
            ? `正在读取${label}…`
            : !known
              ? "等待读取列表"
              : total
                ? `${total.toLocaleString()} ${unit} · 当前 ${(current * pageSize + 1).toLocaleString()}–${Math.min(total, (current + 1) * pageSize).toLocaleString()} ${unit}`
                : `0 ${unit}`}
        </span>
        {children}
      </div>
      <div className="browse-pagination-pages">
        <button
          className="browse-pagination-edge"
          disabled={blocked || current === 0}
          aria-label={`${label}首页`}
          onClick={() => go(0)}
        >
          <ChevronFirst size={16} />
        </button>
        <button
          disabled={blocked || current === 0}
          aria-label={`上一页${label}`}
          onClick={() => go(current - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <label className="browse-page-number">
          <span>第</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label={`${label}页码`}
            aria-describedby={message ? messageId : undefined}
            aria-invalid={!!message}
            disabled={blocked || total === 0}
            value={draft}
            maxLength={10}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage("");
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                submit();
              }
              if (
                event.key === "Escape" &&
                (draft !== String(current + 1) || message)
              ) {
                event.preventDefault();
                event.stopPropagation();
                setDraft(String(current + 1));
                setMessage("");
              }
            }}
          />
          <span>/ {known ? pages.toLocaleString() : "—"} 页</span>
        </label>
        <button
          disabled={blocked || total === 0 || draft === String(current + 1)}
          onClick={submit}
        >
          跳转
        </button>
        <button
          disabled={blocked || current + 1 >= pages}
          aria-label={`下一页${label}`}
          onClick={() => go(current + 1)}
        >
          <ChevronRight size={16} />
        </button>
        <button
          className="browse-pagination-edge"
          disabled={blocked || current + 1 >= pages}
          aria-label={`${label}末页`}
          onClick={() => go(pages - 1)}
        >
          <ChevronLast size={16} />
        </button>
      </div>
      {message && (
        <p id={messageId} className="browse-page-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
