import { useEffect, useMemo, useRef, useState } from "react";
import type { LibrarySelectionReview } from "./libraryBrowse";
import { useBrowseScroll } from "../../app/useBrowseScroll";
import { CheckSquare } from "lucide-react";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import "./librarySelectionSummary.css";
export function LibrarySelectionSummary({
  selected,
  visible,
  fileCount,
  onlySelected,
  disabled,
  toggleOnlySelected,
  keepVisible,
  clear,
  remove,
  initialBrowse,
  rememberBrowse,
  ready = true,
  selectedCount = selected.length,
  clearUnavailable,
  pending = !ready,
}: {
  selected: { path: string; title: string; unavailable?: boolean }[];
  visible: number;
  fileCount: number;
  onlySelected: boolean;
  disabled: boolean;
  toggleOnlySelected: () => void;
  keepVisible: () => void;
  clear: () => void;
  remove?: (path: string) => void;
  initialBrowse?: LibrarySelectionReview;
  rememberBrowse?: (browse: LibrarySelectionReview) => void;
  ready?: boolean;
  selectedCount?: number;
  clearUnavailable?: () => void;
  pending?: boolean;
}) {
  const [query, setQuery] = useState(initialBrowse?.query ?? "");
  const [page, setPage] = useState(initialBrowse?.page ?? 0);
  const [expanded, setExpanded] = useState(initialBrowse?.expanded ?? false);
  const matching = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return text
      ? selected.filter((row) =>
          `${row.title}\n${row.path}`.toLocaleLowerCase().includes(text),
        )
      : selected;
  }, [selected, query]);
  const lastPage = Math.max(0, Math.ceil(matching.length / 40) - 1);
  const currentPage = Math.min(page, lastPage);
  useEffect(() => {
    if (ready && page > lastPage) setPage(lastPage);
  }, [page, lastPage, ready]);
  const rememberedPage = ready ? currentPage : page;
  const positionKey = JSON.stringify([query, rememberedPage]);
  const browsing = useRef<LibrarySelectionReview>({
    query,
    page: rememberedPage,
    expanded,
    top: initialBrowse?.top ?? 0,
    topKey: initialBrowse?.topKey,
  });
  browsing.current = {
    ...browsing.current,
    query,
    page: rememberedPage,
    expanded,
  };
  useEffect(() => {
    rememberBrowse?.(browsing.current);
  }, [query, rememberedPage, expanded, rememberBrowse]);
  const listScroll = useBrowseScroll<HTMLOListElement>(
    positionKey,
    ready && expanded && selected.length > 0,
    !initialBrowse?.topKey || initialBrowse.topKey === positionKey
      ? (initialBrowse?.top ?? 0)
      : 0,
    (top) => {
      browsing.current = { ...browsing.current, top, topKey: positionKey };
      rememberBrowse?.(browsing.current);
    },
  );
  if (!selectedCount && !onlySelected) return null;
  const hidden = selectedCount - visible;
  const unavailable = selected.filter((row) => row.unavailable).length;
  return (
    <section
      className="library-selection-summary"
      aria-label="曲库已选曲目"
      aria-busy={pending || undefined}
    >
      <div className="library-selection-heading">
        <CheckSquare size={16} aria-hidden="true" />
        <strong>已选 {selectedCount} 首</strong>
        <span>
          当前筛选中 {visible} 首 · 已找到文件类曲目 {fileCount} 首
        </span>
        {hidden > 0 && (
          <b>
            {hidden} 首在当前筛选之外，
            {ready && !unavailable ? "仍包含在批量操作中" : "选择仍保留"}
          </b>
        )}
      </div>
      <div className="library-selection-controls">
        <button
          disabled={disabled || (!selectedCount && !onlySelected)}
          aria-pressed={onlySelected}
          onClick={toggleOnlySelected}
        >
          {onlySelected ? "退出仅看所选" : "仅看所选"}
        </button>
        {hidden > 0 && (
          <button disabled={disabled || !ready} onClick={keepVisible}>
            只保留当前筛选中的选择
          </button>
        )}
        <button disabled={disabled || !selectedCount} onClick={clear}>
          清空选择
        </button>
      </div>
      {(!ready || selected.length < selectedCount) && (
        <p role="status">
          {pending ? "正在读取曲库" : "曲库资料尚未读齐"}，已保留{" "}
          {selectedCount} 首选择。读齐后会核对文件位置。
        </p>
      )}
      {ready && unavailable > 0 && (
        <div className="library-selection-unavailable" role="status">
          <span>
            {unavailable}{" "}
            首暂未在曲库中找到，原有选择已保留。可以重新读取曲库，或在清单中取消选择。
          </span>
          {clearUnavailable && (
            <button
              type="button"
              disabled={disabled}
              onClick={clearUnavailable}
            >
              取消这 {unavailable} 首的选择
            </button>
          )}
        </div>
      )}
      {!!selected.length && (
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>核对所选清单</summary>
          <label className="library-selection-search">
            查找已选曲目
            <input
              type="search"
              value={query}
              placeholder="曲名或文件位置"
              disabled={disabled}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <ol {...listScroll} start={currentPage * 40 + 1}>
            {matching
              .slice(currentPage * 40, (currentPage + 1) * 40)
              .map((row) => (
                <li key={row.path}>
                  <div>
                    <strong>{row.title}</strong>
                    {ready && row.unavailable && (
                      <span className="library-selection-unavailable-label">
                        暂未在曲库中找到
                      </span>
                    )}
                    <small>{row.path}</small>
                  </div>
                  {remove && (
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`取消选择：${row.title}`}
                      onClick={() => remove(row.path)}
                    >
                      取消选择
                    </button>
                  )}
                </li>
              ))}
          </ol>
          {ready && !matching.length && (
            <p role="status">所选清单中没有匹配的曲目。</p>
          )}
          {matching.length > 40 && (
            <nav
              className="library-selection-pagination"
              aria-label="所选清单分页"
            >
              <button
                type="button"
                disabled={disabled || currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span role="status">
                {currentPage + 1} / {lastPage + 1} 页 · {matching.length} 首
              </span>
              <button
                type="button"
                disabled={disabled || currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </nav>
          )}
          {query.trim() && (
            <p className="parameter-help">
              {unavailable
                ? "清单搜索只用于核对。请先处理暂未找到的曲目，再批量整理。"
                : `清单搜索只用于核对，批量操作仍包含全部 ${selectedCount} 首已选曲目。`}
            </p>
          )}
          <CopyPracticeDraft
            disabled={!ready || selected.length !== selectedCount}
            plainText
            label="复制所选名称与位置"
            value={selected}
            createText={() =>
              selected
                .map(
                  (row) =>
                    `${row.unavailable ? "[当前未找到] " : ""}${row.title}\n${row.path}`,
                )
                .join("\n\n")
            }
          />
        </details>
      )}
    </section>
  );
}
