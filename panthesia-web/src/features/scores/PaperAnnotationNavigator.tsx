import { useMemo, useState } from "react";
import type { PaperAnnotation } from "./PaperAnnotations";
import { PaperListPager } from "./PaperListPager";
export interface PaperAnnotationLocation {
  note: PaperAnnotation;
  page: number;
}
export function PaperAnnotationNavigator({
  locations,
  disabled,
  locate,
}: {
  locations: PaperAnnotationLocation[];
  disabled: boolean;
  locate: (note: PaperAnnotation, page: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [requestedPage, setPage] = useState(0);
  const matches = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("zh-CN");
    return text
      ? locations.filter(
          ({ note, page }) =>
            note.text.toLocaleLowerCase("zh-CN").includes(text) ||
            String(page) === text,
        )
      : locations;
  }, [locations, query]);
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(matches.length / 30) - 1),
  );
  if (!locations.length) return null;
  return (
    <details
      className="paper-annotation-navigation"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>批注位置 · {locations.length} 处</summary>
      {open && (
        <>
          <label>
            查找批注或页码
            <input
              aria-label="查找纸谱批注或页码"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="文字或页码"
            />
          </label>
          <div className="paper-annotation-navigation-list">
            {matches
              .slice(page * 30, page * 30 + 30)
              .map(({ note, page: pageNumber }) => (
                <button
                  key={note.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => locate(note, pageNumber)}
                  title={note.text || "高亮位置"}
                >
                  <span>第 {pageNumber} 页</span>
                  <span>{note.text.trim().slice(0, 80) || "高亮位置"}</span>
                </button>
              ))}
            {!matches.length && <p>没有找到对应的批注。</p>}
          </div>
          <PaperListPager
            page={page}
            total={matches.length}
            change={setPage}
            label="纸谱批注分页"
          />
        </>
      )}
    </details>
  );
}
