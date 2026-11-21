import { useEffect, useRef, useState } from "react";
import type {
  ExpressionGoal,
  ExpressionGoalSnapshot,
} from "../../engine/commands.generated";
import { useHistoryRead } from "../../engine/useHistoryRead";
import { TaskActivity } from "../../engine/TaskActivity";
import { expressionGoalText } from "../practice/ExpressionGoalControl";
import { sameExpressionGoal } from "../practice/expressionDraft";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import { EditDraftStatus } from "./EditDraftStatus";
import {
  busyEditDraft,
  editDraftValue,
  openEditDraft,
  type EditDraftStore,
} from "./editDraftStore";

/** Resolving a saved target only needs its content identity, even if its MIDI has moved. */
export function ExpressionDraftRecovery({
  store,
  contentId,
  changed,
  resume,
  close,
  onBusy,
}: {
  store: EditDraftStore;
  contentId: string;
  changed: () => Promise<void>;
  resume: () => Promise<void>;
  close: () => void;
  onBusy: (value: boolean) => void;
}) {
  const record = store.expressions.get(contentId);
  const signature = editDraftValue(record);
  const reader = useHistoryRead(record?.pending?.engineId);
  const [latest, setLatest] = useState<{
    goal: ExpressionGoal | null;
    signature: string;
    readAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const release = openEditDraft(store.expressions, contentId);
    return () => {
      mounted.current = false;
      release();
    };
  }, [store, contentId]);
  const job = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    busyEditDraft(store.expressions, contentId, true);
    try {
      await action();
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      busyEditDraft(store.expressions, contentId, false);
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  const loadCurrent = async () => {
    const request = reader.request<ExpressionGoalSnapshot>({
      type: "readSongExpressionGoal",
      content_id: contentId,
    });
    const value = await request.result;
    if (!mounted.current || !request.isCurrent()) return;
    if (
      !value ||
      value.contentId !== contentId ||
      !Object.hasOwn(value, "goal") ||
      value.goal === undefined ||
      typeof value.writeSettled !== "boolean"
    )
      throw new Error("专项要求读取结果与原曲目不一致或不完整，请重新读取。");
    if (editDraftValue(store.expressions.get(contentId)) !== signature)
      throw new Error("暂存内容已有更新，请重新核对。");
    if (!value.writeSettled)
      throw new Error("资料写入尚未结束，请稍后重新核对。原提交内容继续保留。");
    setLatest({ goal: value.goal, signature, readAt: Date.now() });
    return value.goal;
  };
  const read = () =>
    job(async () => {
      await loadCurrent();
    });
  const verified = latest?.signature === signature;
  const matches =
    !!record?.pending &&
    !!latest &&
    sameExpressionGoal(latest.goal, record.pending.goal);
  const finish = () =>
    job(async () => {
      if (!record?.pending) return;
      const current = await loadCurrent();
      if (current === undefined) return;
      if (
        record.pending.phase === "unconfirmed" &&
        !sameExpressionGoal(current, record.pending.goal)
      )
        throw new Error(
          "当前目标与原提交不同，原输入与保存条件继续保留，请打开原曲目核对后编辑。",
        );
      await changed();
      if (editDraftValue(store.expressions.get(contentId)) !== signature)
        throw new Error("暂存内容已有更新，当前记录继续保留。");
      store.expressions.delete(contentId);
      if (mounted.current) close();
    });
  if (!record?.pending)
    return (
      <p role="status">
        这份提交记录已处理。<button onClick={close}>返回草稿清单</button>
      </p>
    );
  return (
    <section
      className="edit-draft-receipt edit-draft-expression-recovery"
      aria-label="专项要求提交恢复"
      aria-busy={busy}
    >
      <h3>
        {record.title || "曲目专项要求"} ·{" "}
        {record.pending.phase === "refresh" ? "已保存" : "提交结果待核对"}
      </h3>
      <p>可以按曲目读取保存结果。继续修改专项要求时，再打开原曲目。</p>
      {record.path && <small className="file-path">{record.path}</small>}
      <EditDraftStatus
        drafts={store.expressions}
        visible
        phase={record.pending.phase === "refresh" ? "saved" : "unconfirmed"}
      />
      <dl>
        <div>
          <dt>原保存条件</dt>
          <dd>
            {expressionGoalText(
              record.pending.expected === undefined
                ? record.base
                : record.pending.expected,
            ) || "未设置专项要求"}
          </dd>
        </div>
        <div>
          <dt>原提交内容</dt>
          <dd>
            {expressionGoalText(record.pending.goal) || "清除全部专项要求"}
          </dd>
        </div>
        <div>
          <dt>当前保存结果</dt>
          <dd>
            {verified && latest
              ? expressionGoalText(latest.goal) || "未设置专项要求"
              : "等待读取"}
          </dd>
        </div>
      </dl>
      {verified && (
        <p role="status">
          {latest &&
            `读取于 ${new Date(latest.readAt).toLocaleTimeString("zh-CN")}。`}
          {matches
            ? "当前目标与原提交一致。"
            : record.pending.phase === "refresh"
              ? "当前目标已有后续修改。完成刷新后会显示当前资料。"
              : "当前目标与原提交不同。输入与原保存条件继续保留，请打开原曲目核对后编辑。"}
        </p>
      )}
      <TaskActivity
        contentId={contentId}
        label="读取曲目专项要求"
        cancelLabel="取消本次读取"
      />
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
          label="复制原提交与输入"
          value={record}
          plainText
          createText={() => editDraftValue({ contentId, ...record })}
        />
        <button
          disabled={busy}
          data-read-expression
          onClick={() => void read()}
        >
          读取原提交结果
        </button>
        <button disabled={busy} onClick={() => void finish()}>
          读取结果并完成刷新
        </button>
        <button disabled={busy} onClick={() => void job(resume)}>
          打开原曲目继续处理
        </button>
      </div>
    </section>
  );
}
