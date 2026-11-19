import { expressionKey } from "./expressionDraft";
import { ExpressionGoalConflict } from "./ExpressionGoalConflict";
import { CopyPracticeDraft } from "./CopyPracticeDraft";
import { TaskActivity } from "../../engine/TaskActivity";
import { useEffect, useRef, useState } from "react";
import { EditDraftStatus } from "../editing/EditDraftStatus";
import { editDraftPersistence } from "../editing/editDraftStore";
import type { ExpressionInputs, ExpressionDraft } from "./expressionDraft";
import {
  ExpressionGoalControl,
  expressionGoalText,
  noteVelocityEvidenceText,
  notePedalEvidenceText,
  type ExpressionGoal,
} from "../../ExpressionGoalControl";
import type { Snapshot } from "../../api";
import "./songExpressionGoals.css";

export function SongExpressionGoals({
  state,
  inputs,
  changeInputs,
  draft,
  change,
  save,
  busy,
  locked,
  planActive,
  contentId,
  dirty: explicitDirty,
  conflict = false,
  base = null,
  resolveConflict,
  resolveConflictInputs,
  reset,
  pendingRefresh = false,
  refresh,
  error = "",
  notice = "",
  inputError = "",
  pendingPhase,
  retrySave,
  continueEditing,
  drafts,
  reveal,
  revealHandled,
}: {
  inputs?: ExpressionInputs;
  changeInputs?: (inputs: ExpressionInputs) => void;
  contentId?: string;
  dirty?: boolean;
  conflict?: boolean;
  base?: ExpressionGoal | null;
  resolveConflict?: (goal: ExpressionGoal | null) => void;
  resolveConflictInputs?: (inputs: ExpressionInputs) => void;
  reset?: () => void;
  pendingRefresh?: boolean;
  refresh?: () => void;
  error?: string;
  notice?: string;
  inputError?: string;
  pendingPhase?: "unconfirmed" | "refresh";
  retrySave?: () => void;
  continueEditing?: () => void;
  drafts?: Map<string, ExpressionDraft>;
  reveal?: string;
  revealHandled?: (id: string) => void;
  state: Pick<
    Snapshot,
    | "songExpressionGoal"
    | "songExpressionGoalResult"
    | "songExpressionGoalState"
    | "status"
    | "mode"
    | "recording"
  >;
  draft: ExpressionGoal | null;
  change: (value: ExpressionGoal | null) => void;
  save: () => void;
  busy: boolean;
  locked: boolean;
  planActive: boolean;
}) {
  const dirty =
    explicitDirty ??
    JSON.stringify(draft) !== JSON.stringify(state.songExpressionGoal ?? null);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null),
    revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  useEffect(() => {
    if (!reveal || !expanded || revealed.current === reveal) return;
    const frame = requestAnimationFrame(() => {
      const section = root.current;
      if (!section?.getClientRects().length) return;
      if (
        [...document.querySelectorAll('[role="dialog"]')].some(
          (node) => node.getClientRects().length && !node.contains(section),
        )
      ) {
        revealHandled?.(reveal);
        return;
      }
      revealed.current = reveal;
      revealHandled?.(reveal);
      section.scrollIntoView({ block: "start" });
      (
        section.querySelector<HTMLElement>(
          "input:not(:disabled), button:not(:disabled)",
        ) ?? section.querySelector<HTMLElement>("summary")
      )?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, expanded, revealHandled]);
  const goal = state.songExpressionGoal;
  const result = state.songExpressionGoalResult;
  const disabled =
    busy ||
    locked ||
    state.recording ||
    state.mode === "listen" ||
    pendingRefresh ||
    !!pendingPhase;
  return (
    <section ref={root} className="inspector-section song-expression-goal">
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <strong>力度与踏板目标</strong>
          <span>
            {pendingPhase === "unconfirmed"
              ? "提交结果待核对"
              : pendingRefresh
                ? "已保存，等待读取"
                : dirty
                  ? "有未保存修改"
                  : goal
                    ? "已设置"
                    : "未设置"}
          </span>
        </summary>
        <p className="parameter-help">
          目标随曲目保存。每次成绩使用开始演奏时的要求。
        </p>
        <ExpressionGoalControl
          value={draft}
          inputs={inputs}
          changeInputs={changeInputs}
          change={change}
          disabled={disabled}
          wait={state.mode === "wait"}
          labelPrefix="当前曲目"
        />
        <div className="song-expression-actions">
          <button
            disabled={disabled || !dirty || conflict || !!inputError}
            onClick={save}
          >
            保存目标
          </button>
          <button
            disabled={!dirty || busy || pendingRefresh || !!pendingPhase}
            onClick={() => (reset ? reset() : change(goal ?? null))}
          >
            撤销修改
          </button>
        </div>
      </details>
      <EditDraftStatus
        drafts={drafts}
        visible={dirty || !!pendingPhase || pendingRefresh}
        phase={
          pendingRefresh ? "saved" : pendingPhase ? "unconfirmed" : "draft"
        }
      />
      <TaskActivity contentId={contentId} label="保存曲目专项要求" />
      {pendingRefresh && (
        <div className="song-expression-recovery" role="status">
          <span>目标已保存，重新读取只更新界面。</span>
          <button disabled={busy} onClick={refresh}>
            重新读取已保存目标
          </button>
          {continueEditing && (
            <button disabled={busy} onClick={continueEditing}>
              保留输入继续编辑
            </button>
          )}
        </div>
      )}
      {pendingPhase === "unconfirmed" && (
        <div className="song-expression-recovery" role="status">
          <span>
            原输入与提交条件已保留。先读取当前目标，核对原提交是否完成。
          </span>
          <span>
            当前读取的目标：{expressionGoalText(goal) || "未设置专项要求"}
          </span>
          <div className="song-expression-actions">
            <button disabled={busy} onClick={refresh}>
              读取原提交结果
            </button>
            {retrySave && (
              <button
                disabled={busy || conflict || !!inputError}
                onClick={retrySave}
              >
                按原条件重试提交
              </button>
            )}
            {continueEditing && (
              <button disabled={busy} onClick={continueEditing}>
                核对后继续编辑
              </button>
            )}
          </div>
        </div>
      )}
      {conflict && !pendingPhase && resolveConflict && (
        <ExpressionGoalConflict
          key={JSON.stringify([
            expressionKey(base),
            expressionKey(draft),
            expressionKey(goal ?? null),
          ])}
          contentId={contentId}
          base={base}
          draft={draft}
          latest={goal ?? null}
          disabled={busy || pendingRefresh}
          resolve={resolveConflict}
          inputs={inputs}
          resolveInputs={resolveConflictInputs}
        />
      )}
      {error && (
        <p className="song-expression-failed" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {inputError && (
        <p className="song-expression-failed" role="status">
          {inputError}
        </p>
      )}
      {dirty && !editDraftPersistence(drafts) && (
        <p className="parameter-help">
          未保存输入按曲目保留在本次会话中，切换曲目后可继续编辑。
        </p>
      )}
      {(dirty || pendingPhase || pendingRefresh) && (
        <CopyPracticeDraft
          label={
            pendingRefresh
              ? "复制已保存目标"
              : pendingPhase
                ? "复制原提交与输入"
                : "复制未保存目标"
          }
          value={
            drafts?.get(contentId ?? "") ?? {
              contentId,
              base,
              draft,
              pendingPhase,
            }
          }
        />
      )}
      {(dirty || conflict || !!error) &&
        !pendingPhase &&
        !pendingRefresh &&
        refresh && (
          <button disabled={busy} onClick={refresh}>
            读取最新目标并保留输入
          </button>
        )}
      {goal && (
        <p className="parameter-help">已保存：{expressionGoalText(goal)}</p>
      )}
      {result && state.status === "finished" && (
        <p
          className={
            result.passed ? "song-expression-passed" : "song-expression-failed"
          }
        >
          本轮目标：{result.message}
          {result.noteVelocity && (
            <> · {noteVelocityEvidenceText(result.noteVelocity)}</>
          )}
          {result.notePedal && (
            <> · {notePedalEvidenceText(result.notePedal)}</>
          )}
        </p>
      )}
      {!result && state.songExpressionGoalState === "pending" && (
        <p className="parameter-help" role="status">
          正在汇总本轮力度与踏板记录…
        </p>
      )}
      {!result && state.songExpressionGoalState === "unavailable" && (
        <p className="song-expression-failed" role="status">
          本轮目标评估尚未完成，请查看保存状态；重试保存后可继续汇总。
        </p>
      )}
      {planActive && (
        <p className="parameter-help">当前使用计划或速度阶梯的要求。</p>
      )}
    </section>
  );
}
