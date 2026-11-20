import { portablePath } from "../../engine/pathIdentity";
import { parseSongSearch, matchesSongSearch } from "./songSearch";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, Layers3, Music2, Search } from "lucide-react";
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
  manage,
  unavailable,
  openProblem,
  menu,
  back,
  visible=true,
}: {
  rows: readonly SongRow[];
  ready: boolean;
  current: LoadedSong | null;
  collection: readonly CollectionSong[];
  open: (row: SongRow) => Promise<boolean>;
  manage: () => void;
  unavailable?: string | null;
  openProblem?: {path:string;message:string}|null;
  menu: () => void;
  back: () => void;
  visible?: boolean;
}) {
  const [roots, setRoots] = useState<LibraryFolder[]>([]),
    [selectedFolder, setSelectedFolder] = useState(() =>
      stored("panthesia-browser-folder",stored("neothesia-browser-folder", "")) === "builtin"
        ? ""
        : stored("panthesia-browser-folder",stored("neothesia-browser-folder", "")),
    ),
    [query, setQuery] = useState(""),
    [selectedPath, setSelectedPath] = useState(() =>
      stored("panthesia-browser-song",stored("neothesia-browser-song", "")),
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
    [opening, setOpening] = useState(false);
  useEffect(() => {
    if (error) reportDiagnostic("曲库", error);
  }, [error]);
  const queryValue = useDeferredValue(query.trim().toLocaleLowerCase()),
    list = useRef<HTMLDivElement>(null);
  const scroll=useRef(0);
  useLayoutEffect(()=>{if(visible&&list.current)list.current.scrollTop=scroll.current;},[visible]);
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
      setSelectedFolder(previous=>previous&&!value.folders.some(folder=>previous===libraryPath(folder.path)||previous.startsWith(libraryPath(folder.path)+"/"))?"":previous);

    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if(visible)void readRoots();
  }, [visible,rows]);
  useEffect(() => {
    try {
      localStorage.setItem("panthesia-browser-folder", selectedFolder);
      localStorage.setItem("panthesia-browser-song", selectedPath);
    } catch {}
  }, [selectedFolder, selectedPath]);
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
  const folderTrail = useMemo(() => {
    const result: FolderNode[] = [];
    const visit = (nodes: FolderNode[]): boolean => {
      for (const node of nodes) {
        if (
          selectedFolder === node.path ||
          selectedFolder.startsWith(node.path + "/")
        ) {
          result.push(node);
          if (selectedFolder !== node.path) visit([...node.children.values()]);
          return true;
        }
      }
      return false;
    };
    visit(forest);
    return result;
  }, [forest, selectedFolder]);
  const visibleFolders = query.trim()
    ? []
    : folderTrail.length
      ? [...folderTrail.at(-1)!.children.values()]
      : forest;
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
        if (!queryValue) {
          if (
            selectedFolder &&
            path.slice(0, path.lastIndexOf("/")) !== selectedFolder
          )
            return false;
          if (
            !selectedFolder &&
            forest.some((root) => path.startsWith(root.path + "/"))
          )
            return false;
        } else if (
          selectedFolder &&
          !globalSearch &&
          !path.startsWith(selectedFolder + "/")
        )
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
      forest,
      recordFor,
      catalogIndex,
      tab,
      selectedFolder,
      globalSearch,
      queryValue,
      searchTerms,
    ],
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
  return (
    <main className="song-browser">
      <header className="synthesia-library-header">
        <button
          className="synthesia-back"
          data-workspace-close
          onClick={back}
        >
          <ChevronRight size={20} style={{ transform: "rotate(180deg)" }} />
          Panthesia
        </button>
        <span className="synthesia-selected-song">
          {selected ? titleParts(selectedGroup!.title).title : "选择歌曲"}
        </span>
        <button
          className="synthesia-menu-button"
          aria-label="应用菜单"
          onClick={menu}
        >
          菜单
        </button>
        <button
          className="synthesia-continue"
          disabled={!selected || !!unavailable || opening}
          onClick={() => void begin()}
        >
          {opening ? "正在打开…" : "继续"}
          <ChevronRight size={20} />
        </button>
      </header>
      <section className="browser-content">
        <div className="synthesia-library-navigation">
          <nav className="synthesia-breadcrumbs" aria-label="曲库路径">
            <button
              onClick={() => {
                setSelectedFolder("");
                setQuery("");
              }}
            >
              歌曲
            </button>
            {folderTrail.map((node) => (
              <button
                key={node.path}
                onClick={() => {
                  setSelectedFolder(node.path);
                  setQuery("");
                }}
              >
                <ChevronRight size={16} />
                {node.label}
              </button>
            ))}
          </nav>
          <div className="browser-search">
            <Search size={20} />
            <input
              aria-label="搜索曲目"
              placeholder="搜索…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setGlobalSearch(true);
              }}
            />
          </div>
        </div>
        <div
          ref={list}
          onScroll={e=>{if(visible)scroll.current=e.currentTarget.scrollTop;}}
          className="browser-song-list"
          role="listbox"
          aria-label="曲目"
          onKeyDown={(e) => {
            if (opening || !["ArrowDown", "ArrowUp", "Enter"].includes(e.key))
              return;
            e.preventDefault();
            const candidates = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                ".browser-directory,.browser-song",
              ),
            ];
            if (e.key === "Enter") {
              const active = document.activeElement as HTMLButtonElement;
              if (active?.classList.contains("browser-directory"))
                active.click();
              else void begin();
              return;
            }
            let index = candidates.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (index < 0)
              index = candidates.findIndex(
                (row) => row.getAttribute("aria-selected") === "true",
              );
            const next =
              candidates[
                Math.max(
                  0,
                  Math.min(
                    candidates.length - 1,
                    index + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                )
              ];
            next?.focus();
            if (next?.classList.contains("browser-song")) next.click();
          }}
          tabIndex={0}
        >
          {visibleFolders
            .sort((a, b) =>
              a.label.localeCompare(b.label, "zh-CN", { numeric: true }),
            )
            .map((node) => (
              <button
                key={node.path}
                role="option"
                aria-selected={false}
                className="browser-directory"
                onClick={() => {
                  setSelectedFolder(node.path);
                  setQuery("");
                  setPage(0);
                }}
              >
                <Folder size={24} />
                <strong>{node.label}</strong>
                <span>
                  {node.available
                    ? `${node.count.toLocaleString()} 首`
                    : "未连接"}
                </span>
                <ChevronRight size={22} />
              </button>
            ))}
          {!ready && (
            <p className="browser-list-notice">
              正在读取曲库，已有目录会陆续显示…
            </p>
          )}
          {ready && !groups.length && !visibleFolders.length && (
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
                {openProblem&&group.performances.some(p=>p.locations.some(row=>libraryPath(row.path)===libraryPath(openProblem.path)))&&<small className="song-file-status">{openProblem.message}</small>}
                {isCurrent && <span className="browser-current">当前歌曲</span>}
                <ChevronRight size={15} />
              </button>
            );
          })}
        </div>
        {error && (
          <p className="browser-list-notice" role="status">
            文件操作未能完成。
            <button onClick={() => setError("")}>收起</button>
          </p>
        )}
        <footer className="browser-pagination">
          <button onClick={manage}>添加 / 管理文件夹</button>
          <div className="synthesia-sort" role="group" aria-label="歌曲排序">
            <button
              aria-pressed={sort === "title"}
              onClick={() => {
                if (sort === "title") setDescending((v) => !v);
                else {
                  setSort("title");
                  setDescending(false);
                }
              }}
            >
              曲名 {sort === "title" ? (descending ? "↓" : "↑") : ""}
            </button>
            <button
              aria-pressed={sort === "recent"}
              onClick={() => {
                if (sort === "recent") setDescending((v) => !v);
                else {
                  setSort("recent");
                  setDescending(true);
                }
              }}
            >
              最近打开
            </button>
            <button
              aria-pressed={tab === "favorites"}
              onClick={() =>
                setTab((v) => (v === "favorites" ? "all" : "favorites"))
              }
            >
              收藏
            </button>
          </div>
          <div className="synthesia-song-count">
            <span>{groups.length.toLocaleString()} 首</span>
            {groups.length > 60 && (
              <>
                <button disabled={!page} onClick={() => setPage((v) => v - 1)}>
                  ‹
                </button>
                <span>
                  {page + 1} / {Math.ceil(groups.length / 60)}
                </span>
                <button
                  disabled={(page + 1) * 60 >= groups.length}
                  onClick={() => setPage((v) => v + 1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
        </footer>
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
