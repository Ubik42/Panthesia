import { useMemo, useState } from "react";
import { CopyPracticeDraft } from "../practice/CopyPracticeDraft";
import { routineGoalInputErrors } from "./routineGoalInputs";
import {
  routineContextKey,
  routineItemKey,
  type RoutineWorkbenchStore,
  type RoutineWorkbench,
  type RoutineMetaDraft,
  type RoutineItemDraft,
  type RoutinePending,
  type RoutineScheduleDraft,
} from "./routineWorkbenchStore";

export function RoutineDraftShelf({
  store,
  state,
  blocked,
  currentMetadata,
  currentItem,
  openMetadata,
  openItem,
  openPending,
  openSchedule,
}: {
  store: RoutineWorkbenchStore;
  state: RoutineWorkbench;
  blocked: boolean;
  currentMetadata: string;
  currentItem: string | null;
  openMetadata: (draft: RoutineMetaDraft) => void;
  openItem: (draft: RoutineItemDraft) => void;
  openPending: (pending: RoutinePending) => void;
  openSchedule: (draft: RoutineScheduleDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const entries = useMemo(
    () =>
      [
        ...Object.values(state.metadata).map((draft) => ({
          kind: "metadata" as const,
          id: routineContextKey(draft),
          title: draft.name || "未命名计划",
          draft,
        })),
        ...Object.values(state.items).map((draft) => ({
          kind: "item" as const,
          id: routineItemKey(draft, draft.token),
          title: draft.title || "未命名项目",
          draft,
        })),
        ...Object.values(state.schedules).map((draft) => ({
          kind: "schedule" as const,
          id: routineContextKey(draft),
          title: draft.title || "周期安排",
          draft,
        })),
      ].sort((left, right) => right.draft.updatedAt - left.draft.updatedAt),
    [state.metadata, state.items, state.schedules],
  );
  const filtered = entries.filter((entry) =>
    `${entry.title} ${entry.draft.day ?? "常用计划"}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 12) - 1),
  );
  if (
    !entries.length &&
    !state.storageError &&
    !Object.keys(state.pending).length
  )
    return null;
  return (
    <details
      className="routine-draft-shelf"
      open={state.storageError ? true : undefined}
    >
      <summary>
        未提交草稿 · {entries.length} 份
        {state.storageError ? " · 暂存需要处理" : " · 已在本机暂存"}
      </summary>
      <p>
        切换计划、日期或关闭窗口会保留输入。草稿分别属于常用计划或当天安排，保存后才会修改正式计划。
      </p>
      {Object.entries(state.pending).map(([id, pending]) => (
        <div className="routine-draft-conflict" key={id} role="status">
          <p>
            {pending.label}
            {pending.confirmed
              ? "已提交，界面尚未确认最新状态。"
              : "的结果尚未确认。"}{" "}
            {pending.day ?? "常用计划"} · {pending.title}
          </p>
          <button disabled={blocked} onClick={() => openPending(pending)}>
            继续读取原结果
          </button>
        </div>
      ))}
      {state.storageError && (
        <div className="routine-draft-storage" role="alert">
          <p>{state.storageError}</p>
          <div className="routine-draft-actions">
            <button disabled={blocked} onClick={store.retrySave}>
              重试暂存
            </button>
            <button disabled={blocked} onClick={store.preserveAndSave}>
              保留原文副本并暂存当前草稿
            </button>
            {store.original() !== null && (
              <CopyPracticeDraft
                label="复制磁盘中的原文"
                value={store.original()}
                plainText
              />
            )}
            <CopyPracticeDraft
              label="复制当前工作台"
              value={state}
              createText={() => JSON.stringify(state, null, 2)}
            />
          </div>
        </div>
      )}
      <label className="routine-draft-search">
        查找草稿
        <input
          type="search"
          value={query}
          maxLength={4096}
          placeholder="计划名、项目名或日期"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <ul>
        {filtered
          .slice(currentPage * 12, (currentPage + 1) * 12)
          .map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <div>
                <strong>{entry.title}</strong>
                <span>
                  {entry.draft.day ?? "常用计划"} ·{" "}
                  {entry.kind === "metadata"
                    ? "计划信息"
                    : entry.kind === "item"
                      ? "项目内容"
                      : "周期安排"}{" "}
                  · {new Date(entry.draft.updatedAt).toLocaleString("zh-CN")}
                  {entry.kind === "item" &&
                    entry.draft.goalInput &&
                    routineGoalInputErrors(
                      entry.draft.goalInput,
                      entry.draft.goal.onTime != null,
                    ).length > 0 &&
                    " · 目标数值待补全"}
                </span>
              </div>
              <div className="routine-draft-actions">
                <button
                  disabled={blocked}
                  onClick={() =>
                    entry.kind === "metadata"
                      ? openMetadata(entry.draft)
                      : entry.kind === "item"
                        ? openItem(entry.draft)
                        : openSchedule(entry.draft)
                  }
                >
                  继续编辑
                </button>
                <CopyPracticeDraft
                  label="复制草稿"
                  value={entry.draft}
                  createText={() => JSON.stringify(entry.draft, null, 2)}
                />
                <button
                  disabled={
                    blocked ||
                    (entry.kind === "item"
                      ? entry.id === currentItem
                      : entry.id === currentMetadata)
                  }
                  onClick={() =>
                    entry.kind === "metadata"
                      ? store.removeMetadata(entry.id)
                      : entry.kind === "item"
                        ? store.removeItem(entry.id)
                        : store.removeSchedule(entry.id)
                  }
                >
                  移除草稿
                </button>
              </div>
            </li>
          ))}
      </ul>
      {!filtered.length && <p>没有匹配的草稿。</p>}
      {filtered.length > 12 && (
        <nav className="routine-draft-actions" aria-label="计划草稿分页">
          <button
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            上一页
          </button>
          <span>
            {currentPage + 1} / {Math.ceil(filtered.length / 12)} 页
          </span>
          <button
            disabled={(currentPage + 1) * 12 >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </details>
  );
}
