import { useCloseParticipant } from "./app/closePreparation";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import type { PassageCatalog } from "./features/practice/catalogTypes";
import {
  capturePracticeScope,
  samePracticeScope,
} from "./engine/useCatalogRead";
import { TaskActivity } from "./engine/TaskActivity";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, type LoadedSong } from "./api";
import type { WrittenRoute, WrittenVisit } from "./ScoreRoute";

import type { ScoreRange, PassagePreset } from "./engine/commands.generated";
export type { ScoreRange } from "./engine/commands.generated";
interface Limits {
  minBeat: number;
  maxBeat: number;
  ticksPerBeat: number;
}
interface Preview {
  firstLimits: Limits;
  lastLimits: Limits;
  range: ScoreRange;
  crossings: number;
  notes: number;
  targets: number;
  rows: WrittenVisit[];
}
const beatText = (value: number) => String(Number(value.toFixed(9)));
export function ScoreRangeDialog({
  song,
  first: initialFirst,
  last: initialLast,
  preset,
  expectedCatalog,
  close,
  changed,
}: {
  song: LoadedSong;
  first: number;
  last: number;
  preset?: { id: string; name: string; notes: string; scoreRange: ScoreRange };
  expectedCatalog?: string;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const source = useRef(capturePracticeScope(song));
  const sourceChanged = !samePracticeScope(source.current, song);
  const [catalogRevision, setCatalogRevision] = useState<string | undefined>(
    expectedCatalog,
  );
  const [catalogReading, setCatalogReading] = useState(false),
    [catalogError, setCatalogError] = useState("");
  const [catalogReload, setCatalogReload] = useState(0);
  const [targetId, setTargetId] = useState<string | null>(preset?.id ?? null);
  const [latestPreset, setLatestPreset] = useState<PassagePreset | null>(null);
  const [catalogNotice, setCatalogNotice] = useState(""),
    [missingTarget, setMissingTarget] = useState(false);
  useEffect(() => {
    let live = true;
    setCatalogReading(true);
    setCatalogError("");
    void api
      .readPractice<PassageCatalog>(source.current, { type: "passages" })
      .then((value) => {
        if (!live) return;
        if (!preset || !expectedCatalog || catalogReload > 0)
          setCatalogRevision(value.catalogRevision);
        if (catalogReload > 0) {
          const latest = targetId
            ? (value.passages.find((row) => row.id === targetId) ?? null)
            : null;
          setLatestPreset(latest);
          setMissingTarget(!!targetId && !latest);
          setCatalogNotice(
            targetId && !latest
              ? "原段落已移除，当前输入仍在，可另存为新段落。"
              : "已读取最新列表，当前输入保留。请核对已保存内容后再保存。",
          );
        }
      })
      .catch((failure) => {
        if (live)
          setCatalogError(
            failure instanceof Error ? failure.message : String(failure),
          );
      })
      .finally(() => {
        if (live) setCatalogReading(false);
      });
    return () => {
      live = false;
    };
  }, [catalogReload]);
  const [startTrim, setStartTrim] = useState(preset?.scoreRange.startTrim ?? 0),
    [endTrim, setEndTrim] = useState(preset?.scoreRange.endTrim ?? 0);
  const [startText, setStartText] = useState(""),
    [endText, setEndText] = useState(""),
    [beatDirty, setBeatDirty] = useState(false);
  const limitsCache = useRef<{
    first: number;
    last: number;
    a: Limits;
    b: Limits;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [route, setRoute] = useState<WrittenRoute | null>(null);
  const [first, setFirst] = useState(initialFirst),
    [last, setLast] = useState(initialLast);
  const [name, setName] = useState(preset?.name ?? ""),
    [notes, setNotes] = useState(preset?.notes ?? "");
  const [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0),
    [reading, setReading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [appliedAction, setAppliedAction] = useState<"saved" | "loop" | null>(null);
  const busyRef = useRef(false);
  useCloseParticipant("原谱选段", () => dirtyRef.current ? "原谱选段的范围、名称或备注尚未保存，可返回继续编辑。" : null);
  const exit = () => {
    if (
      !busyRef.current &&
      (!dirtyRef.current || window.confirm("原谱选段尚未保存，放弃这些修改？"))
    )
      close();
  };
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    api
      .command<{
        contentId: string;
        scoreRevision: number;
        route: WrittenRoute | null;
      }>({ type: "score" })
      .then((asset) => {
        if (disposed) return;
        if (
          !asset ||
          asset.contentId !== song.contentId ||
          asset.scoreRevision !== song.scoreRevision
        )
          throw new Error("曲目或谱面已切换，请重新打开原谱选段");
        if (!asset.route?.complete)
          throw new Error("谱面演奏顺序或音符对应需要校对");
        setRoute(asset.route);
      })
      .catch((e) => {
        if (!disposed) {
          setError(String(e.message));
          setReading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [song.contentId, song.scoreRevision]);
  useEffect(() => {
    if (!route) return;
    let disposed = false;
    setPreview(null);
    setConfirmed(false);
    setPage(0);
    setReading(true);
    setError("");
    api
      .readPractice<Preview>(source.current, {
        type: "previewScoreRangeTrim",
        content_id: song.contentId,
        score_revision: song.scoreRevision,
        first,
        last,
        start_trim: startTrim,
        end_trim: endTrim,
      })
      .then((v) => {
        if (!disposed) {
          setPreview(v);
          limitsCache.current = {
            first,
            last,
            a: v.firstLimits,
            b: v.lastLimits,
          };
          setStartText(
            beatText(
              v.firstLimits.minBeat +
                (v.range.startTrim ?? 0) / v.firstLimits.ticksPerBeat,
            ),
          );
          setEndText(
            beatText(
              v.lastLimits.maxBeat -
                (v.range.endTrim ?? 0) / v.lastLimits.ticksPerBeat,
            ),
          );
          setBeatDirty(false);
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e.message));
      })
      .finally(() => {
        if (!disposed) setReading(false);
      });
    return () => {
      disposed = true;
    };
  }, [
    route,
    first,
    last,
    startTrim,
    endTrim,
    song.contentId,
    song.scoreRevision,
  ]);
  const measures = useMemo(
    () =>
      Array.from(
        new Map(route?.visits.map((v) => [v.measure, v]) ?? []).values(),
      ).sort((a, b) => a.measure - b.measure),
    [route],
  );
  const endpoint = (
    kind: "起点" | "终点",
    ordinal: number,
    update: (v: number) => void,
  ) => {
    const visit = route?.visits[ordinal];
    const visits =
      route?.visits.filter((v) => v.measure === visit?.measure) ?? [];
    return (
      <fieldset>
        <legend>{kind}</legend>
        <label>
          原谱小节
          <select
            aria-label={`${kind}原谱小节`}
            value={visit?.measure ?? -1}
            disabled={busy || !!appliedAction || !route}
            onChange={(e) => {
              const options = route!.visits.filter(
                (v) => v.measure === Number(e.target.value),
              );
              const preferred = kind === "终点" ? first : ordinal;
              const next = (
                options.find((v) => v.ordinal >= preferred) ?? options[0]
              ).ordinal;
              update(next);
              setStartTrim(0);
              setEndTrim(0);
              setDirty(true);
              if (kind === "起点" && next > last) setLast(next);
            }}
          >
            {!visit && <option value={-1}>原演奏位置已不存在</option>}
            {measures.map((m) => (
              <option key={m.measure} value={m.measure}>
                第 {m.number || m.measure + 1} 小节
              </option>
            ))}
          </select>
        </label>
        <label>
          演奏次数
          <select
            aria-label={`${kind}演奏次数`}
            value={ordinal}
            disabled={busy || !!appliedAction || !visit}
            onChange={(e) => {
              const next = Number(e.target.value);
              update(next);
              setStartTrim(0);
              setEndTrim(0);
              setDirty(true);
              if (kind === "起点" && next > last) setLast(next);
            }}
          >
            {visits.map((v, i) => (
              <option key={v.ordinal} value={v.ordinal}>
                第 {i + 1} 次 · 全曲第 {v.ordinal + 1} 段
                {v.partialStart || v.partialEnd ? " · 部分小节" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          原谱拍位
          <input
            aria-label={`${kind}原谱拍位`}
            type="number"
            step="any"
            value={kind === "起点" ? startText : endText}
            disabled={
              busy ||
              !!appliedAction ||
              !limitsCache.current ||
              limitsCache.current.first !== first ||
              limitsCache.current.last !== last
            }
            onChange={(e) => {
              if (kind === "起点") setStartText(e.target.value);
              else setEndText(e.target.value);
              setBeatDirty(true);
              setDirty(true);
              setConfirmed(false);
            }}
          />
        </label>
      </fieldset>
    );
  };
  const reviewBeats = () => {
    const limits = limitsCache.current;
    if (!limits || limits.first !== first || limits.last !== last) return;
    const a = Number(startText),
      b = Number(endText);
    if (
      !startText.trim() ||
      !endText.trim() ||
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < limits.a.minBeat ||
      a > limits.a.maxBeat ||
      b < limits.b.minBeat ||
      b > limits.b.maxBeat
    ) {
      setError("拍位超出所选演奏次数的实际范围");
      return;
    }
    const x = Math.round((a - limits.a.minBeat) * limits.a.ticksPerBeat),
      y = Math.round((limits.b.maxBeat - b) * limits.b.ticksPerBeat);
    const actualStart = limits.a.minBeat + x / limits.a.ticksPerBeat;
    const actualEnd = limits.b.maxBeat - y / limits.b.ticksPerBeat;
    setStartText(beatText(actualStart));
    setEndText(beatText(actualEnd));
    setStartTrim(x);
    setEndTrim(y);
    setBeatDirty(false);
    setError("");
  };
  const allowed =
    !sourceChanged &&
    !!preview &&
    !appliedAction &&
    preview.range.firstVisit === first &&
    preview.range.lastVisit === last &&
    (preview.range.startTrim ?? 0) === startTrim &&
    (preview.range.endTrim ?? 0) === endTrim &&
    !reading &&
    !beatDirty &&
    !busy &&
    (preview.crossings === 0 || confirmed);
  const finish = async (action: "saved" | "loop") => {
    try {
      await changed();
      close();
    } catch (e) {
      setError(
        `${action === "saved" ? "原谱练习段已保存" : "循环范围已用于练习"}，界面刷新失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  const retryRefresh = async () => {
    if (!appliedAction || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await finish(appliedAction);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const work = async (save: boolean) => {
    if (
      !allowed ||
      !preview ||
      busyRef.current ||
      (save &&
        (!catalogRevision || catalogReading || catalogError || missingTarget))
    )
      return;
    if (
      !save &&
      (name !== (preset?.name ?? "") || notes !== (preset?.notes ?? "")) &&
      !window.confirm(
        "循环只应用练习范围，不保存段落名称或备注。继续并放弃这两项修改？",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const command = {
        ...(save
          ? { type: "saveScorePassage" as const, id: targetId, name, notes }
          : { type: "applyScoreRange" as const }),
        content_id: song.contentId,
        score_revision: song.scoreRevision,
        range: preview.range,
      };
      await api.editPractice(
        source.current,
        command,
        save ? catalogRevision : undefined,
      );
      const action = save ? "saved" : "loop";
      setAppliedAction(action);
      setDirty(false);
      dirtyRef.current = false;
      await finish(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
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
        className="settings-dialog score-range-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-range-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="score-range-title">原谱选段练习</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            disabled={busy}
            aria-label="关闭原谱选段"
            onClick={exit}
          >
            <X size={18} />
          </button>
        </div>
        {preset && (
          <p className="score-range-original">
            原保存范围：{preset.scoreRange.description}
            。保存将使用下面重新审阅的范围。
          </p>
        )}
        <div className="score-range-endpoints">
          {endpoint("起点", first, setFirst)}
          {endpoint("终点", last, setLast)}
        </div>
        <p>
          拍位按原谱拍号的分母计拍，可用小数；6/8
          的一拍为八分音符。端点限定于所选演奏次数，终点的起音不计入。审阅后输入框显示对齐到实际演奏
          tick 的拍位。
        </p>
        <div className="file-actions">
          <button
            disabled={
              busy || !!appliedAction || reading || !limitsCache.current
            }
            onClick={reviewBeats}
          >
            审阅拍内范围
          </button>
          <button
            disabled={busy || !!appliedAction}
            onClick={() => {
              setStartTrim(0);
              setEndTrim(0);
              setStartText(String(route?.visits[first]?.startBeat ?? 1));
              setEndText(String(route?.visits[last]?.endBeat ?? 1));
              setBeatDirty(false);
              setDirty(true);
              setError("");
            }}
          >
            恢复该次完整范围
          </button>
        </div>
        {beatDirty && (
          <p role="status">拍位已修改，请审阅拍内范围后再保存或循环。</p>
        )}
        {reading && <p role="status">正在读取实际演奏路径…</p>}
        <TaskActivity
          contentId={song.contentId}
          label={["预览练习范围", "保存练习段资料", "应用练习范围"]}
        />

        {catalogNotice && <p role="status">{catalogNotice}</p>}
        {latestPreset && (
          <div className="catalog-latest">
            <strong>当前已保存：{latestPreset.name}</strong>
            <p>
              {latestPreset.scoreRange?.description ??
                latestPreset.preciseRange?.description ??
                `第 ${latestPreset.start}–${latestPreset.end} 小节`}
            </p>
            <p>{latestPreset.notes || "未填写备注"}</p>
            <button
              disabled={busy || !!appliedAction}
              onClick={() => {
                setName(latestPreset.name);
                setNotes(latestPreset.notes);
                setDirty(true);
              }}
            >
              采用最新名称与备注
            </button>
            {latestPreset.scoreRange &&
              preview &&
              latestPreset.scoreRange.scoreIdentity ===
                preview.range.scoreIdentity &&
              latestPreset.scoreRange.routeIdentity ===
                preview.range.routeIdentity && (
                <button
                  disabled={busy || !!appliedAction}
                  onClick={() => {
                    const range = latestPreset.scoreRange!;
                    setFirst(range.firstVisit);
                    setLast(range.lastVisit);
                    setStartTrim(range.startTrim ?? 0);
                    setEndTrim(range.endTrim ?? 0);
                    setDirty(true);
                    setPreview(null);
                  }}
                >
                  按最新原谱范围重新预览
                </button>
              )}
          </div>
        )}
        {missingTarget && (
          <button
            disabled={busy || !!appliedAction}
            onClick={() => {
              setTargetId(null);
              setMissingTarget(false);
              setLatestPreset(null);
              setDirty(true);
            }}
          >
            将输入另存为新段落
          </button>
        )}
        {catalogError && (
          <p role="alert">
            练习段列表读取失败：{catalogError}。输入仍保留。
            <button
              disabled={catalogReading || busy || sourceChanged}
              onClick={() => setCatalogReload((value) => value + 1)}
            >
              重新读取练习段列表
            </button>
          </p>
        )}
        <div className="practice-catalog-toolbar">
          {!appliedAction && (
            <button
              disabled={
                catalogReading || busy || sourceChanged || !!appliedAction
              }
              onClick={() => setCatalogReload((value) => value + 1)}
            >
              {catalogReading
                ? "正在读取段落列表…"
                : "重新读取段落列表，保留输入"}
            </button>
          )}
          <CopyPracticeDraft
            label="复制原谱段落草稿"
            value={{
              source: source.current,
              contentId: song.contentId,
              title: song.title,
              id: targetId,
              name,
              notes,
              first,
              last,
              startTrim,
              endTrim,
              range: preview?.range,
            }}
          />
        </div>
        {sourceChanged && (
          <p className="catalog-source-warning" role="alert">
            曲目或标注已变化，请关闭后重新打开原谱选段，再核对范围。当前输入仍在。
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {appliedAction && (
          <p role="status">
            {appliedAction === "saved"
              ? "原谱练习段已保存"
              : "循环范围已用于练习"}
            。重试只读取当前状态，不会重复执行。
          </p>
        )}
        {preview && (
          <div className="score-range-preview">
            <h3>{preview.range.description}</h3>
            <p>
              {preview.rows.length} 个演奏段 · 范围音符 {preview.notes} 个 ·
              当前需弹 {preview.targets} 个
              {preview.crossings > 0
                ? ` · 经过 ${preview.crossings} 处反复或跳转`
                : ""}
            </p>
            {preview.targets === 0 && (
              <p role="status">
                当前手别和音轨在这段没有需弹音符。请检查声部设置，或选择其他小节。
              </p>
            )}
            <div
              className="score-range-path"
              tabIndex={0}
              aria-label="选段实际演奏路径"
            >
              <table>
                <thead>
                  <tr>
                    <th>演奏位置</th>
                    <th>原谱小节</th>
                    <th>实际范围</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(page * 30, page * 30 + 30).map((v) => (
                    <tr key={v.ordinal}>
                      <td>第 {v.ordinal + 1} 段</td>
                      <td>第 {v.number || v.measure + 1} 小节</td>
                      <td>
                        {v.partialStart
                          ? `第 ${Number(v.startBeat.toFixed(3))} 拍开始`
                          : "小节起点"}{" "}
                        ·{" "}
                        {v.partialEnd
                          ? `第 ${Number(v.endBeat.toFixed(3))} 拍前结束`
                          : "小节结束"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 30 && (
              <div className="score-range-pages">
                <button
                  disabled={busy || page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  上一页路径
                </button>
                <span>
                  {page + 1} / {Math.ceil(preview.rows.length / 30)}
                </span>
                <button
                  disabled={busy || (page + 1) * 30 >= preview.rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  下一页路径
                </button>
              </div>
            )}
            {preview.crossings > 0 && (
              <label className="score-range-confirm">
                <input
                  type="checkbox"
                  disabled={busy || !!appliedAction}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                按上述实际路径练习，包含返回或跳过的小节
              </label>
            )}
          </div>
        )}
        <div className="score-range-save">
          <label>
            段落名称
            <input
              aria-label="原谱练习段名称"
              maxLength={80}
              disabled={busy || !!appliedAction}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="例如：再现部转指、尾声连接"
            />
          </label>
          <label>
            练习备注
            <textarea
              aria-label="原谱练习段备注"
              disabled={busy || !!appliedAction}
              rows={2}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        </div>
        <p className="score-range-hint">
          保存时记住当前手别、音轨、速度、模式、预备拍与遍数。练习计划也可使用此段落；谱面或路径改变时需重新审阅。
        </p>
        <div className="file-actions">
          {appliedAction && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void retryRefresh()}
            >
              重试读取已
              {appliedAction === "saved" ? "保存的段落" : "启用的循环"}
            </button>
          )}
          <button disabled={!allowed} onClick={() => void work(false)}>
            循环所选范围
          </button>
          <button
            className="primary-button"
            disabled={
              !allowed ||
              !name.trim() ||
              !catalogRevision ||
              catalogReading ||
              !!catalogError ||
              missingTarget
            }
            onClick={() => void work(true)}
          >
            {targetId ? "更新原谱练习段" : "保存原谱练习段"}
          </button>
          <button disabled={busy} onClick={exit}>
            {appliedAction ? "关闭" : "取消"}
          </button>
        </div>
      </section>
    </div>
  );
}
