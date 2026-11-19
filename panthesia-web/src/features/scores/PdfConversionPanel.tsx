import { useState } from "react";
import { FileText, Loader2, RefreshCw, X } from "lucide-react";
import { ScoreFilePreview } from "../../ScoreFilePreview";
import type { usePdfConversion } from "./usePdfConversion";
import "./scoreConversion.css";
export function PdfConversionPanel({
  pdf,
  busy,
}: {
  pdf: ReturnType<typeof usePdfConversion>;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const rows =
    pdf.pdfLast && !pdf.pdfDrafts.some((draft) => draft.id === pdf.pdfLast!.id)
      ? [pdf.pdfLast, ...pdf.pdfDrafts]
      : pdf.pdfDrafts;
  const working = pdf.pdfBusy || pdf.pdfSubmission;
  const visible = expanded
    ? rows
    : rows
        .filter((draft) => !draft.paperId || draft.adoptionPending)
        .slice(0, 3);
  if (
    !working &&
    !pdf.pdfJob &&
    !rows.length &&
    !pdf.pdfTotal &&
    !pdf.pdfIssues.length &&
    !pdf.pdfError
  )
    return null;
  return (
    <section
      className="score-conversion-panel score-pdf-panel"
      aria-label="PDF 排版与保留结果"
      aria-busy={working}
    >
      <div className="score-conversion-heading">
        {working ? (
          <Loader2
            size={18}
            className="score-conversion-spinner"
            aria-hidden="true"
          />
        ) : (
          <FileText size={18} />
        )}
        <strong>
          {pdf.pdfAdopting
            ? "正在加入 PDF 谱面"
            : working
              ? "正在处理 PDF"
              : "本机保留的排版 PDF"}
        </strong>
        <span>
          {pdf.pdfAll
            ? `本机 ${pdf.pdfTotal} 份 PDF 缓存`
            : `当前 ${rows.length} 份 · 本机 ${pdf.pdfTotal} 份 PDF 缓存`}
        </span>
      </div>
      {pdf.pdfMessage && (
        <p role="status" className="score-conversion-progress">
          {pdf.pdfMessage}
        </p>
      )}
      {pdf.pdfError && (
        <p role="alert" className="dialog-error">
          {pdf.pdfError}
        </p>
      )}
      {pdf.pdfIssues.map((issue, index) => (
        <p key={index} role="status" className="score-conversion-warning">
          {issue}
        </p>
      ))}
      <div className="score-conversion-actions">
        {pdf.supported && (
          <button
            disabled={busy || working}
            aria-pressed={pdf.pdfAll}
            onClick={() => void pdf.refresh(!pdf.pdfAll).catch(() => {})}
          >
            {pdf.pdfAll ? "只看当前曲目" : "管理全部曲目的 PDF 缓存"}
          </button>
        )}
        {pdf.pdfJob && !pdf.pdfBusy && (
          <button disabled={busy} onClick={() => void pdf.resume()}>
            <RefreshCw size={14} />
            继续读取原排版任务
          </button>
        )}
        {pdf.pdfJob &&
          !pdf.pdfAdopting &&
          pdf.pdfStatus?.cancellable !== false && (
            <button onClick={() => void pdf.cancel()}>取消排版</button>
          )}
        {!working && (
          <button
            disabled={busy}
            onClick={() => void pdf.refresh().catch(() => {})}
          >
            重新读取 PDF 列表
          </button>
        )}
      </div>
      {!!visible.length && (
        <ul className="score-draft-list">
          {visible.map((draft) => (
            <li key={draft.id}>
              <div>
                <strong>{draft.name}</strong>
                <small>
                  {pdf.pdfAll && (
                    <span>{draft.sourceTitle || "排版时的原谱"} · </span>
                  )}
                  {(draft.size / 1_048_576).toFixed(1)} MB ·{" "}
                  {new Date(draft.createdAtMs).toLocaleString("zh-CN")} ·{" "}
                  {draft.adoptionPending
                    ? "加入结果待确认"
                    : draft.paperId
                      ? "已加入谱页"
                      : "已保留，尚未加入谱页"}
                </small>
                {draft.warning && (
                  <p className="score-pdf-note">{draft.warning}</p>
                )}
              </div>
              <button
                disabled={busy || working}
                data-focus-key={`pdf-preview:${draft.id}`}
                onClick={() => void pdf.action(draft, "view")}
              >
                查看 PDF
              </button>
              <button
                disabled={busy || working}
                onClick={() => void pdf.action(draft, "export")}
              >
                另存副本
              </button>
              <button
                disabled={
                  busy || working || draft.contentId !== pdf.source.contentId
                }
                onClick={() => void pdf.adopt(draft)}
                title={
                  draft.contentId !== pdf.source.contentId
                    ? "返回来源曲目后可以加入谱页；当前可以查看、另存或移除缓存"
                    : undefined
                }
              >
                {draft.adoptionPending
                  ? "确认并继续加入"
                  : draft.paperId
                    ? "确认保存结果"
                    : "加入谱页"}
              </button>
              {remove === draft.id ? (
                <>
                  <button
                    disabled={busy || working}
                    onClick={() => {
                      setRemove(null);
                      void pdf.action(draft, "remove");
                    }}
                  >
                    确认移除缓存
                  </button>
                  <button onClick={() => setRemove(null)}>保留</button>
                </>
              ) : (
                <button
                  disabled={busy || working}
                  aria-label={`移除 PDF 缓存：${draft.name}`}
                  title="只移除排版缓存，已加入的谱页和个人原谱保留"
                  onClick={() => setRemove(draft.id)}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!!rows.length && (
        <button
          className="score-draft-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "收起 PDF 列表"
            : `查看全部 ${rows.length} 份 PDF（含已加入谱页）`}
        </button>
      )}
      {pdf.preview && (
        <ScoreFilePreview
          file={pdf.preview}
          close={pdf.closePreview}
          closeLabel="返回 PDF 列表"
          label="保留的排版 PDF 预览"
        />
      )}
      <p className="score-conversion-help">
        PDF
        来自原谱快照。排版结果保存在本机，加入谱页失败后可以继续处理；移除缓存时保留已经加入曲目的谱页。
      </p>
    </section>
  );
}
