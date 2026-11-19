import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CollectionSong, SongRow } from "../../api";
import { BrowsePagination } from "../../app/BrowsePagination";

const pageSize = 20;
export function RoutineSourcePicker({
  songs,
  collection,
  currentTitle,
  query,
  changeQuery,
  disabled,
  choose,
}: {
  songs: SongRow[];
  collection: CollectionSong[];
  currentTitle: string | undefined;
  query: string;
  changeQuery: (value: string) => void;
  disabled: boolean;
  choose: (row: SongRow | CollectionSong) => void;
}) {
  const [page, setPage] = useState(0);
  const [pageQuery, setPageQuery] = useState(query);
  const results = useRef<HTMLDivElement>(null);
  const generated = useMemo(
    () =>
      collection
        .filter((row) => row.generated)
        .map((row) => ({ row, text: row.title.toLocaleLowerCase() })),
    [collection],
  );
  const indexed = useMemo(
    () =>
      songs.map((row) => ({
        row,
        text: `${row.title} ${row.composer}`.toLocaleLowerCase(),
      })),
    [songs],
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const exercises = generated
      .filter((entry) => !needle || entry.text.includes(needle))
      .map(({ row }) => row);
    return needle
      ? [
          ...exercises,
          ...indexed
            .filter((entry) => entry.text.includes(needle))
            .map(({ row }) => row),
        ]
      : exercises;
  }, [generated, indexed, query]);
  const current = Math.max(
    0,
    Math.min(
      pageQuery === query ? page : 0,
      Math.ceil(rows.length / pageSize) - 1,
    ),
  );
  useLayoutEffect(() => {
    if (results.current) results.current.scrollTop = 0;
  }, [current, query]);
  return (
    <section className="routine-song-picker">
      <h4>加入另一首曲目</h4>
      <p className="parameter-help">
        当前练习：{currentTitle ?? "未打开曲目"}
        。打开曲目后，核对声部和选段，再加入计划。
      </p>
      <input
        type="search"
        aria-label="计划添加曲目搜索"
        value={query}
        maxLength={4096}
        disabled={disabled}
        placeholder="搜索曲名或作曲家"
        onChange={(event) => {
          setPage(0);
          setPageQuery(event.target.value);
          changeQuery(event.target.value);
        }}
      />
      <BrowsePagination
        label="可加入的曲目"
        unit="首曲目"
        page={current}
        total={rows.length}
        pageSize={pageSize}
        disabled={disabled}
        change={(value) => {
          setPageQuery(query);
          setPage(value);
        }}
      />
      <div className="routine-source-results" ref={results}>
        {rows
          .slice(current * pageSize, (current + 1) * pageSize)
          .map((row, index) => (
            <button
              key={
                "generated" in row
                  ? `generated:${row.contentId}`
                  : `file:${row.id}:${index}`
              }
              disabled={disabled}
              onClick={() => choose(row)}
            >
              <strong>{row.title}</strong>
              <span>
                {"generated" in row
                  ? "内置生成练习"
                  : row.composer || "未填写作曲者"}
              </span>
            </button>
          ))}
      </div>
      {!rows.length && (
        <p className="parameter-help">
          {query.trim()
            ? "没有找到对应曲目，可以调整曲名或作曲家关键词。"
            : "输入曲名或作曲家查找本地曲库，也可以从主界面打开曲目后再添加。"}
        </p>
      )}
      {!query.trim() && rows.length > 0 && (
        <p className="parameter-help">
          当前列出已保存的生成练习。输入曲名或作曲家可查找本地曲库。
        </p>
      )}
    </section>
  );
}
