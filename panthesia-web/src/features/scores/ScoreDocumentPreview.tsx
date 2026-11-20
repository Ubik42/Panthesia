import { useEffect, useRef, useState } from "react";
import {useNotationReader} from "./useNotationReader";
import {NotationReaderNavigation} from "./NotationReaderNavigation";
import "./scoreDocumentPreview.css";

export type ScorePreviewDocument = {
  bytes: number[] | Uint8Array;
  name: string;
};

/** Read-only engraving; adopting a score and installing playback mappings are separate actions. */
export function ScoreDocumentPreview({ bytes, name }: ScorePreviewDocument) {
  const reader=useNotationReader(bytes),{pages,page,pageView,error,status}=reader;
  const [zoom,setZoom]=useState(100);
  const viewport=useRef<HTMLDivElement>(null);
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
          <NotationReaderNavigation reader={reader}/>
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
      {reader.busy&&pages.length>0&&<p className="score-document-message" role="status">{status||"正在读取谱页…"}</p>}
      {error || pageView.error ? (
        <div className="score-document-message" role="alert">
          <p>{error || pageView.error}</p>
          <button onClick={reader.retry}>
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
