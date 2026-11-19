import { useEffect, useRef, useState } from "react";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import { EditDraftStatus } from "./EditDraftStatus";
import {
  busyEditDraft,
  editDraftValue,
  openEditDraft,
  type EditDraftStore,
} from "./editDraftStore";

export function SavedMetadataReceipt({
  store,
  memoryKey,
  changed,
  close,
  onBusy,
}: {
  store: EditDraftStore;
  memoryKey: string;
  changed: () => Promise<void>;
  close: () => void;
  onBusy: (value: boolean) => void;
}) {
  const receipt = store.metadata.get(memoryKey);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const working = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const release = openEditDraft(store.metadata, memoryKey);
    return () => {
      alive.current = false;
      release();
    };
  }, [store, memoryKey]);
  if (!receipt?.refresh)
    return (
      <p role="status">
        这份保存回执已处理。<button onClick={close}>返回清单</button>
      </p>
    );
  const [contentId, path] = JSON.parse(memoryKey) as [string, string];
  const refresh = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    busyEditDraft(store.metadata, memoryKey, true);
    try {
      await changed();
      if (
        editDraftValue(store.metadata.get(memoryKey)) !==
        editDraftValue(receipt)
      )
        throw new Error("保存回执已有更新，最新记录继续保留，请核对后处理。");
      store.metadata.delete(memoryKey);
      if (alive.current) close();
    } catch (failure) {
      if (alive.current)
        setError(
          `资料已经保存，界面刷新未完成：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      working.current = false;
      busyEditDraft(store.metadata, memoryKey, false);
      onBusy(false);
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      className="edit-draft-receipt"
      aria-label="曲目信息保存回执"
      aria-busy={busy}
    >
      <h3>
        {receipt.draft.title || receipt.base.title || "曲目信息"} · 已保存
      </h3>
      <p>
        下面是软件确认保存的资料。可直接重试刷新；原文件已移动时也能处理这份回执。
      </p>
      <small className="file-path">{path}</small>
      <EditDraftStatus drafts={store.metadata} visible phase="saved" />
      <dl>
        {Object.entries({
          曲名: receipt.draft.title,
          作曲家: receipt.draft.composer,
          演奏者: receipt.draft.artist,
          作品集: receipt.draft.collection,
          难度: receipt.draft.difficulty,
          标签: receipt.draft.tags.join("，"),
          备注: receipt.draft.notes,
        }).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "未填写"}</dd>
          </div>
        ))}
      </dl>
      {!!receipt.refresh.warnings?.length && (
        <p role="status">{receipt.refresh.warnings.join("；")}</p>
      )}
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="edit-draft-actions">
        <button disabled={busy} onClick={close} data-dialog-escape>
          返回草稿清单
        </button>
        <CopyPracticeDraft
          label="复制保存回执"
          value={receipt}
          plainText
          createText={() => editDraftValue({ contentId, path, ...receipt })}
        />
        <button
          disabled={busy}
          className="primary-button"
          onClick={() => void refresh()}
        >
          {busy ? "正在刷新…" : "刷新已保存结果"}
        </button>
      </div>
    </section>
  );
}
