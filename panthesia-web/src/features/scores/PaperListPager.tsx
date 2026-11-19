export function PaperListPager({
  page,
  total,
  size = 30,
  change,
  label,
}: {
  page: number;
  total: number;
  size?: number;
  change: (page: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages === 1) return null;
  return (
    <nav className="paper-list-pager" aria-label={label}>
      <button
        type="button"
        disabled={page === 0}
        onClick={() => change(page - 1)}
      >
        上一页
      </button>
      <span>
        第 {page + 1} / {pages} 页 · 共 {total} 项
      </span>
      <button
        type="button"
        disabled={page + 1 >= pages}
        onClick={() => change(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
