import { annotationEntry } from "./annotationDraft";
import { requireHistorySource } from "./historySource";
import { shareWireValue } from "../../engine/wireValues";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReadCache } from "../../engine/readCache";
import { useCachedRead } from "../../engine/useCachedRead";
import { useHistoryRead } from "../../engine/useHistoryRead";
import {
  historyFilters,
  type HistoryBrowse,
  type HistoryFilters,
  type HistorySelection,
} from "./historyBrowse";
import type {
  Annotation,
  HistoryEntry,
  HistoryDetail,
  HistoryAnnotationSaved,
  PracticeCalendarData,
} from "./historyTypes";
export type HistoryPage = import("../../engine/commands.generated").HistoryPage;
export const createHistoryCache = () => ({
  listPositions: new Map<string, number>(),
  detailPositions: new Map<string, number>(),
  lists: new ReadCache<HistoryPage>(16),
  details: new ReadCache<HistoryDetail>(8),
  calendars: new ReadCache<PracticeCalendarData>(8),
});
export type HistoryCache = ReturnType<typeof createHistoryCache>;
const queryKey = (
  filters: HistoryFilters,
  offset: number,
  contentId?: string,
) =>
  JSON.stringify([
    contentId ?? null,
    filters.query,
    filters.mode,
    filters.hands,
    filters.range,
    filters.days,
    filters.from,
    filters.to,
    offset,
  ]);
export function useHistoryBrowser(
  initial: HistoryBrowse | undefined,
  supplied?: HistoryCache,
  engineId?: string,
) {
  const own = useMemo(createHistoryCache, []),
    cache = supplied ?? own;
  const listReads = useHistoryRead(engineId),
    detailReads = useHistoryRead(engineId);
  const [filters, setFilters] = useState<HistoryFilters>(
    () => initial?.filters ?? { ...historyFilters },
  );
  const [offset, setOffset] = useState(initial?.offset ?? 0);
  const [selected, commitSelected] = useState<HistoryEntry | null>(
    initial?.selected ?? null,
  );
  const [selection, commitSelection] = useState<HistorySelection | null>(() =>
    initial?.selected
      ? { contentId: initial.selected.contentId, id: initial.selected.id }
      : (initial?.selection ?? null),
  );
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const select = useCallback(
    (entry: HistoryEntry | null, retained?: HistorySelection | null) => {
      const pointer = entry
        ? { contentId: entry.contentId, id: entry.id }
        : (retained ?? null);
      selectionRef.current = pointer;
      commitSelection((old) =>
        old?.contentId === pointer?.contentId && old?.id === pointer?.id
          ? old
          : pointer,
      );
      commitSelected(entry);
    },
    [],
  );
  const setSelected = useCallback(
    (entry: HistoryEntry | null) => select(entry),
    [select],
  );
  const [song, setSong] = useState(initial?.song ?? null);
  const annotations = useRef(
    new Map<string, { generation: number; annotation: Annotation | null }>(),
  );
  const annotationGeneration = useRef(0);
  useEffect(() => {
    annotations.current.clear();
  }, [engineId]);
  const overlayAnnotation = <T extends HistoryEntry>(
    entry: T,
    started: number,
  ): T => {
    const update = annotations.current.get(
      JSON.stringify([entry.contentId, entry.id]),
    );
    return update && update.generation > started
      ? { ...entry, annotation: update.annotation }
      : entry;
  };
  const listKey = queryKey(filters, offset, song?.contentId);
  const list = useCachedRead({
    cache: cache.lists,
    key: listKey,
    scope: engineId,
    delay: 180,
    load: async (signal) => {
      const started = annotationGeneration.current;
      const read = song
        ? listReads.request(
            {
              type: "readHistoryPage",
              request: {
                ...filters,
                contentId: song.contentId,
                offset,
                limit: 50,
              },
            },
            signal,
          )
        : listReads.request<HistoryPage>(
            {
              type: "historyQuery",
              ...filters,
              offset,
              limit: 50,
            },
            signal,
          );
      const data = await read.result.catch((failure: unknown) => {
        const message =
          failure instanceof Error ? failure.message : String(failure);
        if (
          song &&
          /unknown variant[^\n]*readHistoryPage|readHistoryPage[^\n]*not supported/i.test(
            message,
          )
        )
          throw new Error(
            "当前音乐服务尚不支持按曲目内容查看历史。请重启到与界面匹配的版本后重试。",
          );
        throw failure;
      });
      if (data.offset !== offset)
        throw new Error("历史列表页码与请求不一致，请重新读取");
      if (
        song &&
        (data.contentId !== song.contentId ||
          data.entries.some((entry) => entry.contentId !== song.contentId))
      )
        throw new Error("历史列表与所选曲目不一致，请重新读取");
      return {
        ...data,
        entries: data.entries.map((entry) => overlayAnnotation(entry, started)),
      };
    },
  });
  useEffect(() => {
    if (!list.verified || !list.current || !list.value) return;
    const last = Math.max(0, Math.floor((list.value.total - 1) / 50) * 50);
    if (offset > last) setOffset(last);
  }, [list.verified, list.current, list.value, offset]);
  const detailKey = selection
    ? JSON.stringify([selection.contentId, selection.id])
    : "";
  const detail = useCachedRead({
    cache: cache.details,
    key: detailKey,
    scope: engineId,
    enabled: !!selection,
    delay: 100,
    load: async (signal) => {
      const started = annotationGeneration.current;
      const data = await detailReads.request<HistoryDetail>(
        {
          type: "readHistoryDetail",
          content_id: selection!.contentId,
          id: selection!.id,
        },
        signal,
      ).result;
      if (data.id !== selection!.id || data.contentId !== selection!.contentId)
        throw new Error("演奏详情与所选记录不一致，请重新读取");
      requireHistorySource(data.source, data.contentId, data.id);
      return overlayAnnotation(data, started);
    },
  });
  useEffect(() => {
    if (!detail.verified || !detail.current || !detail.value) return;
    const header = annotationEntry(detail.value);
    commitSelected((previous) =>
      selectionRef.current?.id === header.id &&
      selectionRef.current.contentId === header.contentId
        ? previous
          ? shareWireValue(previous, header)
          : header
        : previous,
    );
  }, [detail.verified, detail.current, detail.value]);
  // Retained rows may belong to a previous query while a new read is pending.
  // A piece-specific page must never offer another piece's rows as its results.
  const page =
    list.value &&
    (song ? list.value.contentId === song.contentId : !list.value.contentId)
      ? list.value
      : null;
  const annotationCurrent = (saved: {
    contentId: string;
    id: string;
    annotation: Annotation | null;
  }) => {
    const key = JSON.stringify([saved.contentId, saved.id]);
    const cached = cache.details.get(key);
    const previous = cached
      ? cached.value.annotation
      : annotations.current.get(key)?.annotation;
    if (
      previous !== undefined &&
      shareWireValue(previous, saved.annotation) === previous
    )
      return;
    annotations.current.set(key, {
      generation: ++annotationGeneration.current,
      annotation: saved.annotation,
    });
    while (annotations.current.size > 512)
      annotations.current.delete(annotations.current.keys().next().value!);
    const matches = (entry: HistoryEntry) =>
      entry.contentId === saved.contentId && entry.id === saved.id;
    const annotate = <T extends HistoryEntry>(entry: T): T =>
      matches(entry) ? { ...entry, annotation: saved.annotation } : entry;
    detail.patch(annotate);
    list.patch((page) => ({ ...page, entries: page.entries.map(annotate) }));
    commitSelected((current) => (current ? annotate(current) : current));
    if (filters.query.trim()) {
      listReads.invalidate();
      list.refresh();
    }
  };
  return {
    listPositions: cache.listPositions,
    detailPositions: cache.detailPositions,
    calendars: cache.calendars,
    filters,
    song,
    offset,
    setOffset,
    selected,
    selection,
    setSelected,
    listKey,
    detailKey,
    list,
    detail,
    entries: page?.entries ?? [],
    total: page?.total ?? 0,
    page,
    // A detail from a different record is never displayed as the new selection.
    currentDetail: detail.current ? detail.value : null,
    changeFilter: (patch: Partial<HistoryFilters>) => {
      setFilters((current) => ({ ...current, ...patch }));
      setOffset(0);
    },
    visitSong: (target: NonNullable<HistoryBrowse["song"]>) => {
      setSong(target);
      setFilters({ ...historyFilters });
      setOffset(0);
      setSelected(null);
    },
    restoreBrowse: (browse: Omit<HistoryBrowse, "sources" | "returnTo">) => {
      const listPositionKey = queryKey(
        browse.filters,
        browse.offset,
        browse.song?.contentId,
      );
      cache.listPositions.set(
        listPositionKey,
        !browse.listTopKey || browse.listTopKey === listPositionKey
          ? browse.listTop
          : 0,
      );
      const pointer = browse.selected ?? browse.selection;
      if (pointer) {
        const base = JSON.stringify([pointer.contentId, pointer.id]);
        const detailPositionKey =
          browse.detailSection && browse.detailSection !== "results"
            ? `${base}:${browse.detailSection}`
            : base;
        cache.detailPositions.set(
          detailPositionKey,
          !browse.detailTopKey || browse.detailTopKey === detailPositionKey
            ? browse.detailTop
            : 0,
        );
      }
      setSong(browse.song ?? null);
      setFilters(browse.filters);
      setOffset(browse.offset);
      select(browse.selected, browse.selection);
    },
    annotationSaved: (saved: HistoryAnnotationSaved) =>
      annotationCurrent(saved),
    annotationCurrent,
  };
}
