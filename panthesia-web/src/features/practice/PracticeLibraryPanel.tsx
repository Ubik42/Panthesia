import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  LocateFixed,
  Music2,
  RefreshCw,
  Search,
  Star,
  X,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import type { CollectionSong, SongRow } from "../../api";
import { PanelResizeHandle } from "../../PanelResizeHandle";
import { useBrowseScroll } from "../../app/useBrowseScroll";
import { BrowsePagination } from "../../app/BrowsePagination";
import {
  practiceLibraryIndex,
  practiceLibraryView,
  isPracticeLibraryCurrent,
  type PracticeLibraryBrowse,
  type PracticeLibraryItem,
} from "./practiceLibraryModel";
import "./practiceLibrary.css";
import { ScanFolders, libraryPath } from "../library/ScanFolders";

const tabs = [
  { id: "all", label: "全部" },
  { id: "favorites", label: "收藏" },
  { id: "recent", label: "最近" },
  { id: "queue", label: "队列" },
] as const;
const pageSize = 40;
export function PracticeLibraryPanel({
  rows,
  collection,
  current,
  browse,
  change,
  compact,
  width,
  resize,
  close,
  open,
  manage,
  refresh,
  unavailable,
  opening,
  progress,
  scrollMemory,
  rememberScroll,
  ready = true,
  readError,
}: {
  rows: readonly SongRow[];
  collection: readonly CollectionSong[];
  current?: {
    contentId: string;
    title: string;
    path?: string | null;
    generated?: boolean;
  } | null;
  browse: PracticeLibraryBrowse;
  change: (browse: PracticeLibraryBrowse) => void;
  compact: boolean;
  width: number;
  resize: (value: number) => void;
  close: () => void;
  open: (item: PracticeLibraryItem) => Promise<boolean>;
  manage: () => void;
  refresh: () => Promise<unknown>;
  scrollMemory: Map<string, number>;
  rememberScroll?: (key: string, top: number) => void;
  ready?: boolean;
  readError?: string;
  unavailable?: string | null;
  opening?: { path: string; contentId?: string | null; title: string } | null;
  progress: () => void;
}) {
  const [folder,setFolder]=useState<string|null>(null);
  const folderRows=useMemo(()=>folder?rows.filter(row=>libraryPath(row.path).startsWith(libraryPath(folder)+"/")):rows,[rows,folder]);
  const index = useMemo(
    () => practiceLibraryIndex(folderRows, folder?collection.filter(row=>row.path && libraryPath(row.path).startsWith(libraryPath(folder)+"/")):collection),
    [folderRows, collection, folder],
  );
  const deferredQuery = useDeferredValue(browse.query);
  const filtering = deferredQuery !== browse.query;
  const view = useMemo(
    () => practiceLibraryView(index, { ...browse, query: deferredQuery }),
    [index, browse.tab, deferredQuery, browse.source],
  );
  const page = Math.max(
    0,
    Math.min(browse.page, Math.ceil(view.items.length / pageSize) - 1),
  );
  const visible = view.items.slice(page * pageSize, (page + 1) * pageSize);
  const [message, setMessage] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    refreshActive = useRef(false),
    focusRequested = useRef(false),
    hadListFocus = useRef(false),
    alive = useRef(true);
  const scrollKey = JSON.stringify([
    browse.tab,
    browse.query,
    browse.source,
    page,
  ]);
  const scrolling = useBrowseScroll<HTMLDivElement>(
    scrollKey,
    ready && !filtering,
    0,
    (top) => rememberScroll?.(scrollKey, top),
    scrollMemory,
  );
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      list.current = node;
      scrolling.ref(node);
    },
    [scrolling.ref],
  );
  const heading = useId(),
    listId = useId();
  const selected =
    visible.find((item) => item.key === browse.focusedKey) ??
    visible.find((item) => isPracticeLibraryCurrent(item, current)) ??
    visible[0];
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    // A restored page can only be clamped after both catalog and collection arrive.
    if (ready && !filtering && browse.page !== page)
      change({ ...browse, page });
  }, [ready, filtering, browse.page, page, change]);
  useLayoutEffect(() => {
    if (!focusRequested.current || !ready || filtering) return;
    const item =
      list.current?.querySelector<HTMLButtonElement>('[tabindex="0"]');
    if (item) {
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest" });
      focusRequested.current = false;
    }
  }, [page, browse.focusedKey, view.items, ready, filtering]);
  useLayoutEffect(() => {
    if (!hadListFocus.current || filtering || !ready) return;
    const index = view.items.findIndex(
      (item) => item.key === browse.focusedKey,
    );
    if (index >= 0 && Math.floor(index / pageSize) !== page) {
      focusRequested.current = true;
      change({ ...browse, page: Math.floor(index / pageSize) });
    } else if (selected && document.activeElement === document.body) {
      list.current
        ?.querySelector<HTMLButtonElement>('[tabindex="0"]')
        ?.focus({ preventScroll: true });
    }
  }, [view.items, page, filtering, ready]);
  const update = (patch: Partial<PracticeLibraryBrowse>, reset = true) => {
    setMessage("");
    change({
      ...browse,
      ...patch,
      ...(reset ? { page: 0, focusedKey: null } : {}),
    });
  };
  const selectIndex = (value: number) => {
    if (!ready || filtering) return;
    const index = Math.max(0, Math.min(view.items.length - 1, value)),
      item = view.items[index];
    if (!item) return;
    focusRequested.current = true;
    if (Math.floor(index / pageSize) !== page)
      scrollMemory.set(
        JSON.stringify([
          browse.tab,
          browse.query,
          browse.source,
          Math.floor(index / pageSize),
        ]),
        0,
      );
    change({
      ...browse,
      page: Math.floor(index / pageSize),
      focusedKey: item.key,
    });
  };
  const locate = () => {
    let target = view.items.findIndex((item) =>
      isPracticeLibraryCurrent(item, current),
    );
    if (target >= 0) {
      selectIndex(target);
      return;
    }
    const reset: PracticeLibraryBrowse = {
      ...browse,
      tab: "all",
      query: "",
      source: "",
      page: 0,
      focusedKey: null,
    };
    const all = practiceLibraryView(index, reset).items;
    target = all.findIndex((item) => isPracticeLibraryCurrent(item, current));
    if (target < 0 && current) {
      const recents = practiceLibraryView(index, {
        ...reset,
        tab: "recent",
      }).items;
      target = recents.findIndex((item) =>
        isPracticeLibraryCurrent(item, current),
      );
      if (target >= 0) {
        focusRequested.current = true;
        change({
          ...reset,
          tab: "recent",
          page: Math.floor(target / pageSize),
          focusedKey: recents[target].key,
        });
        return;
      }
    }
    if (target < 0) {
      setMessage("当前曲目尚未出现在侧栏，可重新读取曲库。");
      return;
    }
    focusRequested.current = true;
    change({
      ...reset,
      page: Math.floor(target / pageSize),
      focusedKey: all[target].key,
    });
  };
  const openItem = async (item: PracticeLibraryItem) => {
    if (!ready) {
      setMessage(readError || "曲库仍在读取，完成后可选择曲目。");
      return;
    }
    if (filtering) {
      setMessage("正在筛选曲目，请稍后选择。");
      return;
    }
    if (unavailable) {
      setMessage(unavailable);
      return;
    }
    setMessage("");
    try {
      await open(item);
    } catch (failure) {
      if (alive.current)
        setMessage(
          failure instanceof Error ? failure.message : String(failure),
        );
    }
  };
  const reload = async () => {
    if (refreshActive.current) return;
    refreshActive.current = true;
    setRefreshing(true);
    setMessage("");
    try {
      await refresh();
    } catch (failure) {
      if (alive.current)
        setMessage(
          failure instanceof Error ? failure.message : String(failure),
        );
    } finally {
      refreshActive.current = false;
      if (alive.current) setRefreshing(false);
    }
  };
  return (
    <aside
      className="library-panel practice-library"
      role={compact ? "dialog" : undefined}
      aria-modal={compact ? true : undefined}
      aria-labelledby={heading}
      data-practice-drawer={compact ? "" : undefined}
    >
      <PanelResizeHandle
        label="调整曲库宽度"
        value={width}
        min={180}
        max={440}
        change={resize}
      />
      <div className="panel-heading">
        <div>
          <strong id={heading}>曲库</strong>
        </div>
        <button
          className="icon-button"
          aria-label="隐藏选曲侧栏"
          data-dialog-close={compact ? true : undefined}
          onClick={close}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
      <div
        className="practice-library-tabs"
        role="tablist"
        aria-label="选曲范围"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`${listId}-${tab.id}`}
            role="tab"
            aria-selected={browse.tab === tab.id}
            tabIndex={browse.tab === tab.id ? 0 : -1}
            aria-controls={listId}
            onClick={() => update({ tab: tab.id, source: "" })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                      tabs.length;
              update({ tab: tabs[next].id, source: "" });
              (
                event.currentTarget.parentElement?.children[
                  next
                ] as HTMLButtonElement
              )?.focus();
            }}
          >
            <span>{tab.label}</span>
            <small>{view.counts[tab.id].toLocaleString()}</small>
          </button>
        ))}
      </div>
      <ScanFolders rows={rows} selected={folder} change={path=>{setFolder(path);update({page:0,query:"",source:""});}} manage={manage}/>
      <div className="library-filters">
        <label className="search-box">
          <Search size={14} />
          <input
            aria-label="搜索侧栏曲目"
            data-practice-library-search=""
            data-dialog-initial-focus={compact ? true : undefined}
            placeholder="曲名、作曲家或标签"
            value={browse.query}
            onChange={(event) => update({ query: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" && view.items.length) {
                event.preventDefault();
                selectIndex(page * pageSize);
              }
              if (event.key === "Escape" && browse.query) {
                event.preventDefault();
                event.stopPropagation();
                update({ query: "" });
              }
            }}
          />
          {browse.query && (
            <button
              aria-label="清空侧栏搜索"
              onClick={() => update({ query: "" })}
            >
              <X size={13} />
            </button>
          )}
        </label>
        <div className="practice-library-filter-row">
          <select
            aria-label="筛选曲目来源"
            value={browse.source}
            onChange={(event) => update({ source: event.target.value })}
          >
            <option value="">全部来源</option>
            {browse.source && !view.sources.includes(browse.source) && (
              <option value={browse.source}>
                {browse.source}（当前无曲目）
              </option>
            )}
            {view.sources.map((source) => (
              <option key={source}>{source}</option>
            ))}
          </select>
          <button
            disabled={!current || !ready || filtering}
            title="在列表中定位当前练习"
            aria-label="定位当前曲目"
            onClick={locate}
          >
            <LocateFixed size={15} />
          </button>
        </div>
      </div>
      {opening && (
        <div className="practice-library-opening" role="status">
          <LoaderCircle size={14} />
          <span>正在打开：{opening.title}</span>
          <button onClick={progress}>查看进度</button>
        </div>
      )}
      {filtering && (
        <p className="practice-library-message" role="status">
          正在筛选曲目…
        </p>
      )}
      {(!ready || readError) && (
        <div className="practice-library-read" role="status">
          <span>{readError || "正在读取曲库与练习队列…"}</span>
          {readError && (
            <button disabled={refreshing} onClick={() => void reload()}>
              重新读取
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="practice-library-message" role="status">
          {message}
        </p>
      )}
      <div
        ref={attachList}
        onScroll={scrolling.onScroll}
        id={listId}
        className="library-list"
        role="tabpanel"
        aria-labelledby={`${listId}-${browse.tab}`}
        aria-busy={filtering || !ready || undefined}
        onFocusCapture={() => {
          hadListFocus.current = true;
        }}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget as Node)
          )
            hadListFocus.current = false;
        }}
        aria-label={`${tabs.find((tab) => tab.id === browse.tab)?.label}曲目`}
      >
        <div role="listbox" aria-label="选择练习曲目">
          {visible.map((item, offset) => {
            const active = isPracticeLibraryCurrent(item, current);
            return (
              <button
                key={item.key}
                role="option"
                aria-selected={selected?.key === item.key}
                aria-current={active ? "true" : undefined}
                aria-disabled={!!unavailable || filtering || !ready}
                tabIndex={selected?.key === item.key ? 0 : -1}
                className={`song-row${active ? " active" : ""}`}
                title={`${item.title}\n${item.row.composer || item.row.source}\n${item.row.path}`}
                onFocus={() => {
                  if (ready && !filtering && browse.focusedKey !== item.key)
                    change({ ...browse, page, focusedKey: item.key });
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  const absolute = page * pageSize + offset;
                  const target =
                    event.key === "ArrowDown"
                      ? absolute + 1
                      : event.key === "ArrowUp"
                        ? absolute - 1
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? view.items.length - 1
                            : event.key === "PageDown"
                              ? absolute + pageSize
                              : event.key === "PageUp"
                                ? absolute - pageSize
                                : null;
                  if (target == null) return;
                  event.preventDefault();
                  selectIndex(target);
                }}
                onClick={() => void openItem(item)}
              >
                <span className="song-index">
                  {browse.tab === "queue" ? (
                    page * pageSize + offset + 1
                  ) : (
                    <Music2 size={15} />
                  )}
                </span>
                <span className="song-text">
                  <strong>{item.title}</strong>
                  <small>
                    {active
                      ? "当前练习 · "
                      : item.record?.available === false
                        ? "需要重新定位 · "
                        : item.record?.review?.due
                          ? "待复习 · "
                          : ""}
                    {item.subtitle}
                  </small>
                </span>
                {item.record?.favorite && (
                  <Star size={12} fill="currentColor" />
                )}
              </button>
            );
          })}
        </div>
        {!visible.length && ready && !readError && (
          <div className="practice-library-empty">
            <Music2 size={27} />
            <strong>
              {browse.query || browse.source
                ? "没有找到曲目"
                : browse.tab === "queue"
                  ? "准备一份练习队列"
                  : browse.tab === "favorites"
                    ? "把常练的曲目放在这里"
                    : "从曲库添加一首曲目"}
            </strong>
            <p>
              {browse.query || browse.source
                ? "换个关键词，或清除筛选后再看看。"
                : browse.tab === "queue"
                  ? "在曲库中加入队列，练完一首后可直接继续下一首。"
                  : browse.tab === "favorites"
                    ? "打开曲目后点亮星标，下次从收藏中快速找到。"
                    : "导入 MIDI、生成技术练习，或浏览已有曲目。"}
            </p>
            {browse.query || browse.source ? (
              <button onClick={() => update({ query: "", source: "" })}>
                清除筛选
              </button>
            ) : (
              <button onClick={manage}>打开曲库管理</button>
            )}
          </div>
        )}
      </div>
      <BrowsePagination
        page={page}
        total={view.items.length}
        pageSize={pageSize}
        disabled={!ready || filtering}
        label="侧栏曲目"
        unit="首"
        change={(page) => {
          list.current?.scrollTo({ top: 0 });
          update({ page, focusedKey: null }, false);
        }}
      />
      <div className="library-footer">
        <button onClick={manage}>
          <ArrowUpRight size={13} />
          曲库管理
        </button>
        <span>
          {view.items.length.toLocaleString()} / {view.total.toLocaleString()}{" "}
          首
        </span>
        <button
          aria-label="重新读取选曲侧栏"
          title="重新读取曲库"
          disabled={refreshing}
          onClick={() => void reload()}
        >
          <RefreshCw
            size={13}
            className={refreshing ? "practice-library-spin" : undefined}
          />
        </button>
      </div>
    </aside>
  );
}
