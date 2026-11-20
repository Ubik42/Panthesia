import { parseSongSearch, matchesSongSearch } from "./songSearch";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Headphones,
  Library,
  Layers3,
  Music2,
  Pause,
  Play,
  Search,
  Settings2,
  Star,
} from "lucide-react";
import {
  api,
  clock,
  type SongRow,
  type LoadedSong,
  type Snapshot,
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
import { useSongAudition } from "./useSongAudition";
import { useSongCatalog } from "./useSongCatalog";
import { BrowserSongVersions } from "./BrowserSongVersions";

interface Preview {
  bpm: number;
  duration: number;
  measures: number;
  tracks: number;
  notes: number;
  preview: { pitch: number; start: number; duration: number }[];
}
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
function PreviewStaff({ value }: { value: Preview }) {
  const notes = value.preview,
    begin = notes[0]?.start ?? 0,
    end = begin + 8,
    degree = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  return (
    <svg
      className="browser-score-preview"
      viewBox="0 0 340 220"
      role="img"
      aria-label="所选 MIDI 开头的简单双谱表"
    >
      {[48, 57, 66, 75, 84, 135, 144, 153, 162, 171].map((y) => (
        <line key={y} x1={20} x2={320} y1={y} y2={y} />
      ))}
      <text x={23} y={83} className="preview-clef">
        𝄞
      </text>
      <text x={23} y={167} className="preview-clef">
        𝄢
      </text>
      {notes
        .filter((n) => n.start < end)
        .slice(0, 64)
        .map((n, index) => {
          const low = n.pitch < 60,
            y =
              (low ? 171 : 84) -
              (Math.floor(n.pitch / 12 - 1) * 7 +
                degree[n.pitch % 12] -
                (low ? 18 : 30)) *
                4.5,
            x = 62 + ((n.start - begin) / 8) * 245;
          return (
            <g key={index}>
              <ellipse
                cx={x}
                cy={y}
                rx={4.4}
                ry={3.2}
                transform={`rotate(-16 ${x} ${y})`}
              />
              <line x1={x + 4} x2={x + 4} y1={y} y2={y - 23} />
            </g>
          );
        })}
    </svg>
  );
}
export function SongBrowser({
  rows,
  ready,
  current,
  state,
  collection,
  open,
  resume,
  devices,
  manage,
  refresh,
  unavailable,
  preparation,
}: {
  rows: readonly SongRow[];
  ready: boolean;
  current: LoadedSong | null;
  state: Pick<Snapshot, "output" | "sound">;
  collection: readonly CollectionSong[];
  open: (row: SongRow) => Promise<boolean>;
  resume: () => void;
  devices: () => void;
  manage: () => void;
  refresh: () => Promise<unknown>;
  unavailable?: string | null;
  preparation?: React.ReactNode;
}) {
  const [roots, setRoots] = useState<LibraryFolder[]>([]),
    [selectedFolder, setSelectedFolder] = useState(() =>
      stored("neothesia-browser-folder", ""),
    ),
    [expanded, setExpanded] = useState<Set<string>>(expandedFolders),
    [query, setQuery] = useState(""),
    [selectedPath, setSelectedPath] = useState(() =>
      stored("neothesia-browser-song", ""),
    ),
    [page, setPage] = useState(0),
    [tab, setTab] = useState("all"),
    [globalSearch, setGlobalSearch] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [opening, setOpening] = useState(false),
    [refreshing, setRefreshing] = useState(false);
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
    for (const row of rows) {
      const path = libraryPath(row.path);
      for (const root of nodes) {
        if (!path.startsWith(root.path + "/")) continue;
        root.count++;
        let node: FolderNode = root;
        for (const segment of row.path
          .replaceAll("\\", "/")
          .replace(/^\/\/\?\//, "")
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
        .map((group) => ({
          ...group,
          performances:
            allGroupsById.get(group.id)?.performances ?? group.performances,
        }))
        .sort((a, b) =>
          tab === "recent"
            ? b.lastUsed - a.lastUsed
            : a.title.localeCompare(b.title, "zh-CN", { numeric: true }),
        ),
    [visibleGroups, allGroupsById, tab],
  );
  const requested = rowByPath.get(libraryPath(selectedPath));
  const requestedKey = requested ? songKey(requested, catalogIndex) : null;
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const defaultGroup = useMemo(
    () =>
      groups.find((group) => /look at the sky/i.test(group.title)) ?? groups[0],
    [groups],
  );
  const selectedGroup = groupsById.get(requestedKey ?? "") ?? defaultGroup;
  const selected = selectedGroup
    ? songLocation(selectedGroup, selectedPath)
    : undefined;
  const audition = useSongAudition(selected?.path);
  const stopPreview = () => { void audition.stop().catch(e => setError(String(e))); };
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
  useEffect(() => {
    stopPreview();
    setPreview(null);
    setError("");
    if (!selected) return;
    let live = true;
    const timer = setTimeout(() => {
      void api
        .command<Preview>({ type: "songPreview", path: selected.path })
        .then((value) => {
          if (live) setPreview(value);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }, 160);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected?.path]);
  const listen = () => {
    if (audition.active) stopPreview();
    else void audition.start();
  };
  const begin = async () => {
    if (!selected || opening || unavailable) return;
    setOpening(true);
    try {
      await audition.stop();
      await open(selected);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };
  const folderName =
    selectedFolder === "builtin"
      ? "内置练习"
      : selectedFolder
        ? selectedFolder.split("/").at(-1)
        : "全部歌曲";
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
          <strong>我的曲库</strong>
        </div>
        <button
          className={`browser-root ${!selectedFolder ? "selected" : ""}`}
          onClick={() => setSelectedFolder("")}
        >
          <Music2 size={17} />
          全部歌曲<small>{allGroups.length.toLocaleString()}</small>
        </button>
        <button
          className={`browser-root ${selectedFolder === "builtin" ? "selected" : ""}`}
          onClick={() => setSelectedFolder("builtin")}
        >
          <Star size={17} />
          入门练习
        </button>
        <div className="browser-tree-heading">
          文件夹
          <button
            onClick={() => {
              setRefreshing(true);
              void refresh()
                .then(readRoots)
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
          管理目录与曲目
        </button>
        <button className="browser-manage" onClick={devices}>
          <Settings2 size={16} />
          设备与声音
        </button>
      </aside>
      <section className="browser-content">
        <header className="browser-heading">
          <div>
            <p>选择一首，开始练习</p>
            <h1>曲库</h1>
          </div>
          {current && (
            <button
              className="browser-resume"
              disabled={!!unavailable}
              onClick={() => { void audition.stop().then(resume).catch(e => setError(String(e))); }}
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
            placeholder="搜索曲名、作者、标签；可用 composer:肖邦"
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
              ["recent", "最近"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <span>
            {folderName} <b> / </b>
            {groups.length.toLocaleString()} 首 ·{" "}
            {performanceCount.toLocaleString()} 份演奏
          </span>
        </div>
        <div
          ref={list}
          className="browser-song-list"
          role="listbox"
          aria-label="曲目"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
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
              歌曲关系暂未读到：{grouping.error}{" "}
              <button onClick={grouping.reload}>重新读取</button>
            </p>
          )}
          {groups.slice(page * 60, (page + 1) * 60).map((group) => {
            const isCurrent = !!current && group.performances.some(
              (performance) =>
                (!!performance.contentId && performance.contentId === current.contentId) ||
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
                className={`browser-song ${group.id === selectedGroup?.id ? "selected" : ""}`}
                onClick={() => chooseGroup(group)}
                onDoubleClick={() => {
                  if (opening || unavailable) return;
                  const row = chooseGroup(group);
                  stopPreview();
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
                {isCurrent && <span className="browser-current">当前歌曲</span>}
                <ChevronRight size={15} />
              </button>
            );
          })}
        </div>
        <footer className="browser-pagination">
          <span>包含子目录中的曲目</span>
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
      <aside className="browser-detail">
        {selected ? (
          <>
            <div className="browser-detail-top">
              <span>曲目预览</span>
              <Music2 size={18} />
            </div>
            <h2>{titleParts(selectedGroup!.title).title}</h2>
            <label className="browser-performance-picker">
              <span>
                <Layers3 size={15} />
                演奏版本 · {selectedGroup!.performances.length} 份
              </span>
              <select
                aria-label="选择演奏版本"
                value={selectedPerformance?.id ?? ""}
                disabled={opening}
                onChange={(event) => {
                  const performance = selectedGroup!.performances.find(
                    (row) => row.id === event.target.value,
                  );
                  if (performance)
                    setSelectedPath(performance.locations[0].path);
                }}
              >
                {selectedGroup!.performances.map((performance) => (
                  <option key={performance.id} value={performance.id}>
                    {performance.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="browser-version">
              {titleParts(selected.title).version}
              {selectedPerformance?.notationCount
                ? ` · ${selectedPerformance.notationCount} 份谱面`
                : ""}
            </p>
            <div className="browser-preview-paper">
              {preview ? (
                <PreviewStaff value={preview} />
              ) : (
                <div className="browser-preview-loading">正在读取谱面预览…</div>
              )}
            </div>
            <dl className="browser-song-facts">
              <div>
                <dt>原速</dt>
                <dd>{preview ? `${Math.round(preview.bpm)} BPM` : "—"}</dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>{preview ? clock(preview.duration) : "—"}</dd>
              </div>
              <div>
                <dt>小节</dt>
                <dd>{preview?.measures ?? "—"}</dd>
              </div>
              <div>
                <dt>音轨</dt>
                <dd>{preview?.tracks ?? "—"}</dd>
              </div>
            </dl>
            <div className="browser-song-actions">
            <button
              className={`browser-audition${audition.active ? " is-playing" : ""}`}
              aria-pressed={audition.active}
              disabled={!preview || !!unavailable || opening}
              onClick={listen}
            >
              {audition.active ? <Pause size={17} /> : <Headphones size={17} />}{" "}
              {audition.phase === "preparing" ? "取消准备" : audition.active ? "停止试听" : "试听开头 8 秒"}
              {audition.phase === "playing" && <span className="browser-audition-time">{audition.position.toFixed(1)} / {audition.duration.toFixed(1)} 秒</span>}
            </button>
            <button
              className="browser-begin"
              disabled={!!unavailable || opening}
              onClick={() => void begin()}
            >
              <Play size={17} fill="currentColor" />
              {opening ? "正在准备…" : "开始演奏"}
            </button>
            {audition.error && <p className="browser-audition-error" role="alert">{audition.error}</p>}
            </div>
            <div className="browser-sound-status">
              <i className={state.sound?.ready ? "ready" : ""} />
              <span>
                {state.output}
                <small>{state.sound?.device ?? "系统默认设备"}</small>
              </span>
              <button onClick={devices} aria-label="选择音源">
                <Settings2 size={16} />
              </button>
            </div>
            <details className="browser-file-location">
              <summary>文件位置</summary>
              {selectedPerformance?.locations.map((location) => (
                <button
                  key={location.path}
                  className="browser-location-option"
                  aria-pressed={
                    libraryPath(location.path) === libraryPath(selected.path)
                  }
                  title={location.path}
                  onClick={() => setSelectedPath(location.path)}
                >
                  {location.path}
                </button>
              ))}
            </details>
            <BrowserSongVersions
              key={`${selected.contentId ?? ""}:${selected.path}`}
              row={selected}
              disabled={!!unavailable || opening}
              changed={grouping.reload}
              open={async (path) => {
                const target = rowByPath.get(libraryPath(path));
                if (!target)
                  throw new Error(
                    "这个文件位置未出现在当前曲库，请重新扫描后打开。",
                  );
                stopPreview();
                setOpening(true);
                try {
                  return await open(target);
                } finally {
                  setOpening(false);
                }
              }}
            />
            {error && (
              <p role="alert" className="browser-error">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="browser-detail-empty">
            <Music2 size={34} />
            <p>选择曲目，查看谱面和练习信息。</p>
          </div>
        )}
      </aside>
    </main>
  );
}
