import { requireValue } from "./engine/requireValue";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "./api";
import { TaskActivity } from "./engine/TaskActivity";
import {
  busyEditDraft,
  editDraftValue,
} from "./features/editing/editDraftStore";
import { EditDraftStatus } from "./features/editing/EditDraftStatus";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import {
  readLibraryMetadata,
  previewLibraryMetadata,
  saveLibraryMetadata,
} from "./features/library/metadataClient";
import type { MetadataDraft } from "./features/library/metadataTypes";
import type { Metadata } from "./libraryQuery";
import {
  templateFields,
  emptyRules,
  modes,
  rulesError,
  metadataText,
  type Rules,
  type TemplateField,
} from "./metadataTemplates";
export type MetadataBatchItem = {
  path: string;
  contentId: string | null;
  title: string;
};
type Row = MetadataBatchItem & {
  status:
    "ready" | "unchanged" | "saved" | "conflict" | "error" | "unconfirmed";
  include: boolean;
  base?: Metadata;
  value?: Metadata;
  message?: string;
  fields?: TemplateField[];
};
type Registry = {
  revision: number;
  templates: { name: string; rules: Partial<Rules> }[];
};
export function LibraryMetadataBatchDialog({
  items,
  close,
  changed,
  drafts,
}: {
  items: MetadataBatchItem[];
  close: () => void;
  changed: () => Promise<void>;
  drafts?: Map<string, MetadataDraft>;
}) {
  const [rules, setRules] = useState(emptyRules),
    [registry, setRegistry] = useState<Registry>({
      revision: 0,
      templates: [],
    }),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState(""),
    [refreshPending, setRefreshPending] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const batchId = useRef(crypto.randomUUID());
  const working = useRef(false),
    stop = useRef(false),
    baseline = useRef("");
  const ready = rows.filter((r) => r.status === "ready" && r.include);
  const uncertain = rows.filter((row) => row.status === "unconfirmed");
  const keyOf = (row: MetadataBatchItem) =>
    JSON.stringify([row.contentId, row.path]);
  const releasePrepared = (prepared = rows) => {
    for (const row of prepared) {
      const key = keyOf(row),
        stored = drafts?.get(key);
      if (
        stored?.batchId === batchId.current &&
        !stored.submission &&
        !stored.refresh &&
        editDraftValue(stored.base) === editDraftValue(row.base) &&
        editDraftValue(stored.draft) === editDraftValue(row.value)
      )
        drafts?.delete(key);
    }
  };
  const keepPrepared = (row: Row) => {
    if (!drafts) return true;
    const existing = drafts.get(keyOf(row));
    if (
      existing &&
      (existing.batchId !== batchId.current ||
        existing.submission ||
        existing.refresh)
    )
      return false;
    drafts.set(keyOf(row), {
      base: requireValue(row.base, "预览资料"),
      draft: requireValue(row.value, "待保存资料"),
      source: "library",
      batchId: batchId.current,
    });
    return true;
  };
  const rememberSaved = (row: Row, value: Metadata, warnings?: string[]) => {
    const key = keyOf(row);
    if (drafts?.get(key)?.batchId === batchId.current)
      drafts.set(key, {
        base: value,
        draft: value,
        source: "library",
        batchId: batchId.current,
        refresh: { warnings },
      });
  };
  const stopBatch = () => {
    stop.current = true;
    setStopRequested(true);
  };
  const clearSubmission = (row: Row) => {
    const key = keyOf(row),
      stored = drafts?.get(key);
    if (stored?.batchId === batchId.current)
      drafts?.set(key, { ...stored, submission: undefined });
  };
  const reconcile = async (row: Row): Promise<Partial<Row>> => {
    const current = await readLibraryMetadata(
      row.path,
      requireValue(row.contentId, "曲目编号"),
    );
    if (current.contentId !== row.contentId)
      throw new Error("文件内容已变化，保存结果仍待核对。");
    if (
      row.value &&
      row.fields?.length &&
      row.fields.every(
        (field) =>
          editDraftValue(current.value[field]) ===
          editDraftValue(row.value?.[field]),
      )
    ) {
      rememberSaved(row, current.value);
      return {
        status: "saved",
        include: false,
        message: "重新读取后，本次修改的字段已与目标值一致。",
      };
    }
    clearSubmission(row);
    if (editDraftValue(current.value) === editDraftValue(row.base))
      return {
        status: "ready",
        include: true,
        message: "实际资料仍与原预览一致，保留原修改，可再次保存。",
      };
    return {
      status: "conflict",
      include: false,
      message:
        "实际资料已有其他变化，原输入仍保留，请从顶部“未提交输入”继续处理。",
    };
  };
  const job = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    stop.current = false;
    setStopRequested(false);
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  const loadTemplates = async () =>
    setRegistry(await api.command<Registry>({ type: "metadataTemplates" }));
  const refreshSavedRows = async () => {
    try {
      await changed();
      for (const [key, value] of drafts ?? [])
        if (value.batchId === batchId.current && value.refresh)
          drafts?.delete(key);
      setRefreshPending(false);
    } catch (e) {
      setError(`资料已保存，曲库刷新失败：${String(e)}`);
    }
  };
  useEffect(() => {
    void job(loadTemplates);
  }, []);
  const changeRule = (
    field: TemplateField,
    change: Partial<Rules[TemplateField]>,
  ) => {
    releasePrepared();
    setRules({ ...rules, [field]: { ...rules[field], ...change } });
    setRows([]);
    baseline.current = "";
    setNotice("");
  };
  const preview = (resume = false, retryStatus?: "error" | "conflict") =>
    void job(async () => {
      const invalid = rulesError(rules);
      if (invalid) throw new Error(invalid);
      if (!items.length || items.length > 100)
        throw new Error("每批请选择 1 到 100 个曲目文件。");
      if (resume && baseline.current !== JSON.stringify(rules))
        throw new Error("字段设置已变化，请重新读取修改预览。");
      if (!resume) {
        releasePrepared();
        setRows([]);
      }
      setNotice("");
      baseline.current = JSON.stringify(rules);
      const next: Row[] = resume
        ? rows.filter((row) => !retryStatus || row.status !== retryStatus)
        : [];
      const seen = new Set(next.map((row) => row.path));
      for (const item of items.filter((row) => !seen.has(row.path))) {
        if (stop.current) break;
        setProgress(`读取 ${next.length + 1} / ${items.length}：${item.title}`);
        try {
          const { base, value, contentId } = await previewLibraryMetadata(
            item.path,
            item.contentId,
            rules,
          );
          const fields = templateFields
            .filter(
              ([field]) =>
                JSON.stringify(base[field]) !== JSON.stringify(value[field]),
            )
            .map(([field]) => field);
          if (item.contentId && contentId !== item.contentId)
            throw new Error("预览结果与原曲目不一致，尚未加入批次。");
          if (retryStatus === "conflict")
            releasePrepared(
              rows.filter(
                (row) => row.path === item.path && row.status === "conflict",
              ),
            );
          const row: Row = {
            ...item,
            contentId,
            base,
            value,
            fields,
            include: fields.length > 0,
            status: fields.length ? "ready" : "unchanged",
          };
          if (fields.length && !keepPrepared(row)) {
            row.status = "conflict";
            row.include = false;
            row.message =
              "此文件已有待处理输入或保存回执，请先从顶部“未提交输入”继续处理。";
          }
          next.push(row);
        } catch (e) {
          if (stop.current) break;
          next.push({
            ...item,
            status: "error",
            include: false,
            message: String(e),
          });
        }
        setRows([...next]);
      }
      if (resume && stop.current) {
        const completed = new Set(next.map((row) => row.path));
        next.push(...rows.filter((row) => !completed.has(row.path)));
        setRows([...next]);
      }
      setNotice(
        stop.current
          ? `已停止读取，保留 ${next.length} 个文件的预览。`
          : `已读取 ${next.length} 个文件；展开每行查看将修改的字段。`,
      );
    });
  const apply = () =>
    void job(async () => {
      if (baseline.current !== JSON.stringify(rules) || !ready.length)
        throw new Error("请先读取并检查当前字段的预览。");
      let next = [...rows],
        written = 0,
        processed = 0;
      setNotice("");
      for (const item of ready) {
        if (stop.current) break;
        setProgress(`保存 ${processed + 1} / ${ready.length}：${item.title}`);
        let result: Partial<Row>;
        const key = keyOf(item);
        const stored = drafts?.get(key);
        if (
          drafts &&
          (!stored ||
            stored.batchId !== batchId.current ||
            stored.submission ||
            stored.refresh ||
            editDraftValue(stored.base) !== editDraftValue(item.base) ||
            editDraftValue(stored.draft) !== editDraftValue(item.value))
        ) {
          next = next.map((row) =>
            row.path === item.path
              ? {
                  ...row,
                  status: "conflict",
                  include: false,
                  message: "暂存输入已变化，请从顶部“未提交输入”继续处理。",
                }
              : row,
          );
          setRows(next);
          processed++;
          continue;
        }
        if (stored) drafts?.set(key, { ...stored, submission: "unconfirmed" });
        busyEditDraft(drafts, key, true);
        try {
          const reply = await saveLibraryMetadata(
            item.path,
            requireValue(item.contentId, "曲目编号"),
            requireValue(item.value, "待保存的曲目信息"),
            requireValue(item.base, "预览时的曲目信息"),
          );
          if (reply.status === "conflict") {
            clearSubmission(item);
            result = {
              status: "conflict",
              include: false,
              message:
                "预览后资料已变化，尚未写入。请重新读取预览，检查最新字段。",
            };
          } else if (reply.status === "saved") {
            rememberSaved(
              item,
              requireValue(reply.value, "保存后的曲目信息"),
              reply.warnings,
            );
            written++;
            result = {
              status: "saved",
              include: false,
              message: `已保存${reply.warnings?.length ? "；" + reply.warnings.join("；") : ""}`,
            };
          } else throw new Error("保存结果无法确认，请重新读取资料。");
        } catch (e) {
          result = {
            status: "unconfirmed",
            include: false,
            message: `保存结果待核对：${String(e)}`,
          };
          try {
            if (!stop.current) {
              result = await reconcile(item);
              if (result.status === "saved") written++;
            }
          } catch {
            // Keep the frozen original input and submission marker for later reconciliation.
          }
        } finally {
          busyEditDraft(drafts, key, false);
        }
        next = next.map((row) =>
          row.path === item.path ? { ...row, ...result } : row,
        );
        setRows(next);
        processed++;
      }
      setNotice(
        `${stop.current ? "已停止；" : ""}已保存 ${written} 个文件，${processed - written} 个未完成。${ready.length - processed} 个仍待处理。`,
      );
      if (written) {
        setRefreshPending(true);
        await refreshSavedRows();
      }
    });
  const verifyUnconfirmed = () =>
    void job(async () => {
      let next = [...rows],
        saved = false;
      for (const row of uncertain) {
        if (stop.current) break;
        setProgress(`核对保存结果：${row.title}`);
        busyEditDraft(drafts, keyOf(row), true);
        try {
          const result = await reconcile(row);
          if (result.status === "saved") saved = true;
          next = next.map((item) =>
            item.path === row.path ? { ...item, ...result } : item,
          );
        } catch (e) {
          next = next.map((item) =>
            item.path === row.path
              ? { ...item, message: `仍待核对：${String(e)}` }
              : item,
          );
        } finally {
          busyEditDraft(drafts, keyOf(row), false);
        }
        setRows(next);
      }
      if (saved) {
        setRefreshPending(true);
        await refreshSavedRows();
      }
    });
  const saveTemplate = () =>
    void job(async () => {
      const invalid = rulesError(rules);
      if (invalid) throw new Error(invalid);
      const value = await api.command<Registry>({
        type: "updateMetadataTemplate",
        name,
        rules,
        expected: registry.revision,
      });
      setRegistry(value);
      setSelected(name.trim());
      setName(name.trim());
      setNotice("资料模板已保存。模板不包含曲名，也不包含任何文件路径。");
    });
  const removeTemplate = () =>
    void job(async () => {
      setRegistry(
        await api.command<Registry>({
          type: "updateMetadataTemplate",
          name: selected,
          rules: null,
          expected: registry.revision,
        }),
      );
      setSelected("");
      setNotice("模板已移除，当前字段设置保留。");
    });
  return (
    <div
      className="modal-backdrop metadata-batch-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !working.current) close();
      }}
    >
      <section
        className="settings-dialog metadata-batch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-batch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="metadata-batch-title">批量修改资料</h2>
            <p>
              已选 {items.length}{" "}
              个曲目文件。修改前逐首读取、预览，保存时再核对资料和曲目内容。
            </p>
          </div>
          <button
            autoFocus
            aria-label="关闭批量修改资料"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <TaskActivity
          label={[
            "预览曲库信息",
            "保存曲库信息",
            "读取曲库信息",
            "读取资料模板",
            "保存资料模板",
          ]}
          cancelLabel="停止当前准备"
          onCancelRequested={stopBatch}
        />
        <div className="metadata-template-toolbar">
          <label>
            资料模板
            <select
              aria-label="选择资料模板"
              value={selected}
              disabled={busy}
              onChange={(e) => {
                const name = e.target.value;
                setSelected(name);
                setName(name);
                const template = registry.templates.find(
                  (t) => t.name === name,
                );
                if (template) {
                  releasePrepared();
                  setRules({ ...emptyRules(), ...template.rules });
                  setRows([]);
                  baseline.current = "";
                  setNotice("模板已载入；请读取曲目预览。");
                }
              }}
            >
              <option value="">选择已保存模板</option>
              {registry.templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="资料模板名称"
            placeholder="模板名称"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy || !name.trim()} onClick={saveTemplate}>
            {registry.templates.some((t) => t.name === name.trim())
              ? "更新模板"
              : "保存模板"}
          </button>
          <button disabled={busy || !selected} onClick={removeTemplate}>
            移除模板
          </button>
          <button disabled={busy} onClick={() => void job(loadTemplates)}>
            刷新模板
          </button>
        </div>
        <div className="metadata-batch-fields">
          {templateFields.map(([field, label]) => (
            <div key={field}>
              <label htmlFor={`batch-mode-${field}`}>{label}</label>
              <select
                id={`batch-mode-${field}`}
                aria-label={`批量${label}操作`}
                value={rules[field].mode}
                disabled={busy}
                onChange={(e) => changeRule(field, { mode: e.target.value })}
              >
                {modes(field).map(([mode, name]) => (
                  <option key={mode} value={mode}>
                    {name}
                  </option>
                ))}
              </select>
              {field === "notes" ? (
                <textarea
                  aria-label={`批量${label}内容`}
                  rows={2}
                  maxLength={10000}
                  disabled={
                    busy || ["keep", "clear"].includes(rules[field].mode)
                  }
                  value={rules[field].value}
                  onChange={(e) => changeRule(field, { value: e.target.value })}
                />
              ) : (
                <input
                  aria-label={`批量${label}内容`}
                  maxLength={field === "tags" ? 12900 : 2000}
                  disabled={
                    busy || ["keep", "clear"].includes(rules[field].mode)
                  }
                  placeholder={
                    field === "tags" ? "逗号或换行分隔标签" : "填写修改内容"
                  }
                  value={rules[field].value}
                  onChange={(e) => changeRule(field, { value: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        <p className="parameter-help">
          “保留”不修改原字段；“清空”和“替换”会显示被移除的内容。追加标签去掉重复项，追加备注保留原文。每个副本的资料独立处理；曲名、指法、分手与谱面关联沿原资料保留。
        </p>
        <div className="metadata-batch-controls">
          <button
            disabled={
              busy ||
              !items.length ||
              items.length > 100 ||
              rows.some(
                (row) => row.status === "saved" || row.status === "unconfirmed",
              )
            }
            onClick={() => preview()}
          >
            读取修改预览
          </button>
          {rows.some((row) => row.status === "error") && (
            <button disabled={busy} onClick={() => preview(true, "error")}>
              重试读取失败文件
            </button>
          )}
          {rows.some((row) => row.status === "conflict") && (
            <button disabled={busy} onClick={() => preview(true, "conflict")}>
              重新读取冲突文件
            </button>
          )}
          {rows.length > 0 &&
            rows.length < items.length &&
            baseline.current === JSON.stringify(rules) && (
              <button disabled={busy} onClick={() => preview(true)}>
                继续读取剩余文件
              </button>
            )}
          {!!uncertain.length && (
            <button disabled={busy} onClick={verifyUnconfirmed}>
              核对待确认结果 · {uncertain.length}
            </button>
          )}
          <button disabled={busy || !ready.length} onClick={apply}>
            保存所选修改 · {ready.length}
          </button>
          {refreshPending && (
            <button disabled={busy} onClick={() => void job(refreshSavedRows)}>
              重试刷新已保存的曲库
            </button>
          )}
          {busy && progress && (
            <button disabled={stopRequested} onClick={stopBatch}>
              停止当前批次
            </button>
          )}
          <span role="status">{progress || notice}</span>
        </div>
        {busy && stopRequested && (
          <p role="status">
            已请求停止，正在等待当前文件结束。剩余文件将保留。
          </p>
        )}
        <EditDraftStatus
          drafts={drafts}
          visible={rows.some((row) => !!drafts?.get(keyOf(row)))}
          phase={
            uncertain.length
              ? "unconfirmed"
              : refreshPending
                ? "saved"
                : "draft"
          }
        />
        {!!rows.length && (
          <CopyPracticeDraft
            value={{ items, rules, rows }}
            label="复制本批次设置与结果"
          />
        )}
        {error && <p role="alert">{error}</p>}
        {refreshPending && (
          <p role="status">
            已有曲目资料保存成功。刷新重试只读取曲库，不会再次保存资料。
          </p>
        )}
        <div className="metadata-batch-results" aria-busy={busy}>
          {rows.map((row) => (
            <article className="metadata-batch-row" key={row.path}>
              <div className="metadata-batch-row-heading">
                <input
                  type="checkbox"
                  aria-label={`修改资料 ${row.path}`}
                  checked={row.include}
                  disabled={busy || row.status !== "ready"}
                  onChange={(e) => {
                    if (e.target.checked && !keepPrepared(row)) {
                      setError(
                        "此文件已有其他待处理输入，请先从顶部“未提交输入”继续处理。",
                      );
                      return;
                    }
                    if (!e.target.checked) {
                      const stored = drafts?.get(keyOf(row));
                      if (
                        stored?.batchId === batchId.current &&
                        !stored.submission &&
                        !stored.refresh
                      )
                        drafts?.delete(keyOf(row));
                    }
                    setRows(
                      rows.map((r) =>
                        r.path === row.path
                          ? { ...r, include: e.target.checked }
                          : r,
                      ),
                    );
                  }}
                />
                <strong>{row.base?.title || row.title}</strong>
                <span>
                  {
                    {
                      ready: "待保存",
                      unchanged: "无需修改",
                      saved: "已保存",
                      conflict: "资料冲突",
                      error: "未完成",
                      unconfirmed: "结果待核对",
                    }[row.status]
                  }
                </span>
              </div>
              <p className="file-path">{row.path}</p>
              {row.message && <p>{row.message}</p>}
              {!!row.fields?.length && (
                <details>
                  <summary>查看 {row.fields.length} 个字段变化</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>字段</th>
                        <th>原资料</th>
                        <th>修改后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.fields.map((field) => (
                        <tr key={field}>
                          <th>
                            {templateFields.find(([key]) => key === field)?.[1]}
                          </th>
                          <td>{metadataText(row.base?.[field])}</td>
                          <td>{metadataText(row.value?.[field])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
