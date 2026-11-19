import { metadataFields } from "./features/library/metadataFields";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { TaskActivity } from "./engine/TaskActivity";
import {
  readLibraryMetadata,
  readMetadataHistory,
  previewMetadataRestore,
  restoreLibraryMetadata,
} from "./features/library/metadataClient";
import { editDraftValue } from "./features/editing/editDraftStore";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import type {
  Metadata,
  MetadataHistory as History,
  MetadataRestorePreview as Preview,
} from "./features/library/metadataTypes";
const fields = metadataFields;
type Field = (typeof fields)[number][0];
type RestoreIntent = {
  id: string;
  fields: Field[];
  base: Metadata;
  target: Metadata;
};
const text = (value: unknown) =>
  Array.isArray(value) ? value.join("，") : String(value ?? "（空）");
export type MetadataHistoryContext = {
  path: string;
  contentId: string;
  title: string;
};
export function LibraryMetadataHistoryDialog({
  path,
  contentId,
  title,
  close,
  changed,
}: MetadataHistoryContext & {
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [history, setHistory] = useState<History>({
      records: [],
      retention: 200,
      available: false,
      error: null,
    }),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [choices, setChoices] = useState<
      Partial<Record<Field, "restore" | "keep" | "">>
    >({}),
    [busy, setBusy] = useState(false),
    [refreshPending, setRefreshPending] = useState(false),
    [pending, setPending] = useState<RestoreIntent | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const working = useRef(false);
  const job = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const load = async () => {
    const value = await readMetadataHistory(path, contentId);
    setHistory(value);
    return value;
  };
  useEffect(() => {
    void job(async () => {
      await load();
    });
  }, [path, contentId]);
  const record = history.records.find((r) => r.id === selected);
  const selectedFields =
    preview?.fields.filter((field) => choices[field] === "restore") ?? [];
  const unresolved = preview?.conflicts.some((field) => !choices[field]);
  const readPreview = () =>
    void job(async () => {
      setNotice("");
      const value = await previewMetadataRestore(path, contentId, selected);
      setPreview(value);
      setChoices(
        Object.fromEntries(
          value.fields.map((field) => [
            field,
            value.conflicts.includes(field) ? "" : "restore",
          ]),
        ),
      );
    });
  const refreshSaved = async () => {
    try {
      await changed();
      setRefreshPending(false);
    } catch (e) {
      setError(`资料已恢复，曲库刷新失败：${String(e)}`);
    }
  };
  const restored = async (message: string) => {
    setPending(null);
    setPreview(null);
    setChoices({});
    setNotice(message);
    setRefreshPending(true);
    await refreshSaved();
    try {
      await load();
    } catch (e) {
      setError(`资料已恢复，修改历史读取失败：${String(e)}`);
    }
  };
  const matchesTarget = (current: Metadata, intent: RestoreIntent) =>
    intent.fields.every(
      (field) =>
        editDraftValue(current[field]) === editDraftValue(intent.target[field]),
    );
  const verifyRestore = async (intent: RestoreIntent) => {
    const current = (await readLibraryMetadata(path, contentId)).value;
    if (matchesTarget(current, intent)) {
      await restored("重新读取后，所选字段已与恢复目标一致。");
    } else if (editDraftValue(current) === editDraftValue(intent.base)) {
      setPending(null);
      setNotice("实际资料仍与原预览一致，原恢复选择已保留，可再次恢复。");
    } else {
      setPending(null);
      setPreview(null);
      setNotice("实际资料已有其他变化，请重新读取恢复预览，核对最新字段。");
    }
  };
  const restore = () =>
    void job(async () => {
      if (!preview || unresolved || !selectedFields.length || pending)
        throw new Error("请先检查恢复预览并选择字段。");
      const intent: RestoreIntent = {
        id: selected,
        fields: [...selectedFields],
        base: preview.base,
        target: preview.value,
      };
      setPending(intent);
      let value;
      try {
        value = await restoreLibraryMetadata(
          path,
          contentId,
          intent.id,
          intent.fields,
          intent.base,
        );
      } catch (e) {
        try {
          await verifyRestore(intent);
        } catch {
          throw new Error(`恢复结果待核对，原恢复条件继续保留：${String(e)}`);
        }
        return;
      }
      if (value.status === "conflict") {
        if (value.current && matchesTarget(value.current, intent)) {
          await restored("当前所选字段已与恢复目标一致。");
          return;
        }
        setPending(null);
        setPreview(null);
        setNotice(
          "预览后资料再次变化，尚未恢复。请重新读取恢复预览并检查最新内容。",
        );
        return;
      }
      if (value.status !== "saved")
        throw new Error("恢复结果无法确认，请刷新查看当前资料。");
      await restored(
        `已恢复所选字段。此操作已记入新的资料历史。${value.warnings?.length ? value.warnings.join("；") : ""}`,
      );
    });
  return (
    <div
      className="modal-backdrop metadata-history-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !working.current) close();
      }}
    >
      <section
        className="settings-dialog metadata-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="metadata-history-title">资料变更历史</h2>
            <p>{title}</p>
            <p className="file-path">{path}</p>
          </div>
          <button
            autoFocus
            disabled={busy}
            aria-label="关闭资料变更历史"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <TaskActivity
          contentId={contentId}
          label={["读取资料修改历史", "读取曲库信息", "恢复曲库信息"]}
          cancelLabel="取消准备或读取"
        />
        {pending && (
          <div role="status">
            <p>恢复结果待核对，原恢复条件已保留。</p>
            <button
              disabled={busy}
              onClick={() => void job(() => verifyRestore(pending))}
            >
              读取当前恢复结果
            </button>
            <CopyPracticeDraft
              value={{ path, contentId, ...pending }}
              label="复制原恢复条件"
            />
          </div>
        )}
        {refreshPending && (
          <p role="status">
            资料已恢复。
            <button disabled={busy} onClick={() => void job(refreshSaved)}>
              重试刷新曲库
            </button>
          </p>
        )}
        <div className="metadata-history-toolbar">
          <button
            disabled={busy || !!pending}
            onClick={() =>
              void job(async () => {
                await load();
                setPreview(null);
                setNotice("历史已刷新，请重新读取恢复预览。");
              })
            }
          >
            刷新资料历史
          </button>
          <span>
            每个文件保留最近 {history.retention}{" "}
            次写入；当前内容身份的记录列在此处。
          </span>
        </div>
        {history.error && (
          <p className="dialog-error">
            {history.error}。历史仍可查看，恢复需要同一内容的可用文件。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="metadata-history-workspace">
          <div className="metadata-history-list" aria-label="资料历史列表">
            {!busy && !history.records.length && (
              <p>
                此文件尚无资料变更记录。单首编辑和批量资料修改保存后会开始记录。
              </p>
            )}
            {history.records.map((r) => (
              <button
                key={r.id}
                className={selected === r.id ? "active" : ""}
                disabled={busy || !!pending}
                onClick={() => {
                  setSelected(r.id);
                  setPreview(null);
                  setChoices({});
                  setNotice("");
                }}
              >
                <strong>
                  {r.restoredFrom ? "恢复资料" : "修改资料"} ·{" "}
                  {new Date(r.timeMs).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </strong>
                <span>
                  {r.fields
                    .map((field) => fields.find(([key]) => key === field)?.[1])
                    .join("、")}
                </span>
                <small>
                  {r.state === "applied"
                    ? r.matchesCurrent
                      ? "与当前全部资料一致"
                      : "已记录"
                    : r.state === "failed"
                      ? "写入失败"
                      : "写入状态未确认"}
                </small>
              </button>
            ))}
          </div>
          <div className="metadata-history-detail">
            {!record ? (
              <p>选择一条记录查看具体字段变化。</p>
            ) : (
              <>
                <h3>
                  {record.restoredFrom
                    ? "恢复操作的字段变化"
                    : "此次修改的字段变化"}
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>修改前</th>
                      <th>修改后</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.fields.map((field) => (
                      <tr key={field}>
                        <th>{fields.find(([key]) => key === field)?.[1]}</th>
                        <td>{text(record.before[field])}</td>
                        <td>{text(record.after[field])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {record.state !== "applied" && (
                  <p className="parameter-help">
                    这次写入未确认或失败，不能直接作为恢复来源；仍可查看当时准备写入的内容。
                  </p>
                )}
                <button
                  disabled={
                    busy ||
                    !!pending ||
                    !history.available ||
                    record.state !== "applied"
                  }
                  onClick={readPreview}
                >
                  预览恢复到修改前
                </button>
              </>
            )}
            {preview && (
              <section aria-label="资料恢复审阅">
                <h3>恢复审阅</h3>
                <p>
                  只恢复选定字段，其他最新资料保留。同一字段后来改过时，请明确选择。
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>这次修改后</th>
                      <th>当前最新</th>
                      <th>恢复目标</th>
                      <th>本次操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.fields.map((field) => (
                      <tr key={field}>
                        <th>
                          {fields.find(([key]) => key === field)?.[1]}
                          {preview.conflicts.includes(field) && (
                            <small>后来改过</small>
                          )}
                        </th>
                        <td>{text(preview.after[field])}</td>
                        <td>{text(preview.base[field])}</td>
                        <td>{text(preview.value[field])}</td>
                        <td>
                          <select
                            aria-label={`恢复${fields.find(([key]) => key === field)?.[1]}操作`}
                            disabled={busy || !!pending}
                            value={choices[field] ?? ""}
                            onChange={(e) =>
                              setChoices({
                                ...choices,
                                [field]: e.target.value as
                                  "restore" | "keep" | "",
                              })
                            }
                          >
                            <option value="">请选择</option>
                            <option value="restore">恢复目标值</option>
                            <option value="keep">保留最新值</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  disabled={
                    busy || !!pending || !!unresolved || !selectedFields.length
                  }
                  onClick={restore}
                >
                  恢复所选字段 · {selectedFields.length}
                </button>
              </section>
            )}
          </div>
        </div>
        <p className="parameter-help">
          仅记录本功能启用后的单首/批量资料保存和恢复，导入与外部程序改动不补记为已知历史。恢复只修改资料字段，指法、分手和谱面关联保留。历史保存在应用数据中，当前尚不随练习备份携带。
        </p>
      </section>
    </div>
  );
}
