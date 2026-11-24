import { Dialog } from "../../ui/Dialog";
import "./tickRangeDialog.css";
import { CopyPracticeDraft } from "./CopyPracticeDraft";
import type { PassageCatalog } from "./catalogTypes";
import {
  useCatalogRead,
  capturePracticeScope,
  samePracticeScope,
} from "../../engine/useCatalogRead";
import { usePracticeEdits } from "../../engine/usePracticeEdits";
import { SavedEditNotice } from "../../engine/SavedEditNotice";
import { TaskActivity } from "../../engine/TaskActivity";
import { useEffect, useRef, useState } from "react";
import { type LoadedSong, type Snapshot } from "../../api";
import type {
  TickRange,
  BeatPoint as Point,
  PassagePreset,
} from "../../engine/commands.generated";
export type { TickRange } from "../../engine/commands.generated";

type Preview = {
  range: TickRange;
  description: string;
  notes: number;
  targets: number;
  carry: number;
};
type Preset = {
  id: string;
  name: string;
  notes: string;
  preciseRange: TickRange;
};
export function TickRangeDialog({
  song,
  state,
  first,
  last,
  preset,
  expectedCatalog,
  close,
  changed,
}: {
  song: LoadedSong;
  state: Pick<Snapshot, "recording" | "status">;
  first: number;
  last: number;
  preset?: Preset;
  expectedCatalog?: string;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const length = (m: LoadedSong["measures"][number]) =>
    ((song.ppq * 4) / m.denominator) *
    (m.denominator === 8 && m.numerator >= 6 && m.numerator % 3 === 0 ? 3 : 1);
  const point = (tick: number, end = false): Point => {
    let index = song.measures.findIndex((m) =>
      end
        ? tick > m.startTick && tick <= m.endTick
        : tick >= m.startTick && tick < m.endTick,
    );
    if (index < 0) index = song.measures.length - 1;
    const m = song.measures[index];
    return { measure: index + 1, beat: 1 + (tick - m.startTick) / length(m) };
  };
  const onCurrentGrid = (tick: number, end = false) =>
    song.measures.some((m) =>
      end
        ? tick > m.startTick && tick <= m.endTick
        : tick >= m.startTick && tick < m.endTick,
    );
  const endPoint = (bar: number) => {
    let tick = song.measures[bar - 1].endTick;
    const tempo = [...song.tempo]
      .reverse()
      .find((t) => t.seconds <= song.duration);
    if (tempo)
      tick = Math.min(
        tick,
        Math.round(
          tempo.tick +
            ((song.duration - tempo.seconds) * song.ppq * tempo.bpm) / 60,
        ),
      );
    return point(tick, true);
  };
  first = Math.min(song.measures.length, Math.max(1, first || 1));
  last = Math.min(song.measures.length, Math.max(first, last || first));
  const [savedId, setSavedId] = useState<string | null>(preset?.id ?? null);
  const [a, setA] = useState<Point>({ measure: first, beat: 1 }),
    [b, setB] = useState<Point>(() => endPoint(last)),
    [grid, setGrid] = useState(""),
    [name, setName] = useState(preset?.name ?? ""),
    [notes, setNotes] = useState(preset?.notes ?? ""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [mappingNotice, setMappingNotice] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const source = useRef(capturePracticeScope(song));
  const sourceChanged = !samePracticeScope(source.current, song);
  const readCatalog = useCatalogRead(source.current, song);
  const lastAction = useRef<"saved" | "loop" | null>(null);
  const [rangeApplied, setRangeApplied] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState<string | undefined>(
    expectedCatalog,
  );
  const [catalogReading, setCatalogReading] = useState(false),
    [latestPreset, setLatestPreset] = useState<PassagePreset | null>(null);
  const [catalogNotice, setCatalogNotice] = useState(""),
    [missingTarget, setMissingTarget] = useState(false);
  useEffect(() => {
    if (sourceChanged) setCatalogReading(false);
  }, [sourceChanged]);
  const edits = usePracticeEdits(
    source.current,
    async () => {
      await changed();
      if (lastAction.current === "loop" && alive.current && !draft.current)
        close();
    },
    catalogRevision,
  );
  const alive = useRef(true),
    working = useRef(false),
    draft = useRef(false);
  draft.current = dirty;
  working.current = busy;
  const exit = () => {
    if (
      !working.current &&
      (!draft.current || window.confirm("拍内段落尚未保存，放弃这些修改？"))
    )
      close();
  };
  const loadCatalog = async (initial = false) => {
    const request = readCatalog<PassageCatalog>({ type: "passages" });
    setCatalogReading(true);
    try {
      const value = await request.result;
      if (!alive.current || !request.isCurrent()) return;
      if (
        value.contentId !== song.contentId ||
        (song.grid && song.grid !== value.grid)
      )
        throw new Error("曲目或小节网格已更新，请关闭窗口并重新打开拍内段落。");
      setGrid(value.grid);
      setCatalogRevision(
        initial && preset && expectedCatalog
          ? expectedCatalog
          : value.catalogRevision,
      );
      if (initial && preset) {
        if (preset.preciseRange.contentId !== song.contentId)
          throw new Error("练习段的曲目身份已改变，请重新选择曲目。");
        if (
          onCurrentGrid(preset.preciseRange.startTick) &&
          onCurrentGrid(preset.preciseRange.endTick, true)
        ) {
          setA(point(preset.preciseRange.startTick));
          setB(point(preset.preciseRange.endTick, true));
          if (preset.preciseRange.grid !== value.grid)
            setMappingNotice(
              "小节网格已改变。已按原 MIDI 位置填入当前拍位，请核对两端并预览后保存。",
            );
        } else
          throw new Error(
            "原段落位置不在当前小节网格内，请重新设置范围并预览后保存。",
          );
      }
      if (!initial) {
        const latest = savedId
          ? (value.passages.find((row) => row.id === savedId) ?? null)
          : null;
        setLatestPreset(latest);
        setMissingTarget(!!savedId && !latest);
        setCatalogNotice(
          savedId && !latest
            ? "原段落已移除。输入继续保留，可另存为新段落。"
            : "已读取最新列表，当前输入保留。请核对已保存内容后再保存。",
        );
      }
    } finally {
      if (alive.current && request.isCurrent()) setCatalogReading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void loadCatalog(true).catch((failure) => {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (draft.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const edit = () => {
    setDirty(true);
    setSaved(false);
    setRangeApplied(false);
  };
  const boundary = (v: Point, set: (v: Point) => void, title: string) => {
    const m = song.measures[v.measure - 1];
    const max = m ? 1 + (m.endTick - m.startTick) / length(m) : 1;
    return (
      <fieldset className="tick-boundary">
        <legend>{title}</legend>
        <label>
          小节
          <input
            aria-label={`${title}小节`}
            type="number"
            min={1}
            max={song.measures.length}
            value={v.measure}
            disabled={busy}
            onChange={(e) => {
              set({ measure: Number(e.target.value), beat: 1 });
              setPreview(null);
              edit();
            }}
          />
        </label>
        <label>
          拍位
          <input
            aria-label={`${title}拍位`}
            type="number"
            min={1}
            max={max}
            step="any"
            value={v.beat}
            disabled={busy}
            onChange={(e) => {
              set({ ...v, beat: Number(e.target.value) });
              setPreview(null);
              edit();
            }}
          />
        </label>
        <small>
          {m
            ? `${m.numerator}/${m.denominator}${m.partial ? " · 不完整小节" : ""} · ${m.denominator === 8 && m.numerator >= 6 && m.numerator % 3 === 0 ? "每拍三个八分音符" : "按拍号计拍"}`
            : "小节超出曲目"}
        </small>
      </fieldset>
    );
  };
  const work = async (job: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const blocked =
    sourceChanged ||
    !!edits.pendingRefresh ||
    !!state.recording ||
    ["playing", "countIn"].includes(state.status);
  return (
    <Dialog
      title="拍内练习段落"
      subtitle={song.title}
      close={exit}
      closeLabel="关闭拍内段落"
      closeDisabled={busy}
      className="tick-range-dialog"
    >
        <p>
          按实际演奏顺序的小节与拍位选择。1.5
          表示第一拍的后半拍；终点处的起音不计入。
        </p>
        <TaskActivity
          contentId={song.contentId}
          label={[
            "读取练习段资料",
            "预览练习范围",
            "保存练习段资料",
            "应用练习范围",
          ]}
        />
        <SavedEditNotice
          message={edits.pendingRefresh}
          busy={busy}
          blocked={sourceChanged}
          refresh={() => void work(edits.refresh)}
        />

        {catalogNotice && <p role="status">{catalogNotice}</p>}
        {latestPreset && (
          <div className="catalog-latest">
            <strong>当前已保存：{latestPreset.name}</strong>
            <p>
              {latestPreset.preciseRange?.description ??
                latestPreset.scoreRange?.description ??
                `第 ${latestPreset.start}–${latestPreset.end} 小节`}
            </p>
            <p>{latestPreset.notes || "未填写备注"}</p>
            <button
              disabled={busy}
              onClick={() => {
                setName(latestPreset.name);
                setNotes(latestPreset.notes);
                edit();
              }}
            >
              采用最新名称与备注
            </button>
            {latestPreset.preciseRange && (
              <button
                disabled={busy}
                onClick={() => {
                  const range = latestPreset.preciseRange!;
                  if (
                    !onCurrentGrid(range.startTick) ||
                    !onCurrentGrid(range.endTick, true)
                  ) {
                    setError("已保存范围不在当前小节网格内，请重新选择范围。");
                    return;
                  }
                  setA(point(range.startTick));
                  setB(point(range.endTick, true));
                  setPreview(null);
                  edit();
                }}
              >
                按最新范围重新预览
              </button>
            )}
          </div>
        )}
        {missingTarget && (
          <button
            disabled={busy}
            onClick={() => {
              setSavedId(null);
              setMissingTarget(false);
              setLatestPreset(null);
              edit();
            }}
          >
            将输入另存为新段落
          </button>
        )}
        <div className="practice-catalog-toolbar">
          {!edits.pendingRefresh && (
            <button
              disabled={busy || catalogReading || sourceChanged}
              onClick={() => void work(() => loadCatalog(false))}
            >
              {catalogReading
                ? "正在读取段落列表…"
                : "重新读取段落列表，保留输入"}
            </button>
          )}
          <CopyPracticeDraft
            label="复制拍内段落草稿"
            value={{
              source: source.current,
              contentId: song.contentId,
              title: song.title,
              id: savedId,
              name,
              notes,
              start: a,
              end: b,
              range: preview?.range,
            }}
          />
        </div>
        {sourceChanged && (
          <p className="catalog-source-warning" role="alert">
            曲目或标注已变化，请关闭后重新打开拍内段落，再核对范围。当前输入仍在。
          </p>
        )}
        <div className="tick-boundaries">
          {boundary(a, setA, "起点")}
          {boundary(b, setB, "终点")}
        </div>
        <div className="file-actions">
          <button
            disabled={busy || sourceChanged || !!edits.pendingRefresh || !grid}
            onClick={() =>
              void work(async () => {
                const request = readCatalog<Preview>({
                  type: "previewTickRange",
                  content_id: song.contentId,
                  grid,
                  start: a,
                  end: b,
                });
                const v = await request.result;
                if (alive.current && request.isCurrent()) {
                  setPreview(v);
                  setSaved(false);
                }
              })
            }
          >
            预览拍内范围
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setA({ measure: first, beat: 1 });
              setB(endPoint(last));
              setPreview(null);
              edit();
            }}
          >
            采用当前小节范围
          </button>
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {mappingNotice && (
          <p className="parameter-help" role="status">
            {mappingNotice}
          </p>
        )}
        {preview && (
          <div className="tick-preview" role="status">
            <strong>{preview.description}</strong>
            <p>
              {preview.notes} 个起音 · {preview.targets} 个自己弹的目标音
            </p>
            {preview.carry > 0 && (
              <p>
                起点前有 {preview.carry}{" "}
                个延续音；从中途开始不会把它们作为新的按键目标。
              </p>
            )}
            <p>
              边界取曲目可表达的最接近拍位。按原曲变速计算，不随练习速度改变。
            </p>
          </div>
        )}
        <label>
          段落名称
          <input
            aria-label="拍内段落名称"
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              edit();
            }}
          />
        </label>
        <label>
          练习备注
          <textarea
            aria-label="拍内段落备注"
            rows={3}
            value={notes}
            disabled={busy}
            onChange={(e) => {
              setNotes(e.target.value);
              edit();
            }}
          />
        </label>
        <p>
          保存当前声部、分手、模式、速度、预备拍与遍数。打开后保持暂停，可加入练习计划。
        </p>
        <div className="file-actions">
          <button
            disabled={busy || !preview || blocked}
            onClick={() =>
              void work(async () => {
                await edits.commit(
                  { type: "applyTickRange", range: preview!.range },
                  "拍内范围已用于练习",
                  () => {
                    lastAction.current = "loop";
                    const keepText =
                      name !== (preset?.name ?? "") ||
                      notes !== (preset?.notes ?? "");
                    setDirty(keepText);
                    draft.current = keepText;
                    setRangeApplied(keepText);
                  },
                );
              })
            }
          >
            练这个范围
          </button>
          <button
            className="ui-button ui-button--primary"
            disabled={
              busy ||
              catalogReading ||
              !catalogRevision ||
              missingTarget ||
              !preview ||
              !name.trim() ||
              blocked
            }
            onClick={() =>
              void work(async () => {
                await edits.commit<{
                  passage: { id: string };
                  catalogRevision: string;
                }>(
                  {
                    type: "saveTickPassage",
                    id: savedId,
                    name,
                    notes,
                    range: preview!.range,
                  },
                  "拍内段落已保存",
                  (result) => {
                    lastAction.current = "saved";
                    setRangeApplied(false);
                    setDirty(false);
                    draft.current = false;
                    setSavedId(result.passage.id);
                    setCatalogRevision(result.catalogRevision);
                    setSaved(true);
                  },
                );
              })
            }
          >
            {savedId ? "更新拍内段落" : "保存拍内段落"}
          </button>
        </div>
        {blocked && <p>先停止当前演奏、录音或活动计划，再采用或保存范围。</p>}
        {rangeApplied && (
          <p role="status">
            范围已用于练习。名称与备注仍保留在窗口中，可以继续保存为段落。
          </p>
        )}
        {saved && <p role="status">拍内段落已保存。</p>}
    </Dialog>
  );
}
