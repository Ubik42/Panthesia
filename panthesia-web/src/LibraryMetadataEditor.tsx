import { metadataFields, completeMetadata } from "./features/library/metadataFields";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MetadataDefaultsPanel } from "./features/library/MetadataDefaultsPanel";
import {
  openEditDraft,
  busyEditDraft,
  editDraftPersistence,
  editDraftValue,
} from "./features/editing/editDraftStore";
import { EditDraftStatus } from "./features/editing/EditDraftStatus";
import {
  readLibraryMetadata,
  saveLibraryMetadata,
  resetLibraryMetadataDefaults,
} from "./features/library/metadataClient";
import { requireValue } from "./engine/requireValue";
import { TaskActivity } from "./engine/TaskActivity";
import { copyLibraryPaths } from "./LibraryContextMenu";
import type { Metadata } from "./libraryQuery";
import type {
  MetadataDraft,
  MetadataService,
  MetadataDefaults,
  MetadataField,
} from "./features/library/metadataTypes";
export type MetadataEdit = { path: string; contentId: string; value: Metadata };
const fields = metadataFields;
type Field = (typeof fields)[number][0];
const equal = (a: unknown, b: unknown) =>
  editDraftValue(a) === editDraftValue(b);
const text = (value: unknown) =>
  Array.isArray(value) ? value.join("，") : String(value ?? "（空）");
export function LibraryMetadataEditor({
  edit,
  service,
  draftMemory,
  showHeading = true,
  onBusy,
  saved,
  cancel,
}: {
  edit: MetadataEdit;
  service?: MetadataService;
  draftMemory?: Map<string, MetadataDraft>;
  showHeading?: boolean;
  onBusy: (busy: boolean) => void;
  saved: (warnings?: string[]) => Promise<void>;
  cancel: () => void;
}) {
  const memoryKey = JSON.stringify([edit.contentId, edit.path]);
  const cachedDraft = useRef(draftMemory?.get(memoryKey));
  const [base, setBase] = useState(completeMetadata(cachedDraft.current?.base ?? edit.value)),
    [draft, setDraft] = useState(() =>
      structuredClone(completeMetadata(cachedDraft.current?.draft ?? edit.value)),
    ),
    [conflict, setConflict] = useState<Metadata | null>(null),
    [choices, setChoices] = useState<
      Partial<Record<Field, "mine" | "latest" | "">>
    >({}),
    [busy, setBusy] = useState(false),
    [unconfirmed, setUnconfirmed] = useState(!!cachedDraft.current?.submission),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refreshPending, setRefreshPending] = useState(
      !!cachedDraft.current?.refresh,
    ),
    [savedWarnings, setSavedWarnings] = useState<string[] | undefined>(
      cachedDraft.current?.refresh?.warnings,
    );
  const [tagsText, setTagsText] = useState(
    () =>
      cachedDraft.current?.tagsText ??
      (cachedDraft.current?.draft ?? edit.value).tags.join("，"),
  );
  const [defaultsRevision, setDefaultsRevision] = useState(0);
  const readDefaults = useCallback(() => service ? service.readDefaults() :
    readLibraryMetadata(edit.path, edit.contentId), [service, edit.path, edit.contentId]);
  const dirty = !equal(base, draft) || tagsText !== base.tags.join("，");
  const tagsError =
    draft.tags.length > 100
      ? "最多填写 100 个标签。"
      : draft.tags.some((tag) => Array.from(tag).length > 128)
        ? "每个标签最多 128 字。"
        : "";
  const working = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (conflict) {
      reviewRef.current?.scrollIntoView({ block: "start" });
      reviewRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    }
  }, [conflict]);
  const present = (current: Metadata) => {
    setUnconfirmed(false);
    const defaults: Partial<Record<Field, "mine" | "latest" | "">> = {};
    for (const [key] of fields)
      defaults[key] = equal(draft[key], current[key])
        ? "mine"
        : equal(draft[key], base[key])
          ? "latest"
          : equal(current[key], base[key])
            ? "mine"
            : "";
    setChoices(defaults);
    setConflict(current);
    setNotice("");
  };
  useEffect(
    () => openEditDraft(draftMemory, memoryKey),
    [draftMemory, memoryKey],
  );
  useLayoutEffect(() => {
    if (!draftMemory) return;
    if (!dirty && !refreshPending && !unconfirmed)
      draftMemory.delete(memoryKey);
    else
      draftMemory.set(memoryKey, {
        base,
        draft,
        tagsText,
        source: service ? "practice" : "library",
        ...(unconfirmed ? { submission: "unconfirmed" as const } : {}),
        ...(refreshPending ? { refresh: { warnings: savedWarnings } } : {}),
      });
  }, [
    base,
    draft,
    tagsText,
    dirty,
    draftMemory,
    memoryKey,
    refreshPending,
    unconfirmed,
    savedWarnings,
    service,
  ]);
  useEffect(() => {
    const cached = cachedDraft.current;
    if (!cached || cached.refresh) return;
    if (
      equal(edit.value, cached.draft) &&
      (cached.submission ||
        cached.tagsText === undefined ||
        cached.tagsText === cached.draft.tags.join("，"))
    ) {
      rememberSaved(
        edit.value,
        undefined,
        "当前资料已与输入一致，可直接刷新界面。",
      );
    } else if (!equal(edit.value, cached.base)) present(edit.value);
  }, []);
  const job = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    busyEditDraft(draftMemory, memoryKey, true);
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      busyEditDraft(draftMemory, memoryKey, false);
      setBusy(false);
      onBusy(false);
    }
  };
  const rememberSaved = (
    stored: Metadata,
    warnings: string[] | undefined,
    message: string,
  ) => {
    draftMemory?.set(memoryKey, {
      base: stored,
      draft: stored,
      tagsText: stored.tags.join("，"),
      source: service ? "practice" : "library",
      refresh: { warnings },
    });
    setBase(stored);
    setDraft(stored);
    setTagsText(stored.tags.join("，"));
    setConflict(null);
    setNotice(message);
    setSavedWarnings(warnings);
    setRefreshPending(true);
    setUnconfirmed(false);
    setDefaultsRevision(value => value + 1);
  };
  const resetDefaults = (view: MetadataDefaults, selected: MetadataField[]) => job(async () => {
    setUnconfirmed(true);
    const reply = service ? await service.resetDefaults(selected, base, view.proof) :
      await resetLibraryMetadataDefaults(edit.path, edit.contentId, selected, base, view.proof);
    setDefaultsRevision(value => value + 1);
    if (reply.status === "conflict") {
      present(requireValue(reply.current, "最新曲目信息"));
      setNotice("资料来源或个人修改已变化，请审阅最新资料后重新选择恢复字段。");
      return;
    }
    rememberSaved(requireValue(reply.value, "已恢复的曲目信息"), reply.warnings, "已恢复所选来源默认值。后续导入会更新这些字段。");
    try {
      await saved(reply.warnings);
      draftMemory?.delete(memoryKey);
      setRefreshPending(false);
    } catch (failure) {
      throw new Error(`资料已恢复，界面刷新失败：${failure instanceof Error ? failure.message : String(failure)}`);
    }
  });
  const save = () =>
    void job(async () => {
      setUnconfirmed(true);
      draftMemory?.set(memoryKey, {
        base,
        draft,
        tagsText,
        source: service ? "practice" : "library",
        submission: "unconfirmed",
      });
      const reply = service
        ? await service.save(draft, base)
        : await saveLibraryMetadata(edit.path, edit.contentId, draft, base);
      if (reply.status === "conflict") {
        const current = requireValue(reply.current, "最新曲目信息");
        if (equal(current, draft))
          rememberSaved(
            current,
            reply.warnings,
            "当前资料已与输入一致，可直接刷新界面。",
          );
        else present(current);
        return;
      }
      if (reply.status !== "saved")
        throw new Error("保存结果无法确认，请重新读取资料后核对。");
      const stored = requireValue(reply.value, "已保存的曲目信息");
      rememberSaved(
        stored,
        reply.warnings,
        `资料已保存。${reply.warnings?.length ? reply.warnings.join("；") : ""}`,
      );
      try {
        await saved(reply.warnings);
        draftMemory?.delete(memoryKey);
        setRefreshPending(false);
      } catch (e) {
        throw new Error(
          `资料已保存，曲库刷新失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  const retryRefresh = () =>
    void job(async () => {
      try {
        await saved(savedWarnings);
        draftMemory?.delete(memoryKey);
        setRefreshPending(false);
      } catch (e) {
        throw new Error(
          `资料已保存，曲库刷新失败：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  const review = () =>
    void job(async () => {
      const value = service
        ? await service.read()
        : (await readLibraryMetadata(edit.path, edit.contentId)).value;
      setDefaultsRevision(previous => previous + 1);
      if (
        dirty &&
        equal(value, draft) &&
        (unconfirmed || tagsText === draft.tags.join("，"))
      ) {
        rememberSaved(
          value,
          undefined,
          "当前资料已与输入一致，可直接刷新界面。",
        );
      } else if (equal(value, base)) {
        setUnconfirmed(false);
        setConflict(null);
        setNotice("资料未变化，当前草稿保留。");
      } else present(value);
    });
  const changed = conflict
    ? fields.filter(([key]) => !equal(draft[key], conflict[key]))
    : [];
  const unresolved = changed.some(([key]) => !choices[key]);
  return (
    <section
      className="library-metadata-editor"
      aria-label="曲目信息编辑"
      aria-busy={busy}
    >
      {showHeading && <h4>编辑曲目信息</h4>}
      <p className="file-path">{edit.path}</p>
      {!service && (
        <TaskActivity
          contentId={edit.contentId}
          label={["读取曲库信息", "保存曲库信息"]}
          cancelLabel="取消准备或读取"
        />
      )}
      <EditDraftStatus
        drafts={draftMemory}
        visible={dirty || refreshPending || unconfirmed}
        phase={refreshPending ? "saved" : unconfirmed ? "unconfirmed" : "draft"}
      />
      {unconfirmed && (
        <p role="status">
          保存结果待核对。原输入已保留，请读取实际资料后继续。
        </p>
      )}
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          {key === "notes" ? (
            <textarea
              aria-label={`管理${label}`}
              rows={4}
              maxLength={10000}
              value={draft.notes ?? ""}
              disabled={busy || !!conflict || refreshPending || unconfirmed}
              onChange={(e) =>
                setDraft({ ...draft, notes: e.target.value || null })
              }
            />
          ) : (
            <input
              aria-label={`管理${label}`}
              maxLength={key === "tags" ? 13000 : 2000}
              value={key === "tags" ? tagsText : (draft[key] ?? "")}
              disabled={busy || !!conflict || refreshPending || unconfirmed}
              aria-describedby={
                key === "tags" ? "metadata-tags-help" : undefined
              }
              aria-invalid={key === "tags" && !!tagsError}
              onChange={(e) => {
                if (key === "tags") setTagsText(e.target.value);
                setDraft({
                  ...draft,
                  [key]:
                    key === "tags"
                      ? e.target.value
                          .split(/[,，]/)
                          .map((value) => value.trim())
                          .filter(Boolean)
                      : e.target.value || null,
                });
              }}
            />
          )}
        </label>
      ))}
      <p id="metadata-tags-help" className="parameter-help">
        {tagsError ||
          "标签用中文或英文逗号分隔，最多 100 个，每个最多 128 字。"}
      </p>
      <MetadataDefaultsPanel read={readDefaults} revision={defaultsRevision} base={base}
        disabled={busy || dirty || !!conflict || refreshPending || unconfirmed}
        reset={resetDefaults} />
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {conflict && (
        <section
          ref={reviewRef}
          className="metadata-conflicts"
          aria-label="曲目信息冲突审阅"
        >
          <h4>资料已在另一处修改，草稿尚未保存</h4>
          <p>不同字段默认保留各自修改；同字段双方修改时，请选择采用哪份。</p>
          <div className="metadata-conflict-table">
            <table>
              <thead>
                <tr>
                  <th>字段</th>
                  <th>打开时</th>
                  <th>我的草稿</th>
                  <th>最新资料</th>
                  <th>采用</th>
                </tr>
              </thead>
              <tbody>
                {changed.map(([key, label]) => (
                  <tr key={key}>
                    <th>
                      {label}
                      {!equal(draft[key], base[key]) &&
                        !equal(conflict[key], base[key]) && (
                          <small>双方修改</small>
                        )}
                    </th>
                    <td>{text(base[key])}</td>
                    <td>{text(draft[key])}</td>
                    <td>{text(conflict[key])}</td>
                    <td>
                      <select
                        aria-label={`冲突${label}采用`}
                        value={choices[key] ?? ""}
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [key]: e.target.value as "mine" | "latest" | "",
                          })
                        }
                      >
                        <option value="">请选择</option>
                        <option value="mine">我的草稿</option>
                        <option value="latest">最新资料</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || unresolved}
            onClick={() => {
              const merged = structuredClone(conflict);
              for (const [key] of fields)
                if (choices[key] === "mine")
                  Object.assign(merged, { [key]: draft[key] });
              setBase(conflict);
              setDraft(merged);
              setTagsText(merged.tags.join("，"));
              setConflict(null);
              setError("");
              setNotice(
                "已合并到草稿，请核对后保存；保存时会再次检查最新资料。",
              );
            }}
          >
            合并到草稿
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setBase(conflict);
              setDraft(structuredClone(conflict));
              setTagsText(conflict.tags.join("，"));
              setConflict(null);
              setNotice("已采用最新资料，尚未写入任何修改。");
            }}
          >
            放弃草稿并采用最新资料
          </button>
        </section>
      )}
      <div className="file-actions">
        {refreshPending ? (
          <button
            className="primary-button"
            disabled={busy}
            onClick={retryRefresh}
          >
            重试刷新已保存的曲库
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={
              busy || !!conflict || !!tagsError || !dirty || unconfirmed
            }
            onClick={save}
          >
            保存曲目信息
          </button>
        )}
        <button disabled={busy || refreshPending} onClick={review}>
          {unconfirmed ? "核对当前保存结果" : "读取最新资料并审阅"}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void job(async () => {
              await copyLibraryPaths([
                edit.path,
                ...fields.map(
                  ([key, label]) => `${label}：${text(draft[key])}`,
                ),
              ]);
              setNotice("已复制当前草稿。");
            })
          }
        >
          复制信息草稿
        </button>
        <button disabled={busy} onClick={cancel}>
          {refreshPending
            ? "关闭信息编辑"
            : draftMemory
              ? "关闭并保留输入"
              : "取消信息编辑"}
        </button>
        {draftMemory && !refreshPending && !unconfirmed && dirty && (
          <button
            disabled={busy}
            onClick={() => {
              draftMemory.delete(memoryKey);
              cancel();
            }}
          >
            放弃本次修改
          </button>
        )}
      </div>
      <p className="parameter-help">
        {refreshPending
          ? "资料已经保存。重试只刷新曲库，不会再次写入。关闭后，曲库可能暂时显示旧资料。"
          : draftMemory
            ? `${editDraftPersistence(draftMemory) ? "" : "未保存输入保留到本次会话结束。"}保存仅修改曲目信息，指法、分手和谱面关联继续保留。`
            : "保存或取消后再切换曲目或关闭曲库。保存只修改这些信息，指法、分手和谱面关联仍保留。"}
      </p>
    </section>
  );
}
