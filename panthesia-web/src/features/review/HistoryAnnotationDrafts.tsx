import { useState, useSyncExternalStore } from "react";
import type { AnnotationDraft } from "./annotationDraft";
import type { HistoryEntry } from "./historyTypes";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import { editDraftPersistence } from "../editing/editDraftStore";
import { EditDraftStatus } from "../editing/EditDraftStatus";
const empty = { error: "", pending: false };
const fallback = () => empty;
const subscribe = () => () => {};
export function HistoryAnnotationDrafts({
  drafts,
  blocked,
  editingKey,
  open,
}: {
  drafts?: Map<string, AnnotationDraft>;
  blocked: boolean;
  editingKey: string | null;
  open: (entry: HistoryEntry) => void;
}) {
  const persistence = editDraftPersistence(drafts);
  useSyncExternalStore(
    persistence?.subscribe ?? subscribe,
    persistence?.getSnapshot ?? fallback,
    fallback,
  );
  const [, update] = useState(0);
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const pending = [...(drafts?.entries() ?? [])].filter(
    ([, value]) => value.entry,
  );
  const text = query.trim().toLocaleLowerCase();
  const matching = pending.filter(([, row]) =>
    `${row.entry!.title} ${new Date(row.entry!.recordedAt).toLocaleString("zh-CN")} ${row.draft.note} ${row.draft.teacher} ${row.draft.next}`
      .toLocaleLowerCase()
      .includes(text),
  );
  const last = Math.max(0, Math.ceil(matching.length / 12) - 1),
    current = Math.min(page, last);
  if (!pending.length) return null;
  return (
    <details className="history-annotation-drafts">
      <summary>评语输入与提交 · {pending.length} 条</summary>
      <p>按演奏记录分别保留。打开后读取最新评语，已有输入继续保留。</p>
      <EditDraftStatus drafts={drafts} visible={pending.length > 0} />
      <label className="edit-draft-search">
        查找评语草稿
        <input
          type="search"
          value={query}
          maxLength={4096}
          placeholder="曲名、日期或评语文字"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <ul>
        {matching
          .slice(current * 12, (current + 1) * 12)
          .map(([key, value]) => (
            <li key={key}>
              <div>
                <strong>{value.entry!.title}</strong>
                <span>
                  {new Date(value.entry!.recordedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <div className="history-annotation-draft-actions">
                <button disabled={blocked} onClick={() => open(value.entry!)}>
                  {value.pending ? "核对评语提交" : "继续编辑评语"}
                </button>
                {value.pending && (
                  <span>
                    {value.pending.phase === "refresh"
                      ? "保存回复已保留"
                      : "提交结果待核对"}
                  </span>
                )}
                <CopyPracticeDraft
                  label="复制评语草稿"
                  value={value}
                  plainText
                  createText={() =>
                    JSON.stringify(
                      {
                        entry: value.entry,
                        base: value.base,
                        draft: value.draft,
                        pending: value.pending,
                      },
                      null,
                      2,
                    )
                  }
                />
                <button
                  disabled={blocked || key === editingKey}
                  onClick={() => {
                    drafts?.delete(key);
                    update((value) => value + 1);
                  }}
                >
                  放弃这条草稿
                </button>
              </div>
            </li>
          ))}
      </ul>
      {!matching.length && (
        <p role="status">没有符合当前查找条件的评语草稿。</p>
      )}
      {matching.length > 12 && (
        <nav className="edit-draft-pagination" aria-label="评语草稿分页">
          <span>
            {current + 1} / {last + 1} 页 · {matching.length} 条
          </span>
          <button
            disabled={blocked || current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </button>
          <button
            disabled={blocked || current === last}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </details>
  );
}
