import { useEffect, useRef, useState } from "react";
import {useScorePage} from "./useScorePage";
import {emptyScorePages,type ScorePages, renderScore } from "./scoreRenderCache";
import "./scoreDocumentPreview.css";

export type ScorePreviewDocument = {
  bytes: number[] | Uint8Array;
  name: string;
};

/** Read-only engraving; adopting a score and installing playback mappings are separate actions. */
export function ScoreDocumentPreview({ bytes, name }: ScorePreviewDocument) {
  const [pages, setPages] = useState<ScorePages>(emptyScorePages);
  const [page, setPage] = useState(0);
  const pageView=useScorePage(pages,page);
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("正在排版谱面…");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setPages(emptyScorePages);
    setPage(0);
    setError("");
    setStatus("正在排版谱面…");
    void renderScore(
      {
        bytes: Array.from(bytes),
        compressed: bytes[0] === 80 && bytes[1] === 75,
      },
      controller.signal,
      (_stage, current, total) => {
        if (!controller.signal.aborted)
          setStatus(
            current && total
              ? `正在排版 ${current} / ${total} 页…`
              : "正在排版谱面…",
          );
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.pages.length)
          throw new Error("这份文件未生成可显示的谱页。");
        setPages(result.pages);
        setStatus("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [bytes, attempt]);
  useEffect(() => {
    viewport.current?.scrollTo(0, 0);
  }, [page, bytes]);
  useEffect(() => {
    if (!pages.length) return;
    const preview = viewport.current?.parentElement;
    const panel = preview?.closest<HTMLElement>(".browse-detail-section");
    if (preview && panel) {
      panel.scrollTop += Math.max(0, preview.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8);
    }
  }, [pages]);
  return (
    <section className="score-document-preview" aria-label={`${name}谱页预览`}>
      <div className="score-document-toolbar">
        <strong>谱页预览</strong>
        <span>原谱 · 采用后应用练习转调与量化</span>
        <div className="score-document-pagination">
          <button
            disabled={!pages.length || page === 0}
            onClick={() => setPage((value) => value - 1)}
            aria-label="预览上一页"
          >
            上一页
          </button>
          <output aria-live="polite">
            {pages.length ? `${page + 1} / ${pages.length}` : "—"}
          </output>
          <button
            disabled={!pages.length || page + 1 >= pages.length}
            onClick={() => setPage((value) => value + 1)}
            aria-label="预览下一页"
          >
            下一页
          </button>
          <select
            aria-label="谱页预览缩放"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            <option value={100}>适合宽度</option>
            <option value={125}>125%</option>
            <option value={150}>150%</option>
            <option value={200}>200%</option>
          </select>
        </div>
      </div>
      {error || pageView.error ? (
        <div className="score-document-message" role="alert">
          <p>{error || pageView.error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            重新显示谱页
          </button>
        </div>
      ) : !pages.length ? (
        <p className="score-document-message" role="status">
          {status}
        </p>
      ) : (
        <div
          className="score-document-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label="谱页滚动区域"
        >
          <div
            className="score-document-paper"
            style={{ width: `${zoom}%` }}
            dangerouslySetInnerHTML={{ __html: pageView.markup }}
          />
        </div>
      )}
    </section>
  );
}
