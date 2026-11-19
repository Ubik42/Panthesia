import { readLibraryMetadata } from "./features/library/metadataClient";
import { SynthesiaImportDialog } from "./features/library/SynthesiaImportDialog";
import "./features/library/synthesiaImport.css";
import { libraryGroups } from "./features/library/libraryGroups";
import { isCurrentPracticeRow } from "./features/library/currentPracticeRow";
import { useLibraryActivity } from "./features/library/useLibraryActivity";
import type { CollectionRead } from "./features/practice/usePracticeSession";
import { BrowseFilterChips, type BrowseFilterChip } from "./app/BrowseFilterChips";
import { LibrarySongDetail } from "./features/library/LibrarySongDetail";
import type { LibraryDetailSection } from "./features/library/libraryBrowse";
import { LibrarySelectionSummary } from "./features/library/LibrarySelectionSummary";
import { useWorkspaceFocus } from "./app/useWorkspaceFocus";
import { useBrowsePane } from "./app/useBrowsePane";
import { useBrowseSearch } from "./app/useBrowseSearch";
import { BrowsePaneNavigation } from "./app/BrowsePaneNavigation";
import { BrowseControls } from "./app/BrowseControls";
import { BrowsePagination } from "./app/BrowsePagination";
import { BrowseListState } from "./app/BrowseListState";
import { ToolbarMore } from "./app/ToolbarMore";
import { WorkspaceReadStatus } from "./app/WorkspaceReadStatus";
import { TaskActivity } from "./engine/TaskActivity";
import { useLibraryReads, type LibraryCache } from "./features/library/useLibraryReads";
import { PaperSourceUpdatesDialog } from "./PaperSourceUpdatesDialog";
import { LibraryMetadataHistoryDialog, type MetadataHistoryContext } from "./LibraryMetadataHistoryDialog";
import { LibraryMetadataBatchDialog, type MetadataBatchItem } from "./LibraryMetadataBatchDialog";
import { FileLocationsDialog } from "./FileLocationsDialog";
import {
  LibraryMetadataEditor,
  type MetadataEdit,
} from "./LibraryMetadataEditor";
import {
  LibraryContextMenu,
  copyLibraryPaths,
  type LibraryMenuAction,
} from "./LibraryContextMenu";
import { PracticeTimePanel } from "./PracticeTimePanel";
import { SongLearningDialog } from "./SongLearningDialog";
import {
  learningStages,
  learningMatches,
  compareLearning,
  activeDeadline,
  localDay,
  type SongLearning,
} from "./songLearning";
import { ScoreSourcesDialog } from "./ScoreSourcesDialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBrowseScroll } from "./app/useBrowseScroll";
import { isComposingKey, ownsInputLayer } from "./app/inputOwnership";
import type { MetadataDraft } from "./features/library/metadataTypes";
import type { LibraryBrowse, LibrarySearchRequest, LibraryVisitReturn } from "./features/library/libraryBrowse";
import { libraryVisitReturn } from "./features/library/libraryBrowse";
import type { SongWorkspaceTarget } from "./app/songWorkspaceVisit";
import type { Workspace } from "./app/useWorkspaceNavigation";
import { LibraryScoresPane, type LibraryScoreVisitSelection } from "./LibraryScoresPane";
import { LibraryRepairsDialog } from "./LibraryRepairsDialog";
import { X } from "lucide-react";
import { api, clock, type SongRow } from "./api";
import type { CollectionSong } from "./api";
import {
  compare,
  defaults,
  libraryViewKey,
  matches,
  key,
  readView,
  storage,
  terms,
  type Entry,
  type View,
} from "./libraryQuery";
const indexPhase: Record<string, string> = {
  idle: "索引未开始", running: "正在索引", paused: "索引已暂停", completed: "索引完成", cancelled: "索引已取消", failed: "索引失败",
};
function reviewReason(review: NonNullable<CollectionSong["review"]>): string {
  const reasons: Record<string, string> = {
    NeedsEvidence: "这次练习缺少有效音符成绩",
    IncompleteConditions: "这次练习缺少完整条件，旧成绩不能证明同条件连胜",
    NeedsReinforcement: "最近一次同条件练习尚未达标",
    FirstMastery: "同条件达标 1 次",
    Consolidating: "同条件连续达标 2 次",
    Stable: `同条件连续达标 ${review.streak} 次`,
  };
  return reasons[review.reason ?? ""] ?? "复习日期已根据最近一次练习计算";
}
function reviewLabel(review: CollectionSong["review"]): string {
  if (!review) return "";
  const reason = reviewReason(review);
  const source = review.sourceAt
    ? `；依据 ${new Date(review.sourceAt).toLocaleDateString("zh-CN")} 的${review.sourceIsWholeSong ? "整曲" : "练习"}成绩`
    : "";
  return (review.due ? `待复习：${reason}` : `${reason}，${review.days} 天后复习`) + source;
}
function reviewShort(review: CollectionSong["review"], lastPracticed?: number | null): string {
  if (!review) return "";
  const source = review.sourceIsWholeSong && review.sourceAt && review.sourceAt !== lastPracticed
    ? ` · 整曲 ${new Date(review.sourceAt).toLocaleDateString("zh-CN")}`
    : "";
  if (review.reason === "IncompleteConditions") return `条件不足 · 待复习${source}`;
  if (review.reason === "NeedsEvidence") return `成绩不足 · 待复习${source}`;
  return (review.due ? "待复习" : `${review.days} 天后复习`) + source;
}
export function LibraryDialog({
  presentation = "dialog",
  engineId,
  initialBrowse,
  searchRequest,
  searchConsumed,
  reviewSong,
  currentPractice,
  continuePractice,
  openUnavailable,
  importFiles,
  backToSource,
  readCache,
  readCollection,
  rememberBrowse,
  metadataDrafts,
  learningDrafts,
  navigationLockChanged,
  rows,
  rowsReady = true,
  rowsError = "",
  refreshRows,
  close,
  changed: notifyChanged,
  confirmEditRefresh,
  open,
  openVersion,
  preparation,
  initialFocus,
  focusConsumed,
}: {
  preparation?: import("react").ReactNode;
  presentation?: "dialog" | "workspace";
  engineId?: string;
  initialBrowse?: LibraryBrowse;
  searchRequest?: LibrarySearchRequest | null;
  searchConsumed?: (id: string) => void;
  reviewSong?: (song: SongWorkspaceTarget) => Promise<boolean>;
  currentPractice?: SongWorkspaceTarget | null;
  continuePractice?: (song: SongWorkspaceTarget) => Promise<boolean>;
  openUnavailable?: string | null;
  importFiles?: () => void;
  backToSource?: (workspace: Workspace) => Promise<boolean>;
  readCache?: LibraryCache;
  readCollection?: () => Promise<CollectionRead>;
  metadataDrafts?: Map<string, MetadataDraft>;
  learningDrafts?: Map<string, import("./features/library/learningDraft").LearningEditDraft>;
  rememberBrowse?: (browse: LibraryBrowse) => void;
  navigationLockChanged?: (blocked: boolean) => void;
  rows: SongRow[];
  rowsReady?: boolean;
  rowsError?: string;
  refreshRows?: () => Promise<unknown>;
  close: () => void;
  changed: (collection?: CollectionRead) => Promise<void>;
  confirmEditRefresh?: (collection?: CollectionRead) => Promise<void>;
  open: (row: SongRow, expectedContentId?: string) => Promise<boolean>;
  initialFocus?: "missing" | "review" | null;
  focusConsumed?: (focus: "missing" | "review") => void;
  openVersion: (
    row: SongRow,
    contentId: string,
    kind: "notation" | "paper",
    id: string,
    selection?: LibraryScoreVisitSelection,
  ) => Promise<void>;
}) {
  useWorkspaceFocus(presentation, "library-manager-title");
  const libraryReads = useLibraryReads(readCache, readCollection, engineId);
  const changed = () => notifyChanged(libraryReads.collectionRead());
  const { data, folders, collection, workspaceReady } = libraryReads;
  const reading = libraryReads.reading || (!rowsReady && !rowsError);
  const reload = async () => {
    const [workspace] = await Promise.allSettled([
      libraryReads.reload(),
      !rowsReady || rowsError ? refreshRows?.() : undefined,
    ]);
    if (workspace.status === "rejected") throw workspace.reason;
    return workspace.value;
  };
  const activity = useLibraryActivity(engineId, reload, () => !working.current && !busy);
  const { monitor, background } = activity;
  const refreshEdited = async () => {
    const result = await reload();
    if (!result.current || !result.workspace || !result.collection) throw new Error("曲库资料尚未读齐，请重试读取已保存结果。");
    await (confirmEditRefresh ? confirmEditRefresh(libraryReads.collectionRead()) : changed());
  };
  const browseReady = rowsReady && libraryReads.workspaceVerified && libraryReads.collectionVerified;
  const readError = [...new Set([rowsError, libraryReads.readError, activity.error].filter(Boolean))].join("；");
  const [paperSourcesOpen,setPaperSourcesOpen]=useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [metadataHistory, setMetadataHistory] = useState<MetadataHistoryContext | null>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [synthesiaImport, setSynthesiaImport] = useState<SongRow[] | null>(null);
  const [metadataBatch, setMetadataBatch] = useState<MetadataBatchItem[] | null>(null);
  const [menu, setMenu] = useState<{
    row: SongRow;
    index: number;
    x: number;
    y: number;
    items: { row: SongRow; cid: string | null }[];
  } | null>(null);
  const [fileActionResult, setFileActionResult] = useState("");
  const [collectionWorking, setCollectionWorking] = useState(false);
  const collectionStop = useRef(false);
  const [batchStage, setBatchStage] = useState("learning"),
    [learningResult, setLearningResult] = useState("");
  const [learningEdit, setLearningEdit] = useState<{
    path: string;
    contentId: string;
    title: string;
    previous: SongLearning | null;
  } | null>(null);
  const today = localDay();
  const [view, setView] = useState<View>(() => initialFocus
      ? { ...defaults, filter: initialFocus === "missing" ? "missing" : "all", practice: initialFocus === "review" ? "review" : "all" }
      : initialBrowse?.view ?? readView()),
    [transientView, setTransientView] = useState(Boolean(initialFocus || initialBrowse?.transient || initialBrowse?.visitReturn)),
    [page, setPage] = useState(initialFocus ? 0 : initialBrowse?.page ?? 0),
    [group, setGroup] = useState(initialFocus ? "" : initialBrowse?.group ?? "");
  const [showRecordings,setShowRecordings]=useState(initialFocus ? false : initialBrowse?.recordings ?? false);
  const {
    query,
    field,
    filter,
    sort,
    direction,
    minRating,
    minDuration,
    maxDuration,
    practice,
    learning,
  } = view;
  const updateView = (v: Partial<View>) => {
    setPage(0);
    if (!searchReturn) setTransientView(false);
    setView((old) => ({ ...old, ...v }));
  };
  useEffect(() => {
    // Standalone legacy hosts retain their preference writer; App owns the batched cursor.
    if (rememberBrowse || transientView) return;
    try { localStorage.setItem(storage, JSON.stringify(view)); } catch {}
  }, [view, transientView, rememberBrowse]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialBrowse?.selected ?? [])),
    [active, setActive] = useState<string | null>(initialFocus ? null : initialBrowse?.active ?? null),
    [name, setName] = useState(""),
    [parent, setParent] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(initialBrowse?.advancedOpen ?? false);
  const [selectionOnly, setSelectionOnly] = useState(initialFocus ? false : initialBrowse?.selectionOnly ?? false);
  const [target, setTarget] = useState(""),
    [rating, setRating] = useState("0"),
    [operationBusy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<MetadataEdit | null>(initialFocus ? null : initialBrowse?.editing ?? null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const busy = operationBusy || collectionWorking || scoreBusy || metadataBusy;
  const working = useRef(false);
  const alive = useRef(true);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [detailNotice, setDetailNotice] = useState<{ path: string; message: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const [repairsOpen, setRepairsOpen] = useState(false);
  const sourceUpdates = activity.monitorCurrent ? (monitor?.scoreUpdates ?? 0) + (monitor?.paperUpdates ?? 0) : 0;
  const sourceUnavailable = activity.monitorCurrent ? (monitor?.scoreUnavailable ?? 0) + (monitor?.paperUnavailable ?? 0) : 0;
  const [songScope, setSongScope] = useState<SongWorkspaceTarget | null>(initialFocus ? null : initialBrowse?.song ?? null);
  const [visitFrom, setVisitFrom] = useState(initialFocus ? undefined : initialBrowse?.visitFrom);
  const panes = useBrowsePane(initialFocus ? "list" : initialBrowse?.editing ? "detail" : initialBrowse?.pane);
  const [groupsOpen, setGroupsOpen] = useState(initialBrowse?.groupsOpen ?? false);
  const [filtersOpen, setFiltersOpen] = useState(initialBrowse?.filtersOpen ?? false);
  const [batchOpen, setBatchOpen] = useState(initialBrowse?.batchOpen ?? false);
  const [detailSection, setDetailSection] = useState<LibraryDetailSection>(initialFocus ? "overview" : initialBrowse?.editing ? "files" : initialBrowse?.detailSection ?? "overview");
  const groupTrigger = useRef<HTMLButtonElement>(null);
  const closeGroups = () => {
    setGroupsOpen(false);
    groupTrigger.current?.focus({ preventScroll: true });
  };
  const [searchReturn, setSearchReturn] = useState<LibraryVisitReturn | null>(
    () => {
      if (!initialFocus) return initialBrowse?.visitReturn ?? null;
      const previous =
        initialBrowse?.visitReturn ??
        libraryVisitReturn(
          initialBrowse ?? {
            view: readView(),
            page: 0,
            group: "",
            recordings: false,
            active: null,
            selected: [],
            top: 0,
          },
        );
      return { ...previous, query: "", focus: initialFocus };
    },
  );
  const browsing = useRef<LibraryBrowse>({ view, page, group, recordings: showRecordings, active,
    selectionReview: initialBrowse?.selectionReview,
    detailTop: initialBrowse?.detailTop, detailTopKey: initialBrowse?.detailTopKey,
    selected: [...selected], top: initialFocus ? 0 : initialBrowse?.top ?? 0, topKey: initialBrowse?.topKey });
  browsing.current = { ...browsing.current, view, page, group, recordings: showRecordings, active, selected: [...selected], selectionOnly, advancedOpen, editing: edit, song: songScope, visitReturn: searchReturn, visitFrom, transient: transientView, pane: panes.pane, groupsOpen, filtersOpen, batchOpen, detailSection };
  useEffect(() => { rememberBrowse?.(browsing.current); },
    [view, page, group, showRecordings, active, selected, selectionOnly, advancedOpen, edit, songScope, searchReturn, visitFrom, transientView, panes.pane, groupsOpen, filtersOpen, batchOpen, detailSection, rememberBrowse]);
  const tableKey = JSON.stringify([libraryViewKey(view), group, showRecordings, selectionOnly, page, songScope?.contentId ?? null]);
  const tableScroll = useBrowseScroll<HTMLDivElement>(tableKey, browseReady && panes.listVisible,
    initialFocus || (initialBrowse?.topKey && initialBrowse.topKey !== tableKey) ? 0 : initialBrowse?.top ?? 0, (top) => {
      browsing.current = { ...browsing.current, top, topKey: tableKey };
      rememberBrowse?.(browsing.current);
    }, libraryReads.positions);
  const navigationBlocked = busy || (!!edit && !metadataDrafts) || collectionWorking || !!learningEdit || !!metadataBatch || !!metadataHistory || locationsOpen || paperSourcesOpen || sourcesOpen || repairsOpen;
  const appliedSearch = useRef<string | null>(null);
  const searchFocusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    appliedSearch.current = null;
    if (searchFocusFrame.current !== null) cancelAnimationFrame(searchFocusFrame.current);
    searchFocusFrame.current = null;
  }, []);
  const appliedFocus = useRef(initialFocus ?? null);
  useEffect(() => {
    if (!initialFocus) {
      appliedFocus.current = null;
      return;
    }
    if (navigationBlocked) return;
    if (appliedFocus.current !== initialFocus) {
      appliedFocus.current = initialFocus;
      setSearchReturn((old) => ({
        ...(old ?? libraryVisitReturn(browsing.current)),
        query: "",
        focus: initialFocus,
      }));
      setTransientView(true);
      setView({
        ...defaults,
        filter: initialFocus === "missing" ? "missing" : "all",
        practice: initialFocus === "review" ? "review" : "all",
      });
      setPage(0);
      setGroup("");
      setShowRecordings(false);
      setSelectionOnly(false);
      setSongScope(null);
      setVisitFrom(undefined);
      setActive(null);
      setEdit(null);
      setDetailSection("overview");
      panes.showList(false);
      setMenu(null);
    }
    focusConsumed?.(initialFocus);
  }, [initialFocus, navigationBlocked, focusConsumed]);
  useEffect(() => {
    if (!searchRequest || appliedSearch.current === searchRequest.id || navigationBlocked) return;
    appliedSearch.current = searchRequest.id;
    const text = searchRequest.query?.trim().slice(0, 4096) ?? "";
    if (!text && !searchRequest.song) { searchConsumed?.(searchRequest.id); return; }
    setSearchReturn((old) => old ? { ...old, query: text, focus: undefined } : libraryVisitReturn({ ...browsing.current,
      top: browsing.current.topKey === tableKey ? browsing.current.top : 0, topKey: tableKey }, text));
    setSongScope(searchRequest.song ?? null);
    setVisitFrom(searchRequest.song ? searchRequest.from : undefined);
    setTransientView(true);
    setView({ ...defaults, sort: view.sort, direction: view.direction, query: text });
    setGroup(""); setPage(0); setShowRecordings(false); setSelectionOnly(false);
    setActive(null);
    setEdit(null);
    setDetailSection("overview");
    panes.showList(false);
    setMenu(null);
    searchConsumed?.(searchRequest.id);
    if (searchFocusFrame.current !== null) cancelAnimationFrame(searchFocusFrame.current);
    searchFocusFrame.current = requestAnimationFrame(() => {
      searchFocusFrame.current = null;
      if ([...document.querySelectorAll('[role="dialog"]')].some((node) => node.getClientRects().length)) return;
      if (searchRequest.song) return;
      const input = document.querySelector<HTMLInputElement>('[aria-label="管理曲库搜索"]');
      if (input && !input.closest('[hidden]')) {
        input.focus();
        if (input.value === text) input.setSelectionRange(text.length, text.length);
      }
    });
  }, [searchRequest?.id, navigationBlocked]);
  const restoreSearch = () => {
    if (!searchReturn || navigationBlocked) return;
    previousFilter.current = { view: searchReturn.view, group: searchReturn.group, showRecordings: searchReturn.recordings, selectionOnly: searchReturn.selectionOnly };
    anchor.current = null; rangeBase.current = new Set();
    setView(searchReturn.view); setPage(searchReturn.page); setGroup(searchReturn.group);
    setShowRecordings(searchReturn.recordings); setSelectionOnly(searchReturn.selectionOnly);
    setActive(searchReturn.active); setAdvancedOpen(searchReturn.advancedOpen); setSongScope(searchReturn.song ?? null); setVisitFrom(searchReturn.visitFrom);
    setEdit(searchReturn.editing ?? null);
    setDetailSection(searchReturn.detailSection ?? (searchReturn.editing ? "files" : "overview"));
    setGroupsOpen(searchReturn.groupsOpen ?? false);
    setFiltersOpen(searchReturn.filtersOpen ?? false);
    setBatchOpen(searchReturn.batchOpen ?? false);
    if (searchReturn.pane === "detail") panes.showDetails(false); else panes.showList(false);
    if (searchReturn.topKey) libraryReads.positions.set(searchReturn.topKey, searchReturn.top);
    if (searchReturn.detailTopKey) libraryReads.positions.set(searchReturn.detailTopKey, searchReturn.detailTop ?? 0);
    rememberBrowse?.({ ...browsing.current, view: searchReturn.view, page: searchReturn.page, group: searchReturn.group,
      recordings: searchReturn.recordings, selectionOnly: searchReturn.selectionOnly, active: searchReturn.active,
      advancedOpen: searchReturn.advancedOpen, song: searchReturn.song ?? null, visitReturn: null, visitFrom: searchReturn.visitFrom, transient: searchReturn.transient, top: searchReturn.top, topKey: searchReturn.topKey,
      pane: searchReturn.pane, groupsOpen: searchReturn.groupsOpen, filtersOpen: searchReturn.filtersOpen, batchOpen: searchReturn.batchOpen, editing: searchReturn.editing, detailSection: searchReturn.detailSection, detailTop: searchReturn.detailTop, detailTopKey: searchReturn.detailTopKey });
    setTransientView(searchReturn.transient); setSearchReturn(null);
    if (searchFocusFrame.current !== null) cancelAnimationFrame(searchFocusFrame.current);
    const previousPath = searchReturn.active;
    searchFocusFrame.current = requestAnimationFrame(() => {
      searchFocusFrame.current = null;
      if (!document.hasFocus()) return;
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused.id !== "library-manager-title") return;
      const heading = document.getElementById("library-manager-title");
      if ([...document.querySelectorAll('[role="dialog"]')].some((node) => node.getClientRects().length && !node.contains(heading))) return;
      const row = previousPath ? tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-path="${CSS.escape(previousPath)}"]`) : null;
      const detail = panes.root.current?.querySelector<HTMLElement>("[data-browse-detail-heading]");
      (row?.getClientRects().length ? row : detail?.getClientRects().length ? detail : heading)?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    navigationLockChanged?.(navigationBlocked);
    return () => navigationLockChanged?.(false);
  }, [navigationBlocked, navigationLockChanged]);
  const anchor = useRef<string | null>(null);
  const rangeBase = useRef<Set<string>>(new Set());
  const previousFilter = useRef({ view, group, showRecordings, selectionOnly });
  useEffect(() => {
    if (previousFilter.current.view === view && previousFilter.current.group === group && previousFilter.current.showRecordings === showRecordings && previousFilter.current.selectionOnly === selectionOnly) return;
    previousFilter.current = { view, group, showRecordings, selectionOnly };
    setPage(0);
    anchor.current = null;
    rangeBase.current = new Set();
  }, [view, group, showRecordings, selectionOnly]);
  const work = async (job: () => Promise<void>) => {
    if (working.current || busy) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const addFolder = () => void work(async () => {
    await api.importFolder();
    await changed();
    await reload();
  });
  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of Object.values(data.entries)) {
      if (e.contentId && e.available)
        counts.set(e.contentId, (counts.get(e.contentId) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  }, [data]);
  const groupIndex = useMemo(() => libraryGroups(data.groups), [data.groups]);
  const groupName = (id: string) => groupIndex.names.get(id) ?? "";
  const groups = groupIndex.sorted;
  const historyById = useMemo(
    () => new Map(collection.map((h) => [h.contentId, h])),
    [collection],
  );
  const historyByPath = useMemo(
    () =>
      new Map(collection.filter((h) => h.path).map((h) => [key(h.path!), h])),
    [collection],
  );
  const historyFor = (r: SongRow) => {
    const indexed = data.entries[key(r.path)];
    const id = contentFor(r);
    // An indexed replacement must never inherit grades from its old path.
    return id ? historyById.get(id) : indexed ? undefined : historyByPath.get(key(r.path));
  };
  const contentFor = (row: SongRow) => {
    const indexed = data.entries[key(row.path)];
    return indexed ? indexed.contentId : row.contentId ?? (row.path.startsWith("exercise:") ? row.path.slice(9) : null);
  };
  const continuing = (row: SongRow) => !!continuePractice && isCurrentPracticeRow(row, contentFor(row), currentPractice);
  const openRow = async (row: SongRow) => {
    if (working.current || navigationBlocked || edit) return;
    if (openUnavailable) { setError(openUnavailable); return; }
    working.current = true;
    setBusy(true);
    setOpeningPath(key(row.path));
    setActive(key(row.path));
    browsing.current = { ...browsing.current, active: key(row.path) };
    rememberBrowse?.(browsing.current);
    setError("");
    setMenu(null);
    try {
      const contentId = contentFor(row);
      await (continuing(row) && currentPractice
        ? continuePractice!(currentPractice)
        : open(row, contentId ?? undefined));
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (alive.current) { setBusy(false); setOpeningPath(null); }
    }
  };
  const reviewRow = (row: SongRow) => {
    const contentId = contentFor(row);
    if (!contentId || navigationBlocked || !reviewSong) return;
    void reviewSong({ contentId, title: data.entries[key(row.path)]?.metadata.title ?? row.title, path: row.path });
  };
  const selectionScope = selectionOnly ? selected : null;
  const filtered = useMemo(() => {
    const ids = groupIndex.descendants(group);
    const tokens = terms(query);
    return rows
      .filter((r) => {
        const e = data.entries[key(r.path)],
          m = e?.metadata;
        if (songScope && contentFor(r) !== songScope.contentId) return false;
        if (selectionScope && !selectionScope.has(key(r.path))) return false;
        if(showRecordings && !r.id.startsWith("recording/")) return false;
        if (group && !(e?.groups ?? []).some((id) => ids.has(id))) return false;
        if (
          (filter === "score" &&
            !e?.hasScore &&
            !e?.notationCount &&
            !e?.paperCount) ||
          (filter === "missing" && e?.available !== false) ||
          (filter === "duplicates" &&
            (!e?.contentId || !duplicates.has(e.contentId))) ||
          (filter === "unindexed" && e?.contentId) ||
          (filter === "errors" && !e?.error)
        )
          return false;
        const h = historyFor(r);
        if (
          !learningMatches(
            e?.contentId ? data.learning?.[e.contentId] : undefined,
            learning,
            today,
          )
        )
          return false;
        if ((e?.rating ?? r.rating ?? 0) < minRating) return false;
        if (
          minDuration !== "" &&
          (!e?.contentId || e.duration < Number(minDuration) * 60)
        )
          return false;
        if (
          maxDuration !== "" &&
          (!e?.contentId || e.duration > Number(maxDuration) * 60)
        )
          return false;
        if (
          (practice === "played" && !h?.sessions) ||
          (practice === "unplayed" && !!h?.sessions) ||
          (practice === "favorite" && !h?.favorite) ||
          (practice === "review" && !h?.review?.due)
        )
          return false;
        return matches(r, e, field, tokens);
      })
      .sort(
        (a, b) =>
          (sort === "learningStage" || sort === "learningDue"
            ? compareLearning(
                data.learning?.[data.entries[key(a.path)]?.contentId ?? ""],
                data.learning?.[data.entries[key(b.path)]?.contentId ?? ""],
                sort,
                direction,
              )
            : 0) ||
          compare(
            a,
            b,
            data.entries[key(a.path)],
            data.entries[key(b.path)],
            historyFor(a),
            historyFor(b),
            sort,
            direction,
          ),
      );
  }, [rows, data, view, group, showRecordings, selectionScope, duplicates, historyById, historyByPath, today, groupIndex, songScope]);
  useEffect(() => {
    if (!songScope || !browseReady) return;
    const activeRow = rows.find((row) => key(row.path) === active);
    if (activeRow && contentFor(activeRow) === songScope.contentId) return;
    const preferred = songScope.path ? filtered.find((row) => key(row.path) === key(songScope.path!)) : undefined;
    const found = preferred ?? filtered[0];
    if (!found) { if (activeRow && contentFor(activeRow) !== songScope.contentId) setActive(null); return; }
    const focused = document.activeElement;
    if (!edit && document.hasFocus() && (!focused || focused === document.body || focused.id === "library-manager-title" || focused.matches(".library-manager-table tr")))
      focusPath.current = key(found.path);
    setActive(key(found.path));
    setPage(Math.floor(filtered.indexOf(found) / 50));
  }, [songScope, filtered, browseReady, rows, active, edit]);
  useEffect(() => {
    if (!browseReady) return;
    setPage((p) =>
      Math.min(p, Math.max(0, Math.ceil(filtered.length / 50) - 1)),
    );
  }, [filtered.length, browseReady]);
  useEffect(() => {
    if (!libraryReads.workspaceVerified) return;
    if (group && !data.groups.some((item) => item.id === group)) setGroup("");
  }, [data.groups, libraryReads.workspaceVerified, group]);
  const resetFilters = () => {
    updateView({ query: "", filter: "all", practice: "all", learning: "all", minRating: 0, minDuration: "", maxDuration: "" });
    setGroup(""); setShowRecordings(false); setSelectionOnly(false); setPage(0);
  };
  const filterChips: BrowseFilterChip[] = [];
  if (query.trim()) filterChips.push({ id: "query", label: `关键词：${query.trim()}`, remove: () => updateView({ query: "" }) });
  if (filter !== "all") filterChips.push({ id: "filter", label: ({ score: "已配乐谱", missing: "文件缺失", duplicates: "重复内容", unindexed: "尚未索引", errors: "需要处理" } as Record<string, string>)[filter] ?? filter, remove: () => updateView({ filter: "all" }) });
  if (practice !== "all") filterChips.push({ id: "practice", label: ({ played: "已有成绩", unplayed: "尚无成绩", favorite: "收藏", review: "待复习" } as Record<string, string>)[practice] ?? practice, remove: () => updateView({ practice: "all" }) });
  if (learning !== "all") filterChips.push({ id: "learning", label: learningStages[learning] ?? ({ untracked: "未设学习目标", overdue: "目标已逾期", today: "今日目标" } as Record<string, string>)[learning] ?? learning, remove: () => updateView({ learning: "all" }) });
  if (minRating > 0) filterChips.push({ id: "rating", label: `至少 ${minRating} 星`, remove: () => updateView({ minRating: 0 }) });
  if (minDuration || maxDuration) filterChips.push({ id: "duration", label: `时长 ${minDuration || "0"}–${maxDuration || "不限"} 分钟`, remove: () => updateView({ minDuration: "", maxDuration: "" }) });
  if (group) filterChips.push({ id: "group", label: `分组：${groupName(group) || "正在读取"}`, remove: () => setGroup("") });
  if (showRecordings) filterChips.push({ id: "recordings", label: "自由演奏录音", remove: () => setShowRecordings(false) });
  if (selectionOnly) filterChips.push({ id: "selected", label: "仅看所选", remove: () => setSelectionOnly(false) });
  const selectedRows = useMemo(() => {
    const unique = new Map<string, SongRow>();
    for (const row of rows) {
      const path = key(row.path);
      if (selected.has(path) && !unique.has(path)) unique.set(path, row);
    }
    return [...unique.values()].map((row) => ({
      ...row,
      title: data.entries[key(row.path)]?.metadata.title ?? row.title,
    }));
  }, [rows, selected, data.entries]);
  const batchReady = browseReady && selectedRows.length === selected.size;
  const selectedReviewRows = useMemo(() => {
    const known = new Set(selectedRows.map((row) => key(row.path)));
    return [
      ...selectedRows.map((row) => ({
        path: row.path,
        title: row.title,
        unavailable: false,
      })),
      ...[...selected]
        .filter((path) => !known.has(path))
        .map((path) => ({
          path,
          title:
            data.entries[path]?.metadata.title ||
            path.split(/[\\/]/).at(-1) ||
            path,
          unavailable: true,
        })),
    ];
  }, [selectedRows, selected, data.entries]);
  const unavailableSelectionCount = selected.size - selectedRows.length;
  const clearUnavailableSelection = () => {
    if (busy || !browseReady) return;
    const unavailable = new Set(
      selectedReviewRows.filter((row) => row.unavailable).map((row) => key(row.path)),
    );
    setSelected((current) =>
      new Set([...current].filter((path) => !unavailable.has(path))),
    );
    anchor.current = null;
    rangeBase.current = new Set();
  };
  const filteredKeys = useMemo(() => new Set(filtered.map((row) => key(row.path))), [filtered]);
  const selectedVisible = selectedRows.filter((row) => filteredKeys.has(key(row.path))).length;
  const clearSelection = () => { if (busy || edit) return; setSelected(new Set()); anchor.current = null; rangeBase.current = new Set(); };
  const shown = filtered.slice(page * 50, (page + 1) * 50),
    picked = selectedRows.filter((row) => !row.path.startsWith("exercise:"));
  const learningPicked = [
    ...new Map(
      picked.flatMap((row) => {
        const cid = data.entries[key(row.path)]?.contentId;
        return cid ? [[cid, { row, cid }] as const] : [];
      }),
    ).values(),
  ];
  const current = rows.find((r) => key(r.path) === active && (!songScope || contentFor(r) === songScope.contentId)),
    entry = active ? data.entries[active] : null;
  const activeReview = current ? historyFor(current)?.review ?? null : null;
  const currentIndex = filtered.findIndex((row) => key(row.path) === active);
  const detailKey = JSON.stringify(["library-detail", active, entry?.contentId ?? null, ...(detailSection === "overview" ? [] : [detailSection])]);
  const detailScroll = useBrowseScroll<HTMLElement>(detailKey, panes.detailVisible && !!current && browseReady,
    initialBrowse?.detailTopKey === detailKey ? initialBrowse.detailTop ?? 0 : 0, (detailTop) => {
      browsing.current = { ...browsing.current, detailTop, detailTopKey: detailKey };
      rememberBrowse?.(browsing.current);
    }, libraryReads.positions);
  const inspect = async (list: SongRow[], force = false) => {
    const paths = list
      .filter((r) => !r.path.startsWith("exercise:"))
      .map((r) => r.path);
    await activity.index({
      type: "indexLibrary",
      paths,
      force,
    });
  };
  const choose = (
    row: SongRow,
    index: number,
    event: Pick<React.MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) => {
    if (busy || collectionWorking) return;
    if (edit) {
      setError("请先保存或取消信息编辑，再选择曲目。");
      return;
    }
    setActive(key(row.path));
    setEdit(null);
    const anchorIndex = anchor.current === null ? -1 : filtered.findIndex((candidate) => key(candidate.path) === anchor.current);
    if (event.shiftKey && anchorIndex >= 0) {
      const a = Math.min(index, anchorIndex),
        b = Math.max(index, anchorIndex);
      setSelected(
        new Set([
          ...rangeBase.current,
          ...filtered.slice(a, b + 1).map((r) => key(r.path)),
        ]),
      );
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(key(row.path)) ? n.delete(key(row.path)) : n.add(key(row.path));
        rangeBase.current = new Set(n);
        return n;
      });
      anchor.current = key(row.path);
    } else {
      setSelected(new Set([key(row.path)]));
      rangeBase.current = new Set();
      anchor.current = key(row.path);
    }
  };
  const toggle = (row: SongRow) => {
    if (busy || collectionWorking || edit) return;
    if (selectionOnly && selected.has(key(row.path))) {
      const index = filtered.findIndex((candidate) => key(candidate.path) === key(row.path));
      const next = filtered[index + 1] ?? filtered[index - 1];
      focusPath.current = next ? key(next.path) : null;
      focusSelection.current = !next;
    }
    setSelected((s) => {
      const n = new Set(s);
      n.has(key(row.path)) ? n.delete(key(row.path)) : n.add(key(row.path));
      anchor.current = key(row.path); rangeBase.current = new Set(n);
      return n;
    });
  };
  const mutate = async (value: Parameters<typeof api.command>[0]) => {
    await api.commandForEngine(engineId, value);
    await reload();
    await changed();
  };
  const focusPath = useRef<string | null>(null), focusSelection = useRef(false), tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    if (!panes.listVisible || !browseReady || !document.hasFocus()) return;
    const focused = document.activeElement;
    const anotherDialog = [...document.querySelectorAll('[role="dialog"]')].some((node) => node.getClientRects().length && node !== panes.root.current);
    if (anotherDialog || (focused && focused !== document.body && !panes.root.current?.contains(focused))) {
      focusPath.current = null; focusSelection.current = false; return;
    }
    if (focusSelection.current) {
      const target = panes.root.current?.querySelector<HTMLButtonElement>('.library-selection-controls button[aria-pressed="true"]');
      if (panes.compact && !batchOpen && target) { setBatchOpen(true); return; }
      if (target?.getClientRects().length) target.focus({ preventScroll: true });
      focusSelection.current = false;
    }
    const path = focusPath.current;
    if (!path || edit) return;
    const node = tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-path="${CSS.escape(path)}"]`);
    if (node?.getClientRects().length) {
      if (focused && focused !== document.body && !focused.closest(".library-manager-table") && focused.id !== "library-manager-title") { focusPath.current = null; return; }
      node.focus({ preventScroll: true }); node.scrollIntoView({ block: "nearest" }); focusPath.current = null; return;
    }
    const index = filtered.findIndex((row) => key(row.path) === path);
    if (index < 0) focusPath.current = null;
    else if (Math.floor(index / 50) !== page) setPage(Math.floor(index / 50));
  }, [page, filtered, edit, active, panes.listVisible, panes.compact, batchOpen, browseReady]);
  const moveFocus = (index: number, event: React.KeyboardEvent) => {
    const next = Math.max(0, Math.min(filtered.length - 1, index)), row = filtered[next];
    if (!row) return;
    choose(row, next, event);
    focusPath.current = key(row.path);
    if (Math.floor(next / 50) !== page) setPage(Math.floor(next / 50));
    else {
      tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-path="${CSS.escape(key(row.path))}"]`)?.focus();
      focusPath.current = null;
    }
  };
  const stepDetail = (direction: -1 | 1) => {
    if (busy || edit || !browseReady || currentIndex < 0) return;
    const row = filtered[currentIndex + direction];
    if (!row) return;
    setActive(key(row.path));
    setPage(Math.floor((currentIndex + direction) / 50));
    focusPath.current = key(row.path);
  };
  const ensureEntry = async (row: SongRow): Promise<Entry> => {
    const cached = data.entries[key(row.path)];
    if (cached?.contentId) return cached;
    const result = await api.commandForEngine<Entry>(engineId, {
      type: "inspectSong",
      path: row.path,
      force: true,
    });
    if (!result.contentId)
      throw new Error(result.error ?? "无法识别曲目，请检查文件。");
    return result;
  };
  const editRow = (row: SongRow) =>
    void work(async () => {
      const result = await readLibraryMetadata(row.path, data.entries[key(row.path)]?.contentId ?? null);
      setActive(key(row.path));
      panes.showDetails();
      setDetailSection("files");
      setEdit({
        path: row.path,
        contentId: result.contentId,
        value: result.value,
      });
      await reload();
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(".library-metadata-editor input")
          ?.focus(),
      );
    });
  const learningRow = (row: SongRow) =>
    void work(async () => {
      const e = await ensureEntry(row);
      setLearningEdit({
        path: row.path,
        contentId: e.contentId!,
        title: e.metadata.title ?? row.title,
        previous: data.learning?.[e.contentId!] ?? null,
      });
    });
  const collectionRows = (
    items: { row: SongRow; cid: string | null }[],
    kind: "favorite" | "queued",
    enabled: boolean,
  ) =>
    void work(async () => {
      setCollectionWorking(true);
      collectionStop.current = false;
      let done = 0;
      const errors: string[] = [],
        seen = new Set<string>();
      try {
        for (const [index, { row, cid }] of items.entries()) {
          if (collectionStop.current) break;
          setFileActionResult(`正在处理 ${index + 1} / ${items.length} 首…`);
          try {
            const id = cid ?? (await ensureEntry(row)).contentId!;
            if (seen.has(id)) continue;
            seen.add(id);
            await api.commandForEngine(engineId, {
              type: "setLibraryCollection",
              path: row.path,
              content_id: id,
              [kind]: enabled,
            });
            done++;
          } catch (e) {
            errors.push(
              `${row.title}：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        await reload();
        await changed();
        setFileActionResult(
          `${collectionStop.current ? "已停止；" : ""}已${kind === "favorite" ? (enabled ? "收藏" : "取消收藏") : enabled ? "加入队列" : "移出队列"} ${done} 首${errors.length ? `；${errors.length} 首未完成：${errors.join("；")}` : ""}`,
        );
      } finally {
        setCollectionWorking(false);
      }
    });
  const showMenu = (row: SongRow, index: number, x: number, y: number) => {
    if (busy || edit) {
      if (edit) setError("请先保存或取消信息编辑，再打开曲目菜单。");
      return;
    }
    const keep = selected.has(key(row.path));
    if (!keep)
      choose(row, index, { shiftKey: false, ctrlKey: false, metaKey: false });
    else setActive(key(row.path));
    const chosen = keep ? selectedRows : [row];
    setMenu({
      row,
      index,
      x,
      y,
      items: chosen
        .filter((r) => !r.path.startsWith("exercise:"))
        .map((row) => ({
          row,
          cid: data.entries[key(row.path)]?.contentId ?? null,
        })),
    });
  };
  const closeMenu = (restore: boolean) => {
    const path = menu?.row.path;
    setMenu(null);
    if (restore && path) tableRef.current?.querySelector<HTMLTableRowElement>(`tr[data-path="${CSS.escape(key(path))}"]`)?.focus();
  };
  useEffect(() => {
    setMenu(null);
  }, [view, group, page, data.revision]);
  useBrowseSearch(panes.root, navigationBlocked || !!edit || !!menu, () => {
    panes.showList(false); setGroupsOpen(false);
  });

  const menuActions: LibraryMenuAction[] = menu
    ? [
        { label: continuing(menu.row) ? "继续当前练习" : "打开练习", hint: "Enter", disabled: !!openUnavailable, run: () => void openRow(menu.row) },
        ...(reviewSong ? [{ label: "查看这首曲目的历史", disabled: !contentFor(menu.row) || navigationBlocked,
          run: () => reviewRow(menu.row) }] : []),
        {
          label: "编辑信息",
          hint: "F2",
          disabled: menu.row.path.startsWith("exercise:"),
          run: () => editRow(menu.row),
        },
        {
          label: "学习目标",
          disabled: menu.row.path.startsWith("exercise:"),
          run: () => learningRow(menu.row),
        },
        {
          label: `收藏${menu.items.length > 1 ? `所选 ${menu.items.length} 首` : "曲目"}`,
          disabled: !batchReady || !menu.items.length || menu.items.length > 100,
          run: () => collectionRows(menu.items, "favorite", true),
        },
        {
          label: "取消收藏",
          disabled: !batchReady || !menu.items.length || menu.items.length > 100,
          run: () => collectionRows(menu.items, "favorite", false),
        },
        {
          label: `加入队列${menu.items.length > 1 ? ` · ${menu.items.length} 首` : ""}`,
          disabled: !batchReady || !menu.items.length || menu.items.length > 100,
          run: () => collectionRows(menu.items, "queued", true),
        },
        {
          label: "移出队列",
          disabled: !batchReady || !menu.items.length || menu.items.length > 100,
          run: () => collectionRows(menu.items, "queued", false),
        },
        {
          label: "加入分组…",
          disabled: !batchReady || !menu.items.length,
          run: () =>
            document
              .querySelector<HTMLSelectElement>('[aria-label="批量目标分组"]')
              ?.focus(),
        },
        {
          label: "检查所选文件",
          disabled: !batchReady || !menu.items.length,
          run: () =>
            void work(() =>
              inspect(
                menu.items.map((i) => i.row),
                true,
              ),
            ),
        },
        {
          label: "打开文件位置",
          disabled: !api.desktop || menu.row.path.startsWith("exercise:"),
          run: () =>
            void work(async () => {
              await api.revealFile(menu.row.path);
              setFileActionResult(
                "已打开文件位置；原件缺失时打开可用的上级文件夹。",
              );
            }),
        },
        {
          label: `复制${menu.items.length > 1 ? "所选文件位置" : "文件位置"}`,
          hint: "Ctrl+C",
          disabled: !batchReady || !menu.items.length,
          run: () =>
            void work(async () => {
              await copyLibraryPaths(menu.items.map((i) => i.row.path));
              setFileActionResult(`已复制 ${menu.items.length} 个文件位置`);
            }),
        },
      ]
    : [];
  const sortHeader = (label: string, column: string) => (
    <th
      aria-sort={
        sort === column
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        className="library-sort-heading"
        onClick={() =>
          updateView({
            sort: column,
            direction:
              sort === column
                ? direction === "asc"
                  ? "desc"
                  : "asc"
                : ["rating", "lastUsed", "sessions"].includes(column)
                  ? "desc"
                  : "asc",
          })
        }
      >
        {label}
        {sort === column ? (direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  if (repairsOpen)
    return (
      <LibraryRepairsDialog
        engineId={engineId}
        session={libraryReads.repairSession()}
        initialKind={filter === "duplicates" ? "duplicates" : "missing"}
        close={() => setRepairsOpen(false)}
        changed={refreshEdited}
      />
    );
  const metadataEditor = edit && (
    <LibraryMetadataEditor
      draftMemory={metadataDrafts}
      key={`${edit.path}:${edit.contentId}`}
      edit={edit}
      onBusy={setMetadataBusy}
      cancel={() => {
        setEdit(null);
        setError("");
      }}
      saved={async (warnings) => {
        await refreshEdited();
        if (warnings?.length) setError(warnings.join("；"));
        setEdit(null);
      }}
    />
  );
  return (
    <div
      className={presentation === "workspace" ? "workspace-page" : "modal-backdrop"}
      onClick={() => {
        if (presentation === "workspace") return;
        if (!busy && !edit) close();
        else if (edit) setError("请先保存或取消信息编辑，再关闭曲库。");
      }}
    >
      <section
        ref={panes.attach}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent) || event.ctrlKey || event.altKey || event.metaKey || !ownsInputLayer(event.currentTarget)) return;
          if (event.key === "Escape" && !event.defaultPrevented && panes.compact && groupsOpen && !navigationBlocked && !edit) {
            event.preventDefault(); event.stopPropagation(); closeGroups(); return;
          }
          if (event.key === "Escape" && !event.defaultPrevented && panes.compact && panes.pane === "detail" && !navigationBlocked && !edit) {
            event.preventDefault(); event.stopPropagation(); panes.showList();
          }
        }}
        className="settings-dialog library-manager"
        data-browse-compact={panes.compact ? "" : undefined}
        data-browse-pane={panes.pane}
        role={presentation === "workspace" ? "region" : "dialog"}
        aria-modal={presentation === "dialog" ? true : undefined}
        aria-labelledby="library-manager-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="library-manager-title" tabIndex={-1} className="workspace-page-title">曲库管理</h2>
            <p>
              {rows.length.toLocaleString()} 首 · 已索引{" "}
              {Object.values(data.entries)
                .filter((e) => e.contentId)
                .length.toLocaleString()}{" "}
              个文件
            </p>
          </div>
          {importFiles && <button className="primary" disabled={navigationBlocked || !!edit} onClick={importFiles}>导入文件</button>}
          <ToolbarMore label="曲库工具" status={[sourceUpdates ? `${sourceUpdates} 处更新` : "", sourceUnavailable ? `${sourceUnavailable} 处无法读取` : ""].filter(Boolean).join(" · ") || undefined}
            attention={sourceUnavailable > 0} disabled={busy || !!edit}>
            <button disabled={navigationBlocked || !picked.length || picked.length>64} onClick={()=>setSynthesiaImport([...picked])}>导入 Synthesia 资料 · 已选 {picked.length} 首</button>
            <button
              disabled={busy}
              onClick={() => void work(() => mutate({ type: "refreshLibrary" }))}
            >
              立即检查
            </button>
            <button disabled={busy} onClick={() => setRepairsOpen(true)}>
              文件位置
            </button>
            <button disabled={busy} onClick={() => setSourcesOpen(true)}>
              原谱文件
              {monitor?.scoreUpdates
                ? ` · ${monitor.scoreUpdates} 个关联有更新`
                : ""}
            </button>
            <button disabled={busy} onClick={()=>setPaperSourcesOpen(true)}>纸谱原件{monitor?.paperUpdates?` · ${monitor.paperUpdates} 处更新`:""}{monitor?.paperUnavailable?` · ${monitor.paperUnavailable} 处无法读取`:""}</button>
          </ToolbarMore>
          <button
            autoFocus={presentation === "dialog"}
            aria-label={presentation === "workspace" ? "返回练习" : "关闭曲库管理"}
            data-workspace-close={presentation === "workspace" ? "" : undefined}
            disabled={navigationBlocked}
            onClick={close}
          >
            {presentation === "workspace" ? "返回练习" : <X size={18} />}
          </button>
        </div>
        {preparation}
        {searchReturn && <div className="library-search-handoff" role="status">
          <span>{songScope ? <>按曲目内容查找：<strong>{songScope.title}</strong> · 显示同一内容的已索引位置。</> : searchReturn.focus ? <>从<strong>{searchReturn.focus === "missing" ? "缺失文件" : "待复习曲目"}</strong>快捷入口进入曲库。</> : <>快捷查找：<strong>{searchReturn.query}</strong> · 搜索曲目与录音。</>}</span>
          {songScope && visitFrom && visitFrom !== "library" && backToSource && <button disabled={navigationBlocked}
            onClick={() => { void backToSource(visitFrom); }}>返回{visitFrom === "review" ? "回顾" : "练习"}</button>}
          <button disabled={navigationBlocked} onClick={restoreSearch}>返回原来的曲库列表</button>
        </div>}
        <div className="browse-controls" hidden={!panes.listVisible}>
        <BrowseControls compact={panes.compact} expanded={filtersOpen} toggle={() => setFiltersOpen((old) => !old)}
          activeCount={filterChips.filter((chip) => chip.id !== "query").length} label="管理曲库搜索" query={query}
          placeholder="曲名、作曲家、标签、难度或文件路径" disabled={busy || !!edit} change={(query) => updateView({ query })}
          searchOptions={
          <select
            aria-label="曲库搜索字段"
            disabled={busy || !!edit}
            value={field}
            onChange={(e) =>
              updateView({ field: e.target.value as View["field"] })
            }
          >
            {[
              ["all", "全部信息"],
              ["title", "曲名"],
              ["composer", "作曲家"],
              ["arranger", "改编者"],
              ["artist", "演奏者"],
              ["collection", "曲集"],
              ["tags", "标签"],
              ["difficulty", "难度"],
              ["notes", "备注"],
              ["path", "文件路径"],
              ["source", "来源 / 类别"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          }>
          <select
            aria-label="曲库管理筛选"
            value={filter}
            onChange={(e) => updateView({ filter: e.target.value })}
          >
            {[
              ["all", "全部文件"],
              ["score", "已配乐谱"],
              ["missing", "文件缺失"],
              ["duplicates", "重复内容"],
              ["unindexed", "尚未索引"],
              ["errors", "需要处理"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="曲库管理排序"
            value={sort}
            onChange={(e) =>
              updateView({
                sort: e.target.value,
                direction: ["lastUsed", "sessions", "rating"].includes(
                  e.target.value,
                )
                  ? "desc"
                  : "asc",
              })
            }
          >
            {[
              ["title", "按曲名"],
              ["composer", "按作曲家"],
              ["difficulty", "按难度"],
              ["rating", "按评级"],
              ["duration", "按时长"],
              ["lastUsed", "按最近练习"],
              ["sessions", "按记录次数"],
              ["measures", "按小节数"],
              ["notes", "按音符数"],
              ["path", "按路径"],
              ["learningStage", "按学习阶段"],
              ["learningDue", "按目标日期"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            aria-label="切换曲库排序方向"
            title="缺少信息的曲目始终排在最后"
            onClick={() =>
              updateView({ direction: direction === "asc" ? "desc" : "asc" })
            }
          >
            {direction === "asc" ? "升序 ↑" : "降序 ↓"}
          </button>
        <details className="library-extra-filters" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
          <summary>更多筛选{[practice !== "all", learning !== "all", minRating > 0, !!minDuration || !!maxDuration].filter(Boolean).length > 0 && ` · ${[practice !== "all", learning !== "all", minRating > 0, !!minDuration || !!maxDuration].filter(Boolean).length} 项启用`}</summary>
        <div className="library-query-options">
          <select
            aria-label="曲库学习阶段筛选"
            value={learning}
            onChange={(event) => updateView({ learning: event.target.value })}
          >
            <option value="all">全部学习阶段</option>
            <option value="untracked">未设置学习资料</option>
            <option value="overdue">目标已逾期</option>
            <option value="today">目标在今天</option>
            {Object.entries(learningStages).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="练习记录筛选"
            value={practice}
            onChange={(e) => updateView({ practice: e.target.value })}
          >
            {[
              ["all", "所有练习状态"],
              ["played", "已有成绩"],
              ["unplayed", "尚无成绩"],
              ["favorite", "收藏"],
              ["review", "待复习"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label>
            评级至少{" "}
            <select
              aria-label="最低评级"
              value={minRating}
              onChange={(e) =>
                updateView({ minRating: Number(e.target.value) })
              }
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n ? `${n} 星` : "不限"}
                </option>
              ))}
            </select>
          </label>
          <label>
            时长{" "}
            <input
              aria-label="最短时长分钟"
              type="number"
              min="0"
              step="0.5"
              placeholder="不限"
              value={minDuration}
              onChange={(e) => updateView({ minDuration: e.target.value })}
            />{" "}
            至{" "}
            <input
              aria-label="最长时长分钟"
              type="number"
              min="0"
              step="0.5"
              placeholder="不限"
              value={maxDuration}
              onChange={(e) => updateView({ maxDuration: e.target.value })}
            />{" "}
            分钟
          </label>

          <small>多词同时匹配 · composer:作者 · tags:标签 · 双引号短语 · -词 排除</small>
          {minDuration !== "" &&
            maxDuration !== "" &&
            Number(minDuration) > Number(maxDuration) && (
              <span role="alert">最短时长超过最长时长</span>
            )}
        </div>
        </details>
        </BrowseControls>
        </div>
        <BrowseFilterChips chips={filterChips} reset={resetFilters} disabled={busy || collectionWorking} />
        {monitor && (
          <div className="library-monitor-status">
            <label>
              <input
                type="checkbox"
                aria-label="自动更新曲库"
                checked={monitor.enabled}
                disabled={busy || !activity.monitorCurrent}
                onChange={(e) =>
                  void work(async () => {
                    await activity.setMonitoring(e.target.checked);
                  })
                }
              />{" "}
              自动更新
            </label>
            <span>
              {!activity.monitorCurrent ? "正在核对自动更新状态" : monitor.phase === "loading"
                ? "正在读取曲库，可先选择已经显示的曲目"
                : monitor.phase === "updating"
                ? `正在更新 ${monitor.current} · 剩余 ${monitor.pending}`
                : monitor.phase === "scanning"
                  ? "正在检查文件变化"
                  : monitor.phase === "failed"
                    ? "更新需要处理"
                    : monitor.enabled
                      ? "文件变化后自动更新"
                      : "自动更新已暂停"}
            </span>
            {monitor.lastScan > 0 && (
              <small>
                上次检查{" "}
                {new Date(monitor.lastScan).toLocaleTimeString("zh-CN")}
              </small>
            )}
            {!!monitor.metadataFiles && <small>发现 {monitor.metadataFiles} 份 Synthesia 资料
              {monitor.metadataPending ? ` · ${monitor.metadataPending} 份正在建立索引` : ""}</small>}
            {monitor.errors.length > 0 && (
              <details>
                <summary>{monitor.errors.length} 项需要处理</summary>
                {monitor.errors.map((message, i) => (
                  <p key={i}>{message}</p>
                ))}
              </details>
            )}
          </div>
        )}
        <TaskActivity label={["读取曲库资料", "保存曲库整理", "更新曲目资料"]} cancelLabel="取消本次准备或读取" />
        <WorkspaceReadStatus compact={presentation === "workspace"} label="曲库资料" current={libraryReads.current && rowsReady} pending={reading} error={readError}
          hasData={workspaceReady} pendingDetail={[!rowsReady && !rowsError ? "曲目文件列表" : "", libraryReads.pendingDetail].filter(Boolean).join("、")} readAt={libraryReads.readAt} disabled={busy}
          retry={() => { activity.refresh(); void reload(); }} />
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
          {background && (background.total > 0 || background.status === "failed" || background.message) && (
            <div className="index-status" role="group" aria-label="后台曲库索引">
              <strong role="status">{activity.backgroundCurrent ? indexPhase[background.status] ?? "索引状态待确认" : "正在核对原索引状态"}</strong>
              <progress aria-label="后台曲库索引进度" max={Math.max(1, background.total)} value={Math.min(background.done, Math.max(1, background.total))} />
              <span>
                {background.done.toLocaleString()} /{" "}
                {background.total.toLocaleString()}
                {background.errors > 0
                  ? ` · ${background.errors} 个文件需处理`
                  : ""}
              </span>
              {background.status === "running" && (
                <button
                  disabled={busy || !activity.backgroundCurrent}
                  onClick={() => void work(async () => { await activity.index({ type: "pauseIndex" }); })}
                >
                  暂停后台索引
                </button>
              )}
              {background.status === "paused" && (
                <button
                  disabled={busy || !activity.backgroundCurrent}
                  onClick={() => void work(async () => { await activity.index({ type: "resumeIndex" }); })}
                >
                  继续后台索引
                </button>
              )}
              {["running", "paused"].includes(background.status) && (
                <button
                  disabled={busy || !activity.backgroundCurrent}
                  onClick={() => void work(async () => { await activity.index({ type: "cancelIndex" }); })}
                >
                  取消索引任务
                </button>
              )}
              {background.status === "running" && (
                <span className="parameter-help" title={background.current}>
                  {background.current}
                </span>
              )}
              {background.message && (
                <span className="dialog-error" role="alert">{background.message}</span>
              )}
            </div>
          )}
        <BrowsePaneNavigation compact={panes.compact} pane={panes.pane} title={current ? entry?.metadata.title ?? current.title : active ? "上次选择待读取" : undefined}
          available={!!current || !!edit || !!active} blocked={busy || !!edit} listLabel="曲目列表" detailLabel="曲目详情"
          neighbors={{ position: currentIndex >= 0 ? `第 ${currentIndex + 1} / ${filtered.length} 首` : "当前曲目不在筛选列表中",
            previousLabel: "上一首", nextLabel: "下一首", canPrevious: browseReady && currentIndex > 0,
            canNext: browseReady && currentIndex >= 0 && currentIndex + 1 < filtered.length,
            previous: () => stepDetail(-1), next: () => stepDetail(1) }}
          showList={() => { setGroupsOpen(false); panes.showList(); }} showDetails={() => { setGroupsOpen(false); panes.showDetails(); }}>
          <button ref={groupTrigger} disabled={busy || !!edit} aria-expanded={groupsOpen} onClick={() => setGroupsOpen((old) => !old)}>
            {groupsOpen ? "收起分组" : group ? "切换分组" : "分组与文件夹"}
          </button>
        </BrowsePaneNavigation>
        <div className={`library-manager-body browse-split${panes.compact ? " browse-compact" : ""}`}>
          <nav className="library-manager-groups" hidden={panes.compact && (!panes.listVisible || !groupsOpen)} aria-label="曲目分组">
            {panes.compact && <div className="browse-groups-heading"><strong>分组与文件夹</strong>
              <button disabled={busy || !!edit} data-dialog-escape onClick={closeGroups} aria-label="关闭分组列表"><X size={16} /></button></div>}
            <button
              className={!group && !showRecordings ? "selected" : ""}
              data-browse-selected={!group && !showRecordings ? "true" : undefined}
              onClick={() => {setGroup("");setShowRecordings(false);setPage(0);if (panes.compact) closeGroups();}}
            >
              全部曲目
            </button>
            <button className={showRecordings ? "selected" : ""} data-browse-selected={showRecordings ? "true" : undefined} aria-pressed={showRecordings} onClick={()=>{setGroup("");setShowRecordings(true);setPage(0);if (panes.compact) closeGroups();}}>我的录音 · {rows.filter(row=>row.id.startsWith("recording/")).length}</button>
            {groups.map((g) => (
              <button
                className={group === g.id ? "selected" : ""}
                data-browse-selected={group === g.id ? "true" : undefined}
                key={g.id}
                title={groupName(g.id)}
                onClick={() => {setGroup(g.id);setShowRecordings(false);setPage(0);if (panes.compact) closeGroups();}}
              >
                {groupName(g.id)}
              </button>
            ))}
            <div className="group-editor">
              <input
                aria-label="新分组名称"
                placeholder="分组名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                aria-label="分组上级"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">顶层分组</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {groupName(g.id)}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !name.trim()}
                onClick={() =>
                  void work(async () => {
                    const r = await api.commandForEngine<{ id: string }>(engineId, {
                      type: "libraryGroup",
                      id: null,
                      name,
                      parent: parent || null,
                    });
                    await reload();
                    setGroup(r.id);
                    setName("");
                  })
                }
              >
                新建分组
              </button>
              {group && (
                <>
                  <button
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      void work(async () => {
                        await mutate({
                          type: "libraryGroup",
                          id: group,
                          name,
                          parent: parent || null,
                        });
                        setName("");
                      })
                    }
                  >
                    重命名 / 移动分组
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        await mutate({ type: "removeLibraryGroup", id: group });
                        setGroup("");
                      })
                    }
                  >
                    取消此分组
                  </button>
                </>
              )}
            </div>
            <div className="folder-list">
              <h3>曲库文件夹</h3>
              <button disabled={busy || !!edit} onClick={() => setLocationsOpen(true)}>最近文件位置</button>
              {folders.map((f) => (
                <div key={f.path}>
                  <span title={f.path}>{f.path}</span>
                  {f.kind === "catalog" ? <small>默认曲库目录</small> : f.automatic ? <small>本地转换目录</small> : null}
                  {!f.available && <small>未连接</small>}
                  <button
                    aria-label={`移除文件夹 ${f.path}`}
                    disabled={busy || f.kind === "catalog"}
                    onClick={() =>
                      void work(() =>
                        mutate({ type: "removeLibraryFolder", path: f.path }),
                      )
                    }
                  >
                    移除登记
                  </button>
                </div>
              ))}
              {api.desktop && (
                <button
                  disabled={busy}
                  onClick={addFolder}
                >
                  添加文件夹
                </button>
              )}
              <p>移除登记只停止扫描，文件和历史仍保留。</p>
            </div>
          </nav>
          <div className="library-manager-center" hidden={!panes.listVisible} inert={panes.compact && groupsOpen}>
            <div {...tableScroll} className="library-manager-table-wrap" aria-busy={reading || !workspaceReady}>
              <table
                ref={tableRef}
                className="library-manager-table"
                onKeyDown={(event) => {
                  if (navigationBlocked || edit || !browseReady) return;
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "a"
                  ) {
                    event.preventDefault();
                    setSelected(new Set(filtered.map((r) => key(r.path))));
                  }
                }}
              >
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="选择本页曲目"
                        checked={
                          shown.length > 0 &&
                          shown.every((r) => selected.has(key(r.path)))
                        }
                        disabled={navigationBlocked || !!edit || !browseReady}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((old) => {
                            const next = new Set(old);
                            for (const row of shown) {
                              if (checked) next.add(key(row.path));
                              else next.delete(key(row.path));
                            }
                            return next;
                          });
                        }}
                      />
                    </th>
                    {sortHeader("曲名 / 标签", "title")}
                    {sortHeader("作曲家", "composer")}
                    {sortHeader("难度", "difficulty")}
                    {sortHeader("时长", "duration")}
                    <th>谱面 / 状态</th>
                    {sortHeader("学习阶段 / 目标", "learningStage")}
                    {sortHeader("评级", "rating")}
                    <th title="每曲最多保留 200 次成绩；日期取最后一条成绩，不含仅打开曲目">
                      练习记录
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const e = data.entries[key(r.path)],
                      m = e?.metadata;
                    return (
                      <tr
                        key={r.path}
                        className={active === key(r.path) ? "active" : ""}
                        data-index={page * 50 + i}
                        data-path={key(r.path)}
                        data-browse-selected={active === key(r.path) ? "true" : undefined}
                        tabIndex={0}
                        aria-selected={selected.has(key(r.path))}
                        onClick={(event) => choose(r, page * 50 + i, event)}
                        onDoubleClick={(event) => {
                          if ((event.target as Element).closest("button, input, select, textarea, a")) return;
                          void openRow(r);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          showMenu(
                            r,
                            page * 50 + i,
                            event.clientX,
                            event.clientY,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (busy || collectionWorking || edit) return;
                          if (panes.compact && event.key === "ArrowRight" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                            event.preventDefault(); setActive(key(r.path)); setGroupsOpen(false); panes.showDetails(); return;
                          }
                          if (
                            event.key === "ContextMenu" ||
                            (event.shiftKey && event.key === "F10")
                          ) {
                            event.preventDefault();
                            const rect =
                              event.currentTarget.getBoundingClientRect();
                            showMenu(
                              r,
                              page * 50 + i,
                              rect.left + 30,
                              rect.bottom,
                            );
                            return;
                          }
                          if (event.key === "F2") {
                            event.preventDefault();
                            if (!r.path.startsWith("exercise:")) editRow(r);
                            return;
                          }
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key.toLowerCase() === "a"
                          ) {
                            event.preventDefault();
                            setSelected(
                              new Set(filtered.map((row) => key(row.path))),
                            );
                            return;
                          }
                          if (
                            (event.ctrlKey || event.metaKey) &&
                            event.key.toLowerCase() === "c"
                          ) {
                            event.preventDefault();
                            const paths = (
                              selected.has(key(r.path))
                                ? rows.filter((row) =>
                                    selected.has(key(row.path)),
                                  )
                                : [r]
                            )
                              .filter(
                                (row) => !row.path.startsWith("exercise:"),
                              )
                              .map((row) => row.path);
                            void work(async () => {
                              await copyLibraryPaths(paths);
                              setFileActionResult(
                                `已复制 ${paths.length} 个文件位置`,
                              );
                            });
                            return;
                          }
                          const index = page * 50 + i,
                            movement: Record<string, number> = {
                              ArrowDown: index + 1,
                              ArrowUp: index - 1,
                              Home: event.ctrlKey ? 0 : page * 50,
                              End: event.ctrlKey
                                ? filtered.length - 1
                                : Math.min(filtered.length - 1, page * 50 + 49),
                              PageDown: index + 50,
                              PageUp: index - 50,
                            };
                          if (event.key in movement) {
                            event.preventDefault();
                            if (event.shiftKey && anchor.current === null)
                              anchor.current = key(r.path);
                            moveFocus(movement[event.key], event);
                            return;
                          }
                          if (event.key === "Enter") { event.preventDefault(); void openRow(r); }
                          if (event.key === " ") {
                            event.preventDefault();
                            toggle(r);
                          }
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${m?.title ?? r.title}`}
                            checked={selected.has(key(r.path))}
                            disabled={busy || collectionWorking || !!edit}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggle(r)}
                          />
                        </td>
                        <td title={r.path}>
                          <strong>{m?.title ?? r.title}</strong>
                          {isCurrentPracticeRow(r, contentFor(r), currentPractice) && <span className="library-current-practice">当前练习</span>}
                          {panes.compact && <small className="library-compact-meta">{[
                            m?.composer ?? r.composer,
                            m?.difficulty ?? r.difficulty,
                            e?.contentId ? clock(e.duration) : null,
                            historyFor(r)?.review ? reviewShort(historyFor(r)?.review ?? null, historyFor(r)?.lastPracticed) : null,
                          ].filter(Boolean).join(" · ")}</small>}
                          {panes.compact && <button className="library-row-details" disabled={busy || !!edit}
                            aria-label={`查看 ${m?.title ?? r.title} 的详情`}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={(event) => { event.stopPropagation(); setActive(key(r.path)); panes.showDetails(); }}>详情</button>}
                          <small title={reviewLabel(historyFor(r)?.review ?? null)}>
                            {(m?.tags ?? r.tags ?? []).join(" · ") ||
                              r.category ||
                              r.source}
                          </small>
                        </td>
                        <td>{m?.composer ?? r.composer}</td>
                        <td>{m?.difficulty ?? r.difficulty ?? "—"}</td>
                        <td>{e?.contentId ? clock(e.duration) : "—"}</td>
                        <td>
                          {e?.available === false
                            ? "文件缺失"
                            : e?.error
                              ? "需处理"
                              : e?.hasScore
                                ? "已配乐谱"
                                : e?.contentId
                                  ? "已索引"
                                  : "待索引"}
                          {!!e?.notationCount && (
                            <small>{e.notationCount} 份演奏乐谱</small>
                          )}
                          {!!e?.paperCount && (
                            <small title={e.paperNames?.join(" · ")}>
                              {e.paperCount} 份 PDF / 图片谱面
                            </small>
                          )}
                          {e?.contentId && duplicates.has(e.contentId) && (
                            <small>重复内容</small>
                          )}
                        </td>
                        <td>
                          {e?.contentId && data.learning?.[e.contentId] ? (
                            <>
                              <span>
                                {
                                  learningStages[
                                    data.learning[e.contentId].stage
                                  ]
                                }
                              </span>
                              <small
                                className={
                                  activeDeadline(data.learning[e.contentId]) &&
                                  data.learning[e.contentId].due! < today
                                    ? "learning-overdue"
                                    : ""
                                }
                              >
                                {data.learning[e.contentId].due ??
                                  "未设目标日期"}
                                {activeDeadline(data.learning[e.contentId]) &&
                                data.learning[e.contentId].due! < today
                                  ? " · 已逾期"
                                  : ""}
                              </small>
                            </>
                          ) : (
                            "未设置"
                          )}
                        </td>
                        <td>{e?.rating ? "★".repeat(e.rating) : "—"}</td>
                        <td>
                          {historyFor(r)?.sessions
                            ? `${historyFor(r)!.sessions} 次`
                            : "—"}
                          <small title={reviewLabel(historyFor(r)?.review ?? null)}>
                            {historyFor(r)?.lastPracticed
                              ? new Date(
                                  historyFor(r)!.lastPracticed!,
                                ).toLocaleDateString("zh-CN")
                              : ""}
                            {historyFor(r)?.review ? ` · ${reviewShort(historyFor(r)?.review ?? null, historyFor(r)?.lastPracticed)}` : ""}
                          </small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!shown.length && (reading ? <BrowseListState kind="loading" title="正在读取曲库" detail="筛选、选择和浏览位置会继续保留。" />
                : !browseReady ? <BrowseListState kind="failed" title="曲库资料尚未读齐" detail="重新读取曲目与练习资料后，可以继续浏览原来的列表。">
                    <button disabled={busy} onClick={() => void reload()}>重新读取曲库</button>
                  </BrowseListState>
                : <BrowseListState kind={filterChips.length ? "filtered" : "empty"}
                    title={filterChips.length ? "当前筛选下没有曲目" : songScope ? "尚未找到这首曲目的文件" : "把想练的曲目放进曲库"}
                    detail={filterChips.length ? "可以清除筛选后继续选择。原有多选会继续保留。" : songScope ? "需要先索引同一内容的 MIDI 文件。可以返回原列表，添加或检查文件位置。" : "支持导入 MIDI、MusicXML 和曲目包，也可以登记一个曲库文件夹。"}>
                    {filterChips.length > 0 ? <button disabled={navigationBlocked} onClick={resetFilters}>{songScope ? "查看本曲全部位置" : "清除筛选，查看全部曲目"}</button>
                      : songScope && searchReturn ? <button disabled={navigationBlocked} onClick={restoreSearch}>返回原来的曲库列表</button>
                      : <>{importFiles && <button className="primary" disabled={navigationBlocked} onClick={importFiles}>导入曲目文件</button>}
                          {api.desktop && <button disabled={navigationBlocked} onClick={addFolder}>添加曲库文件夹</button>}</>}
                  </BrowseListState>)}
            </div>
            <BrowsePagination page={page} total={filtered.length} disabled={navigationBlocked || !!edit || !browseReady}
              pending={reading} known={workspaceReady && rowsReady} label="曲目" unit="首" change={setPage}>
              <span>已选择 {selected.size} 首</span>
                <button
                  disabled={navigationBlocked || !!edit || !browseReady || !filtered.length}
                  onClick={() =>
                    setSelected(new Set(filtered.map((r) => key(r.path))))
                  }
                >
                  选择全部结果
                </button>
            </BrowsePagination>
          </div>
          <aside
            {...detailScroll}
            className="library-file-details"
            hidden={!panes.detailVisible}
          >
            {current ? (
              <LibrarySongDetail
                row={current}
                notice={
                  detailNotice?.path === current.path ? detailNotice.message : undefined
                }
                entry={entry}
                learning={
                  entry?.contentId ? data.learning?.[entry.contentId] : undefined
                }
                review={activeReview}
                reviewReason={activeReview ? reviewReason(activeReview) : ""}
                today={today}
                section={detailSection}
                changeSection={setDetailSection}
                blocked={busy}
                open={{
                  label:
                    openingPath === key(current.path)
                      ? "正在打开…"
                      : continuing(current)
                        ? "继续当前练习"
                        : "开始练习",
                  disabled:
                    navigationBlocked ||
                    !!edit ||
                    !!openUnavailable ||
                    (entry?.available === false && !continuing(current)),
                  title:
                    openUnavailable ??
                    (entry?.available === false && !continuing(current)
                      ? "文件缺失，请在文件与资料中重新定位 MIDI。"
                      : undefined),
                  run: () => {
                    void openRow(current);
                  },
                }}
                history={
                  reviewSong
                    ? {
                        label: "查看历史",
                        disabled: navigationBlocked || !contentFor(current),
                        title: !contentFor(current)
                          ? "检查文件并建立内容索引后，可查看对应历史。"
                          : undefined,
                        run: () => reviewRow(current),
                      }
                    : undefined
                }
                learn={{
                  label:
                    entry?.contentId && data.learning?.[entry.contentId]
                      ? "调整目标"
                      : "设置目标",
                  disabled: busy || !entry?.contentId,
                  run: () => learningRow(current),
                }}
                fileActions={[
                  {
                    label: "检查文件",
                    disabled: busy || current.path.startsWith("exercise:"),
                    run: () => {
                      void work(() => inspect([current], true));
                    },
                  },
                  {
                    label: "编辑曲目信息",
                    disabled: busy || current.path.startsWith("exercise:"),
                    run: () => editRow(current),
                  },
                  {
                    label: "打开文件位置",
                    disabled:
                      busy || !api.desktop || current.path.startsWith("exercise:"),
                    run: () => {
                      void work(() => api.revealFile(current.path));
                    },
                  },
                  {
                    label: "复制文件位置",
                    disabled: busy || current.path.startsWith("exercise:"),
                    run: () => {
                      void work(async () => {
                        await copyLibraryPaths([current.path]);
                        setFileActionResult("已复制文件位置");
                        setDetailNotice({
                          path: current.path,
                          message: "文件位置已复制。",
                        });
                      });
                    },
                  },
                  ...(entry?.available === false && api.desktop
                    ? [
                        {
                          label: "重新定位 MIDI",
                          disabled: busy || !entry.contentId,
                          run: () => {
                            void work(async () => {
                              const restored = await api.relocate(entry.contentId!);
                              if (restored) {
                                await api.commandForEngine(engineId, {
                                  type: "inspectSong",
                                  path: restored.sourcePath,
                                  force: true,
                                });
                                setActive(key(restored.sourcePath));
                                await reload();
                                await changed();
                              }
                            });
                          },
                        },
                      ]
                    : []),
                  ...(entry?.contentId
                    ? [
                        {
                          label: "资料变更历史",
                          disabled: busy || !!edit,
                          run: () =>
                            setMetadataHistory({
                              path: current.path,
                              contentId: entry.contentId!,
                              title: entry.metadata.title ?? current.title,
                            }),
                        },
                      ]
                    : []),
                ]}
                scores={
                  entry?.contentId && (
                    <LibraryScoresPane
                      key={JSON.stringify([engineId ?? null, current.path, entry.contentId])}
                      row={current}
                      contentId={entry.contentId}
                      engineId={engineId}
                      active={panes.detailVisible && detailSection === "scores"}
                      changed={async () => {
                        await reload();
                        await changed();
                      }}
                      onBusy={setScoreBusy}
                      openVersion={openVersion}
                    />
                  )
                }
                time={
                  entry?.contentId && (
                    <PracticeTimePanel
                      engineId={engineId}
                      active={panes.detailVisible && detailSection === "overview"}
                      contentId={entry.contentId}
                      targetMinutes={
                        data.learning?.[entry.contentId]?.weeklyMinutes ?? null
                      }
                    />
                  )
                }
                editor={metadataEditor}
              />
            ) : (
              <>
                <div className="browse-detail-empty">
                  <h3
                    className="browse-detail-heading"
                    tabIndex={-1}
                    data-browse-detail-heading
                  >
                    {edit
                      ? "继续编辑曲目资料"
                      : active
                        ? reading
                          ? "正在读取已选曲目"
                          : "已保留上次选择"
                        : "选择一首曲目"}
                  </h3>
                  <span>
                    {edit
                      ? "当前列表中没有这首曲目，下方保留了正在编辑的资料。"
                      : active
                        ? reading
                          ? "曲库读齐后会继续显示原来的详情。"
                          : "当前曲库尚未找到这个位置，可以重新读取或检查文件位置。"
                        : "查看学习目标、乐谱和文件资料，再开始练习。"}
                  </span>
                  {!edit && active && (
                    <>
                      <small className="library-retained-location">{active}</small>
                      <div className="browse-detail-actions">
                        <button disabled={reading || busy} onClick={() => void reload()}>
                          重新读取曲库
                        </button>
                        {!active.startsWith("exercise:") && (
                          <button
                            disabled={navigationBlocked}
                            onClick={() => setRepairsOpen(true)}
                          >
                            查看文件位置修复
                          </button>
                        )}
                        <button
                          disabled={navigationBlocked}
                          onClick={() => {
                            panes.showList();
                          }}
                        >
                          返回曲目列表
                        </button>
                      </div>
                    </>
                  )}
                  {!edit && !active && <span>Ctrl 多选，Shift 连选，双击进入练习。</span>}
                </div>
                {metadataEditor}
              </>
            )}
          </aside>
        </div>
        {learningResult && (
          <p className="library-learning-result" role="status">
            {learningResult}
          </p>
        )}
        <div className="library-bulk-actions browse-controls" hidden={!panes.listVisible}>
          {panes.compact && <button className="library-bulk-toggle" aria-expanded={batchOpen} onClick={() => setBatchOpen((old) => !old)}>
            <span>批量整理与索引 · 已选 {selected.size} 首</span>
            {selected.size > 0 && (!browseReady ? <small>正在核对选择</small> : unavailableSelectionCount ? <small>{unavailableSelectionCount} 首暂未找到</small> : selectedVisible < selected.size ? <small>{selected.size - selectedVisible} 首在筛选之外</small> : null)}
            {batchOpen ? "⌃" : "⌄"}
          </button>}
          <div className="library-bulk-content" hidden={panes.compact && !batchOpen}>
        <LibrarySelectionSummary selected={selectedReviewRows} visible={selectedVisible}
          ready={browseReady} pending={reading} selectedCount={selected.size}
          clearUnavailable={clearUnavailableSelection}
          initialBrowse={initialBrowse?.selectionReview}
          rememberBrowse={(selectionReview) => {
            browsing.current = { ...browsing.current, selectionReview };
            rememberBrowse?.(browsing.current);
          }}
          fileCount={picked.length} onlySelected={selectionOnly} disabled={busy || collectionWorking}
          toggleOnlySelected={() => { setSelectionOnly((value) => !value); setPage(0); }}
          keepVisible={() => setSelected((current) => new Set([...current].filter((path) => filteredKeys.has(path))))}
          remove={(path) => { if (busy) return; setSelected((old) => { const next = new Set(old); next.delete(key(path)); return next; }); anchor.current = null; rangeBase.current = new Set(); }}
          clear={clearSelection} />
        <div className="library-manager-actions">
          <button disabled={busy || !batchReady || !!edit || !picked.length || picked.length > 100} onClick={() => setMetadataBatch(picked.map(row => ({path:row.path,contentId:data.entries[key(row.path)]?.contentId ?? null,title:row.title}))) }>批量修改资料 · {picked.length}</button>
          <select
            aria-label="批量学习阶段"
            value={batchStage}
            disabled={busy}
            onChange={(event) => setBatchStage(event.target.value)}
          >
            {Object.entries(learningStages).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            disabled={
              busy || !batchReady || !learningPicked.length || learningPicked.length > 100
            }
            title="只处理已索引曲目，相同内容的副本合并为一首；每次最多 100 首。保留原目标与要求。"
            onClick={() =>
              void work(async () => {
                setLearningResult("");
                let done = 0;
                const errors: string[] = [];
                for (const { row, cid } of learningPicked) {
                  const previous = data.learning?.[cid] ?? null;
                  try {
                    await api.commandForEngine(engineId, {
                      type: "saveSongLearning",
                      path: row.path,
                      content_id: cid,
                      expected: previous,
                      value: {
                        stage: batchStage,
                        goal: previous?.goal ?? "",
                        due: previous?.due ?? null,
                        weeklyMinutes: previous?.weeklyMinutes ?? null,
                        targetBpm: previous?.targetBpm ?? null,
                      },
                    });
                    done++;
                  } catch (error) {
                    errors.push(`${row.title}：${String(error)}`);
                  }
                }
                await reload();
                await changed();
                setLearningResult(
                  `已设置 ${done} 首为${learningStages[batchStage]}${errors.length ? `；${errors.length} 首未完成：${errors.join("；")}` : "。原目标与要求已保留。"}`,
                );
              })
            }
          >
            设定学习阶段 · {learningPicked.length}
          </button>
          <button
            disabled={busy || !batchReady || !picked.length}
            onClick={() => void work(() => inspect(picked))}
          >
            索引所选 {picked.length || ""}
          </button>
          <button
            disabled={busy || !shown.length}
            onClick={() => void work(() => inspect(shown))}
          >
            索引本页
          </button>
          <button
            disabled={
              busy ||
              !rows.length ||
              background?.status === "running" ||
              background?.status === "paused"
            }
            onClick={() => void work(() => inspect(rows))}
          >
            后台索引全库
          </button>
          <select
            aria-label="批量目标分组"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择分组</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {groupName(g.id)}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !batchReady || !target || !picked.length}
            onClick={() =>
              void work(() =>
                mutate({
                  type: "assignLibrary",
                  paths: picked.map((r) => r.path),
                  group: target,
                  rating: null,
                }),
              )
            }
          >
            加入分组
          </button>
          {group && (
            <button
              disabled={busy || !batchReady || !picked.length}
              onClick={() =>
                void work(() =>
                  mutate({
                    type: "unassignLibrary",
                    paths: picked.map((r) => r.path),
                    group,
                  }),
                )
              }
            >
              移出此分组
            </button>
          )}
          <select
            aria-label="批量曲目评级"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            {[0, 1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r ? "★".repeat(r) : "未评级"}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !batchReady || !picked.length}
            onClick={() =>
              void work(() =>
                mutate({
                  type: "assignLibrary",
                  paths: picked.map((r) => r.path),
                  group: null,
                  rating: Number(rating),
                }),
              )
            }
          >
            设定评级
          </button>
          <span className="menu-spacer" />
          <button
            disabled={busy || !!edit || !selected.size}
            onClick={clearSelection}
          >
            取消选择
          </button>
        </div>
          </div>
        </div>
        {collectionWorking && (
          <button
            onClick={() => {
              collectionStop.current = true;
            }}
          >
            停止收藏 / 队列处理
          </button>
        )}
        {fileActionResult && (
          <p role="status" className="library-learning-result">
            {fileActionResult}
          </p>
        )}
        {menu && (
          <LibraryContextMenu
            x={menu.x}
            y={menu.y}
            title={
              menu.items.length > 1
                ? `已选择 ${menu.items.length} 首 · ${menu.row.title}`
                : menu.row.title
            }
            actions={menuActions}
            close={closeMenu}
          />
        )}
        {learningEdit && (
          <SongLearningDialog
            key={learningEdit.contentId}
            {...learningEdit}
            engineId={engineId}
            draftMemory={learningDrafts}
            close={() => setLearningEdit(null)}
            changed={async () => {
              await refreshEdited();
            }}
          />
        )}
        {metadataHistory && <LibraryMetadataHistoryDialog {...metadataHistory} close={() => setMetadataHistory(null)} changed={refreshEdited} />}
        {metadataBatch && <LibraryMetadataBatchDialog items={metadataBatch} drafts={metadataDrafts} close={() => setMetadataBatch(null)} changed={refreshEdited} />}
        {locationsOpen && <FileLocationsDialog close={() => setLocationsOpen(false)} />}
        {synthesiaImport && <SynthesiaImportDialog songs={synthesiaImport} engineId={engineId} close={()=>setSynthesiaImport(null)} changed={async()=>{await refreshRows?.();await refreshEdited();}}/>}
        {paperSourcesOpen && <PaperSourceUpdatesDialog close={()=>setPaperSourcesOpen(false)} changed={changed}/>}
        {sourcesOpen && (
          <ScoreSourcesDialog
            close={() => setSourcesOpen(false)}
            changed={changed}
          />
        )}
      </section>
    </div>
  );
}
