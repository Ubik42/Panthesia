import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { paperViewSession } from "./paperViewStore";
import {
  paperLocationSession,
  paperLocationDraftId,
  samePaperAnchor,
  samePaperRegion,
  type PaperLocationDraft,
} from "./paperLocationDraftStore";
import { PaperPagePicker } from "./PaperPagePicker";
import { createPaperRasterCache } from "./paperRasterCache";
import { PaperLocationDrafts } from "./PaperLocationDrafts";
import { PaperReadingFeedback } from "./PaperReadingFeedback";
import { TaskActivity } from "../../engine/TaskActivity";
import {
  paperNoteIndex,
  paperNoteKey,
  markedPaperNotes,
  nextUnmarkedPaperNote,
  paperAnchorAt,
  paperAnchorIndex,
} from "./paperNavigationIndex";
import { PaperAnnotationNavigator } from "./PaperAnnotationNavigator";
import { PaperListPager } from "./PaperListPager";
import { usePaperNavigator } from "./usePaperNavigator";
import {
  PaperMeasureRegions,
  PaperNoteRegions,
} from "./PaperNavigationRegions";
import { api, pitchName, type LoadedSong, type Note } from "../../api";
import { usePaperExport } from "./usePaperExport";
import { PaperExportFeedback } from "./PaperExportFeedback";
import { PaperPracticeBuilder } from "../../PaperPracticeBuilder";
import type {
  PaperView,
  PaperAttachment,
  PaperMapping,
  PaperNoteAnchor,
  PracticeContext,
  PageAnchor,
} from "./paperTypes";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  PaperAnnotations,
  paperAnnotationBox,
  type PaperRegion,
  type PaperAnnotation,
  type PaperAnnotationDraft,
} from "../../PaperAnnotations";
import "../../paper-navigation.css";
import "../../paper-note-regions.css";
import "./scoreConversion.css";
import "./paperReaderWorkspace.css";
const noReadingSubscription = () => () => {};
const noReadingState = () => null;

export function PaperReader({
  contentId,
  attachment,
  disabled,
  manage,
  update,
  onViewSaved,
  practice,
  song,
  playback,
  saveMapping,
  saveNoteAnchor,
  saveAnnotation,
  saveInk,
  previewKind,
  readOnly = false,
  onPageCount,
  engineId,
}: {
  contentId: string;
  engineId?: string;
  previewKind?: string;
  readOnly?: boolean;
  onPageCount?: (count: number) => void;
  attachment: PaperAttachment;
  disabled: boolean;
  manage: boolean;
  update: (
    action: string,
    extra: Record<string, unknown>,
  ) => Promise<void | boolean>;
  onViewSaved?: () => void;
  practice: PracticeContext | null;
  song?: LoadedSong | null;
  playback?: { measure: number };
  saveMapping: (mapping: PaperMapping | null) => Promise<void | boolean>;
  saveNoteAnchor?: (
    track: number,
    index: number,
    draft: Pick<
      PaperNoteAnchor,
      "pitch" | "measure" | "assetId" | "page" | "region"
    > | null,
    expected: PaperNoteAnchor | null,
  ) => Promise<void | boolean>;
  saveInk?: (
    assetId: string,
    page: number,
    expected: PaperAnnotation[],
    strokes: PaperAnnotation[],
  ) => Promise<boolean>;
  saveAnnotation: (
    id: string | null,
    draft: PaperAnnotationDraft | null,
    expected: PaperAnnotation | null,
  ) => Promise<boolean>;
}) {
  const locationSession = useMemo(
    () => paperLocationSession(contentId, attachment.id),
    [contentId, attachment.id],
  );
  const locationDrafts = useSyncExternalStore(
    locationSession.subscribe,
    locationSession.getSnapshot,
  );
  const initialForm = useRef(
    readOnly || previewKind ? null : locationSession.getSnapshot().form,
  );
  const toolsId = useId();
  const [toolsOpen, setToolsOpen] = useState(
    initialForm.current?.toolsOpen ??
      (!!initialForm.current?.mappingOpen ||
        !!initialForm.current?.noteOpen ||
        (!readOnly &&
          !previewKind &&
          locationSession.getSnapshot().drafts.length > 0)),
  );
  const toolsRoot = useRef<HTMLElement>(null),
    focusSequence = useRef(0),
    handledFocus = useRef(0);
  const [editorFocus, setEditorFocus] = useState<{
    kind: "measure" | "note";
    request: number;
  } | null>(null);
  const focusEditor = (kind: "measure" | "note") =>
    setEditorFocus({ kind, request: ++focusSequence.current });
  const [anchorText, setAnchorText] = useState(
    initialForm.current?.anchorText ?? String(practice?.measure || 1),
  );
  const [noteText, setNoteText] = useState(
    initialForm.current?.noteText ?? String(practice?.measure || 1),
  );
  const [activeMeasureDraft, setActiveMeasureDraft] = useState<string | null>(
    null,
  );
  const [activeNoteDraft, setActiveNoteDraft] = useState<string | null>(null);
  const [locationSaveNotice, setLocationSaveNotice] = useState("");
  const [resourceRevision, setResourceRevision] = useState(0);
  const [annotationEditing, setAnnotationEditing] = useState(false),
    [annotationNotice, setAnnotationNotice] = useState(""),
    [sheetSize, setSheetSize] = useState({ width: 1, height: 1 });
  const [locationNotice, setLocationNotice] = useState("");
  const [renderedPage, setRenderedPage] = useState(0);
  const [suspended, setSuspended] = useState(false),
    [followPending, setFollowPending] = useState<boolean | null>(null);
  const anchorMeasure = anchorText.trim() ? Number(anchorText) : NaN;
  const setAnchorMeasure = (measure: number) => {
    setAnchorText(String(measure));
    setAnchorRegion(null);
    setActiveMeasureDraft(null);
  };
  const [anchorRegion, setAnchorRegion] = useState<PaperRegion | null>(null),
    [anchorRegionPage, setAnchorRegionPage] = useState(attachment.view.page),
    [selectingRegion, setSelectingRegion] = useState(false);
  const noteMeasure = noteText.trim() ? Number(noteText) : NaN;
  const setNoteMeasure = (measure: number) => {
    setNoteText(String(measure));
    setNoteRegion(null);
    setActiveNoteDraft(null);
  };
  const [noteKey, setNoteKey] = useState(initialForm.current?.noteKey ?? "");
  const [noteRegion, setNoteRegion] = useState<PaperRegion | null>(null);
  const [noteRegionPage, setNoteRegionPage] = useState(attachment.view.page);
  const [noteEditorOpen, setNoteEditorOpen] = useState(
    initialForm.current?.noteOpen ?? false,
  );
  const [selectingNoteRegion, setSelectingNoteRegion] = useState(false);
  const [noteSeekBusy, setNoteSeekBusy] = useState(false);
  const navigator = usePaperNavigator(
    contentId,
    attachment.id,
    engineId,
    JSON.stringify([practice?.grid, practice?.scoreRevision]),
  );
  useEffect(() => {
    setNoteSeekBusy(false);
    setNoteSeekNotice("");
    setLocationNotice("");
  }, [navigator]);
  const [noteSeekNotice, setNoteSeekNotice] = useState("");
  const [practiceAnchor, setPracticeAnchor] = useState<number | null>(null);
  const followedRegion = useRef("");
  const pendingAnnotation = useRef<{
    page: number;
    region: PaperRegion;
  } | null>(null);
  const scrollRegion = (region: PaperRegion) => {
    const viewport = frame.current,
      sheet = viewport?.querySelector<HTMLElement>(".paper-annotation-sheet");
    if (!viewport || !sheet) return;
    const r = paperAnnotationBox(region, latest.current.rotation);
    viewport.scrollTo({
      top:
        sheet.offsetTop +
        r.y * sheet.offsetHeight -
        Math.max(
          12,
          (viewport.clientHeight - r.height * sheet.offsetHeight) / 2,
        ),
      left:
        sheet.offsetLeft +
        r.x * sheet.offsetWidth -
        Math.max(12, (viewport.clientWidth - r.width * sheet.offsetWidth) / 2),
    });
  };
  const jumpAnchor = useCallback(
    async (anchor: PageAnchor) => {
      const task = navigator.request({
        type: "seekPaperMeasure",
        content_id: contentId,
        id: attachment.id,
        measure: anchor.measure,
      });
      setNoteSeekBusy(true);
      setLocationNotice("");
      try {
        await task.result;
        if (task.isCurrent())
          setLocationNotice(`已定位第 ${anchor.measure} 小节。`);
      } catch (e) {
        if (task.isCurrent())
          setLocationNotice(e instanceof Error ? e.message : String(e));
      } finally {
        if (task.isCurrent()) setNoteSeekBusy(false);
      }
    },
    [navigator, contentId, attachment.id],
  );
  const mapping = attachment.mapping;
  const measureAnchorIndex = useMemo(
    () =>
      new Map(mapping?.anchors.map((anchor) => [anchor.measure, anchor]) ?? []),
    [mapping?.anchors],
  );
  const stale = !!mapping && !!practice && mapping.grid !== practice.grid;
  const measureForNote = song?.measures[noteMeasure - 1];
  const trackNames = useMemo(
    () => new Map(song?.tracks.map((track) => [track.id, track.name]) ?? []),
    [song?.tracks],
  );
  const noteIndex = useMemo(
    () =>
      paperNoteIndex(
        song?.contentId === contentId &&
          song.scoreRevision === practice?.scoreRevision
          ? song
          : null,
      ),
    [song, contentId, practice?.scoreRevision],
  );
  const notesForMeasure = noteIndex.byMeasure.get(noteMeasure) ?? [];
  const selectedNote: Note | undefined =
    notesForMeasure.find((note) => `${note.track}:${note.index}` === noteKey) ??
    notesForMeasure[0];
  const anchorIndex = useMemo(
    () => paperAnchorIndex(attachment.noteAnchors),
    [attachment.noteAnchors],
  );
  const savedNoteAnchor =
    selectedNote && anchorIndex.get(paperNoteKey(selectedNote));
  const seekSavedNote = async (anchor: PaperNoteAnchor) => {
    const task = navigator.request({
      type: "seekPaperNote",
      content_id: contentId,
      book: attachment.id,
      expected: anchor,
    });
    setNoteSeekBusy(true);
    setNoteSeekNotice("");
    try {
      await task.result;
      if (task.isCurrent())
        setNoteSeekNotice(
          `练习已定位到第 ${anchor.measure} 小节的 ${pitchName(anchor.pitch)}。`,
        );
    } catch (cause) {
      if (task.isCurrent())
        setNoteSeekNotice(
          cause instanceof Error ? cause.message : String(cause),
        );
    } finally {
      if (task.isCurrent()) setNoteSeekBusy(false);
    }
  };
  const noteCoverage = useMemo(
    () => ({
      notes: noteIndex.ordered,
      marked: markedPaperNotes(noteIndex, attachment, practice?.grid),
    }),
    [
      noteIndex,
      practice?.grid,
      attachment.noteAnchors,
      attachment.pages,
      attachment.format,
    ],
  );
  const unmarkedNote = useMemo(
    () => nextUnmarkedPaperNote(noteIndex, noteCoverage.marked, selectedNote),
    [noteIndex, noteCoverage.marked, selectedNote],
  );
  const measured = playback?.measure ?? practice?.measure ?? 1;
  const activeMeasureAnchor = paperAnchorAt(mapping?.anchors ?? [], measured);
  const [mappingOpen, setMappingOpen] = useState(
      initialForm.current?.mappingOpen ?? false,
    ),
    [anchorQuery, setAnchorQuery] = useState(""),
    [anchorListPage, setAnchorListPage] = useState(0);
  useLayoutEffect(() => {
    if (
      !toolsOpen ||
      !editorFocus ||
      handledFocus.current === editorFocus.request
    )
      return;
    const root = toolsRoot.current;
    const input = root?.querySelector<HTMLInputElement>(
      editorFocus.kind === "note"
        ? '[aria-label="音符位置演奏小节"]'
        : '[aria-label="谱页对应小节"]',
    );
    if (!root || !input?.getClientRects().length || input.disabled) return;
    handledFocus.current = editorFocus.request;
    input.focus({ preventScroll: true });
    const box = root.getBoundingClientRect(),
      field = input.getBoundingClientRect();
    const heading =
      root.querySelector<HTMLElement>(".paper-reader-tools-heading")
        ?.offsetHeight ?? 0;
    if (field.top < box.top + heading + 12)
      root.scrollTop += field.top - box.top - heading - 12;
    else if (field.bottom > box.bottom - 12)
      root.scrollTop += field.bottom - box.bottom + 12;
  }, [
    toolsOpen,
    editorFocus,
    mappingOpen,
    noteEditorOpen,
    practice?.scoreRevision,
    disabled,
  ]);
  const matchingAnchors = useMemo(() => {
    const query = anchorQuery.trim();
    return (mapping?.anchors ?? []).filter(
      (anchor) =>
        !query ||
        `第 ${anchor.measure} 小节 → 第 ${anchor.page} 页`.includes(query),
    );
  }, [mapping?.anchors, anchorQuery]);
  const actualAnchorPage = Math.min(
    anchorListPage,
    Math.max(0, Math.ceil(matchingAnchors.length / 30) - 1),
  );
  const readingSession = useMemo(
    () =>
      !readOnly && !previewKind
        ? paperViewSession(contentId, attachment.id, attachment.view)
        : null,
    [contentId, attachment.id, readOnly, previewKind],
  );
  const readingState = useSyncExternalStore(
    readingSession?.subscribe ?? noReadingSubscription,
    readingSession?.getSnapshot ?? noReadingState,
  );
  useEffect(() => {
    readingSession?.bindEngine(engineId);
  }, [readingSession, engineId]);
  useEffect(() => {
    readingSession?.observeSaved(attachment.view, attachment.readingTicket);
  }, [readingSession, attachment.view, attachment.readingTicket]);
  const [previewView, setPreviewView] = useState<PaperView>(attachment.view),
    [count, setCount] = useState(
      attachment.format === "images" ? attachment.pages.length : 0,
    ),
    [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [width, setWidth] = useState(900),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [password, setPassword] = useState(""),
    [needsPassword, setNeedsPassword] = useState(false);
  const view = readingState?.view ?? previewView;
  const setView = (
    change: PaperView | ((previous: PaperView) => PaperView),
  ) => {
    if (readingSession) {
      const previous = readingSession.getSnapshot().view;
      readingSession.setView(
        typeof change === "function" ? change(previous) : change,
      );
    } else setPreviewView(change);
  };
  const exports = usePaperExport({
    contentId,
    attachment,
    doc,
    count,
    view,
    previewKind,
    annotationEditing,
    selectingRegion: selectingRegion || selectingNoteRegion,
    loading,
    error,
    needsPassword,
    disabled,
    onStart: () => {
      if (playback && mapping?.enabled) setSuspended(true);
    },
  });
  const {
    exportBusy,
    exportCommitting,
    preparedBook,
    preparedPage,
    exportPage,
    exportBook,
    savePreparedPage,
    savePreparedBook,
  } = exports;
  const currentAsset =
    attachment.format === "pdf"
      ? attachment.pages[0]
      : attachment.pages[view.page - 1];
  const locationSaving = useRef(false);
  const readerIdentity = JSON.stringify([
    contentId,
    attachment.id,
    engineId,
    practice?.grid,
    practice?.scoreRevision,
  ]);
  const readerOwner = useRef(readerIdentity),
    readerMounted = useRef(true);
  readerOwner.current = readerIdentity;
  useEffect(() => {
    readerMounted.current = true;
    return () => {
      readerMounted.current = false;
    };
  }, []);
  const measureDraft = locationDrafts.drafts.find(
    (draft) => draft.id === activeMeasureDraft,
  );
  const noteDraft = locationDrafts.drafts.find(
    (draft) => draft.id === activeNoteDraft,
  );
  const draftIssue = (
    draft: PaperLocationDraft,
    ignoreRevision = false,
  ): string | null => {
    if (!practice) return "打开此曲目练习后可继续保存。";
    if (
      draft.grid !== practice.grid ||
      (!ignoreRevision && draft.scoreRevision !== practice.scoreRevision)
    )
      return "谱面或小节网格已变化，请核对后重新框选。";
    if (draft.measure > practice.measures) return "小节已超出曲目范围。";
    const asset =
      attachment.format === "pdf"
        ? attachment.pages[0]
        : attachment.pages[draft.page - 1];
    if (
      asset?.id !== draft.assetId ||
      !asset.available ||
      (count > 0 && draft.page > count)
    )
      return "原谱页已移动或不可用，请重新选择谱页并框选。";
    const saved = draft.note
      ? anchorIndex.get(paperNoteKey(draft.note))
      : measureAnchorIndex.get(draft.measure);
    if (!samePaperAnchor(saved, draft.expected))
      return "已保存的位置发生变化，请核对后重新框选。";
    if (draft.note) {
      const target = noteIndex.byKey.get(paperNoteKey(draft.note));
      if (
        !target ||
        noteIndex.duplicates.has(paperNoteKey(draft.note)) ||
        target.measure !== draft.measure ||
        target.note.pitch !== draft.note.pitch ||
        target.note.tick !== draft.note.tick
      )
        return "目标音符已变化，请重新选择音符并框选。";
    }
    return null;
  };
  const measureDraftIssue = measureDraft ? draftIssue(measureDraft) : null;
  const noteDraftIssue = noteDraft ? draftIssue(noteDraft) : null;
  const canReconfirm = (draft: PaperLocationDraft) =>
    !!practice &&
    draft.scoreRevision !== practice.scoreRevision &&
    !draftIssue(draft, true);
  const reconfirmLocation = (draft: PaperLocationDraft) => {
    if (!practice || !canReconfirm(draft)) return;
    const next = {
      ...draft,
      scoreRevision: practice.scoreRevision,
      updatedAt: Date.now(),
    };
    next.id = paperLocationDraftId(next);
    if (!locationSession.replace(draft, next)) {
      setLocationSaveNotice(
        "当前谱面已有此位置草稿，或草稿刚有修改，请从列表继续。",
      );
      return;
    }
    if (draft.kind === "note") setActiveNoteDraft(next.id);
    else setActiveMeasureDraft(next.id);
    setLocationSaveNotice("已按当前谱面确认框选位置，请继续保存对应。");
  };
  const rememberLocation = (kind: "measure" | "note", region: PaperRegion) => {
    if (
      !practice ||
      !currentAsset?.available ||
      (kind === "note" && !selectedNote)
    )
      return false;
    const measure = kind === "note" ? noteMeasure : anchorMeasure;
    if (
      !Number.isSafeInteger(measure) ||
      measure < 1 ||
      measure > practice.measures
    )
      return false;
    const base = {
      kind,
      grid: practice.grid,
      scoreRevision: practice.scoreRevision,
      measure,
      assetId: currentAsset.id,
      page: view.page,
      note:
        kind === "note" && selectedNote
          ? {
              track: selectedNote.track,
              index: selectedNote.index,
              pitch: selectedNote.pitch,
              tick: selectedNote.tick,
            }
          : null,
    };
    const draft: PaperLocationDraft = {
      ...base,
      id: paperLocationDraftId(base),
      region,
      expected:
        kind === "note"
          ? (savedNoteAnchor ?? null)
          : (measureAnchorIndex.get(measure) ?? null),
      updatedAt: Date.now(),
    };
    if (!locationSession.put(draft)) {
      setLocationSaveNotice(
        locationDrafts.drafts.length >= 128
          ? "已保留 128 处位置草稿，请先保存或移除部分草稿。"
          : "框选资料不完整，请重新框选。",
      );
      return false;
    }
    if (kind === "note") setActiveNoteDraft(draft.id);
    else setActiveMeasureDraft(draft.id);
    setLocationSaveNotice("框选位置已保留为草稿，请保存对应。");
    setSuspended(true);
    return true;
  };
  const resumeLocation = (draft: PaperLocationDraft) => {
    setToolsOpen(true);
    setSuspended(true);
    setSelectingRegion(false);
    setSelectingNoteRegion(false);
    const issue = draftIssue(draft);
    setLocationSaveNotice(issue ?? "已恢复框选位置，可继续保存。");
    focusEditor(draft.kind);
    if (draft.kind === "note") {
      setNoteEditorOpen(true);
      setNoteMeasure(draft.measure);
      setNoteKey(draft.note ? paperNoteKey(draft.note) : "");
      setNoteRegion(draft.region);
      setNoteRegionPage(draft.page);
      setActiveNoteDraft(draft.id);
    } else {
      setMappingOpen(true);
      setAnchorMeasure(draft.measure);
      setAnchorRegion(draft.region);
      setAnchorRegionPage(draft.page);
      setActiveMeasureDraft(draft.id);
    }
    const asset =
      attachment.format === "pdf"
        ? attachment.pages[0]
        : attachment.pages[draft.page - 1];
    if (asset?.id === draft.assetId && asset.available && draft.page <= count) {
      page(draft.page);
      pendingAnnotation.current = { page: draft.page, region: draft.region };
      if (!loading && renderedPage === draft.page && view.page === draft.page) {
        scrollRegion(draft.region);
        pendingAnnotation.current = null;
      }
    }
  };
  const saveMeasureLocation = async () => {
    if (
      locationSaving.current ||
      disabled ||
      !practice ||
      stale ||
      !currentAsset?.available ||
      !Number.isSafeInteger(anchorMeasure) ||
      anchorMeasure < 1 ||
      anchorMeasure > practice.measures ||
      (anchorRegion && anchorRegionPage !== view.page) ||
      measureDraftIssue
    )
      return;
    const captured = measureDraft,
      capturedRegion = anchorRegion;
    locationSaving.current = true;
    setLocationSaveNotice("正在保存小节位置…");
    try {
      const saved = await saveMapping({
        grid: practice.grid,
        enabled: mapping?.enabled ?? false,
        anchors: [
          ...(mapping?.anchors ?? []).filter(
            (anchor) => anchor.measure !== anchorMeasure,
          ),
          {
            measure: anchorMeasure,
            page: view.page,
            ...(capturedRegion ? { region: capturedRegion } : {}),
          },
        ].sort((a, b) => a.measure - b.measure),
      });
      if (saved && captured) locationSession.remove(captured.id, captured);
      if (!readerMounted.current || readerOwner.current !== readerIdentity)
        return;
      if (saved) {
        setAnchorRegion((current) =>
          samePaperRegion(current, capturedRegion) ? null : current,
        );
        setActiveMeasureDraft((current) =>
          current === captured?.id ? null : current,
        );
        setLocationSaveNotice(
          `已保存第 ${anchorMeasure} 小节在第 ${view.page} 页的位置。`,
        );
      } else
        setLocationSaveNotice(
          "小节位置尚未确认保存，请查看上方提示。当前输入继续保留。",
        );
    } finally {
      locationSaving.current = false;
    }
  };
  const saveNoteLocation = async () => {
    if (
      locationSaving.current ||
      disabled ||
      !saveNoteAnchor ||
      !selectedNote ||
      !noteRegion ||
      noteRegionPage !== view.page ||
      !currentAsset?.available ||
      noteDraftIssue
    )
      return;
    const captured = noteDraft,
      capturedRegion = noteRegion;
    locationSaving.current = true;
    setLocationSaveNotice("正在保存音符位置…");
    try {
      const saved = await saveNoteAnchor(
        selectedNote.track,
        selectedNote.index,
        {
          pitch: selectedNote.pitch,
          measure: noteMeasure,
          assetId: currentAsset.id,
          page: view.page,
          region: capturedRegion,
        },
        captured
          ? (captured.expected as PaperNoteAnchor | null)
          : (savedNoteAnchor ?? null),
      );
      if (saved && captured) locationSession.remove(captured.id, captured);
      if (!readerMounted.current || readerOwner.current !== readerIdentity)
        return;
      if (saved) {
        setNoteRegion((current) =>
          samePaperRegion(current, capturedRegion) ? null : current,
        );
        setActiveNoteDraft((current) =>
          current === captured?.id ? null : current,
        );
        setLocationSaveNotice(
          `已保存第 ${noteMeasure} 小节的 ${pitchName(selectedNote.pitch)} 位置。`,
        );
      } else
        setLocationSaveNotice(
          "音符位置尚未确认保存，请查看上方提示。当前输入继续保留。",
        );
    } finally {
      locationSaving.current = false;
    }
  };
  useEffect(() => {
    if (readOnly || previewKind) return;
    locationSession.setForm({
      anchorText,
      noteText,
      noteKey,
      mappingOpen,
      noteOpen: noteEditorOpen,
      toolsOpen,
    });
  }, [
    locationSession,
    anchorText,
    noteText,
    noteKey,
    mappingOpen,
    noteEditorOpen,
    toolsOpen,
    readOnly,
    previewKind,
  ]);
  useEffect(() => {
    if (readOnly || previewKind || !practice) return;
    // Saved evidence also settles a response lost while switching books or reconnecting.
    for (const draft of locationDrafts.drafts) {
      if (draft.grid !== practice.grid) continue;
      const asset =
        attachment.format === "pdf"
          ? attachment.pages[0]
          : attachment.pages[draft.page - 1];
      if (asset?.id !== draft.assetId || !asset.available) continue;
      const savedNote = draft.note ? anchorIndex.get(paperNoteKey(draft.note)) : undefined;
      const saved = draft.note
        ? savedNote
        : mapping?.grid === draft.grid
          ? measureAnchorIndex.get(draft.measure)
          : null;
      if (
        !saved ||
        saved.page !== draft.page ||
        saved.measure !== draft.measure ||
        !samePaperRegion(saved.region, draft.region)
      )
        continue;
      if (
        draft.note &&
        (!savedNote ||
          savedNote.grid !== draft.grid ||
          savedNote.assetId !== draft.assetId ||
          savedNote.pitch !== draft.note.pitch)
      )
        continue;
      if (
        draft.note &&
        noteIndex.byKey.get(paperNoteKey(draft.note))?.note.tick !==
          draft.note.tick
      )
        continue;
      locationSession.remove(draft.id, draft);
      if (activeMeasureDraft === draft.id) {
        setAnchorRegion(null);
        setActiveMeasureDraft(null);
      }
      if (activeNoteDraft === draft.id) {
        setNoteRegion(null);
        setActiveNoteDraft(null);
      }
    }
  }, [
    locationSession,
    locationDrafts.drafts,
    practice?.grid,
    mapping,
    measureAnchorIndex,
    anchorIndex,
    noteIndex,
    attachment.pages,
    attachment.format,
    activeMeasureDraft,
    activeNoteDraft,
    readOnly,
    previewKind,
  ]);
  const visibleMeasureRegions = useMemo(
    () =>
      mapping?.anchors.filter(
        (anchor) => anchor.page === view.page && !!anchor.region,
      ) ?? [],
    [mapping?.anchors, view.page],
  );
  const visibleNoteRegions = useMemo(
    () =>
      attachment.noteAnchors?.filter(
        (anchor) =>
          anchor.page === view.page &&
          anchor.grid === practice?.grid &&
          anchor.assetId === currentAsset?.id,
      ) ?? [],
    [attachment.noteAnchors, view.page, practice?.grid, currentAsset?.id],
  );
  const selectPaperNote = useCallback(
    (anchor: PaperNoteAnchor) => {
      setToolsOpen(true);
      setNoteEditorOpen(true);
      setActiveNoteDraft(null);
      setNoteMeasure(anchor.measure);
      setNoteKey(`${anchor.track}:${anchor.index}`);
      setNoteRegionPage(anchor.page);
      const target = noteIndex.byKey.get(paperNoteKey(anchor));
      const valid =
        target &&
        !noteIndex.duplicates.has(paperNoteKey(anchor)) &&
        target.measure === anchor.measure &&
        target.note.pitch === anchor.pitch &&
        anchor.grid === practice?.grid;
      setNoteRegion(valid ? anchor.region : null);
      setLocationSaveNotice(
        valid
          ? "已选中这个音符的纸谱位置，可重新框选或保存。"
          : "这个位置所指的音符已变化，请重新选择实际音符并框选。",
      );
      focusEditor("note");
    },
    [noteIndex, practice?.grid],
  );
  const canvas = useRef<HTMLCanvasElement>(null),
    frame = useRef<HTMLDivElement>(null),
    passwordCallback = useRef<((v: string) => void) | null>(null),
    latest = useRef(view);
  useEffect(() => {
    if (count > 0) onPageCount?.(count);
  }, [count, onPageCount]);
  latest.current = view;
  const annotationLocations = useMemo(() => {
    const pages = new Map(
      attachment.pages.map((asset, index) => [asset.id, index + 1]),
    );
    return (attachment.annotations ?? [])
      .filter(
        (note) => !note.ink && (note.text.trim() || note.width || note.height),
      )
      .map((note) => ({
        note,
        page:
          attachment.format === "pdf"
            ? note.page
            : (pages.get(note.assetId) ?? 0),
      }))
      .filter((entry) => entry.page > 0 && entry.page <= count)
      .sort(
        (left, right) =>
          left.page - right.page ||
          left.note.y - right.note.y ||
          left.note.x - right.note.x,
      );
  }, [attachment.annotations, attachment.pages, attachment.format, count]);
  useEffect(() => {
    const pending = pendingAnnotation.current;
    if (
      !pending ||
      loading ||
      renderedPage !== pending.page ||
      view.page !== pending.page
    )
      return;
    pendingAnnotation.current = null;
    scrollRegion(pending.region);
  }, [loading, renderedPage, view.page, view.rotation, sheetSize]);
  const invalidPages =
    count > 0 && !!mapping?.anchors.some((a) => a.page > count);
  useEffect(() => {
    if (!annotationEditing) setAnnotationNotice("");
  }, [annotationEditing]);
  const savedCallback = useRef(onViewSaved);
  savedCallback.current = onViewSaved;
  const acknowledgedView = useRef(readingState?.savedVersion);
  useEffect(() => {
    if (
      readingState &&
      !readingState.saving &&
      !readingState.dirty &&
      acknowledgedView.current !== readingState.savedVersion
    ) {
      acknowledgedView.current = readingState.savedVersion;
      savedCallback.current?.();
    }
  }, [readingState]);
  useEffect(() => {
    if (
      !playback ||
      !practice ||
      disabled ||
      !mapping?.enabled ||
      stale ||
      suspended ||
      annotationEditing ||
      anchorRegion ||
      selectingRegion ||
      noteRegion ||
      selectingNoteRegion ||
      (toolsOpen && (noteEditorOpen || mappingOpen)) ||
      exportBusy ||
      invalidPages ||
      !count
    )
      return;
    try {
      const asset = (
        attachment.format === "pdf"
          ? attachment.pages[0]
          : attachment.pages[view.page - 1]
      )?.id;
      if (
        localStorage.getItem(
          `panthesia-paper-draft:${contentId}:${attachment.id}:${asset}:${attachment.format === "pdf" ? view.page : 1}`,
        )
      )
        return;
    } catch {}
    const anchor = paperAnchorAt(mapping.anchors, measured);
    if (!anchor || anchor.page > count) return;
    if (latest.current.page !== anchor.page) {
      followedRegion.current = "";
      setView((v) =>
        v.page === anchor.page ? v : { ...v, page: anchor.page },
      );
      frame.current?.scrollTo({ top: 0, left: 0 });
      return;
    }
    if (loading || renderedPage !== view.page) return;
    const key = JSON.stringify([anchor, view.rotation, sheetSize]);
    if (followedRegion.current === key) return;
    followedRegion.current = key;
    if (anchor.region) scrollRegion(anchor.region);
  }, [
    measured,
    mapping,
    stale,
    suspended,
    annotationEditing,
    anchorRegion,
    selectingRegion,
    noteRegion,
    selectingNoteRegion,
    noteEditorOpen,
    mappingOpen,
    toolsOpen,
    exportBusy,
    count,
    !!playback,
    practice?.grid,
    disabled,
    loading,
    renderedPage,
    view.page,
    view.rotation,
    sheetSize,
  ]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width - 32)),
    );
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    passwordCallback.current = null;
    setDoc(null);
    setCount(0);
    setNeedsPassword(false);
    setPassword("");
    setError("");
    setLoading(true);
    if (attachment.format === "images") {
      setCount(attachment.pages.length);
      setView((v) => ({
        ...v,
        page: Math.min(v.page, attachment.pages.length),
      }));
      setLoading(false);
      return;
    }
    void api
      .readScoreAttachment(
        contentId,
        attachment.id,
        0,
        previewKind,
        attachment.pages[0]?.id,
      )
      .then(async (bytes) => {
        const pdfjs = await import("pdfjs-dist");
        if (!alive) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({
          data: bytes,
          enableXfa: false,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          maxImageSize: 64_000_000,
        });
        task.onPassword = (
          callback: (value: string) => void,
          reason: number,
        ) => {
          if (alive) {
            passwordCallback.current = callback;
            setNeedsPassword(true);
            setError(
              reason === 2
                ? "PDF 密码不正确，请重新输入。"
                : "该 PDF 需要密码，请输入后打开。",
            );
          }
        };
        return task.promise;
      })
      .then((pdf) => {
        if (!alive || !pdf) return;
        if (pdf.numPages > 5000)
          throw new Error("PDF 超过 5000 页，请拆分后导入");
        setDoc(pdf);
        setCount(pdf.numPages);
        setView((v) => ({ ...v, page: Math.min(v.page, pdf.numPages) }));
        setNeedsPassword(false);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(`PDF 无法打开：${e.message ?? e}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      passwordCallback.current = null;
      void task?.destroy();
    };
  }, [
    contentId,
    attachment.id,
    attachment.format,
    attachment.pages.length,
    attachment.pages[0]?.id,
    attachment.pages[0]?.available,
    previewKind,
    engineId,
    resourceRevision,
  ]);
  const rasterCache = useMemo(
    () => createPaperRasterCache(contentId, attachment.id, previewKind),
    [contentId, attachment.id, previewKind, engineId, resourceRevision],
  );
  useEffect(() => {
    rasterCache.activate();
    return () => rasterCache.dispose();
  }, [rasterCache]);
  const rasterAssetId = currentAsset?.id,
    rasterAssetAvailable = currentAsset?.available,
    rasterAssetKind = currentAsset?.kind;
  useEffect(() => {
    const target = canvas.current;
    if (!target || !count || (attachment.format === "pdf" && !doc)) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    setRenderedPage(0);
    setLoading(true);
    if (!needsPassword) setError("");
    const draw = async () => {
      const ctx = target.getContext("2d");
      if (!ctx) throw new Error("无法创建谱页画布");
      const density = Math.min(window.devicePixelRatio || 1, 2);
      if (attachment.format === "pdf" && doc) {
        const p = await doc.getPage(view.page);
        if (cancelled) return;
        const base = p.getViewport({
          scale: 1,
          rotation: (p.rotate + view.rotation) % 360,
        });
        const scale = view.fit ? width / base.width : view.zoom / 100;
        const viewport = p.getViewport({
          scale,
          rotation: (p.rotate + view.rotation) % 360,
        });
        const d = Math.min(
          density,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        target.width = Math.max(1, Math.floor(viewport.width * d));
        target.height = Math.max(1, Math.floor(viewport.height * d));
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        setSheetSize({ width: viewport.width, height: viewport.height });
        renderTask = p.render({
          canvas: target,
          canvasContext: ctx,
          viewport,
          transform: [d, 0, 0, d, 0, 0],
        });
        await renderTask.promise;
      } else {
        const index = view.page - 1;
        const asset = attachment.pages[index];
        if (!asset?.available) throw new Error("该谱页副本缺失，请重新添加");
        const img = await rasterCache.load(asset, index);
        if (cancelled) return;
        const swap = view.rotation % 180 !== 0;
        const w = swap ? img.naturalHeight : img.naturalWidth,
          h = swap ? img.naturalWidth : img.naturalHeight;
        const scale = view.fit ? width / w : view.zoom / 100;
        const d = Math.min(
          density,
          Math.sqrt(16_000_000 / (w * h * scale * scale)),
        );
        target.width = Math.max(1, Math.floor(w * scale * d));
        target.height = Math.max(1, Math.floor(h * scale * d));
        target.style.width = `${w * scale}px`;
        target.style.height = `${h * scale}px`;
        setSheetSize({ width: w * scale, height: h * scale });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.translate(target.width / 2, target.height / 2);
        ctx.rotate((view.rotation * Math.PI) / 180);
        ctx.scale(scale * d, scale * d);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      }
    };
    let rendered = false;
    void draw()
      .then(() => {
        rendered = true;
      })
      .catch((e) => {
        if (!cancelled) setError(`谱页显示失败：${e.message ?? e}`);
      })
      .finally(() => {
        if (!cancelled) {
          setRenderedPage(rendered ? view.page : 0);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [
    doc,
    count,
    invalidPages,
    view,
    width,
    contentId,
    attachment.id,
    rasterAssetId,
    rasterAssetAvailable,
    rasterAssetKind,
    rasterCache,
    needsPassword,
  ]);
  const page = (n: number) => {
    if (exports.isBusy()) return false;
    if (!Number.isFinite(n) || !Number.isInteger(n) || !count || disabled)
      return false;
    if (annotationEditing || selectingRegion || selectingNoteRegion) {
      setAnnotationNotice(
        selectingRegion || selectingNoteRegion
          ? "请先完成或取消位置框选，再翻页。"
          : "请先保存或取消当前批注，再翻页。",
      );
      return false;
    }
    setAnnotationNotice("");
    if (playback && mapping?.enabled) setSuspended(true);
    setView((v) => ({ ...v, page: Math.max(1, Math.min(count, n)) }));
    frame.current?.scrollTo({ top: 0, left: 0 });
    return true;
  };
  const locateAnnotation = (note: PaperAnnotation, pageNumber: number) => {
    if (
      annotationEditing ||
      selectingRegion ||
      selectingNoteRegion ||
      exports.isBusy() ||
      disabled ||
      !count
    )
      return;
    pendingAnnotation.current = {
      page: pageNumber,
      region: {
        x: note.x,
        y: note.y,
        width: Math.max(note.width ?? 0, 0.035),
        height: Math.max(note.height ?? 0, 0.035),
      },
    };
    page(pageNumber);
    if (pageNumber === view.page && !loading && renderedPage === pageNumber) {
      const pending = pendingAnnotation.current;
      pendingAnnotation.current = null;
      if (pending) scrollRegion(pending.region);
    }
  };
  const followPaused =
    suspended ||
    annotationEditing ||
    selectingRegion ||
    selectingNoteRegion ||
    !!anchorRegion ||
    !!noteRegion ||
    (toolsOpen && (mappingOpen || noteEditorOpen));
  const resumeFollow = () => {
    if (
      annotationEditing ||
      selectingRegion ||
      selectingNoteRegion ||
      disabled ||
      !mapping?.enabled ||
      stale
    )
      return;
    // Drafts remain on the shelf; following only releases their temporary viewport selection.
    setAnchorRegion(null);
    setActiveMeasureDraft(null);
    setNoteRegion(null);
    setActiveNoteDraft(null);
    setMappingOpen(false);
    setNoteEditorOpen(false);
    setSuspended(false);
    setLocationSaveNotice("");
  };
  return (
    <div
      className="paper-reader"
      onKeyDown={(e) => {
        if (
          e.altKey ||
          e.ctrlKey ||
          e.metaKey ||
          e.shiftKey ||
          toolsRoot.current?.contains(e.target as Node)
        )
          return;
        if (
          (e.target as HTMLElement).matches(
            "input,select,textarea,[contenteditable='true']",
          )
        )
          return;
        const delta =
          e.key === "PageDown" || e.key === "ArrowRight"
            ? 1
            : e.key === "PageUp" || e.key === "ArrowLeft"
              ? -1
              : 0;
        if ((e.key === "Home" || e.key === "End") && count) {
          e.preventDefault();
          e.stopPropagation();
          page(e.key === "Home" ? 1 : count);
          return;
        }
        if (delta && count) {
          e.preventDefault();
          e.stopPropagation();
          page(view.page + delta);
        }
      }}
    >
      <fieldset className="paper-controls" disabled={exportBusy}>
        {!previewKind && (!readOnly || annotationLocations.length > 0) && (
          <button
            type="button"
            aria-expanded={toolsOpen}
            aria-controls={toolsId}
            disabled={selectingRegion || selectingNoteRegion}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            {toolsOpen ? "收起标记与定位" : "标记与定位"}
            {locationDrafts.drafts.length > 0
              ? ` · ${locationDrafts.drafts.length} 处草稿`
              : ""}
          </button>
        )}
        {playback && mapping?.enabled && !stale && (
          <span className="paper-follow-status">
            {followPaused ? "跟随已暂停" : `跟随第 ${measured} 小节`}
          </span>
        )}
        {playback && mapping?.enabled && !stale && followPaused && (
          <button
            type="button"
            disabled={
              disabled ||
              annotationEditing ||
              selectingRegion ||
              selectingNoteRegion
            }
            onClick={resumeFollow}
          >
            继续跟随
          </button>
        )}
        {readingState && (
          <span className="paper-reading-status" aria-label="阅读位置保存状态">
            {readingState.saving
              ? "正在保存位置…"
              : readingState.dirty
                ? "阅读位置待保存"
                : "阅读位置已保存"}
          </span>
        )}
        <button
          disabled={disabled || view.page <= 1}
          aria-label="上一谱页"
          onClick={() => page(view.page - 1)}
        >
          上一页
        </button>
        <PaperPagePicker
          page={view.page}
          count={count}
          disabled={disabled || exportBusy}
          navigate={page}
        />
        <button
          aria-label="下一谱页"
          disabled={disabled || !count || view.page >= count}
          onClick={() => page(view.page + 1)}
        >
          下一页
        </button>
        <button
          className={view.fit ? "selected" : ""}
          onClick={() => setView((v) => ({ ...v, fit: true }))}
        >
          适合宽度
        </button>
        <select
          aria-label="谱页缩放"
          value={view.fit ? "fit" : String(view.zoom)}
          onChange={(e) =>
            setView((v) =>
              e.target.value === "fit"
                ? { ...v, fit: true }
                : { ...v, fit: false, zoom: Number(e.target.value) },
            )
          }
        >
          <option value="fit">适合宽度</option>
          {[25, 50, 75, 100, 125, 150, 200, 250, 300].map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            setView((v) => ({ ...v, rotation: (v.rotation + 90) % 360 }))
          }
        >
          旋转 90°
        </button>
        <button
          disabled={
            disabled ||
            loading ||
            !!error ||
            needsPassword ||
            annotationEditing ||
            exportBusy ||
            !count
          }
          onClick={() => void exportPage()}
          title="导出完整当前页、编号和批注说明，不受阅读缩放影响"
        >
          {exportBusy ? "正在导出…" : "导出本页批注"}
        </button>
        <button
          disabled={
            disabled ||
            loading ||
            !!error ||
            needsPassword ||
            annotationEditing ||
            selectingRegion ||
            exportBusy ||
            !count
          }
          onClick={() => void exportBook()}
          title="按当前旋转方向导出整份谱本和已保存的批注；长批注会自动续到下一张打印页"
        >
          导出整本批注 PDF
        </button>
        {manage && attachment.format === "images" && (
          <>
            <button
              disabled={disabled || view.page <= 1}
              onClick={() =>
                void update("movePage", {
                  page: view.page - 1,
                  direction: -1,
                })
              }
            >
              此页前移
            </button>
            <button
              disabled={disabled || view.page >= count}
              onClick={() =>
                void update("movePage", {
                  page: view.page - 1,
                  direction: 1,
                })
              }
            >
              此页后移
            </button>
            <button
              disabled={disabled || count <= 1}
              onClick={() => void update("removePage", { page: view.page - 1 })}
            >
              移除此页
              {(attachment.annotations ?? []).filter(
                (n) => n.assetId === attachment.pages[view.page - 1]?.id,
              ).length > 0
                ? `及 ${(attachment.annotations ?? []).filter((n) => n.assetId === attachment.pages[view.page - 1]?.id).length} 条批注`
                : ""}
            </button>
          </>
        )}
      </fieldset>
      {readingSession && readingState && (
        <PaperReadingFeedback session={readingSession} state={readingState} />
      )}
      <div className={`paper-reader-body${toolsOpen ? " tools-open" : ""}`}>
        <aside
          ref={toolsRoot}
          id={toolsId}
          className="paper-reader-tools"
          hidden={!toolsOpen}
          aria-label="谱页标记与定位工具"
        >
          <div className="paper-reader-tools-heading">
            <h3>标记与定位</h3>
            <span>框选位置会暂存在本机</span>
          </div>
          {!readOnly && !previewKind && (
            <PaperLocationDrafts
              session={locationSession}
              disabled={
                disabled ||
                annotationEditing ||
                selectingRegion ||
                selectingNoteRegion ||
                exportBusy
              }
              issue={draftIssue}
              resume={resumeLocation}
            />
          )}
          {locationSaveNotice && (
            <p role="status" className="paper-location-draft-status">
              {locationSaveNotice}
            </p>
          )}
          {!readOnly && !previewKind && (
            <TaskActivity
              contentId={contentId}
              label="从谱页定位练习"
              cancelLabel="停止定位"
              onCancelRequested={() => {
                navigator.cancel();
                setNoteSeekBusy(false);
                setLocationNotice("已停止这次定位，可重新选择位置。");
              }}
            />
          )}
          {!previewKind && (
            <PaperAnnotationNavigator
              locations={annotationLocations}
              disabled={
                disabled ||
                annotationEditing ||
                selectingRegion ||
                selectingNoteRegion ||
                exportBusy
              }
              locate={locateAnnotation}
            />
          )}
          {!readOnly && !previewKind && (practice || mapping) && (
            <div className="paper-follow-controls">
              <label>
                <input
                  type="checkbox"
                  aria-label="纸谱自动翻页"
                  checked={followPending ?? !!mapping?.enabled}
                  disabled={disabled || !practice || !mapping || stale}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setFollowPending(enabled);
                    void saveMapping({ ...mapping!, enabled })
                      .then((saved) => {
                        if (saved) setSuspended(false);
                      })
                      .finally(() => setFollowPending(null));
                  }}
                />
                自动翻页
              </label>
              {noteKey &&
                savedNoteAnchor &&
                noteCoverage.marked.has(noteKey) && (
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      stale ||
                      noteSeekBusy ||
                      annotationEditing ||
                      selectingRegion ||
                      selectingNoteRegion ||
                      !noteCoverage.marked.has(paperNoteKey(savedNoteAnchor))
                    }
                    title={
                      noteCoverage.marked.has(paperNoteKey(savedNoteAnchor))
                        ? "从已核对的纸谱音符位置开始练习"
                        : "音符所在小节或谱页已改变，请先核对并更新位置"
                    }
                    onClick={() => void seekSavedNote(savedNoteAnchor)}
                  >
                    {noteSeekBusy
                      ? "正在定位…"
                      : `从此音练习 · ${pitchName(savedNoteAnchor.pitch)}`}
                  </button>
                )}
              {noteSeekNotice && <span role="status">{noteSeekNotice}</span>}
              {playback && mapping?.enabled && !stale && (
                <span>
                  {annotationEditing || selectingRegion || selectingNoteRegion
                    ? "谱页编辑中，自动翻页暂停"
                    : (toolsOpen && (noteEditorOpen || mappingOpen)) ||
                        noteRegion ||
                        anchorRegion
                      ? "位置编辑中，自动翻页暂停"
                      : suspended
                        ? "已手动翻页，跟随暂停"
                        : `跟随第 ${measured} 小节`}
                </span>
              )}
              {stale && (
                <span role="status">
                  小节位置已改变，请核对后重新确认对应。
                </span>
              )}
              {invalidPages && (
                <span role="status">
                  部分对应页码不可用，请修改后继续自动翻页。
                </span>
              )}
              <details
                className="paper-mapping-editor"
                open={mappingOpen}
                onToggle={(event) => setMappingOpen(event.currentTarget.open)}
              >
                <summary>
                  小节与谱页对应
                  {mapping ? ` · ${mapping.anchors.length} 处` : ""}
                </summary>
                <p className="parameter-help">
                  从指定演奏小节开始显示此页，直到下一个对应点。反复回到前页时，为展开后的演奏小节添加对应。可框选页内位置，随小节定位到具体谱行。
                </p>
                {practice && (
                  <div className="paper-anchor-add">
                    <label>
                      演奏小节{" "}
                      <input
                        aria-label="谱页对应小节"
                        type="number"
                        min={1}
                        max={practice.measures}
                        value={anchorText}
                        disabled={disabled || stale || selectingRegion}
                        onChange={(e) => {
                          setAnchorText(e.target.value);
                          setAnchorRegion(null);
                          setActiveMeasureDraft(null);
                        }}
                      />
                    </label>
                    <span>
                      → 当前第 {view.page} 页
                      {anchorRegion && anchorRegionPage === view.page
                        ? " · 已选页内位置"
                        : ""}
                    </span>
                    <button
                      disabled={
                        disabled ||
                        stale ||
                        annotationEditing ||
                        !count ||
                        loading ||
                        selectingRegion ||
                        !Number.isSafeInteger(anchorMeasure) ||
                        anchorMeasure < 1 ||
                        anchorMeasure > (practice?.measures ?? 0)
                      }
                      onClick={() => setSelectingRegion(true)}
                    >
                      框选小节位置
                    </button>
                    {selectingRegion && (
                      <>
                        <span role="status">
                          在谱页上拖选此小节或谱行的位置。
                        </span>
                        <button onClick={() => setSelectingRegion(false)}>
                          取消框选
                        </button>
                      </>
                    )}
                    {anchorRegion && !selectingRegion && (
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (measureDraft)
                            locationSession.remove(
                              measureDraft.id,
                              measureDraft,
                            );
                          setAnchorRegion(null);
                          setActiveMeasureDraft(null);
                        }}
                      >
                        移除本次框选
                      </button>
                    )}
                    {anchorRegion && anchorRegionPage !== view.page && (
                      <button
                        disabled={disabled || annotationEditing}
                        onClick={() => page(anchorRegionPage)}
                      >
                        返回框选的第 {anchorRegionPage} 页
                      </button>
                    )}
                    {measureDraftIssue && (
                      <span role="status">{measureDraftIssue}</span>
                    )}
                    {measureDraft && canReconfirm(measureDraft) && (
                      <button
                        disabled={disabled}
                        onClick={() => reconfirmLocation(measureDraft)}
                      >
                        已核对，沿用此框选
                      </button>
                    )}
                    {playback && (
                      <button
                        disabled={disabled || stale || selectingRegion}
                        onClick={() => setAnchorMeasure(measured)}
                      >
                        使用当前小节
                      </button>
                    )}
                    <button
                      disabled={
                        disabled ||
                        selectingRegion ||
                        stale ||
                        !count ||
                        !currentAsset?.available ||
                        !!measureDraftIssue ||
                        (!!anchorRegion && anchorRegionPage !== view.page) ||
                        !Number.isInteger(anchorMeasure) ||
                        anchorMeasure < 1 ||
                        anchorMeasure > practice.measures
                      }
                      onClick={() => void saveMeasureLocation()}
                    >
                      保存此页对应
                    </button>
                  </div>
                )}
                {!!mapping?.anchors.length && mappingOpen && (
                  <label className="paper-anchor-filter">
                    查找小节或页码
                    <input
                      aria-label="查找小节或页码"
                      value={anchorQuery}
                      placeholder="小节或页码"
                      onChange={(event) => {
                        setAnchorQuery(event.target.value);
                        setAnchorListPage(0);
                      }}
                    />
                  </label>
                )}
                {mappingOpen &&
                  matchingAnchors
                    .slice(actualAnchorPage * 30, actualAnchorPage * 30 + 30)
                    .map((a) => (
                      <div className="paper-anchor-row" key={a.measure}>
                        <span>
                          第 {a.measure} 小节 → 第 {a.page} 页
                          {a.region ? " · 页内位置" : ""}
                          {practice && a.measure > practice.measures
                            ? "（小节超出当前曲目）"
                            : ""}
                          {a.page > count && count > 0 ? "（页码不可用）" : ""}
                        </span>
                        <button
                          disabled={
                            disabled ||
                            annotationEditing ||
                            selectingRegion ||
                            selectingNoteRegion
                          }
                          onClick={() => {
                            setActiveMeasureDraft(null);
                            setAnchorMeasure(a.measure);
                            setAnchorRegion(a.region ?? null);
                            setAnchorRegionPage(a.page);
                            page(a.page);
                            followedRegion.current = "";
                            if (a.region && a.page === view.page)
                              scrollRegion(a.region);
                          }}
                        >
                          查看 / 修改对应
                        </button>
                        <button
                          disabled={
                            disabled ||
                            noteSeekBusy ||
                            !practice ||
                            stale ||
                            annotationEditing ||
                            a.measure > practice.measures ||
                            a.page > count ||
                            !(
                              attachment.format === "pdf"
                                ? attachment.pages[0]
                                : attachment.pages[a.page - 1]
                            )?.available
                          }
                          onClick={() => void jumpAnchor(a)}
                        >
                          定位练习
                        </button>
                        <button
                          disabled={
                            disabled ||
                            !practice ||
                            stale ||
                            annotationEditing ||
                            a.measure > practice.measures
                          }
                          onClick={() => setPracticeAnchor(a.measure)}
                        >
                          建立练习段
                        </button>
                        <button
                          disabled={disabled || !practice || stale}
                          aria-label={`移除第 ${a.measure} 小节对应`}
                          onClick={() => {
                            if (!mapping) return;
                            const anchors = mapping.anchors.filter(
                              (v) => v.measure !== a.measure,
                            );
                            void saveMapping(
                              anchors.length ? { ...mapping, anchors } : null,
                            );
                          }}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                {mappingOpen && !!mapping?.anchors.length && (
                  <>
                    {!matchingAnchors.length && (
                      <p>没有找到对应的小节或页码。</p>
                    )}
                    <PaperListPager
                      page={actualAnchorPage}
                      total={matchingAnchors.length}
                      change={setAnchorListPage}
                      label="谱页小节对应分页"
                    />
                  </>
                )}
                {stale && practice && mapping && (
                  <button
                    disabled={
                      disabled ||
                      mapping.anchors.some(
                        (a) => a.measure > practice.measures || a.page > count,
                      )
                    }
                    onClick={() =>
                      void saveMapping({
                        ...mapping,
                        grid: practice.grid,
                        enabled: false,
                      })
                    }
                  >
                    按当前小节重新确认
                  </button>
                )}
                {stale &&
                  practice &&
                  mapping &&
                  mapping.anchors.some(
                    (a) => a.measure > practice.measures || a.page > count,
                  ) &&
                  count > 0 && (
                    <button
                      disabled={disabled}
                      onClick={() => {
                        const anchors = mapping.anchors.filter(
                          (a) =>
                            a.measure <= practice.measures && a.page <= count,
                        );
                        void saveMapping(
                          anchors.length
                            ? {
                                ...mapping,
                                grid: practice.grid,
                                enabled: false,
                                anchors,
                              }
                            : null,
                        );
                      }}
                    >
                      移除超出范围的对应并重新确认
                    </button>
                  )}
                {mapping && practice && (
                  <button
                    disabled={disabled}
                    onClick={() => void saveMapping(null)}
                  >
                    清除全部对应
                  </button>
                )}
                {!practice && (
                  <p className="parameter-help">
                    打开该曲目练习后可以编辑小节对应。
                  </p>
                )}
              </details>
              {practice &&
                song?.contentId === contentId &&
                song.scoreRevision === practice.scoreRevision &&
                saveNoteAnchor && (
                  <details
                    className="paper-note-editor"
                    open={noteEditorOpen}
                    onToggle={(event) =>
                      setNoteEditorOpen(event.currentTarget.open)
                    }
                  >
                    <summary>
                      音符在纸谱上的位置 · {attachment.noteAnchors?.length ?? 0}{" "}
                      处
                    </summary>
                    {noteEditorOpen && (
                      <>
                        <p className="parameter-help">
                          先选实际演奏小节和音符，再在纸谱上框选它的位置。同一音高在反复段出现多次时，请逐次标记。
                        </p>
                        <p className="parameter-help">
                          当前有效位置 {noteCoverage.marked.size} /{" "}
                          {noteCoverage.notes.length}{" "}
                          个演奏音符。小节网格或谱页变化后，旧位置需重新核对。
                        </p>
                        <div className="paper-note-editor-controls">
                          <label>
                            演奏小节
                            <input
                              aria-label="音符位置演奏小节"
                              type="number"
                              min={1}
                              max={practice.measures}
                              value={noteText}
                              disabled={disabled || selectingNoteRegion}
                              onChange={(event) => {
                                setNoteText(event.target.value);
                                setNoteKey("");
                                setNoteRegion(null);
                                setActiveNoteDraft(null);
                              }}
                            />
                          </label>
                          <label>
                            目标音符
                            <select
                              aria-label="纸谱位置目标音"
                              value={
                                selectedNote
                                  ? `${selectedNote.track}:${selectedNote.index}`
                                  : ""
                              }
                              disabled={
                                disabled ||
                                selectingNoteRegion ||
                                !notesForMeasure.length
                              }
                              onChange={(event) => {
                                setNoteKey(event.target.value);
                                setNoteRegion(null);
                                setActiveNoteDraft(null);
                              }}
                            >
                              {!notesForMeasure.length && (
                                <option value="">
                                  这一小节没有可标记的音符
                                </option>
                              )}
                              {notesForMeasure.map((note) => (
                                <option
                                  key={`${note.track}:${note.index}`}
                                  value={`${note.track}:${note.index}`}
                                >
                                  {noteCoverage.marked.has(
                                    `${note.track}:${note.index}`,
                                  )
                                    ? "已标记 · "
                                    : "未标记 · "}
                                  {pitchName(note.pitch)} ·{" "}
                                  {trackNames.get(note.track) ??
                                    `音轨 ${note.track}`}{" "}
                                  · 第{" "}
                                  {(
                                    (note.tick - measureForNote!.startTick) /
                                      song.ppq +
                                    1
                                  ).toFixed(2)}{" "}
                                  拍
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={
                              disabled || selectingNoteRegion || !unmarkedNote
                            }
                            onClick={() => {
                              if (!unmarkedNote) return;
                              setNoteMeasure(unmarkedNote.measure);
                              setNoteKey(
                                `${unmarkedNote.note.track}:${unmarkedNote.note.index}`,
                              );
                              setNoteRegion(null);
                            }}
                          >
                            下一处未标记音符
                          </button>
                          <span>
                            当前第 {view.page} 页
                            {noteRegion && noteRegionPage === view.page
                              ? " · 已框选"
                              : ""}
                          </span>
                          <button
                            disabled={
                              disabled ||
                              !selectedNote ||
                              !count ||
                              loading ||
                              annotationEditing ||
                              selectingRegion ||
                              selectingNoteRegion
                            }
                            onClick={() => setSelectingNoteRegion(true)}
                          >
                            框选音符位置
                          </button>
                          {selectingNoteRegion && (
                            <>
                              <span role="status">
                                请在谱页上拖选这个音符所在的小区域。
                              </span>
                              <button
                                onClick={() => setSelectingNoteRegion(false)}
                              >
                                取消框选
                              </button>
                            </>
                          )}
                          {noteRegion && !selectingNoteRegion && (
                            <button
                              disabled={disabled}
                              onClick={() => {
                                if (noteDraft)
                                  locationSession.remove(
                                    noteDraft.id,
                                    noteDraft,
                                  );
                                setNoteRegion(null);
                                setActiveNoteDraft(null);
                              }}
                            >
                              移除本次框选
                            </button>
                          )}
                          {noteRegion && noteRegionPage !== view.page && (
                            <button
                              disabled={disabled || annotationEditing}
                              onClick={() => page(noteRegionPage)}
                            >
                              返回框选的第 {noteRegionPage} 页
                            </button>
                          )}
                          {noteDraftIssue && (
                            <span role="status">{noteDraftIssue}</span>
                          )}
                          {noteDraft && canReconfirm(noteDraft) && (
                            <button
                              disabled={disabled}
                              onClick={() => reconfirmLocation(noteDraft)}
                            >
                              已核对，沿用此框选
                            </button>
                          )}
                          <button
                            disabled={
                              disabled ||
                              !selectedNote ||
                              !noteRegion ||
                              noteRegionPage !== view.page ||
                              !currentAsset?.available ||
                              selectingNoteRegion ||
                              !!noteDraftIssue
                            }
                            onClick={() => void saveNoteLocation()}
                          >
                            {savedNoteAnchor ? "更新音符位置" : "保存音符位置"}
                          </button>
                        </div>
                        {savedNoteAnchor && (
                          <div className="paper-note-anchor-row">
                            <span>
                              {pitchName(savedNoteAnchor.pitch)} 已标在第{" "}
                              {savedNoteAnchor.page} 页
                              {savedNoteAnchor.grid !== practice.grid
                                ? " · 小节网格已变化"
                                : ""}
                            </span>
                            <button
                              disabled={disabled || selectingNoteRegion}
                              onClick={() => {
                                setActiveNoteDraft(null);
                                setNoteRegion(savedNoteAnchor.region);
                                setNoteRegionPage(savedNoteAnchor.page);
                                page(savedNoteAnchor.page);
                                pendingAnnotation.current = {
                                  page: savedNoteAnchor.page,
                                  region: savedNoteAnchor.region,
                                };
                              }}
                            >
                              查看 / 修改位置
                            </button>
                            <button
                              disabled={disabled || selectingNoteRegion}
                              onClick={() =>
                                void saveNoteAnchor(
                                  savedNoteAnchor.track,
                                  savedNoteAnchor.index,
                                  null,
                                  savedNoteAnchor,
                                )
                              }
                            >
                              移除音符位置
                            </button>
                          </div>
                        )}
                        {!notesForMeasure.length && (
                          <p className="parameter-help">
                            请选有演奏音符的小节。
                          </p>
                        )}
                      </>
                    )}
                  </details>
                )}
            </div>
          )}
        </aside>
        <div className="paper-reader-page">
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          {error && !needsPassword && !loading && (
            <button
              type="button"
              className="paper-resource-retry"
              disabled={
                disabled || exportBusy || selectingRegion || selectingNoteRegion
              }
              onClick={() => {
                setError("");
                setResourceRevision((value) => value + 1);
              }}
            >
              重新读取当前谱页
            </button>
          )}
          {locationNotice && (
            <p className="parameter-help" role="status">
              {locationNotice}
            </p>
          )}
          <PaperExportFeedback feedback={exports.feedback} />
          {exportBusy && (
            <button
              type="button"
              disabled={exportCommitting}
              onClick={exports.cancel}
            >
              {exportCommitting ? "正在完成文件保存…" : "取消本次导出"}
            </button>
          )}
          {preparedPage && !exportBusy && (
            <div className="paper-prepared-export" role="status">
              <strong>已制作的第 {preparedPage.page} 页批注图片</strong>
              <span>{(preparedPage.blob.size / 1_048_576).toFixed(1)} MB</span>
              <button type="button" onClick={() => void savePreparedPage()}>
                保存上次制作的图片
              </button>
              <button type="button" onClick={exports.releasePage}>
                释放这张临时图片
              </button>
              <small>
                保留的是制作完成时的谱页和批注快照，关闭当前谱本时释放。
              </small>
            </div>
          )}
          {preparedBook && !exportBusy && (
            <div className="paper-prepared-export" role="status">
              <strong>已制作的批注 PDF</strong>
              <span>
                {preparedBook.pages} 页原谱 ·{" "}
                {(preparedBook.bytes.length / 1_048_576).toFixed(1)} MB
              </span>
              <button type="button" onClick={() => void savePreparedBook()}>
                保存上次制作的 PDF
              </button>
              <button type="button" onClick={exports.releaseBook}>
                释放这份临时副本
              </button>
              <small>
                保留的是制作完成时的谱页和批注快照。内容修改后可以重新制作；关闭当前谱本时释放临时副本。
              </small>
            </div>
          )}
          {needsPassword && (
            <form
              className="paper-password"
              onSubmit={(e) => {
                e.preventDefault();
                setLoading(true);
                passwordCallback.current?.(password);
                setPassword("");
              }}
            >
              <input
                type="password"
                aria-label="PDF 密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
              <button disabled={!password}>打开 PDF</button>
            </form>
          )}
          <div
            className="paper-sheet-scroll"
            ref={frame}
            tabIndex={0}
            aria-label="谱页画布"
          >
            {annotationNotice && <p role="status">{annotationNotice}</p>}
            <PaperAnnotations
              key={`${contentId}:${attachment.id}:${attachment.format === "pdf" ? attachment.pages[0]?.id : attachment.pages[view.page - 1]?.id}:${attachment.format === "pdf" ? view.page : 1}`}
              contentId={contentId}
              book={attachment.id}
              assetId={
                (attachment.format === "pdf"
                  ? attachment.pages[0]
                  : attachment.pages[view.page - 1]
                )?.id ?? ""
              }
              page={attachment.format === "pdf" ? view.page : 1}
              rotation={view.rotation}
              width={sheetSize.width}
              height={sheetSize.height}
              notes={attachment.annotations ?? []}
              disabled={
                readOnly ||
                !!previewKind ||
                disabled ||
                loading ||
                !!error ||
                needsPassword ||
                exportBusy
              }
              editing={setAnnotationEditing}
              regionSelection={selectingRegion || selectingNoteRegion}
              regionSelected={(region) => {
                if (selectingNoteRegion) {
                  if (rememberLocation("note", region)) {
                    setNoteRegion(region);
                    setNoteRegionPage(view.page);
                    setSelectingNoteRegion(false);
                  }
                } else {
                  if (rememberLocation("measure", region)) {
                    setAnchorRegion(region);
                    setAnchorRegionPage(view.page);
                    setSelectingRegion(false);
                  }
                }
              }}
              save={saveAnnotation}
              saveInk={
                saveInk
                  ? (expected, strokes) =>
                      saveInk(
                        (attachment.format === "pdf"
                          ? attachment.pages[0]
                          : attachment.pages[view.page - 1]
                        )?.id ?? "",
                        attachment.format === "pdf" ? view.page : 1,
                        expected,
                        strokes,
                      )
                  : undefined
              }
            >
              <canvas
                ref={canvas}
                aria-label={`谱面第 ${view.page} 页`}
                hidden={!!error || needsPassword}
              />
              <PaperMeasureRegions
                anchors={visibleMeasureRegions}
                rotation={view.rotation}
                activeMeasure={
                  !stale
                    ? activeMeasureAnchor?.measure
                    : undefined
                }
                disabled={
                  disabled ||
                  noteSeekBusy ||
                  readOnly ||
                  !practice ||
                  stale ||
                  annotationEditing ||
                  selectingRegion ||
                  loading ||
                  !!error ||
                  needsPassword ||
                  !currentAsset?.available
                }
                measures={practice?.measures ?? 0}
                locate={jumpAnchor}
              />
              <PaperNoteRegions
                anchors={visibleNoteRegions}
                rotation={view.rotation}
                disabled={
                  disabled ||
                  readOnly ||
                  annotationEditing ||
                  selectingRegion ||
                  selectingNoteRegion ||
                  loading ||
                  !!error ||
                  needsPassword ||
                  !currentAsset?.available
                }
                select={selectPaperNote}
              />
              {anchorRegion &&
                anchorRegionPage === view.page &&
                (() => {
                  const r = paperAnnotationBox(anchorRegion, view.rotation);
                  return (
                    <span
                      className="paper-measure-region draft"
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.width * 100}%`,
                        height: `${r.height * 100}%`,
                      }}
                    >
                      第 {anchorMeasure} 小节位置
                    </span>
                  );
                })()}
              {noteRegion &&
                noteRegionPage === view.page &&
                selectedNote &&
                (() => {
                  const r = paperAnnotationBox(noteRegion, view.rotation);
                  return (
                    <span
                      className="paper-note-region draft"
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.width * 100}%`,
                        height: `${r.height * 100}%`,
                      }}
                    >
                      {pitchName(selectedNote.pitch)}
                    </span>
                  );
                })()}
            </PaperAnnotations>
            {loading && (
              <span className="paper-loading" role="status">
                正在载入谱页…
              </span>
            )}
          </div>
        </div>
      </div>
      {practiceAnchor !== null && (
        <PaperPracticeBuilder
          key={`${contentId}:${attachment.id}:${practiceAnchor}`}
          contentId={contentId}
          engineId={engineId}
          book={attachment.id}
          measure={practiceAnchor}
          close={() => setPracticeAnchor(null)}
        />
      )}
    </div>
  );
}

export async function verifyPdfRenderer() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const content = "0 0 0 rg 10 10 80 80 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const at = text.length;
  text += "xref\n0 5\n0000000000 65535 f \n";
  for (const n of offsets.slice(1))
    text += `${n.toString().padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  const task = pdfjs.getDocument({ data: new TextEncoder().encode(text) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 100;
    const ctx = canvas.getContext("2d")!;
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: page.getViewport({ scale: 1 }),
    }).promise;
    return ctx.getImageData(50, 50, 1, 1).data[0] < 10;
  } finally {
    await task.destroy();
  }
}
(
  window as unknown as { __panthesiaPdfCheck: () => Promise<boolean> }
).__panthesiaPdfCheck = verifyPdfRenderer;
