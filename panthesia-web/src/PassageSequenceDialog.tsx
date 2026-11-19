import { useCloseParticipant } from "./app/closePreparation";
import { TaskActivity } from "./engine/TaskActivity";
import { useEffect, useRef, useState } from "react";
import { useRoutineService } from "./features/routines/useRoutineService";
import type { RoutineGoal } from "./features/routines/routineTypes";
type Candidate = {
  contentId: string;
  songTitle: string;
  id: string;
  name: string;
  notes: string;
  start: number;
  end: number;
  speed: number;
  settings: { mode?: string; hands: string };
  scoreRange?: { description: string };
  preciseRange?: { description: string };
};
type Entry = { id: string; copies: number; contentId: string; row: Candidate };
type Saved = { ids: string[]; count: number };
type Preview = {
  proof: string;
  existing: number;
  count: number;
  items: {
    id: string;
    songTitle: string;
    title: string;
    notes: string;
    speed: number;
    settings: { mode?: string; hands: string };
    target: {
      kind: string;
      start?: number;
      end?: number;
      range?: { description: string };
    };
  }[];
};
const modes: Record<string, string> = {
  wait: "等音",
  flow: "连续",
  recital: "完整演奏",
  memory: "背谱",
};
const hands: Record<string, string> = {
  custom: "逐音分手",
  all: "全部声部",
  both: "双手",
  left: "左手",
  right: "右手",
};
const candidateRange = (p: Candidate) =>
  p.scoreRange?.description ??
  p.preciseRange?.description ??
  `第 ${p.start}–${p.end} 小节`;
export function PassageSequenceDialog({
  engineId,
  contentId,
  songTitle,
  routineId,
  day,
  planName,
  close,
  added,
}: {
  engineId?: string;
  contentId: string;
  songTitle: string;
  routineId: string;
  day: string | null;
  planName: string;
  close: () => void;
  added: () => Promise<void>;
}) {
  const service = useRoutineService(engineId);
  const [rows, setRows] = useState<Candidate[]>([]),
    [entries, setEntries] = useState<Entry[]>([]),
    [search, setSearch] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const [all, setAll] = useState(!contentId),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const [goal, setGoal] = useState<RoutineGoal>({
    passes: 1,
    accuracy: 90,
    onTime: null,
    consecutive: false,
    attemptLimit: 20,
  });
  const busyRef = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const prior = document.activeElement;
    return () => {
      alive.current = false;
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setRows([]);
    setError("");
    const timer = window.setTimeout(() => {
      void service
        .command<{ rows: Candidate[]; total: number }>({
          type: "passageCatalog",
          content_id: all ? null : contentId,
          query: search,
          offset,
        })
        .then((p) => {
          if (!cancelled) {
            setRows(p.rows);
            setTotal(p.total);
            setReady(true);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e.message));
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [contentId, all, search, offset, readRevision, service]);
  const exit = () => {
    if (
      !busyRef.current &&
      (saved ||
        !entries.length ||
        window.confirm("段落编排尚未加入计划，放弃这些修改？"))
    )
      close();
  };
  useCloseParticipant("段落编排", () =>
    entries.length && !saved
      ? "当前段落顺序尚未加入计划，关闭后这些输入会丢失。"
      : null,
  );
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (entries.length && !saved) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
    };
  }, [entries, close, saved]);
  const update = (next: Entry[]) => {
    setEntries(next);
    setPreview(null);
    setError("");
  };
  const patch = (next: Partial<RoutineGoal>) => {
    setGoal((g) => ({ ...g, ...next }));
    setPreview(null);
    setError("");
  };
  const count = entries.reduce((n, e) => n + e.copies, 0);
  const retrySaved = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await added();
      if (alive.current) close();
    } catch (failure) {
      if (alive.current)
        setError(
          `编排已保存，计划列表读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const work = async (save: boolean) => {
    if (busyRef.current || saved) return;
    if (save && !preview) {
      setError("请先核对编排，再加入计划");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    let committed = false;
    try {
      const result = await service.command<Preview | Saved>({
        type: "composePassages",
        routine_id: routineId,
        day,
        content_id: contentId,
        entries: entries.map(({ id, copies, contentId }) => ({
          id,
          copies,
          contentId,
        })),
        goal,
        proof: save ? preview!.proof : null,
      });
      if (!alive.current) return;
      if (save) {
        if (!("ids" in result))
          throw new Error("编排保存结果缺少项目编号，请重新读取计划确认");
        committed = true;
        setSaved(result);
        await added();
        if (alive.current) close();
      } else if ("proof" in result) setPreview(result);
      else throw new Error("编排预览结果无效，请重试");
    } catch (failure) {
      if (alive.current) {
        if (!committed) setPreview(null);
        const detail =
          failure instanceof Error ? failure.message : String(failure);
        setError(
          committed ? `编排已保存，计划列表读取失败：${detail}` : detail,
        );
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        exit();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog passage-sequence-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sequence-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="sequence-title">编排多个段落</h2>
            <p>
              {songTitle} → {planName}
              {day ? ` · ${day}` : " · 常用计划"}
            </p>
          </div>
          <button
            autoFocus
            disabled={busy}
            onClick={exit}
            aria-label="关闭段落编排"
          >
            关闭
          </button>
        </div>
        <p className="parameter-help">
          每段保留已保存的范围、手别、声部和速度。重复编排为独立项目，各自记录达标；本次编排的达标要求统一设置。
        </p>
        {busy && <TaskActivity label={["预览段落编排", "保存练习计划"]} />}
        {saved && (
          <div className="passage-sequence-saved" role="status">
            已将 {saved.count} 个项目加入计划。
            <button disabled={busy} onClick={() => void retrySaved()}>
              重新读取已保存的计划
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        {!ready && error && !saved && (
          <button
            disabled={busy}
            onClick={() => setReadRevision((value) => value + 1)}
          >
            重试读取段落
          </button>
        )}
        <fieldset className="passage-sequence-controls" disabled={!!saved}>
          <div className="passage-sequence-layout">
            <div>
              <h3>已保存段落 · {total}</h3>
              <label className="passage-sequence-all">
                <input
                  type="checkbox"
                  checked={all}
                  disabled={busy || !contentId}
                  onChange={(e) => {
                    setAll(e.target.checked);
                    setOffset(0);
                  }}
                />
                全部曲目
              </label>
              <input
                aria-label="查找可编排段落"
                value={search}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                placeholder="曲名、段落名称或备注"
              />
              <div className="passage-sequence-candidates">
                {rows.map((p) => (
                  <div
                    className="passage-sequence-candidate"
                    key={p.contentId + ":" + p.id}
                  >
                    <div>
                      <strong>{p.name}</strong>
                      <small>{p.songTitle}</small>
                      <small>
                        {candidateRange(p)} ·{" "}
                        {hands[p.settings.hands] ?? p.settings.hands} ·{" "}
                        {modes[p.settings.mode ?? "wait"] ?? p.settings.mode} ·{" "}
                        {Math.round(p.speed * 100)}%
                      </small>
                      {p.notes && <small>{p.notes}</small>}
                    </div>
                    <button
                      aria-label={`加入编排：${p.songTitle} / ${p.name}`}
                      disabled={busy || count >= 200}
                      onClick={() =>
                        update([
                          ...entries,
                          {
                            id: p.id,
                            copies: 1,
                            contentId: p.contentId,
                            row: p,
                          },
                        ])
                      }
                    >
                      加入
                    </button>
                  </div>
                ))}
                {ready && !rows.length && (
                  <p>
                    {search
                      ? "没有匹配段落，请调整查找文字。"
                      : "还没有保存段落，请先保存要练的范围，或选择全部曲目。"}
                  </p>
                )}
                {!ready && !error && <p role="status">正在读取段落…</p>}
              </div>
              <div className="passage-sequence-paging">
                <button
                  disabled={busy || !ready || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  上一页
                </button>
                <span>
                  {total
                    ? `${offset + 1}–${Math.min(offset + 50, total)} / ${total}`
                    : "0 / 0"}
                </span>
                <button
                  disabled={busy || !ready || offset + 50 >= total}
                  onClick={() => setOffset(offset + 50)}
                >
                  下一页
                </button>
              </div>
            </div>
            <div>
              <h3>练习顺序 · {count} 个项目</h3>
              <div className="passage-sequence-order">
                {entries.map((entry, index) => {
                  const p = entry.row;
                  return (
                    <div className="passage-sequence-entry" key={index}>
                      <strong>
                        {index + 1}. {p?.name ?? "段落已移除"}
                      </strong>
                      <small>
                        {p.songTitle} · {candidateRange(p)}
                      </small>
                      <div className="passage-sequence-actions">
                        <label>
                          编排次数
                          <input
                            type="number"
                            aria-label={`第 ${index + 1} 段编排次数`}
                            min={1}
                            max={20}
                            disabled={busy}
                            value={entry.copies}
                            onChange={(e) =>
                              update(
                                entries.map((v, i) =>
                                  i === index
                                    ? { ...v, copies: Number(e.target.value) }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          aria-label={`上移第 ${index + 1} 段`}
                          disabled={busy || index === 0}
                          onClick={() => {
                            const next = [...entries];
                            [next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ];
                            update(next);
                          }}
                        >
                          上移
                        </button>
                        <button
                          aria-label={`下移第 ${index + 1} 段`}
                          disabled={busy || index === entries.length - 1}
                          onClick={() => {
                            const next = [...entries];
                            [next[index + 1], next[index]] = [
                              next[index],
                              next[index + 1],
                            ];
                            update(next);
                          }}
                        >
                          下移
                        </button>
                        <button
                          aria-label={`移除第 ${index + 1} 段`}
                          disabled={busy}
                          onClick={() =>
                            update(entries.filter((_, i) => i !== index))
                          }
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!entries.length && (
                  <p className="parameter-help">
                    从左侧加入段落，再调整先后顺序。可以将同一段放在不同位置。
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="passage-sequence-goals">
            <label>
              每项达标次数
              <input
                aria-label="编排达标次数"
                type="number"
                min={1}
                max={100}
                value={goal.passes}
                disabled={busy}
                onChange={(e) => patch({ passes: Number(e.target.value) })}
              />
            </label>
            <label>
              最低正确率（%）
              <input
                aria-label="编排最低正确率"
                type="number"
                min={50}
                max={100}
                value={goal.accuracy}
                disabled={busy}
                onChange={(e) => patch({ accuracy: Number(e.target.value) })}
              />
            </label>
            <label>
              每项轮数上限
              <input
                aria-label="编排轮数上限"
                type="number"
                min={1}
                max={500}
                value={goal.attemptLimit}
                disabled={busy}
                onChange={(e) =>
                  patch({ attemptLimit: Number(e.target.value) })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={goal.consecutive}
                onChange={(e) => patch({ consecutive: e.target.checked })}
              />
              连续达标
            </label>
          </div>
          {preview && (
            <div className="passage-sequence-preview" role="status">
              <strong>
                核对结果：追加 {preview.count} 项，计划原有 {preview.existing}{" "}
                项
              </strong>
              <ol>
                {preview.items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>
                      {item.songTitle} ·{" "}
                      {item.target.range?.description ??
                        `第 ${item.target.start}–${item.target.end} 小节`}{" "}
                      · {hands[item.settings.hands] ?? item.settings.hands} ·{" "}
                      {modes[item.settings.mode ?? "wait"] ??
                        item.settings.mode}{" "}
                      · {Math.round(item.speed * 100)}%
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </fieldset>
        <div className="dialog-actions">
          <button
            disabled={busy || !!saved || !entries.length || !ready}
            onClick={() => void work(false)}
          >
            核对编排
          </button>
          <button
            className="primary"
            disabled={busy || !!saved || !preview}
            onClick={() => void work(true)}
          >
            按此顺序加入计划
          </button>
          <button disabled={busy} onClick={exit}>
            {saved ? "完成" : "取消"}
          </button>
        </div>
      </section>
    </div>
  );
}
