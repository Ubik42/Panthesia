import { ToolbarMore } from "../../app/ToolbarMore";
import { NotationTimeIndex, revealNotationNote } from "./notationTimeIndex";
import { useScorePage } from "./useScorePage";
import { emptyScorePages, type ScorePages, renderScore } from "./scoreRenderCache";
import "./notationWorkspace.css";
import type { ScoreToolRequest } from "./scoreToolRequest";
import type { ScoreMappingRequest } from "./mappingTypes";
import type { PracticeRange } from "../practice/usePracticeRange";
import { TaskActivity } from "../../engine/TaskActivity";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { PlaybackStore } from "../practice/playbackStore";
import { usePlaybackFields } from "../practice/usePlaybackFields";
import {
  api,
  pitchName,
  type Note,
  type LoadedSong,
} from "../../api";
import { ScoreNoteEditor, type ScoreMapping } from "./ScoreNoteEditor";
import { ScoreExportDialog } from "./ScoreExportDialog";
import { ScoreExportButton } from "./ScoreExportButton";
import { ScoreRoute, type WrittenRoute } from "./ScoreRoute";
import { ScoreRangeDialog } from "./ScoreRangeDialog";
import { LocatedScorePaperDialog } from "./LocatedScorePaperDialog";
import { actionsForNote, actionUsable, fingerSequence } from "../fingering/fingerActions";
interface Asset {
  contentId: string;
  window?:{first:number;count:number;total:number;start:number;end:number;firstNumber:number|string;lastNumber:number|string;previous?:number|null;intervals?:{start:number;end:number}[]};
  displayFingerprint?:string;
  sourceFingerprint: string;
  bytes: number[];
  name: string;
  compressed: boolean;
  coverage: number;
  alignmentSource?: "duetIdentity"|"matching"|"practiceIdentity";
  practiceNotation?: boolean;
  practiceNotationKind?: "simplified" | "quantized";
  confidence: number;
  readiness: string;
  diagnostics: string[];
  warnings: string[];
  trillCount?: number;
  mordentCount?: number;
  turnCount?: number;
  invertedTurnCount?: number;
  route?: WrittenRoute | null;
}
type Mapping = ScoreMapping;
const playbackSpeed = ["speed"] as const;
export function Notation({
  song,
  store,
  seek,
  changed,
  detail,
  assignHands,
  edit,
  onEdit,
  canEdit,
  toolRequest,
  clearToolRequest,
  selectPracticeNote,
  practiceRange,
  loop,
}: {
  song: LoadedSong;
  selectPracticeNote?: (note:Note)=>void;
  practiceRange?:PracticeRange|null;
  loop:(start:number,end:number)=>Promise<boolean>;
  toolRequest?: ScoreToolRequest | null;
  clearToolRequest?: () => void;
  store: PlaybackStore;
  seek: (position: number) => void;
  changed: () => Promise<void>;
  detail: (note: Note) => void;
  assignHands: () => void;
  edit: boolean;
  canEdit: boolean;
  onEdit: (value: boolean) => void;
}) {
  // Position changes every frame; read it on demand and react to it in subscriptions, never by rendering.
  const { speed } = usePlaybackFields(store, playbackSpeed);
  const position = () => store.getSnapshot().position;
  const [rangeSelection, setRangeSelection] = useState<{
    first: number;
    last: number;
  } | null>(null);
  const [pages, setPages] = useState<ScorePages>(emptyScorePages),
    [page, setPage] = useState(0),
    [asset, setAsset] = useState<Asset | null>(null),
    [mapping, setMapping] = useState<Mapping[]>([]),
    [mappingToken, setMappingToken] = useState(""),
    [follow, setFollow] = useState(true),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [renderStage, setRenderStage] = useState("正在读取乐谱…"),
    [ambiguities, setAmbiguities] = useState(0);
  const [showFingers, setShowFingers] = useState(true),
    [selected, setSelected] = useState<Mapping | null>(null),
    [selectionError, setSelectionError] = useState("");
  useEffect(() => {
    if (!edit) setSelected(null);
  }, [edit]);
  const [editorBusy, setEditorBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [locatingPaper, setLocatingPaper] = useState(false);
  useEffect(() => setExporting(false), [song.engineId, song.contentId, song.scoreRevision]);
  useEffect(() => setLocatingPaper(false), [song.engineId, song.contentId, song.scoreRevision]);
  const [toolIssue, setToolIssue] = useState("");
  useEffect(() => {
    if (
      !toolRequest ||
      toolRequest.contentId !== song.contentId ||
      toolRequest.engineId !== song.engineId ||
      editorBusy
    )
      return;
    if (toolRequest.kind === "export") {
      setExporting(true);
      setToolIssue("");
      clearToolRequest?.();
      return;
    }
    if (loading || (asset && asset.contentId !== song.contentId)) return;
    if (
      !asset ||
      asset.readiness !== "Ready" ||
      !mappingToken ||
      !mapping.length ||
      !pages.length
    ) {
      setToolIssue(
        "原谱的逐音对应尚未就绪。可重新读取乐谱，完成后会打开原制作入口。名称和选择继续保留。",
      );
      return;
    }
    if (
      toolRequest.sourceFingerprint &&
      toolRequest.sourceFingerprint !== asset.sourceFingerprint
    ) {
      setToolIssue(
        "当前原谱与这项制作的来源不同。可从谱面工作台切回原版本；原名称和音符选择可在工作进度中复制。",
      );
      return;
    }
    if (
      renderedMapping.current?.contentId !== song.contentId ||
      renderedMapping.current.scoreRevision !== song.scoreRevision
    )
      return;
    setToolIssue("");
    setLocatingPaper(true);
    clearToolRequest?.();
  }, [
    toolRequest,
    song.contentId,
    song.engineId,
    song.scoreRevision,
    editorBusy,
    loading,
    asset,
    mappingToken,
    mapping.length,
    pages.length,
    clearToolRequest,
  ]);
  const [zoom, setZoom] = useState(0),
    [simpleFingers, setSimpleFingers] = useState(false),
    [paperWidth, setPaperWidth] = useState(900);
  // "Fit width" reflows systems to the pane instead of enlarging A4 pages: the staff size is
  // the 100% size (0.5 px per Verovio unit), reduced until a system fits the pane.
  const [paneHeight, setPaneHeight] = useState(0),
    [systemUnits, setSystemUnits] = useState(0);
  // Wider systems hold more measures and grow taller, hence the 1.15 margin; below 0.35 the
  // staff stops being readable, and the follow scroll keeps the current note in view instead.
  const staffScale = systemUnits && paneHeight ? Math.max(0.35, Math.min(0.5, (paneHeight - 16) / (systemUnits * 1.15))) : 0.5;
  useEffect(() => setSystemUnits(0), [song.contentId, song.scoreRevision]);
  const layoutWidth = zoom ? 2100 : Math.min(9600, Math.max(1200, Math.round(paperWidth / staffScale / 400) * 400));
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(
        localStorage.getItem(`notation-view:${song.contentId}`) || "{}",
      );
      setZoom([0, 75, 100, 125, 150, 200].includes(v.zoom) ? v.zoom : 0);
      setSimpleFingers(v.simple === true);
    } catch {
      setZoom(0);
      setSimpleFingers(false);
    }
  }, [song.contentId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `notation-view:${song.contentId}`,
        JSON.stringify({ zoom, simple: simpleFingers }),
      );
    } catch {}
  }, [song.contentId, zoom, simpleFingers]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const update = () => {
      setPaperWidth(Math.max(240, el.clientWidth - 24));
      // The space below the toolbar, independent of how much score is loaded into it.
      // Messages above the score come and go; the toolbar and the pane do not.
      const box = el.closest(".notation-pane");
      const room = (box?.clientHeight ?? 0) - (box?.querySelector<HTMLElement>(".notation-toolbar")?.offsetHeight ?? 0);
      if (room > 0) setPaneHeight(room);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const pane = el.closest(".notation-pane");
    if (pane) ro.observe(pane);
    update();
    return () => ro.disconnect();
  }, [edit, selected?.id, loading]);
  const important = useMemo(() => {
    const keep = new Set<string>();
    for (const a of song.fingerActions ?? []) keep.add(`${a.track}:${a.index}`);
    const byHand = new Map<string, Note[]>();
    for (const n of song.notes) {
      const key = `${n.track}:${n.part}`;
      const rows = byHand.get(key) || [];
      rows.push(n);
      byHand.set(key, rows);
    }
    for (const rows of byHand.values()) {
      rows.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      rows.forEach((n, i) => {
        const a = rows[i - 1],
          b = rows[i + 1];
        const smooth = (x: Note | undefined, y: Note | undefined) =>
          x &&
          y &&
          x.finger != null &&
          y.finger != null &&
          y.start > x.start &&
          y.start - x.start <= x.duration + 0.12 &&
          Math.abs(y.pitch - x.pitch) <= 2 &&
          Math.abs(y.finger - x.finger) === 1 &&
          Math.sign(y.pitch - x.pitch) ===
            Math.sign((y.finger - x.finger) * (n.part === "left" ? -1 : 1));
        if (!smooth(a, n) || !smooth(n, b)) keep.add(`${n.track}:${n.index}`);
      });
    }
    return keep;
  }, [song.notes, song.fingerActions]);
  const pageView = useScorePage(pages,page);
  const html = useMemo(() => ({ __html: pageView.markup }), [pageView.markup]);
  useEffect(() => {
    if (zoom || !pageView.markup || !root.current) return;
    const systems = [...root.current.querySelectorAll("g.system")];
    const tallest = Math.max(0, ...systems.map((system) => system.getBoundingClientRect().height));
    // Measured once, on the standard-size layout (rendered pixels per unit is the paper width
    // over the layout width). Re-measuring after each reflow would chase taller systems that
    // hold more measures and shrink the staff without end.
    if (tallest) setSystemUnits((units) => units || Math.round(tallest / (paperWidth / layoutWidth)));
  }, [pageView.markup, zoom, paperWidth, layoutWidth]);
  useEffect(()=>{
    const selected=new Set(practiceRange?mapping.filter(m=>m.start<practiceRange.end&&m.end>practiceRange.start).map(m=>m.id):[]);
    root.current?.querySelectorAll("g.note").forEach(note=>note.classList.toggle("practice-range-note",selected.has(note.id)));
  },[practiceRange?.start,practiceRange?.end,mapping,pages,page,pageView.markup]);
  const notesById = useMemo(
    () => new Map(song.notes.map((n) => [`${n.track}:${n.index}`, n])),
    [song.notes],
  );
  const [reload, setReload] = useState(0);
  const [sourceRhythm, setSourceRhythm] = useState(false);
  const [rangeAnchor,setRangeAnchor]=useState<{first?:number;position?:number;last?:boolean}>({});
  const desiredFollow=useRef(true),pendingRange=useRef(false),currentPosition={get current(){return position();}};
  const rangeSong=useRef(`${song.engineId}:${song.contentId}:${song.scoreRevision}`);
  useEffect(()=>{
    const identity=`${song.engineId}:${song.contentId}:${song.scoreRevision}`;
    if(rangeSong.current!==identity){rangeSong.current=identity;setRangeAnchor({});desiredFollow.current=true;pendingRange.current=false;}
  },[song.engineId,song.contentId,song.scoreRevision]);
  useEffect(()=>setSourceRhythm(false),[song.contentId]);
  const renderedMapping = useRef<ScoreMappingRequest | null>(null);
  const mappingSequence = useRef(0), mappingWorking = useRef(false);
  const correlateRendered = useCallback(async (request: ScoreMappingRequest) => {
    const ticket = ++mappingSequence.current;
    renderedMapping.current = request;
    mappingWorking.current = true;
    setLoading(true);
    setRenderStage("正在对应乐谱与演奏…");
    setError("");
    try {
      const result = await api.mapScore(request);
      if (ticket !== mappingSequence.current) return;
      setMapping(result.mapping);
      setMappingToken(result.mappingToken ?? "");
      setAmbiguities(result.ambiguities);
      setFollow(desiredFollow.current && result.following && (result.mapping.length > 0 || !!request.measureRange));
      // The rendered pages remain in state; release MIDI and evidence after success.
      renderedMapping.current = null;
    } catch (cause) {
      if (ticket === mappingSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (ticket === mappingSequence.current) {
        mappingWorking.current = false;
        setLoading(false);
      }
    }
  }, []);
  const retryScore = () => {
    if (mappingWorking.current) return;
    const rendered = renderedMapping.current;
    if (rendered && rendered.contentId === song.contentId && rendered.scoreRevision === song.scoreRevision) {
      void correlateRendered(rendered);
    } else setReload(value => value + 1);
  };
  const root = useRef<HTMLDivElement>(null),
    activeIds = useRef<string[]>([]);
  useEffect(() => {
    let disposed = false;
    renderedMapping.current = null;
    mappingSequence.current++;
    mappingWorking.current = false;
    const controller = new AbortController();
    setPages(emptyScorePages);
    setAsset(null);
    setAmbiguities(0);
    setFollow(false);
    setSelected(null);
    setSelectionError("");
    setMapping([]);
    setMappingToken("");
    setLoading(true);
    setRenderStage("正在读取乐谱…");
    setError("");
    setPage(0);
    api
      .command<Asset | null>({ type:"scoreView",content_id:song.contentId,score_revision:song.scoreRevision,source:sourceRhythm&&song.hasScore,first_measure:rangeAnchor.first??null,position:rangeAnchor.position??currentPosition.current })
      .then((data) => {
        if (disposed) return;
        if (!data) {
          setLoading(false);
          setError("请先为这首 MIDI 配对 MusicXML 或 MXL 乐谱");
          return;
        }
        setAsset(data);
        void renderScore(data, controller.signal, (stage, page, total) => {
          if (!disposed) setRenderStage(stage === "index" ? `正在对应谱页 ${page} / ${total}…` : stage === "midi" ? "正在整理乐谱演奏顺序…" : stage === "loading" ? "正在读取并排版乐谱…" : "正在准备乐谱排版…");
        }, layoutWidth).then(async result => {
          if (disposed) return;
          setPages(result.pages);
          if(rangeAnchor.last)setPage(Math.max(0,result.pages.length-1));
          const evidence=await result.evidence();
          if(disposed || controller.signal.aborted)return;
          await correlateRendered({
            scoreRevision: song.scoreRevision, sourceFingerprint: data.sourceFingerprint,
            practiceNotation: data.practiceNotation === true,
            measureRange:data.window?{first:data.window.first,count:data.window.count}:undefined,
            displayFingerprint:data.displayFingerprint,
            ...evidence, pageCount:result.pages.length, contentId: data.contentId,
          });
          if(!disposed)pendingRange.current=false;
        }).catch(cause => {
          if (!disposed) {
            pendingRange.current=false;
            setError(cause instanceof Error ? cause.message : String(cause));
            setLoading(false);
          }
        });
      })
      .catch((e) => {
        if (!disposed) {
          pendingRange.current=false;
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      mappingSequence.current++;
      renderedMapping.current = null;
      mappingWorking.current = false;
      controller.abort();
    };
  }, [song.engineId, song.contentId, song.hasScore, song.scoreRevision, reload, correlateRendered, sourceRhythm, rangeAnchor, layoutWidth]);
  useEffect(()=>{
    const window=asset?.window;
    if(!window||!follow||loading)return;
    const check=()=>{
      if(pendingRange.current)return;
      const at=position();
      const inside=window.intervals ? window.intervals.some(interval=>at>=interval.start&&at<interval.end) : at>=window.start&&(at<window.end||window.first+window.count>=window.total);
      if(!inside && !(window.intervals && at>=song.duration && window.intervals.some(interval=>interval.end>=song.duration))) {
        pendingRange.current=true;desiredFollow.current=true;
        setRangeAnchor({position:at});
      }
    };
    check();
    return store.subscribe(check);
  },[asset,follow,loading,song.duration,store]);
  const timeIndex = useMemo(() => new NotationTimeIndex(mapping), [mapping]);
  useEffect(() => {
    // Rendered markup, page or zoom changed: element handles and the last target are stale.
    const elements = new Map<string, Element | null>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, root.current?.querySelector(`[id="${CSS.escape(id)}"]`) ?? null);
      return elements.get(id) ?? null;
    };
    activeIds.current.forEach((id) => element(id)?.classList.remove("playing-note"));
    activeIds.current = [];
    let revealed = "";
    const update = () => {
      const { active: current, next } = timeIndex.at(position());
      if (follow && next && next.page !== page) setPage(next.page);
      const ids = current.filter((n) => n.page === page).map((n) => n.id);
      if (ids.length !== activeIds.current.length || ids.some((id, i) => id !== activeIds.current[i])) {
        const keep = new Set(ids);
        activeIds.current.forEach((id) => keep.has(id) || element(id)?.classList.remove("playing-note"));
        const had = new Set(activeIds.current);
        ids.forEach((id) => had.has(id) || element(id)?.classList.add("playing-note"));
        activeIds.current = ids;
      }
      if (follow && next?.page === page && scroll.current && next.id !== revealed) {
        revealed = next.id;
        const note = element(next.id);
        if (note) revealNotationNote(scroll.current, note.querySelector(".notehead") ?? note, [note.closest("g.system"), note.closest("g.staff")]);
      }
    };
    update();
    return store.subscribe(update);
  }, [store, timeIndex, follow, page, pages, pageView.markup, zoom, paperWidth]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll(".score-practice-finger").forEach((n) => n.remove());
    el.querySelectorAll("g.note").forEach((n) => {
      n.classList.remove("selected-score-note");
      n.removeAttribute("tabindex");
      n.removeAttribute("role");
    });
    const groups = new Map<string, Mapping[]>();
    for (const m of mapping.filter((m) => m.page === page)) {
      const old = groups.get(m.id) ?? [];
      if (!old.some((x) => x.track === m.track && x.index === m.index))
        old.push(m);
      groups.set(m.id, old);
    }
    const occupiedLabels: DOMRect[] = [];
    for (const [id, entries] of groups) {
      const target = el.querySelector<SVGGraphicsElement>(
        `[id="${CSS.escape(id)}"]`,
      );
      if (!target) continue;
      target.setAttribute("role", "button");
      target.setAttribute("tabindex", "0");
      target.setAttribute(
        "aria-label",
        `${pitchName(entries[0].pitch)} · ${entries.length} 个演奏位置 · ${selectPracticeNote?"选择练习范围":edit ? "编辑指法" : "定位"}`,
      );
      if (selected?.id === id) target.classList.add("selected-score-note");
      if (!showFingers) continue;
      const notes = entries.map((m) => notesById.get(`${m.track}:${m.index}`));
      if (
        simpleFingers &&
        selected?.id !== id &&
        entries.every((m) => !important.has(`${m.track}:${m.index}`))
      )
        continue;
      const actions = entries.flatMap((m) => actionsForNote(song, m));
      const fingers = Array.from(
        new Set(
          notes
            .map((n) =>
              fingerSequence(n, n ? actionsForNote(song, n) : [], speed),
            )
            .filter(Boolean),
        ),
      );
      if (!fingers.length) continue;
      const head =
        target.querySelector<SVGGraphicsElement>(".notehead") ?? target;
      const svg = target.ownerSVGElement,
        ctm = svg?.getScreenCTM();
      if (!svg || !ctm) continue;
      const box = head.getBoundingClientRect();
      const point = new DOMPoint(
        box.left + box.width / 2,
        box.bottom + 13,
      ).matrixTransform(ctm.inverse());
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("class", "score-practice-finger");
      if (actions.length) {
        label.classList.add("score-practice-substitution");
        label.setAttribute("data-score-note", id);
        label.setAttribute("tabindex", "0");
        label.setAttribute("role", "button");
        label.setAttribute(
          "aria-label",
          `${pitchName(entries[0].pitch)} 持音换指 ${fingers.join(" / ")}，查看演奏位置`,
        );
        target.setAttribute(
          "aria-label",
          `${pitchName(entries[0].pitch)} · ${entries.length} 个演奏位置 · 持音换指 ${fingers.join(" / ")}`,
        );
        label.setAttribute(
          "data-actions-valid",
          String(actions.every((a) => actionUsable(a, speed))),
        );
      }
      label.setAttribute("x", String(point.x));
      label.setAttribute("y", String(point.y));
      label.setAttribute("font-size", String(13 / Math.hypot(ctm.a, ctm.b)));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute(
        "fill",
        actions.some((a) => !actionUsable(a, speed))
          ? "#9a4b08"
          : notes[0]?.part === "left"
            ? "#0765a3"
            : "#4b751c",
      );
      label.setAttribute("font-weight", "700");
      label.textContent = fingers.join("/");
      svg.append(label);
      // Keep longer substitution chains clear of adjacent personal fingering labels.
      for (let row = 1; row <= 10; row++) {
        const rect = label.getBoundingClientRect();
        if (
          !occupiedLabels.some(
            (old) =>
              rect.left < old.right + 3 &&
              rect.right + 3 > old.left &&
              rect.top < old.bottom + 3 &&
              rect.bottom + 3 > old.top,
          )
        )
          break;
        const shifted = new DOMPoint(
          box.left + box.width / 2,
          box.bottom + 13 + row * 15,
        ).matrixTransform(ctm.inverse());
        label.setAttribute("x", String(shifted.x));
        label.setAttribute("y", String(shifted.y));
      }
      occupiedLabels.push(label.getBoundingClientRect());
    }
  }, [
    mapping,
    pages,
    pageView.markup,
    page,
    song.notes,
    song.fingerActions,
    speed,
    showFingers,
    selected,
    edit,
    simpleFingers,
    important,
    zoom,
    paperWidth,
    Boolean(selectPracticeNote),
  ]);
  const activate = (target: Element | null) => {
    if (!target || editorBusy) return;
    const choices = mapping.filter(
      (n) => n.id === target.id && n.page === page,
    );
    const unique = Array.from(
      new Map(choices.map((n) => [`${n.track}:${n.index}`, n])).values(),
    );
    const n = unique.find((n) => n.end >= position()) ?? unique[0];
    if (!n) {
      if (edit)
        setSelectionError("此谱音没有可靠的演奏对应关系，请先核对乐谱配对。");
      return;
    }
    setSelectionError("");
    if(selectPracticeNote){const note=notesById.get(`${n.track}:${n.index}`);if(note)selectPracticeNote(note);return;}
    if (edit) {
      setFollow(false);
      setSelected(n);
    } else seek(n.start);
  };
  const activateLabel = (element: Element | null) => {
    const label = element?.closest(".score-practice-substitution");
    if (label) {
      const id = label.getAttribute("data-score-note");
      const choices = mapping
        .filter((m) => m.id === id && m.page === page)
        .sort((a, b) => a.start - b.start);
      const choice = choices.find((m) => m.end >= position()) ?? choices[0];
      if (!choice || editorBusy) return;
      if(selectPracticeNote){const note=notesById.get(`${choice.track}:${choice.index}`);if(note)selectPracticeNote(note);return;}
      if (canEdit) {
        onEdit(true);
        setFollow(false);
        setSelected(choice);
      } else seek(choice.start);
    } else activate(element?.closest("g.note") ?? null);
  };
  const locate = (track: number, index: number) => {
    const next = mapping.find((m) => m.track === track && m.index === index);
    if (!next) return false;
    setFollow(false);
    setPage(next.page);
    setSelected(next);
    return true;
  };
  const positions = selected
    ? Array.from(
        new Map(
          mapping
            .filter((m) => m.id === selected.id && m.page === selected.page)
            .map((m) => [`${m.track}:${m.index}`, m]),
        ).values(),
      ).sort((a, b) => a.start - b.start)
    : [];
  return (
    <div className="notation-pane">
      <div className="notation-toolbar">
        <button
          disabled={loading || (page === 0 && !asset?.window?.first)}
          onClick={() => {
            desiredFollow.current=false;setFollow(false);
            if(page>0)setPage(page-1);
            else if(asset?.window)setRangeAnchor({first:asset.window.previous??Math.max(0,asset.window.first-32),last:true});
          }}
        >
          上一页
        </button>
        <span>{asset?.window ? `第 ${asset.window.firstNumber}–${asset.window.lastNumber} 小节 · ` : ""}{pages.length ? `${page + 1} / ${pages.length}` : "乐谱"}</span>
        <button
          disabled={loading || (page >= pages.length - 1 && (!asset?.window || asset.window.first+asset.window.count>=asset.window.total))}
          onClick={() => {
            desiredFollow.current=false;setFollow(false);
            if(page<pages.length-1)setPage(page+1);
            else if(asset?.window)setRangeAnchor({first:asset.window.first+asset.window.count});
          }}
        >
          下一页
        </button>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {desiredFollow.current=e.target.checked;setFollow(e.target.checked);}}
            disabled={loading || (!mapping.length && !asset?.window) || !!error}
          />
          跟随演奏
        </label>
        <label>
          缩放
          <select
            aria-label="乐谱缩放"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={0}>适合宽度</option>
            {[75, 100, 125, 150, 200].map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
        </label>
        <ToolbarMore label="谱面选项" disabled={loading}>
        <button
          className={edit ? "selected" : ""}
          disabled={!mapping.length || editorBusy || !canEdit}
          onClick={() => {
            onEdit(!edit);
            setSelected(null);
            setSelectionError("");
          }}
        >
          谱面指法
        </button>
        <label>
          <input
            type="checkbox"
            checked={showFingers}
            onChange={(e) => setShowFingers(e.target.checked)}
          />
          练习指法
        </label>
        <label>
          显示
          <select
            aria-label="指法显示密度"
            value={simpleFingers ? "important" : "all"}
            disabled={!showFingers}
            onChange={(e) => setSimpleFingers(e.target.value === "important")}
            title="重点显示保留乐句首尾、换指、重复音与不连续的指法，省略连续顺指的中间标注"
          >
            <option value="all">全部指法</option>
            <option value="important">重点指法</option>
          </select>
        </label>
        {song.hasScore && !asset?.practiceNotation && <ScoreExportButton song={song} disabled={editorBusy} expanded={exporting} open={() => setExporting(true)} />}
        {song.hasScore && !asset?.practiceNotation && <button
          disabled={loading || editorBusy || asset?.practiceNotation || asset?.readiness !== "Ready" || !asset.sourceFingerprint || !mappingToken || !mapping.length || !pages.length}
          onClick={() => setLocatingPaper(true)}
          title="根据已核对的 MusicXML 谱页，生成可从练习历史逐音定位的纸谱"
        >
          {asset?.window&&asset.window.count<asset.window.total?"生成当前范围纸谱":"生成可定位纸谱"}
        </button>}
        {!!song.practiceVariant?.settings.quantize && song.hasScore && <label>书面节奏 <select aria-label="谱面节奏来源" value={sourceRhythm ? "source" : "practice"} disabled={editorBusy} onChange={event=>{setRangeAnchor({position:currentPosition.current});setSourceRhythm(event.target.value==="source");}}><option value="practice">量化练习谱</option><option value="source">所选原谱</option></select></label>}
        <span className="notation-alignment-status" title={asset?.alignmentSource === "duetIdentity" ? "DuET 逐音来源已核对" : undefined}>
          {asset
            ? `${asset.practiceNotation ? (asset.practiceNotationKind === "simplified" ? "MIDI 简化谱" : "量化练习谱") : asset.alignmentSource === "duetIdentity" ? "逐音" : "配对"} ${asset.coverage}% · ${asset.readiness === "Ready" ? "可跟随" : asset.readiness === "Blocked" ? "导航未通过" : "需校对"}${asset.trillCount ? ` · 颤音 ${asset.trillCount} 处` : ""}${asset.mordentCount ? ` · 波音 ${asset.mordentCount} 处` : ""}${asset.turnCount ? ` · 回音 ${asset.turnCount} 处` : ""}${asset.invertedTurnCount ? ` · 倒回音 ${asset.invertedTurnCount} 处` : ""}`
            : ""}
        </span>
      {asset?.route && (
        <ScoreRoute
          key={`${song.contentId}:${song.scoreRevision}:${sourceRhythm}`}
          route={asset.route}
          practice={asset.practiceNotation}
          store={store}
          seek={seek}
          disabled={editorBusy}
          selectRange={(first, last) => setRangeSelection({ first, last })}
          loop={async (start, end) => {
            if(!(await loop(start,end)))throw Error("循环尚未设置，请稍后重试。");
          }}
        />
      )}
      {asset?.practiceNotationKind === "simplified" && <p className="score-rhythm-note">书面节奏按十六分音符整理，演奏保持原时序。复杂节奏可从“添加 / 管理谱面”使用 DuET 制谱。</p>}
        </ToolbarMore>
      </div>
      {rangeSelection && (
        <ScoreRangeDialog
          song={song}
          {...rangeSelection}
          close={() => setRangeSelection(null)}
          changed={changed}
        />
      )}
      {toolRequest && toolIssue && <div className="score-message" role="status"><p>{toolIssue}</p><button type="button" onClick={() => { setToolIssue(""); clearToolRequest?.(); }}>收起工作提示</button></div>}
      {exporting && (
        <ScoreExportDialog song={song} allowPrepare={!!asset && !loading} close={() => setExporting(false)} />
      )}
      {locatingPaper && asset?.readiness === "Ready" && mappingToken && (
        <LocatedScorePaperDialog
          song={song}
          pages={pages}
          mapping={mapping}
          sourceFingerprint={asset.sourceFingerprint}
          mappingToken={mappingToken}
          sourceRangeLabel={asset.window&&asset.window.count<asset.window.total?`原谱第 ${asset.window.firstNumber}–${asset.window.lastNumber} 小节`:undefined}
          performanceIntervals={asset.window?.intervals}
          close={() => setLocatingPaper(false)}
        />
      )}

      <TaskActivity contentId={song.contentId} label="对应乐谱音符" cancelLabel="取消对应" />
      {pageView.error && <p className="score-message" role="alert">{pageView.error}</p>}
      {pageView.loading && pages.length>0 && <p className="score-message" role="status">正在读取谱页…</p>}
      {loading && <p className="score-message" role="status">{renderStage}</p>}
      {error && (
        <div className="score-message" role="alert">
          <p>{error}</p>
          <button disabled={loading || editorBusy} onClick={retryScore}>
            {renderedMapping.current ? "重试音符对应" : "重新读取乐谱"}
          </button>
        </div>
      )}
      {!loading && !error && pages.length > 0 && !mapping.length && <p className="score-message">
        原谱可继续阅读。建立可靠的逐音对应后，可使用跟随与指法编辑。
      </p>}
      {asset && asset.diagnostics.length > 0 && (
        <p className="score-message">{asset.diagnostics.join("；")}</p>
      )}
      {ambiguities > 0 && (
        <p className="score-message">
          {ambiguities} 组音符身份不明确，已保留显示并跳过高亮。
        </p>
      )}
      {!!song.fingerActions?.length && (
        <p className="score-message score-held-legend">
          箭头表示保持琴键按下时换指；点选数字查看拍位与衔接音。⚠
          表示当前条件需要重新审阅。
          {song.fingerActions.some(
            (a) =>
              !mapping.some((m) => m.track === a.track && m.index === a.index),
          )
            ? "部分换指尚无可靠谱面对应，请在指法建议中查看。"
            : ""}
        </p>
      )}
      {selectionError && (
        <p className="score-message" role="alert">
          {selectionError}
        </p>
      )}
      {edit && !selected && (
        <p className="score-message">
          点选谱面音符编辑指法；有多次演奏位置时可分别修改。
        </p>
      )}
      <div className={`notation-body ${edit && selected ? "editing" : ""}`}>
        <div
          className="notation-scroll"
          ref={scroll}
        >
          <div
            className="score-paper"
            style={{
              width: zoom ? `${(1050 * zoom) / 100}px` : `${paperWidth}px`,
              maxWidth: "none",
            }}
            ref={root}
            onClick={(e) => activateLabel(e.target as Element)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                const target = (e.target as Element).closest(
                  "g.note,.score-practice-substitution",
                );
                if (target) {
                  e.preventDefault();
                  e.stopPropagation();
                  activateLabel(target);
                }
              }
            }}
            dangerouslySetInnerHTML={html}
          />
        </div>
        {edit && selected && (
          <ScoreNoteEditor
            song={song}
            positions={positions}
            selected={selected}
            choose={setSelected}
            close={() => setSelected(null)}
            changed={changed}
            detail={detail}
            assignHands={assignHands}
            onBusy={setEditorBusy}
            seek={seek}
            locate={locate}
            rate={speed}
          />
        )}
      </div>
    </div>
  );
}
