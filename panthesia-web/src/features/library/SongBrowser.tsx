import { portablePath } from "../../engine/pathIdentity";
import { parseSongSearch, matchesSongSearch } from "./songSearch";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Library,
  Layers3,
  Music2,
  Play,
  Search,
} from "lucide-react";
import {
  api,
  type SongRow,
  type LoadedSong,
  type CollectionSong,
} from "../../api";
import { libraryPath } from "./ScanFolders";
import type { LibraryFolder } from "./useLibraryReads";
import "./songBrowser.css";
import {
  groupSongs,
  songKey,
  songLocation,
  type BrowserSong,
} from "./songCatalog";
import { Dialog } from "../../Dialog";
import { reportDiagnostic } from "../../app/diagnostics";
import { useSongCatalog } from "./useSongCatalog";
import { practiceDate } from "./BrowserPracticeSummary";
import { BrowserSongVersions } from "./BrowserSongVersions";

interface FolderNode {
  path: string;
  label: string;
  count: number;
  children: Map<string, FolderNode>;
  available: boolean;
}
const expandedFolders = () => {
  try {
    const value = JSON.parse(stored("neothesia-browser-expanded", "[]"));
    return new Set<string>(
      Array.isArray(value) ? value.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
};
const stored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
function titleParts(title: string) {
  const match = title.match(/^(.*?)[_]((?:原调|C大调|自动对齐|乐谱量化).*)$/);
  return match
    ? { title: match[1], version: match[2].replaceAll("_", " · ") }
    : { title, version: "MIDI" };
}
export function SongBrowser({
  rows,
  ready,
  current,
  collection,
  open,
  resume,
  manage,
  refresh,
  unavailable,
  preparation,
}: {
  rows: readonly SongRow[];
  ready: boolean;
  current: LoadedSong | null;
  collection: readonly CollectionSong[];
  open: (row: SongRow) => Promise<boolean>;
  resume: () => void;
  manage: () => void;
  refresh: () => Promise<unknown>;
  unavailable?: string | null;
  preparation?: React.ReactNode;
}) {
  const [roots, setRoots] = useState<LibraryFolder[]>([]),
    [selectedFolder, setSelectedFolder] = useState(() =>
      stored("neothesia-browser-folder", "") === "builtin"
        ? ""
        : stored("neothesia-browser-folder", ""),
    ),
    [expanded, setExpanded] = useState<Set<string>>(expandedFolders),
    [query, setQuery] = useState(""),
    [selectedPath, setSelectedPath] = useState(() =>
      stored("neothesia-browser-song", ""),
    ),
    [page, setPage] = useState(0),
    [tab, setTab] = useState("all"),
    [globalSearch, setGlobalSearch] = useState(false),
    [sort, setSort] = useState(() => {
      const value = stored("panthesia-browser-sort", "title");
      return ["title", "recent"].includes(value) ? value : "title";
    }),
    [descending, setDescending] = useState(
      () => stored("panthesia-browser-sort-desc", "false") === "true",
    );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState(""),
    [opening, setOpening] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (error) reportDiagnostic("曲库", error);
  }, [error]);
  const queryValue = useDeferredValue(query.trim().toLocaleLowerCase()),
    list = useRef<HTMLDivElement>(null);
  const grouping = useSongCatalog(rows);
  const catalogIndex = useMemo(
    () =>
      new Map(
        grouping.catalog?.performances.map((row) => [row.contentId, row]) ?? [],
      ),
    [grouping.catalog],
  );
  const rowByPath = useMemo(
    () => new Map(rows.map((row) => [libraryPath(row.path), row])),
    [rows],
  );
  const readRoots = async () => {
    try {
      const value = await api.command<{ folders: LibraryFolder[] }>({
        type: "libraryFolders",
      });
      setRoots(value.folders);
      if (!selectedFolder) {
        const output = value.folders.find(
          (f) => f.kind === "folder" && f.automatic && f.available,
        );
        if (output) {
          setSelectedFolder(libraryPath(output.path));
          setExpanded((old) => new Set([...old, libraryPath(output.path)]));
        }
      }
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void readRoots();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("neothesia-browser-folder", selectedFolder);
      localStorage.setItem(
        "neothesia-browser-expanded",
        JSON.stringify([...expanded]),
      );
      localStorage.setItem("neothesia-browser-song", selectedPath);
    } catch {}
  }, [selectedFolder, expanded, selectedPath]);
  const forest = useMemo(() => {
    const nodes = roots.map((root) => ({
      path: libraryPath(root.path),
      label:
        root.kind === "catalog"
          ? "练习曲库"
          : (root.path
              .replaceAll("\\", "/")
              .split("/")
              .filter(Boolean)
              .at(-1) ?? root.path),
      count: 0,
      children: new Map<string, FolderNode>(),
      available: root.available,
    }));
    const counted = new Set<string>();
    for (const row of rows) {
      const path = libraryPath(row.path);
      if (counted.has(path)) continue;
      counted.add(path);
      for (const root of nodes) {
        if (!path.startsWith(root.path + "/")) continue;
        root.count++;
        let node: FolderNode = root;
        for (const segment of portablePath(row.path)
          .slice(root.path.length + 1)
          .split("/")
          .slice(0, -1)) {
          const key = node.path + "/" + segment.toLowerCase();
          let child = node.children.get(key);
          if (!child) {
            child = {
              path: key,
              label: segment,
              count: 0,
              children: new Map(),
              available: true,
            };
            node.children.set(key, child);
          }
          child.count++;
          node = child;
        }
      }
    }
    return nodes;
  }, [rows, roots]);
  const searchTerms = useMemo(() => parseSongSearch(queryValue), [queryValue]);
  const records = useMemo(
    () => new Map(collection.map((r) => [libraryPath(r.path ?? ""), r])),
    [collection],
  );
  const recordsByContent = useMemo(
    () => new Map(collection.map((row) => [row.contentId, row])),
    [collection],
  );
  const recordFor = useMemo(
    () => (row: SongRow) =>
      row.contentId
        ? recordsByContent.get(row.contentId)
        : records.get(libraryPath(row.path)),
    [recordsByContent, records],
  );
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const path = libraryPath(row.path),
          record = recordFor(row);
        if (tab === "favorites" && !record?.favorite) return false;
        if (tab === "recent" && !record?.lastUsed) return false;
        if (
          !(globalSearch && queryValue) &&
          selectedFolder &&
          selectedFolder !== "builtin" &&
          !path.startsWith(selectedFolder + "/")
        )
          return false;
        if (selectedFolder === "builtin" && !row.id.startsWith("builtin/"))
          return false;
        return matchesSongSearch(
          {
            title: `${catalogIndex.get(row.contentId ?? "")?.title ?? ""} ${row.title}`,
            composer:
              catalogIndex.get(row.contentId ?? "")?.composer || row.composer,
            arranger: row.arranger ?? "",
            artist: "",
            collection: "",
            tags: (row.tags ?? []).join(" "),
            difficulty: row.difficulty ?? "",
            notes: "",
            path: row.path,
            source: `${row.source} ${row.category}`,
          },
          searchTerms,
        );
      }),
    [
      rows,
      recordFor,
      catalogIndex,
      tab,
      selectedFolder,
      globalSearch,
      queryValue,
      searchTerms,
    ],
  );
  const performanceCount = useMemo(
    () =>
      new Set(filtered.map((row) => row.contentId || libraryPath(row.path)))
        .size,
    [filtered],
  );
  const allGroups = useMemo(
    () => groupSongs(rows, catalogIndex, recordFor),
    [rows, catalogIndex, recordFor],
  );
  const allGroupsById = useMemo(
    () => new Map(allGroups.map((group) => [group.id, group])),
    [allGroups],
  );
  const visibleGroups = useMemo(
    () => groupSongs(filtered, catalogIndex, recordFor),
    [filtered, catalogIndex, recordFor],
  );
  const visibleById = useMemo(
    () => new Map(visibleGroups.map((group) => [group.id, group])),
    [visibleGroups],
  );
  const groups = useMemo(
    () =>
      visibleGroups
        .map((group) => allGroupsById.get(group.id) ?? group)
        .sort((a, b) => {
          const compared =
            sort === "recent"
              ? a.lastUsed - b.lastUsed
              : sort === "count"
                ? a.practiceCount - b.practiceCount
                : sort === "progress"
                  ? { new: 0, practiced: 1, whole: 2 }[a.practiceStage] -
                    { new: 0, practiced: 1, whole: 2 }[b.practiceStage]
                  : a.title.localeCompare(b.title, "zh-CN", { numeric: true });
          return compared
            ? compared * (descending ? -1 : 1)
            : a.id.localeCompare(b.id);
        }),
    [visibleGroups, allGroupsById, sort, descending],
  );
  useEffect(() => {
    try {
      localStorage.setItem("panthesia-browser-sort", sort);
      localStorage.setItem("panthesia-browser-sort-desc", String(descending));
    } catch {}
  }, [sort, descending]);
  const requested = rowByPath.get(libraryPath(selectedPath));
  const requestedKey = requested ? songKey(requested, catalogIndex) : null;
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const defaultGroup = useMemo(
    () =>
      groups.find((group) =>
        group.performances.some((performance) =>
          performance.locations.some(
            (row) =>
              current?.sourcePath &&
              libraryPath(row.path) === libraryPath(current.sourcePath),
          ),
        ),
      ) ?? groups[0],
    [groups, current?.sourcePath],
  );
  const selectedGroup = groupsById.get(requestedKey ?? "") ?? defaultGroup;
  const selected = selectedGroup
    ? songLocation(selectedGroup, selectedPath)
    : undefined;
  const selectedPerformance = selectedGroup?.performances.find(
    (performance) =>
      performance.id ===
      (selected?.contentId || libraryPath(selected?.path ?? "")),
  );
  const chooseGroup = (group: BrowserSong) => {
    const row =
      group.id === selectedGroup?.id && selected
        ? selected
        : songLocation(
            visibleById.get(group.id) ?? group,
            current?.sourcePath ?? "",
          );
    setSelectedPath(row.path);
    return row;
  };
  useEffect(() => setPage(0), [selectedFolder, queryValue, tab, globalSearch]);
  useEffect(() => {
    const index = groups.findIndex((group) => group.id === selectedGroup?.id);
    if (index >= 0) setPage(Math.floor(index / 60));
  }, [groups, selectedGroup?.id]);
  useEffect(() => {
    requestAnimationFrame(() =>
      list.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [page, selectedGroup?.id, groups]);
  const begin = async () => {
    if (!selected || opening || unavailable) return;
    setOpening(true);
    setError("");
    try {
      await open(selected);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };
  const folderName = selectedFolder ? selectedFolder.split("/").at(-1) : "曲库";
  const folderNode = (node: FolderNode, depth = 0): React.ReactNode => (
    <div key={node.path} role="none">
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selectedFolder === node.path}
        aria-expanded={node.children.size ? expanded.has(node.path) : undefined}
        className={`browser-tree-row ${selectedFolder === node.path ? "selected" : ""}`}
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <button
          aria-label={`${expanded.has(node.path) ? "折叠" : "展开"}${node.label}`}
          disabled={!node.children.size}
          onClick={() =>
            setExpanded((previous) => {
              const next = new Set(previous);
              next.has(node.path)
                ? next.delete(node.path)
                : next.add(node.path);
              return next;
            })
          }
        >
          {node.children.size ? (
            expanded.has(node.path) ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : (
            <span />
          )}
        </button>
        <button
          title={node.path}
          onClick={() => {
            setSelectedFolder(node.path);
            setQuery("");
          }}
        >
          <Folder size={16} />
          <span>{node.label}</span>
          <small>
            {node.available ? node.count.toLocaleString() : "未连接"}
          </small>
        </button>
      </div>
      {expanded.has(node.path) && (
        <div role="group">
          {[...node.children.values()]
            .sort((a, b) =>
              a.label.localeCompare(b.label, "zh-CN", { numeric: true }),
            )
            .map((n) => folderNode(n, depth + 1))}
        </div>
      )}
    </div>
  );
  return (
    <main className="song-browser">
      <aside className="browser-sidebar">
        <div className="browser-sidebar-title">
          <Library size={18} />
          <button
            className="browser-home"
            onClick={() => {
              setSelectedFolder("");
              setQuery("");
            }}
          >
            我的曲库
          </button>
        </div>
        <div className="browser-tree-heading">
          文件夹
          <button
            onClick={() => {
              setRefreshing(true);
              void refresh()
                .then(readRoots)
                .catch((e) => setError(String(e)))
                .finally(() => setRefreshing(false));
            }}
            disabled={refreshing}
            title="重新扫描目录"
          >
            {refreshing ? "扫描中" : "刷新"}
          </button>
        </div>
        <div
          className="browser-folder-tree"
          role="tree"
          aria-label="音乐文件夹"
          onKeyDown={(event) => {
            if (
              ![
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            const row = (event.target as HTMLElement).closest<HTMLElement>(
              '[role="treeitem"]',
            );
            if (!row) return;
            event.preventDefault();
            const rows = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="treeitem"]',
                ),
              ],
              index = rows.indexOf(row);
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              const open = row.getAttribute("aria-expanded") === "true";
              if (
                (event.key === "ArrowRight" && !open) ||
                (event.key === "ArrowLeft" && open)
              ) {
                row
                  .querySelector<HTMLButtonElement>("button:not(:disabled)")
                  ?.click();
                return;
              }
            }
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? rows.length - 1
                  : index +
                    (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1);
            rows[Math.max(0, Math.min(rows.length - 1, next))]
              ?.querySelector<HTMLButtonElement>("button:last-child")
              ?.focus();
          }}
        >
          {forest.map((node) => folderNode(node))}
        </div>
        <button className="browser-manage" onClick={manage}>
          <FolderOpen size={16} />
          管理文件夹
        </button>
      </aside>
      <section className="browser-content">
        <header className="browser-heading">
          <div>
            <h1>{folderName}</h1>
          </div>
          {current && (
            <button
              className="browser-resume"
              disabled={!!unavailable}
              onClick={resume}
            >
              <span>
                <small>继续上次演奏</small>
                <strong>{titleParts(current.title).title}</strong>
              </span>
              <ArrowRight size={19} />
            </button>
          )}
        </header>
        <div className="browser-search">
          <Search size={18} />
          <input
            aria-label="搜索曲目"
            placeholder="搜索歌曲"
            title={"支持 composer:作者、tags:标签、双引号短语和 -词 排除"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.checked)}
            />
            搜索全部目录
          </label>
        </div>
        <div className="browser-list-toolbar">
          <div role="tablist" aria-label="曲目分类">
            {[
              ["all", "全部"],
              ["favorites", "收藏"],
              ["recent", "最近打开"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  if (id === "recent") {
                    setSort("recent");
                    setDescending(true);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="browser-sort">
            <select
              aria-label="曲库排序"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="title">按曲名</option>
              <option value="recent">按最近打开</option>
            </select>
            <button
              aria-label={descending ? "切换为升序" : "切换为降序"}
              onClick={() => setDescending((value) => !value)}
            >
              {descending ? "↓ 降序" : "↑ 升序"}
            </button>
          </div>
        </div>
        <div
          className="browser-library-progress"
          aria-label="当前曲库的练习概况"
        >
          <span>
            {folderName} · {groups.length.toLocaleString()} 首 ·{" "}
            {performanceCount.toLocaleString()} 份演奏
          </span>
        </div>
        <div
          ref={list}
          className="browser-song-list"
          role="listbox"
          aria-label="曲目"
          onKeyDown={(e) => {
            if (opening || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key))
              return;
            e.preventDefault();
            if (e.key === "Enter") {
              void begin();
              return;
            }
            const index = groups.findIndex(
                (group) => group.id === selectedGroup?.id,
              ),
              next = Math.max(
                0,
                Math.min(
                  groups.length - 1,
                  index + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
            if (groups[next]) {
              chooseGroup(groups[next]);
              setPage(Math.floor(next / 60));
            }
          }}
          tabIndex={0}
        >
          {!ready && (
            <p className="browser-list-notice">
              正在读取曲库，已有目录会陆续显示…
            </p>
          )}
          {ready && !groups.length && (
            <div className="browser-empty">
              <Music2 size={35} />
              <h2>{query ? "没有匹配曲目" : "这个目录还没有曲目"}</h2>
              <p>
                {query
                  ? "试试其他名称，或搜索全部目录。"
                  : "选择其他文件夹，或在管理目录中添加 MIDI 所在位置。"}
              </p>
            </div>
          )}
          {grouping.error && (
            <p role="status" className="browser-list-notice">
              歌曲版本信息暂不可用。
              <button onClick={grouping.reload}>刷新</button>
            </p>
          )}
          {groups.slice(page * 60, (page + 1) * 60).map((group) => {
            const isCurrent =
              !!current &&
              group.performances.some(
                (performance) =>
                  (!!performance.contentId &&
                    performance.contentId === current.contentId) ||
                  performance.locations.some(
                    (row) =>
                      libraryPath(row.path) ===
                      libraryPath(current?.sourcePath ?? ""),
                  ),
              );
            return (
              <button
                key={group.id}
                role="option"
                aria-selected={group.id === selectedGroup?.id}
                disabled={opening}
                className={`browser-song ${group.id === selectedGroup?.id ? "selected" : ""}`}
                onClick={() => chooseGroup(group)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  chooseGroup(group);
                  setContext({ x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const box = event.currentTarget.getBoundingClientRect();
                    chooseGroup(group);
                    setContext({ x: box.left + 40, y: box.bottom });
                  }
                }}
                onDoubleClick={() => {
                  if (opening || unavailable) return;
                  const row = chooseGroup(group);
                  setOpening(true);
                  void open(row)
                    .catch((error) => setError(String(error)))
                    .finally(() => setOpening(false));
                }}
              >
                <span className="browser-song-icon">
                  <Music2 size={20} />
                </span>
                <span className="browser-song-title">
                  <strong>{titleParts(group.title).title}</strong>
                  <small>
                    {group.composer ||
                      group.performances[0].locations[0].source ||
                      "本地 MIDI"}
                    {group.performances.some(
                      (row) => row.notationCount > 0,
                    ) && <> · 有关联谱面</>}
                  </small>
                </span>
                {group.performances.length > 1 && (
                  <span className="browser-edition-count">
                    <Layers3 size={13} />
                    {group.performances.length} 份演奏
                  </span>
                )}
                {group.lastUsed > 0 && (
                  <span className="browser-song-study">
                    <small>{practiceDate(group.lastUsed)} 打开</small>
                  </span>
                )}
                {isCurrent && <span className="browser-current">当前歌曲</span>}
                <ChevronRight size={15} />
              </button>
            );
          })}
        </div>
        {error && (
          <p className="browser-list-notice" role="status">
            这次操作未能完成，详情已记入日志。
            <button onClick={() => void api.openLogs().catch(() => {})}>
              打开日志
            </button>
            <button onClick={() => setError("")}>收起</button>
          </p>
        )}
        <footer className="browser-pagination">
          <button
            className="browser-begin"
            disabled={!selected || !!unavailable || opening}
            onClick={() => void begin()}
          >
            <Play size={16} />
            {opening ? "正在打开…" : "打开演奏"}
          </button>
          <div>
            <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(groups.length / 60))}
            </span>
            <button
              disabled={(page + 1) * 60 >= groups.length}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
        {preparation}
      </section>
      {context && selected && (
        <SongContextMenu
          x={context.x}
          y={context.y}
          close={() => setContext(null)}
          open={() => void begin()}
          disabled={opening || !!unavailable}
          view={() => setDetailsOpen(true)}
          reveal={() =>
            void api.revealFile(selected.path).catch((e) => setError(String(e)))
          }
        />
      )}
      {detailsOpen && selected && (
        <Dialog
          title={titleParts(selectedGroup!.title).title}
          close={() => setDetailsOpen(false)}
        >
          <div className="song-object-details">
            <h3>演奏版本</h3>
            {selectedGroup!.performances.map((performance) => (
              <button
                key={performance.id}
                aria-pressed={performance.id === selectedPerformance?.id}
                onClick={() => setSelectedPath(performance.locations[0].path)}
              >
                {performance.label}
              </button>
            ))}
            <BrowserSongVersions
              key={selected.path}
              row={selected}
              disabled={!!unavailable || opening}
              changed={grouping.reload}
              open={async (path) => {
                const target = rowByPath.get(libraryPath(path));
                if (!target) throw new Error("文件暂时不可用");
                setDetailsOpen(false);
                return open(target);
              }}
            />
            <button
              disabled={opening || !!unavailable}
              onClick={() => {
                setDetailsOpen(false);
                void begin();
              }}
            >
              打开演奏与完整谱面
            </button>
            <button
              onClick={() =>
                void api
                  .revealFile(selected.path)
                  .catch((e) => setError(String(e)))
              }
            >
              在资源管理器中显示
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function SongContextMenu({
  x,
  y,
  close,
  open,
  view,
  reveal,
  disabled,
}: {
  x: number;
  y: number;
  close: () => void;
  open: () => void;
  view: () => void;
  reveal: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        previous?.focus();
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="song-context-menu"
      role="menu"
      aria-label="歌曲操作"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 244)),
        top: Math.max(8, Math.min(y, window.innerHeight - 160)),
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                buttons.length
        ]?.focus();
      }}
    >
      <button
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          close();
          open();
        }}
      >
        打开演奏
      </button>
      <button
        role="menuitem"
        onClick={() => {
          close();
          view();
        }}
      >
        查看歌曲与版本…
      </button>
      <button
        role="menuitem"
        onClick={() => {
          close();
          reveal();
        }}
      >
        在资源管理器中显示
      </button>
    </div>
  );
}
