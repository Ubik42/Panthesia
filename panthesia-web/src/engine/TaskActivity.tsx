import { taskStageLabel } from "./taskStages";
import { useState } from "react";
import { api } from "../api";
import { taskMonitor, useTaskFrame } from "./taskStore";
import "./taskActivity.css";

export function TaskActivity({
  engineId,
  contentId,
  taskId,
  label,
  cancelLabel = "取消这次计算",
  onCancelRequested,
}: {
  engineId?: string;
  contentId?: string;
  taskId?: string;
  label?: string | readonly string[];
  cancelLabel?: string;
  onCancelRequested?: () => void;
}) {
  const frame = useTaskFrame(engineId);
  const tasks = frame.tasks.filter(
    (task) =>
      (!taskId || task.id === taskId) &&
      (!label ||
        (typeof label === "string"
          ? task.label === label
          : label.includes(task.label))) &&
      (!contentId || !task.contentId || task.contentId === contentId) &&
      ["queued", "running", "committing"].includes(task.state),
  );
  const [error, setError] = useState<{
    engineId?: string;
    taskId: string | null;
    message: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set());
  // A task may finish between the cancel click and its response. An old refusal
  // must not remain visible as a current failure after that task has ended.
  const message =
    error &&
    error.engineId === engineId &&
    (!error.taskId || tasks.some((task) => task.id === error.taskId))
      ? error.message
      : "";
  if (!tasks.length && !message && !(engineId && frame.error)) return null;
  const cancelKey = (id: string) => JSON.stringify([engineId, id]);
  return (
    <section className="task-activity" aria-label="后台任务">
      {engineId && frame.error && (
        <p className="task-activity-error" role="status">
          后台进度暂未读齐：{frame.error}
        </p>
      )}
      {tasks.map((task) => (
        <div key={task.id}>
          <span role="status">
            {task.label} · {taskStageLabel(task.stage)}
          </span>
          <button
            disabled={
              task.state === "committing" || cancelling.has(cancelKey(task.id))
            }
            onClick={async () => {
              const key = cancelKey(task.id);
              setCancelling((current) => new Set([...current, key]));
              setError(null);
              try {
                onCancelRequested?.();
                await api.commandForEngine(engineId, {
                  type: "cancelTask",
                  id: task.id,
                });
                await taskMonitor(engineId).refresh();
              } catch (failure) {
                setError({
                  engineId,
                  taskId: task.id,
                  message:
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                });
              } finally {
                setCancelling((current) => {
                  const next = new Set(current);
                  next.delete(key);
                  return next;
                });
              }
            }}
          >
            {task.state === "committing"
              ? "等待完成"
              : cancelling.has(cancelKey(task.id))
                ? "正在取消…"
                : cancelLabel}
          </button>
        </div>
      ))}
      {tasks.some((task) => task.label === "导入练习资料") && (
        <p>导入期间暂时停用演奏和资料修改，止音仍可使用。</p>
      )}
      {tasks.some((task) => task.state !== "committing") && (
        <p>取消后将丢弃未提交的结果；已开始保存时请等待完成。</p>
      )}
      <button
        onClick={() =>
          void api.command({ type: "panic" }).catch((failure) =>
            setError({
              engineId,
              taskId: null,
              message:
                failure instanceof Error ? failure.message : String(failure),
            }),
          )
        }
      >
        暂停并停止发声
      </button>
      {message && (
        <div className="task-activity-error" role="alert">
          <span>{message}</span>
          <button onClick={() => setError(null)}>关闭提示</button>
        </div>
      )}
    </section>
  );
}
