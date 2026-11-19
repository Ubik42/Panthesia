const pageSize = 40;
export { pageSize as feedbackPageSize };

export function FeedbackPager({
  page,
  total,
  label,
  change,
}: {
  page: number;
  total: number;
  label: string;
  change: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  return (
    <nav className="feedback-page-controls" aria-label={`${label}分页`}>
      <span aria-live="polite">
        第 {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} 项，共{" "}
        {total} 项
      </span>
      <button
        aria-label={`${label}上一页`}
        disabled={page === 0}
        onClick={() => change(page - 1)}
      >
        上一页
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button
        aria-label={`${label}下一页`}
        disabled={page + 1 >= pages}
        onClick={() => change(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
