import {useScorePage} from "./features/scores/useScorePage";
import type {ScorePages} from "./features/scores/scoreRenderCache";
import { useLocatedPaperSession } from "./features/scores/locatedPaperSession";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, pitchName, type LoadedSong } from "./api";
import type { ScoreMapping } from "./ScoreNoteEditor";
import { buildLocatedPaperPlanAsync, svgPagePng, type LocatedPaperPlan } from "./locatedScorePaper";
import "./located-score-paper.css";

export function LocatedScorePaperDialog({
  song, pages, mapping, sourceFingerprint, mappingToken, close,
}: {
  song: LoadedSong;
  pages: ScorePages;
  mapping: ScoreMapping[];
  sourceFingerprint: string;
  mappingToken: string;
  close: () => void;
}) {
  const [plan, setPlan] = useState<LocatedPaperPlan | null>(null);
  const sourceKey = JSON.stringify([song.engineId, song.contentId, song.scoreRevision, sourceFingerprint, mappingToken]);
  const { name, excluded, busy, committing, saved, progress, error, storageError, preparedPages, session } = useLocatedPaperSession(song.contentId, sourceFingerprint, `${song.title} · 可定位谱`, sourceKey, { title: song.title, path: song.sourcePath, engineId: song.engineId });
  const setName = session.setName, setExcluded = session.setExcluded;
  const setProgress = (progress: string) => session.update({ progress });
  const setError = (error: string) => session.update({ error });
  const [planning, setPlanning] = useState(true), [planningProgress, setPlanningProgress] = useState("");
  const [notePage, setNotePage] = useState(0);
  const latestSong = useRef(song); latestSong.current = song;
  const [previewPage, setPreviewPage] = useState(0);
  const pageView=useScorePage(pages,previewPage);
  const [selectedMeasure, setSelectedMeasure] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(0);
  const [focused, setFocused] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const identity = (note: LocatedPaperPlan["notes"][number]) => `${note.track}:${note.index}`;
  useEffect(() => {
    const controller = new AbortController();
    setPlan(null); setPlanning(true); setPlanningProgress("正在核对谱页音符位置…");
    void buildLocatedPaperPlanAsync(pages, mapping, latestSong.current, {
      signal: controller.signal,
      progress: (page, total) => { if (!controller.signal.aborted) setPlanningProgress(`正在核对第 ${page} / ${total} 页的音符位置…`); },
    }).then((result) => { if (!controller.signal.aborted) setPlan(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setPlanning(false); });
    return () => controller.abort();
  }, [pages, mapping, sourceKey]);
  useEffect(() => { setPreviewPage(0); setSelectedMeasure(0); setFocused(""); setNotePage(0); }, [sourceKey]);
  const accepted = useMemo(() => plan?.notes.filter(note => !excluded.has(identity(note))) ?? [], [plan, excluded]);
  const pageNotes = useMemo(() => plan?.notes.filter(note => note.page === previewPage + 1) ?? [], [plan, previewPage]);
  const measures = useMemo(() => [...new Set(plan?.notes.map(note => note.measure) ?? [])].sort((a, b) => a - b), [plan]);
  const listedNotes = useMemo(() => selectedMeasure ? plan?.notes.filter(note => note.measure === selectedMeasure) ?? [] : pageNotes, [plan, selectedMeasure, pageNotes]);
  const excludedCount = (plan?.notes.length ?? 0) - accepted.length;
  const notePages = Math.max(1, Math.ceil((listedNotes?.length ?? 0) / 60));
  const noteOffset = Math.min(notePage, notePages - 1) * 60;
  const visibleNotes = listedNotes?.slice(noteOffset, noteOffset + 60) ?? [];
  useEffect(() => { setNotePage(0); }, [previewPage, selectedMeasure, sourceKey]);
  const trackNames = useMemo(() => new Map(song.tracks.map(track => [track.id, track.name])), [song.tracks]);
  const selected = pageNotes.find(note => identity(note) === focused);
  useEffect(() => {
    if (!selected || !previewRef.current) return;
    const viewport = previewRef.current;
    const svg = viewport.querySelector("svg");
    if (!svg) return;
    const viewportRect = viewport.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    viewport.scrollTo({
      top: viewport.scrollTop + svgRect.top - viewportRect.top + selected.region.y * svgRect.height - viewport.clientHeight / 2,
      left: viewport.scrollLeft + svgRect.left - viewportRect.left + selected.region.x * svgRect.width - viewport.clientWidth / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [focused, previewPage, selected, pageView.markup]);
  const setListedNotes = (keep: boolean) => {
    setExcluded(current => {
      const next = new Set(current);
      for (const note of listedNotes) keep ? next.delete(identity(note)) : next.add(identity(note));
      return next;
    });
  };
  const chooseMeasure = (measure: number) => {
    setSelectedMeasure(measure);
    if (!measure) return;
    const first = plan?.notes.find(note => note.measure === measure);
    if (first) {
      setPreviewPage(first.page - 1);
      setFocused(identity(first));
    }
  };
  const save = async () => {
    if (!accepted.length || accepted.length > 10000 || busy || planning || !name.trim()) return;
    const controller = session.claim(sourceKey);
    if (!controller) return;
    const check = () => { if (controller.signal.aborted) throw new DOMException("谱页制作已停止", "AbortError"); };
    const metadata = { content_id: song.contentId, score_revision: song.scoreRevision, source_fingerprint: sourceFingerprint, mapping_token: mappingToken, name: name.trim(), anchors: accepted };
    try {
      const context = await api.command<{ contentId: string | null; grid: string }>({ type: "paperPracticeContext" });
      check();
      if (context.contentId !== song.contentId || !context.grid) throw new Error("当前曲目已改变，请重新打开关联乐谱");
      const current = await api.command<{ sourceFingerprint: string; readiness: string } | null>({ type: "score" });
      check();
      if (current?.sourceFingerprint !== sourceFingerprint || current.readiness !== "Ready") throw new Error("关联乐谱已改变，请重新打开后核对定位");
      session.beginPages(pages.key);
      const rendered: Blob[] = [];
      for (let index = 0; index < pages.length; index++) {
        check(); setProgress(`正在生成第 ${index + 1} / ${pages.length} 页…`);
        let image = session.image(index);
        if (!image) {
          image = await svgPagePng(await pages.get(index,controller.signal), controller.signal);
          check(); session.retainImage(index, image);
        }
        rendered.push(image);
      }
      check();
      const result = await api.createLocatedScorePaper(metadata, rendered, {
        signal: controller.signal,
        progress: (sent, total) => setProgress(`正在传输谱页：${Math.round(sent / total * 100)}%`),
        committing: () => session.update({ committing: true, progress: "正在保存谱页与逐音位置，请等待实际保存结果…" }),
      });
      session.saved(result);
    } catch (cause) {
      if (controller.signal.aborted && !session.getSnapshot().committing) session.update({ error: "", progress: `制作已停止，已生成 ${session.getSnapshot().preparedPages} 页。可以继续制作。` });
      else session.update({ error: `${session.getSnapshot().committing ? "保存结果需要核对。重试会复用相同谱页与音符位置。" : ""}${cause instanceof Error ? cause.message : String(cause)}`, progress: "" });
    } finally { session.release(controller); }
  };

  return (
    <div className="modal-backdrop">
      <section className="settings-dialog located-paper-dialog" role="dialog" aria-modal="true" aria-labelledby="located-paper-title">
        <header className="dialog-heading">
          <h2 id="located-paper-title">生成可定位纸谱</h2>
          <button aria-label="关闭可定位纸谱" disabled={busy} onClick={close}>关闭</button>
        </header>
        <p>软件会用当前已核对的关联乐谱生成本机谱页。请逐页查看音符位置；您可以在保存前跳过需要重新核对的音符。原有 PDF、图片和手工标记会保留。</p>
        <label>谱面名称 <input aria-label="可定位谱面名称" value={name} maxLength={80} disabled={busy || !!saved} onChange={(event) => setName(event.target.value)} /></label>
        {plan && (
          <div role="status" className="located-paper-summary">
            <p>共 {pages.length} 页；可定位 {plan.notes.length} 个演奏音符；本次保留 {accepted.length} 个；跳过 {plan.skipped + excludedCount} 个。</p>
            {plan.reasons.length > 0 && <p>{plan.reasons.join("；")}。</p>}
            {accepted.length > 10000 && <p>一份可定位谱最多保存 10000 个位置。请按页或小节跳过部分位置后保存。</p>}
            {excludedCount > 0 && <p>您手动跳过 {excludedCount} 个位置。这些音符以后仍可在纸谱中手工标记。</p>}
          </div>
        )}
        {pages.length > 0 && <>
          <div className="located-paper-pages">
            <button disabled={busy || previewPage === 0} onClick={() => { setPreviewPage(page => page - 1); setSelectedMeasure(0); setFocused(""); }}>上一页</button>
            <label>预览页码 <input aria-label="预览页码" type="number" min={1} max={pages.length} value={previewPage + 1}
              disabled={busy} onChange={event => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= pages.length) { setPreviewPage(next - 1); setSelectedMeasure(0); setFocused(""); } }} /> / {pages.length} 页</label>
            <button disabled={busy || previewPage >= pages.length - 1} onClick={() => { setPreviewPage(page => page + 1); setSelectedMeasure(0); setFocused(""); }}>下一页</button>
            <label>预览缩放 <select aria-label="谱页预览缩放" value={previewZoom} disabled={busy} onChange={event => setPreviewZoom(Number(event.target.value))}>
              <option value={0}>适合宽度</option><option value={1100}>原尺寸</option><option value={1650}>放大</option>
            </select></label>
            <span>本页保留 {pageNotes.filter(note => !excluded.has(identity(note))).length} / {pageNotes.length} 个位置</span>
          </div>
          <div className="located-paper-measures">
            {measures.length > 200 ? <>
              <label>定位演奏小节 <input type="number" aria-label="定位演奏小节" min={1} max={song.measures.length} step={1}
                placeholder="输入小节号" value={selectedMeasure || ""} disabled={busy}
                onChange={event => { const value = Number(event.target.value); if (!value || Number.isInteger(value) && value > 0 && value <= song.measures.length) chooseMeasure(value); }} /></label>
              <button type="button" disabled={busy || !selectedMeasure} onClick={() => chooseMeasure(0)}>查看当前页</button>
            </> : <>
            <label>定位演奏小节 <select aria-label="定位演奏小节" value={selectedMeasure} disabled={busy}
              onChange={event => chooseMeasure(Number(event.target.value))}>
              <option value={0}>查看当前页全部音符</option>
              {measures.map(measure => <option key={measure} value={measure}>第 {measure} 小节</option>)}
            </select></label>
            </>}
            {selectedMeasure > 0 && <span>本节保留 {listedNotes.filter(note => !excluded.has(identity(note))).length} / {listedNotes.length} 个位置；点击音符可跳到所在谱页。</span>}
          </div>
          <div className="located-paper-preview" aria-label={`生成谱页预览 · 第 ${previewPage + 1} 页`} ref={previewRef}>
            <div className="located-paper-sheet" style={{ width: previewZoom ? `${previewZoom}px` : "100%" }}>
              <div className="located-paper-svg" dangerouslySetInnerHTML={{ __html: pageView.markup }} />
              {selected && <span className={`located-paper-highlight ${excluded.has(identity(selected)) ? "excluded" : ""}`}
                style={{ left: `${selected.region.x * 100}%`, top: `${selected.region.y * 100}%`, width: `${selected.region.width * 100}%`, height: `${selected.region.height * 100}%` }} />}
            </div>
          </div>
          {plan && <div className="located-paper-notes">
            <div className="located-paper-notes-heading">
              <strong>{selectedMeasure ? `第 ${selectedMeasure} 小节音符位置` : "本页音符位置"}</strong>
              <button disabled={busy || !!saved || !listedNotes.length} onClick={() => setListedNotes(true)}>{selectedMeasure ? "保留本节" : "保留本页"}</button>
              <button disabled={busy || !!saved || !listedNotes.length} onClick={() => setListedNotes(false)}>{selectedMeasure ? "跳过本节" : "跳过本页"}</button>
            </div>
            <div className="located-paper-note-pagination" aria-label="音符列表分页">
              <span>{listedNotes.length} 个位置 · 第 {Math.min(notePage, notePages - 1) + 1} / {notePages} 页</span>
              <button type="button" disabled={notePage <= 0} onClick={() => setNotePage((value) => Math.max(0, value - 1))}>上一组</button>
              <button type="button" disabled={notePage >= notePages - 1} onClick={() => setNotePage((value) => Math.min(notePages - 1, value + 1))}>下一组</button>
            </div>
            <div className="located-paper-note-list">
              {visibleNotes.map(note => <div className="located-paper-note-row" key={identity(note)}>
                <input type="checkbox" aria-label={`保留音轨 ${note.track} 音符 ${note.index} 的位置`}
                  checked={!excluded.has(identity(note))} disabled={busy || !!saved}
                  onChange={event => { const keep = event.target.checked; setExcluded(current => { const next = new Set(current); keep ? next.delete(identity(note)) : next.add(identity(note)); return next; }); }} />
                <button className={focused === identity(note) ? "selected" : ""} onClick={() => { setPreviewPage(note.page - 1); setFocused(identity(note)); }}
                  aria-label={`查看第 ${note.measure} 小节 ${pitchName(note.pitch)} 的位置`}>第 {note.measure} 小节 · {pitchName(note.pitch)} · 第 {note.page} 页 · {trackNames.get(note.track) ?? `音轨 ${note.track}`}</button>
              </div>)}
              {!listedNotes.length && <p>{selectedMeasure ? "这一小节没有可靠的逐音位置。" : "这一页没有可靠的逐音位置。"}谱页仍会保存。</p>}
            </div>
          </div>}
        </>}
        {planning && <p role="status">{planningProgress}</p>}
        {preparedPages > 0 && !saved && <p className="parameter-help">已保留 {preparedPages} / {pages.length} 页图片；停止后可继续制作。</p>}
        {storageError && <div className="paper-draft-recovery" role="status"><span>{storageError}</span>
          <button type="button" disabled={busy} onClick={() => void navigator.clipboard.writeText(session.copy()).then(() => setProgress("已复制当前名称和音符选择。")).catch(() => setError("复制未完成，请重试。"))}>复制当前输入</button>
          <button type="button" disabled={busy} onClick={() => void session.preserveAndSave()}>复制原文并采用当前输入</button>
        </div>}
        {progress && <p role="status">{progress}</p>}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <footer className="dialog-actions">
          <button disabled={committing} onClick={busy ? session.cancel : close}>{busy ? "停止制作" : saved ? "完成" : "保留输入并关闭"}</button>
          {saved && <button type="button" onClick={session.startAnother}>继续制作新版本</button>}
          {!saved && <button disabled={busy || planning || !accepted.length || accepted.length > 10000 || !name.trim()} onClick={() => void save()}>{preparedPages ? "继续制作并保存" : "采用并保存"}</button>}
        </footer>
      </section>
    </div>
  );
}
