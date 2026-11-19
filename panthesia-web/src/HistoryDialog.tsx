import { BrowseDetailWorkspace } from "./app/BrowseDetailWorkspace";
import { ToolbarMore } from "./app/ToolbarMore";
import { HistoryBarResults } from "./features/review/HistoryBarResults";
import { HistoryComparison, HistoryResultSummary } from "./features/review/HistoryDetailSections";
import type { HistoryBarReview, HistoryDetailSection } from "./features/review/historyBrowse";
import { modeName, handName, accuracy, percent, rangeName, date } from "./features/review/historyPresentation";
import { useHistoryActions } from "./features/review/useHistoryActions";
import { useHistoryListNavigation } from "./features/review/useHistoryListNavigation";
import type { SongWorkspaceRequest, SongWorkspaceTarget } from "./app/songWorkspaceVisit";
import type { Workspace } from "./app/useWorkspaceNavigation";
import { BrowseFilterChips, type BrowseFilterChip } from "./app/BrowseFilterChips";
import { useWorkspaceFocus } from "./app/useWorkspaceFocus";
import { useBrowsePane } from "./app/useBrowsePane";
import { useBrowseSearch } from "./app/useBrowseSearch";
import { BrowsePaneNavigation } from "./app/BrowsePaneNavigation";
import { BrowseControls } from "./app/BrowseControls";
import { BrowsePagination } from "./app/BrowsePagination";
import { BrowseListState } from "./app/BrowseListState";
import { WorkspaceReadStatus } from "./app/WorkspaceReadStatus";
import { useHistoryBrowser, type HistoryCache } from "./features/review/useHistoryBrowser";
import { HistoryTaskActivity } from "./engine/HistoryTaskActivity";
import {
  HistoryMultiProblemPlan,
  type ReviewSource,
} from "./HistoryMultiProblemPlan";
import type {
  HistoryScoreTarget,
  HistoryScoreReview,
} from "./historyScoreFocus";
import { HistoryPerformance } from "./HistoryPerformance";
import { getReplayEditor } from "./features/review/replayEditorStore";
import { getPerformanceArchive } from "./features/review/performanceArchiveStore";
import { HistoryOperationRecovery } from "./features/review/HistoryOperationRecovery";
export type { HistoryPaperTarget } from "./features/review/historyTypes";
import type { HistoryPaperTarget } from "./features/review/historyTypes";
import { practiceDuration } from "./practiceTime";
import { PracticeCalendar } from "./PracticeCalendar";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HistoryAnnotationDrafts } from "./features/review/HistoryAnnotationDrafts";
import { readReviewSources, writeReviewSources, originalReviewSources } from "./features/review/reviewSources";
import { annotationEntry } from "./features/review/annotationDraft";
import type { AnnotationDraft } from "./features/review/annotationDraft";
import { useBrowseScroll } from "./app/useBrowseScroll";
import { historyFilters, type HistoryBrowse } from "./features/review/historyBrowse";
import {
  HistoryAnnotationEditor,
  type Annotation,
} from "./HistoryAnnotationEditor";
import { api, type Snapshot } from "./api";
import type { HistoryEntry as Entry, HistoryDetail as Detail } from "./features/review/historyTypes";
import { TaskActivity } from "./engine/TaskActivity";
export function HistoryDialog({
  presentation = "dialog",
  engineId,
  initialBrowse,
  songRequest,
  songConsumed,
  locateSong,
  currentSong,
  backToSource,
  readCache,
  annotationDrafts,
  annotationRequest,
  replayRequest,
  replayConsumed,
  annotationConsumed,
  rememberBrowse,
  navigationLockChanged,
  close,
  changed,
  backup,
  score,
  paper,
  finger,
  review,
  openPlan,
}: {
  presentation?: "dialog" | "workspace";
  engineId?: string;
  initialBrowse?: HistoryBrowse;
  songRequest?: SongWorkspaceRequest | null;
  songConsumed?: (id: string) => void;
  locateSong?: (song: SongWorkspaceTarget) => Promise<boolean>;
  currentSong?: SongWorkspaceTarget | null;
  backToSource?: (workspace: Workspace) => Promise<boolean>;
  readCache?: HistoryCache;
  annotationDrafts?: Map<string, AnnotationDraft>;
  annotationRequest?: { id: string; entry: Entry } | null;
  replayRequest?: { id: string; entry: Entry } | null;
  replayConsumed?: (id: string) => void;
  annotationConsumed?: (id: string) => void;
  rememberBrowse?: (browse: HistoryBrowse) => void;
  navigationLockChanged?: (blocked: boolean) => void;
  openPlan: (id: string, day: string | null) => void;
  close: () => void;
  changed: () => Promise<Snapshot | void>;
  backup: () => void;
  score: (focus: HistoryScoreTarget) => void;
  paper: (focus: HistoryPaperTarget) => void;
  finger: (focus: HistoryPaperTarget) => Promise<void>;
  review: (data: HistoryScoreReview) => void;
}) {
  useWorkspaceFocus(presentation, "history-title");
  const connection = useRef(engineId);
  connection.current = engineId;
  const [sources, setSources] = useState<ReviewSource[]>(() => initialBrowse?.sources ?? readReviewSources());
  const [sourceStorageError, setSourceStorageError] = useState("");
  const [sourceStorageRevision, setSourceStorageRevision] = useState(0);
  const [sourceCopyNotice, setSourceCopyNotice] = useState("");
  const replaceSources = useRef(false);
  useEffect(() => {
    try {
      const replace = replaceSources.current; replaceSources.current = false;
      writeReviewSources(sources, replace);
      setSourceStorageError("");
    } catch (failure) {
      setSourceStorageError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [sources, sourceStorageRevision]);
  const [, setMultiDirty] = useState(false);
  const [draftBlocked, setDraftBlocked] = useState(false);
  const browser = useHistoryBrowser(initialBrowse, readCache, engineId);
  const { filters, offset, setOffset, selected, setSelected, entries, total, currentDetail: detail, changeFilter } = browser;
  const panes = useBrowsePane(initialBrowse?.pane);
  const [filtersOpen, setFiltersOpen] = useState(initialBrowse?.filtersOpen ?? false);
  const [detailSection, setDetailSection] = useState<HistoryDetailSection>(initialBrowse?.detailSection ?? "results");
  const [barReview, setBarReview] = useState<HistoryBarReview | undefined>(initialBrowse?.barReview);
  const [barReviewEpoch, setBarReviewEpoch] = useState(0);
  const barReviewMemory = useRef(new Map((initialBrowse?.barReviews ?? (initialBrowse?.barReview ? [initialBrowse.barReview] : []))
    .map((review) => [JSON.stringify([review.contentId, review.id]), review])));
  const rememberBarReview = (review: HistoryBarReview) => {
    const key = JSON.stringify([review.contentId, review.id]);
    barReviewMemory.current.delete(key);
    barReviewMemory.current.set(key, review);
    if (barReviewMemory.current.size > 32) barReviewMemory.current.delete(barReviewMemory.current.keys().next().value!);
    setBarReview(review);
  };

  const loading = browser.list.pending, listError = browser.list.error;
  const detailLoading = browser.detail.pending, detailError = browser.detail.error;
  const [notesDirty, setNotesDirty] = useState(false);
  const [order, setOrder] = useState(initialBrowse?.order ?? "errors");
  const actions = useHistoryActions({ engineId, detail, blocked: notesDirty || draftBlocked, changed, close, review, paper, finger, score });
  const { busy, error, open, reviewScore, practicePerformance } = actions;

  const [returnTo, setReturnTo] = useState<HistoryBrowse["returnTo"]>(initialBrowse?.returnTo ?? null);
  const [calendarRestore, setCalendarRestore] = useState(initialBrowse?.calendar);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [visitFrom, setVisitFrom] = useState(initialBrowse?.visitFrom);
  const browsing = useRef<HistoryBrowse>({ sources, filters, offset, selected, order,
    calendar: initialBrowse?.calendar,
    listTop: initialBrowse?.listTop ?? 0, listTopKey: initialBrowse?.listTopKey, detailTop: initialBrowse?.detailTop ?? 0, detailTopKey: initialBrowse?.detailTopKey });
  browsing.current = { ...browsing.current, sources, filters, offset, selected, selection: browser.selection, order, song: browser.song, returnTo, visitFrom, pane: panes.pane, filtersOpen, detailSection, barReview, barReviews: [...barReviewMemory.current.values()] };
  useEffect(() => { rememberBrowse?.(browsing.current); }, [sources, filters, offset, selected, browser.selection, order, browser.song, returnTo, visitFrom, panes.pane, filtersOpen, detailSection, barReview, rememberBrowse]);
  const listScroll = useBrowseScroll<HTMLDivElement>(browser.listKey, panes.listVisible && browser.list.current && !!browser.list.value,
    !initialBrowse?.listTopKey || initialBrowse.listTopKey === browser.listKey ? initialBrowse?.listTop ?? 0 : 0, (listTop) => {
      browsing.current = { ...browsing.current, listTop, listTopKey: browser.listKey }; rememberBrowse?.(browsing.current);
    }, browser.listPositions);
  const detailScrollKey = detailSection === "results" ? browser.detailKey : `${browser.detailKey}:${detailSection}`;
  const detailScroll = useBrowseScroll<HTMLDivElement>(detailScrollKey,
    panes.detailVisible && !!detail, !initialBrowse?.detailTopKey || initialBrowse.detailTopKey === detailScrollKey ? initialBrowse?.detailTop ?? 0 : 0, (detailTop) => {
      browsing.current = { ...browsing.current, detailTop, detailTopKey: detailScrollKey }; rememberBrowse?.(browsing.current);
    }, browser.detailPositions);
  const clearFilters = () => changeFilter({ ...historyFilters });
  const filterChips: BrowseFilterChip[] = [];
  if (filters.query.trim()) filterChips.push({ id: "query", label: `关键词：${filters.query.trim()}`, remove: () => changeFilter({ query: "" }) });
  if (filters.mode) filterChips.push({ id: "mode", label: modeName(filters.mode), remove: () => changeFilter({ mode: "" }) });
  if (filters.hands) filterChips.push({ id: "hands", label: handName(filters.hands), remove: () => changeFilter({ hands: "" }) });
  if (filters.range) filterChips.push({ id: "range", label: filters.range === "whole" ? "全曲" : "选段", remove: () => changeFilter({ range: "" }) });
  if (filters.days || filters.from !== null || filters.to !== null) filterChips.push({ id: "date",
    label: filters.days ? filters.days === 1 ? "最近 24 小时" : `最近 ${filters.days} 天`
      : `${filters.from === null ? "不限开始" : new Date(filters.from).toLocaleDateString("zh-CN")}–${filters.to === null ? "不限结束" : new Date(filters.to).toLocaleDateString("zh-CN")}`,
    remove: () => changeFilter({ days: 0, from: null, to: null }) });
  const navigationBlocked = actions.blocked;
  const detailActionsBlocked = navigationBlocked || !browser.detail.verified;
  useBrowseSearch(panes.root, navigationBlocked, () => panes.showList(false));
  const listNavigation = useHistoryListNavigation({ entries, selected, select: setSelected, offset, setOffset, total,
    ready: browser.list.current && !loading && !listError, blocked: navigationBlocked,
    scope: JSON.stringify([filters, browser.song?.contentId ?? null]),
  });
  const appliedAnnotation = useRef<string | null>(null);
  const appliedReplay = useRef<string | null>(null);
  useEffect(() => {
    if (!replayRequest || replayRequest.id === appliedReplay.current || navigationBlocked) return;
    appliedReplay.current = replayRequest.id;
    listNavigation.cancel();
    const entry = replayRequest.entry;
    getReplayEditor(entry.contentId, entry.id).update({ title: entry.title, rangeOpen: true, clipsOpen: true });
    setSelected(entry); setDetailSection("performance"); panes.showDetails(false);
    browser.detail.refresh();
    replayConsumed?.(replayRequest.id);
  }, [replayRequest?.id, navigationBlocked]);
  const annotationFocus = useRef<{ key: string; waiting: boolean } | null>(null);
  useEffect(() => {
    if (!annotationRequest || appliedAnnotation.current === annotationRequest.id || navigationBlocked) return;
    appliedAnnotation.current = annotationRequest.id;
    listNavigation.cancel(); setSelected(annotationRequest.entry); setDetailSection("annotation"); panes.showDetails(false);
    annotationFocus.current = { key: JSON.stringify([annotationRequest.entry.contentId, annotationRequest.entry.id]), waiting: false };
    browser.detail.refresh();
    annotationConsumed?.(annotationRequest.id);
  }, [annotationRequest?.id, navigationBlocked]);
  useEffect(() => {
    const target = annotationFocus.current;
    if (!target) return;
    if (browser.detailKey !== target.key) { if (target.waiting) annotationFocus.current = null; return; }
    if (browser.detail.pending) { target.waiting = true; return; }
    if (!target.waiting || !browser.detail.verified || !browser.detail.current || !panes.detailVisible) return;
    const section = panes.root.current?.querySelector<HTMLElement>(".history-annotation");
    if (!section) return;
    annotationFocus.current = null;
    if ([...document.querySelectorAll('[role="dialog"]')].some((node) => node.getClientRects().length && !node.contains(section))) return;
    section.scrollIntoView({ block: "start" });
    (section.querySelector<HTMLElement>("textarea:not(:disabled), select:not(:disabled), button:not(:disabled)") ?? section.querySelector<HTMLElement>("summary"))?.focus({ preventScroll: true });
  }, [browser.detailKey, browser.detail.pending, browser.detail.verified, browser.detail.current, panes.detailVisible]);
  const appliedSong = useRef<string | null>(null);
  const returnFocus = useRef(false);
  const visitSong = (target: SongWorkspaceTarget, from?: Workspace) => {
    if (navigationBlocked) return;
    returnFocus.current = false;
    const { sources: _sources, returnTo: _returnTo, ...previous } = browsing.current;
    setReturnTo((old) => old ?? previous);
    setVisitFrom(from ?? visitFrom ?? "practice");
    if (browser.song?.contentId !== target.contentId) setDetailSection("results");
    panes.showList(false);
    browser.visitSong(target);
  };
  useEffect(() => {
    if (!songRequest || appliedSong.current === songRequest.id || navigationBlocked) return;
    appliedSong.current = songRequest.id;
    visitSong(songRequest.song, songRequest.from);
    songConsumed?.(songRequest.id);
  }, [songRequest?.id, navigationBlocked]);
  const restoreVisit = () => {
    if (!returnTo || navigationBlocked) return;
    listNavigation.cancel();
    returnFocus.current = true;
    browser.restoreBrowse(returnTo);
    if (returnTo.pane === "detail") panes.showDetails(false); else panes.showList(false);
    setOrder(returnTo.order);
    setDetailSection(returnTo.detailSection ?? "results");
    setBarReview(returnTo.barReview);
    setBarReviewEpoch((revision) => revision + 1);
    barReviewMemory.current = new Map((returnTo.barReviews ?? (returnTo.barReview ? [returnTo.barReview] : []))
      .map((review) => [JSON.stringify([review.contentId, review.id]), review]));
    setFiltersOpen(returnTo.filtersOpen ?? false);
    setVisitFrom(returnTo.visitFrom);
    setCalendarRestore(returnTo.calendar);
    setCalendarRevision((value) => value + 1);
    setReturnTo(null);
  };
  useLayoutEffect(() => {
    if (!returnFocus.current || loading) return;
    returnFocus.current = false;
    if (!document.hasFocus()) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.id !== "history-title") return;
    const heading = document.getElementById("history-title");
    if ([...document.querySelectorAll('[role="dialog"]')].some((node) => node.getClientRects().length && !node.contains(heading))) return;
    const row = heading?.closest('[role="region"], [role="dialog"]')?.querySelector<HTMLElement>(".history-record.selected:not(:disabled)");
    const detailHeading = panes.root.current?.querySelector<HTMLElement>("[data-browse-detail-heading]");
    (row?.getClientRects().length ? row : detailHeading?.getClientRects().length ? detailHeading : heading)?.focus({ preventScroll: true });
  }, [loading, browser.list.current, browser.listKey]);
  useEffect(() => {
    navigationLockChanged?.(navigationBlocked);
    return () => navigationLockChanged?.(false);
  }, [navigationBlocked, navigationLockChanged]);
  return (
    <div
      className={presentation === "workspace" ? "workspace-page" : "modal-backdrop"}
      onClick={() => {
        if (presentation === "workspace") return;
        if (!navigationBlocked) close();
      }}
    >
      <section
        ref={panes.attach}
        className="settings-dialog history-dialog history-workspace"
        data-browse-compact={panes.compact ? "" : undefined}
        data-browse-pane={panes.pane}
        role={presentation === "workspace" ? "region" : "dialog"}
        aria-modal={presentation === "dialog" ? true : undefined}
        aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2 id="history-title" tabIndex={-1} className="workspace-page-title">练习历史</h2>
          <span className="menu-spacer" />
          <button disabled={navigationBlocked} onClick={backup}>
            练习资料备份
          </button>
          <button
            autoFocus={presentation === "dialog"}
            disabled={navigationBlocked}
            onClick={close}
            aria-label={presentation === "workspace" ? "返回练习" : "关闭练习历史"}
            data-workspace-close={presentation === "workspace" ? "" : undefined}
          >
            {presentation === "workspace" ? "返回练习" : "关闭"}
          </button>
        </div>
        {(browser.song || currentSong && presentation === "dialog") && <div className="song-workspace-context" role="status">
          <div><span className="song-workspace-eyebrow">{browser.song ? "曲目历史" : "当前练习"}</span>
            <strong>{(browser.song ?? currentSong)!.title}</strong>
            <span>{browser.song ? "按曲目内容查找，包含同一内容的其他文件位置。" : "查看这首曲目已保存的全部练习记录。"}</span>
          </div>
          <div className="song-workspace-actions">
            {browser.song && visitFrom && visitFrom !== "review" && backToSource && <button disabled={navigationBlocked}
              onClick={() => { void backToSource(visitFrom); }}>返回{visitFrom === "library" ? "曲库" : "练习"}</button>}
            {currentSong && browser.song?.contentId !== currentSong.contentId && <button disabled={navigationBlocked}
              onClick={() => visitSong(currentSong)}>只看当前练习曲目</button>}
            {returnTo && <button disabled={navigationBlocked} onClick={restoreVisit}>返回原来的历史列表</button>}
            {browser.song && !returnTo && <button disabled={navigationBlocked} onClick={() => browser.restoreBrowse({
              filters: { ...historyFilters }, offset: 0, selected: null, order, listTop: 0, detailTop: 0,
            })}>查看全部曲目历史</button>}
          </div>
        </div>}
        {busy ? <TaskActivity contentId={detail?.contentId} /> : <HistoryTaskActivity />}
        <HistoryAnnotationDrafts drafts={annotationDrafts} blocked={navigationBlocked}
          editingKey={detail ? JSON.stringify([detail.contentId, detail.id]) : null}
          open={(entry) => { listNavigation.cancel(); setSelected(entry); setDetailSection("annotation"); panes.showDetails(); browser.detail.refresh(); }} />
        {sourceStorageError && <div className="workspace-read-error" role="status">
          <div><p>复习来源列表暂存失败：{sourceStorageError}</p><p>当前列表已保留在本次会话中，重启前请保存复习编排。</p>
            {sourceCopyNotice && <p>{sourceCopyNotice}</p>}</div>
          <button onClick={() => setSourceStorageRevision((value) => value + 1)}>重试暂存来源</button>
          {originalReviewSources() !== null && <>
            <button onClick={() => {
              const raw = originalReviewSources(); if (raw === null) return;
              void navigator.clipboard.writeText(raw).then(() => setSourceCopyNotice("旧来源列表原文已复制。"))
                .catch(() => setSourceCopyNotice("复制失败，请重试。"));
            }}>复制旧列表原文</button>
            <button disabled={navigationBlocked} onClick={() => {
              replaceSources.current = true; setSourceStorageRevision((value) => value + 1);
            }}>用当前来源替换旧列表</button>
          </>}
        </div>}
        <div className="browse-controls" hidden={!panes.listVisible}>
        <HistoryMultiProblemPlan
          key={engineId ?? "legacy"}
          sources={sources}
          remove={(id, cid) =>
            setSources((old) =>
              old.filter((s) => s.id !== id || s.contentId !== cid),
            )
          }
          openPlan={openPlan}
          dirtyChanged={setMultiDirty}
          draftBlockedChanged={setDraftBlocked}
        />
        <PracticeCalendar
          engineId={engineId}
          active={panes.listVisible}
          key={calendarRevision}
          initialBrowse={calendarRestore}
          rememberBrowse={(calendar) => {
            browsing.current = { ...browsing.current, calendar };
            rememberBrowse?.(browsing.current);
          }}
          song={browser.song}
          readCache={browser.calendars}
          initiallyOpen={presentation !== "workspace"}
          selected={filters.from}
          disabled={navigationBlocked}
          choose={(range) =>
            changeFilter({
              from: range?.from ?? null,
              to: range?.to ?? null,
              days: 0,
            })
          }
        />
        <BrowseControls compact={panes.compact} expanded={filtersOpen} toggle={() => setFiltersOpen((old) => !old)}
          activeCount={filterChips.filter((chip) => chip.id !== "query").length} label="查找历史曲目" query={filters.query}
          placeholder="曲名、路径或评语" disabled={navigationBlocked} change={(query) => changeFilter({ query })}>
          {presentation === "workspace" && currentSong && !browser.song && <button type="button" onClick={() => visitSong(currentSong)}>只看当前练习曲目</button>}
          <select
            disabled={navigationBlocked}
            aria-label="历史练习模式"
            value={filters.mode}
            onChange={(e) => changeFilter({ mode: e.target.value })}
          >
            <option value="">全部模式</option>
            {["wait", "flow", "recital", "memory", "listen"].map((m) => (
              <option key={m} value={m}>
                {modeName(m)}
              </option>
            ))}
          </select>
          <select
            disabled={navigationBlocked}
            aria-label="历史练习手别"
            value={filters.hands}
            onChange={(e) => changeFilter({ hands: e.target.value })}
          >
            <option value="">全部手别</option>
            {["Both", "Left", "Right", "Custom", "Unspecified"].map((h) => (
              <option key={h} value={h}>
                {handName(h)}
              </option>
            ))}
          </select>
          <select
            disabled={navigationBlocked}
            aria-label="历史练习范围"
            value={filters.range}
            onChange={(e) => changeFilter({ range: e.target.value })}
          >
            <option value="">全部范围</option>
            <option value="whole">全曲</option>
            <option value="loop">选段</option>
          </select>
          <select
            disabled={navigationBlocked}
            aria-label="历史日期范围"
            value={filters.days}
            onChange={(e) =>
              changeFilter({
                days: Number(e.target.value),
                from: null,
                to: null,
              })
            }
          >
            <option value="0">全部日期</option>
            <option value="1">最近 24 小时</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
          </select>
        </BrowseControls>
        <BrowseFilterChips chips={filterChips} reset={clearFilters} disabled={navigationBlocked} />
        <details className="history-comparison-help"><summary>筛选与同条件比较的说明</summary>
        <p className="history-filter-help">上方选项只筛选记录列表。选中成绩后的“同条件比较”会核对保存时的曲目内容、小节与音符、练习范围、音轨、弹法、速度、判断数和设备设置；搜索词与日期筛选不会改变比较结果。</p>
        </details>
        </div>
        {draftBlocked && <div className="workspace-read-error" role="alert"><span>复习编排草稿尚未安全保留。请打开“跨记录复习编排”，重试暂存或复制草稿后再离开。</span></div>}
        <WorkspaceReadStatus compact label="记录列表" pending={loading} error={listError}
          hasData={!!browser.page} current={browser.list.current} readAt={browser.page ? browser.list.readAt : null}
          disabled={navigationBlocked} retry={browser.list.refresh} />
        {selected && !loading && !listError && !entries.some((entry) => entry.id === selected.id && entry.contentId === selected.contentId) &&
          <div className="workspace-selection-note" role="status"><span>正在查看当前列表之外的一次成绩，列表筛选保持原样。</span>
            <button disabled={navigationBlocked} onClick={() => setSelected(null)}>取消这次选择</button>
          </div>}
        {browser.selection && !selected && (
          <div className="workspace-selection-note" role="status"><span>{detailLoading ? "正在读取上次选中的成绩…" : "已保留上次选择，可重新读取或选择其他成绩。"}</span>
            <button disabled={navigationBlocked || detailLoading} onClick={() => browser.detail.refresh()}>重新读取</button>
            <button disabled={navigationBlocked} onClick={() => { setSelected(null); panes.showList(); }}>取消选择</button>
          </div>
        )}
        <HistoryOperationRecovery actions={actions} contentId={selected?.contentId} historyId={selected?.id} />
        {error && (
          <div className="history-error" role="alert"><p>{error}</p>{actions.sourceIssue && selected && <button disabled={busy || actions.dismissDisabled} onClick={() => {
            actions.dismissPrepared(); browser.detail.refresh();
            const target = selected;
            if (detail?.performanceAvailable) void getPerformanceArchive(target.contentId, target.id, engineId).load();
          }}>重新读取原记录与演奏</button>}</div>
        )}
        <BrowsePaneNavigation compact={panes.compact} pane={panes.pane} title={selected?.title ?? (browser.selection ? detailLoading ? "正在读取上次选择…" : "上次选择待读取" : undefined)}
          available={!!browser.selection} blocked={busy} listLabel="记录列表" detailLabel="演奏详情"
          neighbors={{ position: loading ? "正在读取记录列表…" : listError ? "记录列表读取失败" : listNavigation.selectedIndex >= 0 ? `第 ${offset + listNavigation.selectedIndex + 1} / ${total} 条` : "当前记录不在筛选列表中",
            previousLabel: "上一条", nextLabel: "下一条", canPrevious: !navigationBlocked && listNavigation.canPrevious, canNext: !navigationBlocked && listNavigation.canNext,
            previous: () => listNavigation.step(-1), next: () => listNavigation.step(1) }}
          showList={() => { listNavigation.cancel(); panes.showList(); }} showDetails={() => panes.showDetails()} />
        <div className={`history-split browse-split${panes.compact ? " browse-compact" : ""}`}>
          <div className="history-records" hidden={!panes.listVisible} aria-busy={loading}>
            <BrowsePagination page={Math.floor(offset / 50)} total={total} label="记录" unit="条"
              pending={loading} known={browser.list.current && !!browser.page}
              disabled={navigationBlocked || !!listError || !browser.list.verified}
              change={(page) => { listNavigation.cancel(); setOffset(page * 50); }} />
            <div {...listScroll} className="history-list" role="group" aria-label="练习记录"
              onKeyDown={listNavigation.onKeyDown} onBlurCapture={listNavigation.onBlurCapture}>
              {!entries.length ? loading ? <BrowseListState kind="loading" title="正在读取练习记录" detail="读取期间保留原来的筛选和演奏详情。" />
                : listError ? <BrowseListState kind="failed" title="练习记录读取失败" detail="原有筛选与选择已保留，可以重新读取。">
                    <button disabled={navigationBlocked} onClick={browser.list.refresh}>重新读取记录</button>
                  </BrowseListState>
                : <BrowseListState kind={filterChips.length ? "filtered" : "empty"}
                    title={filterChips.length ? "当前筛选下没有记录" : browser.song ? "这首曲目还没有练习记录" : "从今天的第一轮练习开始"}
                    detail={filterChips.length ? "可以清除筛选后查看已保存的成绩。" : "完成并保存一轮练习后，可以在这里查看成绩、回放和逐小节反馈。"}>
                  {filterChips.length ? <button disabled={navigationBlocked} onClick={clearFilters}>{browser.song ? "清除筛选，查看本曲全部记录" : "清除筛选，查看全部记录"}</button>
                    : <button disabled={navigationBlocked} onClick={close}>返回练习</button>}
                  {returnTo && <button disabled={navigationBlocked} onClick={restoreVisit}>返回原来的历史列表</button>}
                </BrowseListState> : (
                entries.map((e) => (
                  <button
                    {...listNavigation.row(e)}
                    className={`history-record ${selected?.id === e.id && selected.contentId === e.contentId ? "selected" : ""}`}
                    key={`${e.contentId}-${e.id}`}
                    disabled={navigationBlocked || !browser.list.verified}
                    data-browse-selected={selected?.id === e.id && selected.contentId === e.contentId ? "true" : undefined}
                    onClick={() => { listNavigation.choose(e); if (panes.compact) panes.showDetails(); }}
                    onKeyDown={(event) => {
                      if (panes.compact && event.key === "ArrowRight" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault(); listNavigation.choose(e); panes.showDetails();
                      }
                    }}
                  >
                    <span className="history-record-title">
                      <strong>
                        {e.title}
                        {e.annotation &&
                          [
                            e.annotation.note,
                            e.annotation.teacher,
                            e.annotation.next,
                          ].some(Boolean) && (
                            <small className="history-note-mark">
                              {" "}
                              · 有评语
                            </small>
                          )}
                      </strong>
                      <b>{percent(accuracy(e.score))}</b>
                    </span>
                    <span>
                      {date(e.recordedAt)} ·{" "}
                      {e.playingMs != null
                        ? practiceDuration(e.playingMs)
                        : "旧记录未计时"}{" "}
                      ·{" "}
                      {e.coverage &&
                      e.coverage.target > 0 &&
                      e.coverage.judged < e.coverage.target
                        ? "部分结果"
                        : ""}
                    </span>
                    <span>
                      {rangeName(e)} · {modeName(e.mode)} · {handName(e.hands)}{" "}
                      · {Math.round(e.speed * 100)}%
                    </span>
                  </button>
                ))
              )}
            </div>
            <p className="parameter-help">
              每首曲目保留最近 200 次已保存结果。循环按轮保存。
            </p>
            <details className="history-list-keyboard-help">
              <summary>键盘浏览记录</summary>
              <p>↑ / ↓ 切换本页记录；Page Up / Page Down 翻页并保留所在行。Home / End 定位本页首尾，Ctrl + Home / End 定位整个列表的首尾。</p>
              <p>Tab 移到下一组操作。小窗口可用 → 打开详情，Escape 返回列表。翻页读取期间保留当前演奏详情。</p>
            </details>
          </div>
          <div
            {...detailScroll}
            className="history-detail"
            hidden={!panes.detailVisible}
            aria-busy={detailLoading}
          >
            {detail ? (
              <BrowseDetailWorkspace<HistoryDetailSection>
                value={detailSection}
                change={setDetailSection}
                label="演奏详情分类"
                header={
                  <>
                    <h3
                      className="browse-detail-heading"
                      title={detail.title}
                      tabIndex={-1}
                      data-browse-detail-heading
                    >
                      {detail.title}
                    </h3>
                    <p className="browse-detail-subtitle">
                      {date(detail.recordedAt)} · {rangeName(detail)}
                      <br />
                      {modeName(detail.mode)} · {handName(detail.hands)} ·{" "}
                      {Math.round(detail.speed * 100)}%
                      {detail.tempo != null ? ` · ${detail.tempo} BPM` : ""}
                    </p>
                    {selected && (
                      <WorkspaceReadStatus
                        compact
                        label="演奏详情"
                        pending={detailLoading}
                        error={detailError}
                        hasData={!!detail}
                        readAt={browser.detail.current ? browser.detail.readAt : null}
                        disabled={navigationBlocked}
                        retry={browser.detail.refresh}
                      />
                    )}
                    <div className="browse-detail-actions">
                      <button
                        className="primary"
                        disabled={detailActionsBlocked || !detail.restorable}
                        title={
                          !detail.restorable
                            ? "当前记录暂时无法精确恢复，可尝试打开曲目。"
                            : undefined
                        }
                        onClick={() => void open(true)}
                      >
                        {busy ? actions.busyLabel : "恢复这次练习"}
                      </button>
                      <button
                        disabled={detailActionsBlocked}
                        onClick={() => void open(false)}
                      >
                        打开曲目
                      </button>
                      <ToolbarMore label="更多操作" disabled={detailActionsBlocked}>
                        {locateSong && (
                          <button
                            onClick={() => {
                              void locateSong({
                                contentId: detail.contentId,
                                title: detail.title,
                                path: detail.path,
                              });
                            }}
                          >
                            在曲库定位
                          </button>
                        )}
                        <button
                          disabled={
                            detailActionsBlocked ||
                            !detail.performanceAvailable ||
                            sources.length >= 20 ||
                            sources.some(
                              (s) =>
                                s.id === detail.id && s.contentId === detail.contentId,
                            )
                          }
                          onClick={() =>
                            setSources((old) => {
                              if (
                                old.length >= 20 ||
                                old.some(
                                  (source) =>
                                    source.id === detail.id &&
                                    source.contentId === detail.contentId,
                                )
                              )
                                return old;
                              const occupied = new Set(
                                old.map((source) => source.slot),
                              );
                              let slot = 0;
                              while (occupied.has(slot)) slot++;
                              return [
                                ...old,
                                {
                                  contentId: detail.contentId,
                                  id: detail.id,
                                  title: detail.title,
                                  recordedAt: detail.recordedAt,
                                  slot,
                                },
                              ];
                            })
                          }
                        >
                          {sources.some(
                            (item) =>
                              item.id === detail.id &&
                              item.contentId === detail.contentId,
                          )
                            ? "已加入复习编排"
                            : "加入复习编排"}
                        </button>
                      </ToolbarMore>
                    </div>
                    {notesDirty && (
                      <p className="browse-detail-note">
                        这条记录的备注尚未保存。
                        <button
                          className="browse-detail-inline-action"
                          onClick={() => setDetailSection("annotation")}
                        >
                          继续编辑备注
                        </button>
                      </p>
                    )}
                  </>
                }
                sections={[
                  {
                    id: "results",
                    label: "成绩与小节",
                    content: (
                      <>
                        <HistoryResultSummary detail={detail} />
                        <HistoryBarResults
                          key={`bars:${engineId ?? "legacy"}:${detail.contentId}:${detail.id}:${barReviewEpoch}`}
                          detail={detail}
                          order={order}
                          changeOrder={setOrder}
                          initial={
                            barReviewMemory.current.get(
                              JSON.stringify([detail.contentId, detail.id]),
                            ) ?? barReview
                          }
                          remember={rememberBarReview}
                          busy={busy}
                          practiceBlocked={detailActionsBlocked || !detail.restorable}
                          practice={(measure) => {
                            void open(true, measure);
                          }}
                        />
                      </>
                    ),
                  },
                  {
                    id: "performance",
                    label: "演奏回放",
                    content: (
                      <>
                        <HistoryPerformance
                          engineId={engineId}
                          title={detail.title}
                          key={`performance:${engineId ?? "legacy"}:${detail.contentId}:${detail.id}`}
                          embedded
                          visible={
                            detailSection === "performance" && panes.detailVisible
                          }
                          contentId={detail.contentId}
                          id={detail.id}
                          goalThreshold={
                            detail.context?.routine?.expression
                              ?.note_velocity_difference ??
                            detail.context?.expression?.note_velocity_difference
                          }
                          available={!!detail.performanceAvailable}
                          review={reviewScore}
                          practice={practicePerformance}
                          blocked={detailActionsBlocked}
                          practiceBlocked={!detail.restorable}
                        />
                      </>
                    ),
                  },
                  {
                    id: "comparison",
                    label: "条件与趋势",
                    content: (
                      <HistoryComparison
                        detail={detail}
                        blocked={navigationBlocked}
                        select={(entry) => {
                          listNavigation.cancel();
                          setSelected(entry);
                          setDetailSection("results");
                        }}
                      />
                    ),
                  },
                  {
                    id: "annotation",
                    label: "评语",
                    content: (
                      <>
                        <HistoryAnnotationEditor
                          key={`${detail.contentId}:${detail.id}`}
                          value={detail.annotation}
                          engineId={engineId}
                          active={detailSection === "annotation"}
                          received={(annotation) => { if (connection.current === engineId) browser.annotationCurrent({ contentId: detail.contentId, id: detail.id, annotation }); }}
                          entry={annotationEntry(detail)}
                          draftMemory={annotationDrafts}
                          readLatest={
                            annotationDrafts
                              ? () => browser.detail.refresh()
                              : undefined
                          }
                          draftKey={JSON.stringify([detail.contentId, detail.id])}
                          locked={busy}
                          saveBlocked={!browser.detail.verified}
                          reading={detailLoading}
                          onLocked={setNotesDirty}
                          save={async (draft, expected, originEngine) => {
                            if (connection.current !== engineId)
                              throw new Error(
                                "连接已改变，请重新读取这条记录后再保存评语。",
                              );
                            const updated = await api.saveHistoryAnnotation({
                              engineId: originEngine ?? engineId,
                              contentId: detail.contentId,
                              id: detail.id,
                              ...draft,
                              expected,
                            });
                            if (connection.current !== engineId)
                              throw new Error(
                                "保存返回来自上次连接，当前输入继续保留。请重新读取评语，核对保存结果。",
                              );
                            if (
                              updated.contentId !== detail.contentId ||
                              updated.id !== detail.id
                            )
                              throw new Error(
                                "保存返回与所选记录不一致，当前评语输入继续保留。",
                              );
                            browser.annotationSaved(updated);
                            return updated.annotation;
                          }}
                        />
                      </>
                    ),
                  },
                ]}
              />
            ) : (
              <>
                <h3
                  className="browse-detail-heading"
                  tabIndex={-1}
                  data-browse-detail-heading
                >
                  {selected?.title ?? "演奏详情"}
                </h3>
                {browser.selection && (
                  <WorkspaceReadStatus
                    compact
                    label="演奏详情"
                    pending={detailLoading}
                    error={detailError}
                    hasData={!!detail}
                    readAt={browser.detail.current ? browser.detail.readAt : null}
                    disabled={navigationBlocked}
                    retry={browser.detail.refresh}
                  />
                )}
                <div className="browse-detail-empty">
                  <strong>
                    {detailLoading
                      ? "正在读取演奏详情"
                      : browser.selection
                        ? "详情暂时无法读取"
                        : "选择一次练习"}
                  </strong>
                  <span>
                    {browser.selection
                      ? "可以重新读取，或选择其他练习记录。"
                      : "查看成绩、逐小节反馈与回放，再决定下一轮怎么练。"}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
