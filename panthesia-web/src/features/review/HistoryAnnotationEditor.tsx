import { useEffect, useState } from "react";
import { EditDraftStatus } from "../editing/EditDraftStatus";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import {
  annotationFields,
  annotationText,
  type AnnotationDraft,
  type AnnotationText,
} from "./annotationDraft";
import type { Annotation, HistoryEntry } from "./historyTypes";
import { useAnnotationEditor } from "./useAnnotationEditor";
import { editDraftValue } from "../editing/editDraftStore";
import "./historyAnnotationEditor.css";
export type { Annotation } from "./historyTypes";

export function HistoryAnnotationEditor({
  value,
  locked,
  saveBlocked = false,
  reading = false,
  onLocked,
  save,
  readLatest,
  received,
  entry,
  draftMemory,
  draftKey = "",
  engineId,
  active = true,
}: {
  value: Annotation | null;
  locked: boolean;
  saveBlocked?: boolean;
  reading?: boolean;
  onLocked: (value: boolean) => void;
  save: (
    value: AnnotationText,
    expected: Annotation | null,
    engineId?: string,
  ) => Promise<Annotation | null>;
  readLatest?: () => void;
  received?: (value: Annotation | null) => void;
  entry?: HistoryEntry;
  draftMemory?: Map<string, AnnotationDraft>;
  draftKey?: string;
  engineId?: string;
  active?: boolean;
}) {
  const editor = useAnnotationEditor({
    value,
    entry,
    memory: draftMemory,
    draftKey,
    engineId,
    active,
    save,
    refresh: readLatest,
    received,
  });
  const [choices, setChoices] = useState<
    Partial<Record<keyof AnnotationText, "mine" | "latest">>
  >({});
  const [expanded, setExpanded] = useState<keyof AnnotationText | null>(
    () => draftMemory?.get(draftKey)?.field ?? "note",
  );
  const latest = annotationText(editor.latest),
    original = annotationText(editor.base);
  useEffect(() => {
    onLocked(editor.writing || (editor.dirty && !draftMemory));
    return () => onLocked(false);
  }, [editor.writing, editor.dirty, draftMemory, onLocked]);
  useEffect(() => setChoices({}), [editDraftValue(editor.latest)]);
  const choice = (field: keyof AnnotationText) =>
    choices[field] ??
    (editor.draft[field] === latest[field] || latest[field] === original[field]
      ? "mine"
      : editor.draft[field] === original[field]
        ? "latest"
        : undefined);
  const unresolved = annotationFields.some(({ key }) => !choice(key));
  const frozen = editor.busy || locked || editor.conflict || !!editor.pending;
  return (
    <section
      className="history-annotation history-annotation-workbench"
      aria-label="备注与教师评语"
      aria-busy={editor.busy || editor.reading}
    >
      <header>
        <div>
          <h3>备注与教师评语</h3>
          <p>记录这次练习的观察和下次重点，文字评语随原成绩保存。</p>
        </div>
        {editor.latest && (
          <time>
            {new Date(editor.latest.updated_at_unix_ms).toLocaleString("zh-CN")}
          </time>
        )}
      </header>
      <EditDraftStatus
        drafts={draftMemory}
        visible={editor.dirty || !!editor.pending}
        phase={
          editor.pending?.phase === "refresh"
            ? "saved"
            : editor.pending
              ? "unconfirmed"
              : "draft"
        }
      />
      {editor.pending && (
        <section className="annotation-receipt" aria-label="评语提交结果">
          <p>
            {editor.pending.phase === "refresh"
              ? "保存回复已保留，可读取实际评语完成核对。"
              : "原提交回复尚未确认，输入与提交条件继续保留。"}
          </p>
          <div className="history-annotation-actions">
            <button
              disabled={editor.busy || locked}
              onClick={() => void editor.finish()}
            >
              读取原结果并完成
            </button>
            {editor.pending.phase === "unconfirmed" && (
              <button
                disabled={editor.busy || locked || !editor.verified}
                onClick={() => void editor.retry()}
              >
                按原条件重试
              </button>
            )}
            <button
              disabled={editor.busy || locked || !editor.verified}
              onClick={() => editor.merge(editor.draft)}
            >
              保留输入继续编辑
            </button>
          </div>
        </section>
      )}
      {annotationFields.map(({ key, label }) => (
        <details
          key={key}
          className="annotation-field"
          open={expanded === key}
          onToggle={(event) => {
            if (event.currentTarget.open) {
              setExpanded(key);
              editor.changeField(key);
            } else setExpanded((old) => (old === key ? null : old));
          }}
        >
          <summary>
            <strong>{label}</strong>
            <span>
              {Array.from(editor.draft[key]).length} 字
              {editor.draft[key] !== original[key] ? " · 有修改" : ""}
            </span>
          </summary>
          <label>
            {label}
            <textarea
              aria-label={label}
              rows={key === "next" ? 3 : 5}
              maxLength={2048}
              value={editor.draft[key]}
              disabled={frozen}
              onChange={(event) =>
                editor.change({ ...editor.draft, [key]: event.target.value })
              }
            />
          </label>
        </details>
      ))}
      {editor.conflict && !editor.pending && (
        <section
          className="history-annotation-conflict"
          aria-label="评语修改审阅"
        >
          <p>已保存的评语有更新，请逐项核对后合并。</p>
          {annotationFields
            .filter(({ key }) => editor.draft[key] !== latest[key])
            .map(({ key, label }) => (
              <div className="annotation-merge-field" key={key}>
                <strong>{label}</strong>
                <p>当前输入：{editor.draft[key] || "（空）"}</p>
                <p>最新评语：{latest[key] || "（空）"}</p>
                <select
                  aria-label={`${label}采用`}
                  value={choice(key) ?? ""}
                  onChange={(event) =>
                    setChoices((old) => ({
                      ...old,
                      [key]: event.target.value as "mine" | "latest",
                    }))
                  }
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  <option value="mine">保留当前输入</option>
                  <option value="latest">采用最新评语</option>
                </select>
              </div>
            ))}
          <button
            disabled={editor.busy || locked || !editor.verified || unresolved}
            onClick={() =>
              editor.merge(
                Object.fromEntries(
                  annotationFields.map(({ key }) => [
                    key,
                    choice(key) === "latest" ? latest[key] : editor.draft[key],
                  ]),
                ) as AnnotationText,
              )
            }
          >
            合并到评语输入
          </button>
        </section>
      )}
      <div className="history-annotation-actions">
        <button
          className="primary"
          disabled={
            !editor.dirty || frozen || saveBlocked || !!editor.inputError
          }
          onClick={() => void editor.save()}
        >
          {editor.busy ? "正在处理…" : "保存评语"}
        </button>
        <button
          disabled={!editor.dirty || editor.busy || locked || !!editor.pending}
          onClick={editor.adoptLatest}
        >
          还原为最新评语
        </button>
        {editor.discarded && (
          <button
            disabled={editor.busy || editor.dirty || !!editor.pending}
            onClick={editor.undoDiscard}
          >
            撤销本次还原
          </button>
        )}
        {entry && (
          <button
            disabled={editor.busy || locked || reading || editor.reading}
            onClick={() => void editor.refresh()}
          >
            读取最新评语并保留输入
          </button>
        )}
        {(editor.dirty || editor.pending) && (
          <CopyPracticeDraft label="复制评语输入" value={editor.copy()} />
        )}
      </div>
      {editor.reading && <p role="status">正在读取所选演奏的评语…</p>}
      {editor.inputError && (
        <p role="status" className="dialog-error">
          {editor.inputError}
        </p>
      )}
      {editor.notice && <p role="status">{editor.notice}</p>}
      {editor.error && (
        <p role="alert" className="dialog-error">
          {editor.error}
        </p>
      )}
    </section>
  );
}
