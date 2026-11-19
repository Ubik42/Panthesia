import { useMemo, useState } from "react";
import { RefreshCw, FileMusic, X, CheckCircle2, Loader2 } from "lucide-react";
import type { useScoreConversion } from "./useScoreConversion";
import "./scoreConversion.css";
import { PaperListPager } from "./PaperListPager";
import type { ScoreVersionRow } from "./scoreManagerDraftStore";
export function ScoreConversionPanel({
  conversion,
  busy,
  versions,
}: {
  conversion: ReturnType<typeof useScoreConversion>;
  busy: boolean;
  versions: ScoreVersionRow[];
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const expanded = conversion.draftExpanded;
  const setExpanded = (draftExpanded: boolean) =>
    conversion.browseDrafts({ draftExpanded, draftPage: 0 });
  const {
    job,
    jobStatus,
    jobBusy,
    pendingDraft,
    message,
    refreshPending,
    drafts,
    draftIssues,
  } = conversion;
  const active =
    jobStatus && ["preparing", "running"].includes(jobStatus.phase);
  const known = useMemo(
    () =>
      new Set(
        versions
          .filter((row) => row.available && row.fingerprint)
          .map((row) => row.fingerprint),
      ),
    [versions],
  );
  const matching = useMemo(() => {
    const query = conversion.draftQuery.trim().toLocaleLowerCase();
    return drafts.filter(
      (draft) =>
        !query ||
        [draft.name, draft.savedPath ?? ""].some((value) =>
          value.toLocaleLowerCase().includes(query),
        ),
    );
  }, [drafts, conversion.draftQuery]);
  const page = Math.min(
    conversion.draftPage,
    Math.max(0, Math.ceil(matching.length / 12) - 1),
  );
  const visible = expanded
    ? matching.slice(page * 12, page * 12 + 12)
    : drafts
        .filter(
          (draft) =>
            (!draft.saved || draft.savePending) &&
            !known.has(draft.fingerprint),
        )
        .slice(0, 3);
  if (
    !job &&
    !pendingDraft &&
    !drafts.length &&
    !draftIssues.length &&
    !refreshPending &&
    !jobBusy
  )
    return null;
  return (
    <section className="score-conversion-panel" aria-label="谱面任务与保留文件">
      <div className="score-conversion-heading">
        {jobBusy ? (
          <Loader2
            className="score-conversion-spinner"
            size={18}
            aria-hidden="true"
          />
        ) : (
          <FileMusic size={18} />
        )}
        <strong>
          {jobBusy
            ? "正在处理谱面"
            : pendingDraft
              ? pendingDraft.cached
                ? "谱面副本已保留"
                : "文件已读入，待核对"
              : job && active
                ? "原任务仍在处理"
                : "本机保留的谱面"}
        </strong>
        <span>{drafts.length} 份保留谱面</span>
      </div>
      {(jobBusy || job || pendingDraft) && (
        <p className="score-conversion-progress" role="status">
          {message || "可以继续读取原任务，或查看本机已生成的初稿。"}
        </p>
      )}
      {pendingDraft?.warning && (
        <p className="score-conversion-warning" role="status">
          {pendingDraft.warning}
        </p>
      )}
      <div className="score-conversion-actions">
        {!jobBusy && pendingDraft?.imported && !pendingDraft.cached && (
          <button
            disabled={busy}
            onClick={() => void conversion.retryRetainImported()}
          >
            重试保留文件副本
          </button>
        )}
        {job && !jobBusy && (
          <button
            disabled={busy}
            onClick={() => void conversion.resume().catch(() => {})}
          >
            <RefreshCw size={14} />
            继续读取原任务
          </button>
        )}
        {job && jobStatus?.cancellable !== false && (
          <button onClick={() => void conversion.cancel()}>取消当前任务</button>
        )}
        {!job && jobBusy && conversion.canCancelPreparation && (
          <button onClick={() => void conversion.cancel()}>停止图片准备</button>
        )}
        {pendingDraft && !jobBusy && (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void conversion.previewRetained()}
          >
            核对已保留初稿
          </button>
        )}
        {pendingDraft && !jobBusy && conversion.canExportRetained && (
          <button
            disabled={busy}
            onClick={() => void conversion.exportRetained()}
          >
            另存待核对初稿
          </button>
        )}
        {pendingDraft && !jobBusy && (
          <button disabled={busy} onClick={() => conversion.discardPending()}>
            放弃待核对内容
          </button>
        )}
        {!jobBusy && drafts.length > 0 && (
          <button
            disabled={busy}
            onClick={() => void conversion.refreshDrafts().catch(() => {})}
          >
            重新读取初稿列表
          </button>
        )}
      </div>
      {draftIssues.map((issue, index) => (
        <p className="score-conversion-warning" role="status" key={index}>
          {issue}
        </p>
      ))}
      {expanded && (
        <label className="score-draft-filter">
          查找初稿
          <input
            aria-label="查找保留的谱面初稿"
            placeholder="名称或另存位置"
            value={conversion.draftQuery}
            onChange={(event) =>
              conversion.browseDrafts({
                draftQuery: event.target.value,
                draftPage: 0,
              })
            }
          />
        </label>
      )}
      {visible.length > 0 && (
        <ul className="score-draft-list">
          {visible.map((draft) => (
            <li key={draft.id}>
              <div>
                <strong>{draft.name}</strong>
                <small>
                  {draft.kind === "importedNotation"
                    ? "添加的文件"
                    : draft.kind === "paperToNotation"
                      ? "纸谱识别"
                      : "MIDI 转谱"}{" "}
                  · {(draft.size / 1024).toFixed(0)} KB ·{" "}
                  {new Date(draft.createdAtMs).toLocaleString("zh-CN")}
                  {draft.saved && (
                    <span className="score-draft-saved">
                      <CheckCircle2 size={12} />
                      {draft.savePending
                        ? "原谱已保存，待完成关联"
                        : "已另存原谱"}
                    </span>
                  )}
                  {known.has(draft.fingerprint) && (
                    <span className="score-draft-saved">同内容版本已登记</span>
                  )}
                </small>
                {draft.savedPath && (
                  <small title={draft.savedPath}>{draft.savedPath}</small>
                )}
                {draft.sourceWarning && (
                  <small className="score-conversion-warning">
                    {draft.sourceWarning}
                  </small>
                )}
              </div>
              <button
                disabled={busy || jobBusy}
                onClick={() => void conversion.load(draft)}
              >
                {draft.savePending
                  ? "继续处理"
                  : draft.kind === "importedNotation"
                    ? "继续添加"
                    : "打开初稿"}
              </button>
              <button
                disabled={busy || jobBusy}
                onClick={() => void conversion.exportCopy(draft)}
              >
                另存副本
              </button>
              {confirm === draft.id ? (
                <>
                  <button
                    disabled={busy || jobBusy}
                    onClick={() => {
                      setConfirm(null);
                      void conversion.remove(draft);
                    }}
                  >
                    确认移除缓存
                  </button>
                  <button onClick={() => setConfirm(null)}>保留</button>
                </>
              ) : (
                <button
                  disabled={busy || jobBusy}
                  title="移除这份缓存初稿；原 MIDI、纸谱及已另存文件保留"
                  aria-label={`移除缓存初稿：${draft.name}`}
                  onClick={() => setConfirm(draft.id)}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {drafts.length > 0 && (
        <button
          className="score-draft-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "收起初稿列表"
            : `查看全部 ${drafts.length} 份初稿（含已处理）`}
        </button>
      )}
      {expanded && (
        <PaperListPager
          page={page}
          total={matching.length}
          size={12}
          label="保留谱面初稿分页"
          change={(draftPage) => conversion.browseDrafts({ draftPage })}
        />
      )}
      {expanded && !matching.length && <p>没有符合条件的初稿。</p>}
      <p className="score-conversion-help">
        本机副本包含添加的文件、转谱或识谱初稿。正式版本与个人原谱分别保留，核对后再选择保存或使用。
      </p>
    </section>
  );
}
