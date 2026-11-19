import { useMemo, useState, type ReactNode } from "react";
export function BackupPreviewList<T>({
  title,
  rows,
  text,
  render,
  initialOpen = false,
}: {
  title: string;
  rows: readonly T[];
  text: (row: T) => string;
  render: (row: T) => ReactNode;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    if (!open) return [];
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return words.length
      ? rows.filter((row) => {
          const value = text(row).toLocaleLowerCase();
          return words.every((word) => value.includes(word));
        })
      : rows;
  }, [rows, query, text, open]);
  const pages = Math.max(1, Math.ceil(filtered.length / 40)),
    current = Math.min(page, pages - 1);
  return (
    <details
      className="backup-preview-list"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {title} · {rows.length} 项
      </summary>
      {open && (
        <>
          {rows.length > 40 && (
            <label className="backup-preview-search">
              筛选内容
              <input
                value={query}
                placeholder="输入名称或内容"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          )}
          {!filtered.length ? (
            <p>没有符合筛选条件的内容。</p>
          ) : (
            <ul>
              {filtered
                .slice(current * 40, current * 40 + 40)
                .map((row, index) => (
                  <li key={current * 40 + index}>{render(row)}</li>
                ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label={`${title}分页`}>
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                上一页
              </button>
              <span>
                {current + 1} / {pages} 页 · {filtered.length} 项
              </span>
              <button
                disabled={current + 1 >= pages}
                onClick={() => setPage(current + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}
    </details>
  );
}
