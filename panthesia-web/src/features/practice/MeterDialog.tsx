import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { api, type LoadedSong, type MeterMapPreview } from "../../api";
import { capturePracticeScope } from "../../engine/useCatalogRead";
import { PracticeEditTaskActivity } from "../../engine/PracticeEditTaskActivity";
import { BrowseDetailWorkspace } from "../../app/BrowseDetailWorkspace";
import { PersistentSessionRecovery } from "../../app/PersistentSessionRecovery";
import { CopyPracticeDraft } from "./CopyPracticeDraft";
import { practiceScopeKey } from "./practiceEditorStore";
import {
  getMeterEditor,
  meterDraftDirty,
} from "./meterEditorStore";
import {
  meterDenominators,
  meterValueKey,
  nativeMeterValue,
  parseMeterForm,
  type MeterForm,
} from "./meterEditorModel";
import "./meter.css";
import type { MeterEditorState } from "../../engine/commands.generated";

const clock = (seconds: number) =>
  Math.floor(seconds / 60) + ":" + (seconds % 60).toFixed(3).padStart(6, "0");
function Pager({
  count,
  page,
  size = 12,
  change,
}: {
  count: number;
  page: number;
  size?: number;
  change: (page: number) => void;
}) {
  const total = Math.max(1, Math.ceil(count / size));
  return (
    <div className="meter-map-toolbar">
      <button disabled={page <= 0} onClick={() => change(page - 1)}>
        上一页
      </button>
      <span>
        {page + 1} / {total} 页 · {count} 项
      </span>
      <button disabled={page >= total - 1} onClick={() => change(page + 1)}>
        下一页
      </button>
    </div>
  );
}
export function MeterDialog({
  song,
  close,
  changed,
}: {
  song: LoadedSong;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [store] = useState(() => getMeterEditor(song));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [preview, setPreview] = useState<
      (MeterMapPreview & { key: string }) | null
    >(null),
    [previewing, setPreviewing] = useState(false),
    [actionBusy, setActionBusy] = useState(false),
    [error, setError] = useState(""),
    [located, setLocated] = useState<number | null>(null);
  const [readResult, setReadResult] = useState<{
    song: LoadedSong;
    quiet: boolean;
  } | null>(null);
  const request = useRef(0),
    working = useRef(false),
    alive = useRef(true);
  const parsed = useMemo(
    () => parseMeterForm(state.form, song.ppq),
    [state.form, song.ppq],
  );
  const value = state.mode === "original" ? null : parsed.value;
  const problem = state.mode === "original" ? "" : parsed.error;
  const sourceKey = practiceScopeKey(song),
    stale = state.source !== sourceKey;
  const key =
    sourceKey + ":" + state.mode + ":" + (problem || meterValueKey(value));
  const validPreview =
    !stale && preview?.key === key && !problem ? preview : null;
  const busy = actionBusy || state.busy,
    locked = busy || stale || !!state.receipt;
  const dirty = meterDraftDirty(state);
  useEffect(() => {
    request.current++;
    setPreview(null);
    setPreviewing(false);
    setLocated(null);
    if (
      !meterDraftDirty(store.getSnapshot()) &&
      !store.getSnapshot().receipt &&
      store.getSnapshot().source !== sourceKey
    )
      store.adopt(song);
  }, [sourceKey, store]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const work = async (job: () => Promise<void>) => {
    if (working.current || store.getSnapshot().busy) return;
    working.current = true;
    setActionBusy(true);
    setError("");
    try {
      await job();
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      working.current = false;
      if (alive.current) setActionBusy(false);
    }
  };
  const edit = (form: MeterForm) => {
    request.current++;
    setPreview(null);
    setPreviewing(false);
    setLocated(null);
    store.edit(form);
    setError("");
  };
  const inspect = async () => {
    if (problem || stale || busy || state.receipt) return;
    const id = ++request.current,
      captured = key;
    setPreviewing(true);
    setError("");
    try {
      const result = await api.readPractice<MeterMapPreview>(
        capturePracticeScope(song),
        { type: "previewMeterMap", content_id: song.contentId, value },
      );
      if (!alive.current || id !== request.current) return;
      setPreview({ ...result, key: captured });
      store.update({ page: 0, section: "preview" });
    } catch (error) {
      if (alive.current && id === request.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (alive.current && id === request.current) setPreviewing(false);
    }
  };
  const readSaved = async (closeAfter = false) => {
    const response = await api.session(),
      current = response.song;
    if (!current || current.contentId !== song.contentId)
      throw new Error("请返回原曲目后读取小节网格，提交记录继续保留。");
    current.engineId = response.state.stateOrder?.engineId ?? current.engineId;
    const native = await api.readPractice<MeterEditorState>(current, {
      type: "readMeterEditorState",
    });
    const quiet =
      native.contentId === current.contentId && native.writeSettled === true;
    if (alive.current) setReadResult({ song: current, quiet });
    const receipt = store.getSnapshot().receipt;
    if (
      quiet &&
      receipt &&
      meterValueKey(nativeMeterValue(current)) === receipt.value
    ) {
      await changed();
      store.adopt(current);
      if (closeAfter && alive.current) close();
    } else if (!quiet)
      throw new Error("资料仍在保存或恢复，请稍后重新读取结果。");
  };
  const adoptResult = (keep: boolean) =>
    void work(async () => {
      if (!readResult?.quiet) return;
      await changed();
      store.adopt(readResult.song, keep);
      setReadResult(null);
      setPreview(null);
    });
  const save = () =>
    void work(async () => {
      if (!validPreview || problem || !dirty || stale) return;
      await store.save(song, value, validPreview.proof);
      await readSaved(true);
    });
  const bars = validPreview?.measures ?? [],
    page = Math.min(state.page, Math.max(0, Math.ceil(bars.length / 20) - 1));
  const segmentPage = Math.min(
    state.segmentPage,
    Math.max(0, Math.ceil(state.form.segments.length / 12) - 1),
  );
  const lengthPage = Math.min(
    state.lengthPage,
    Math.max(0, Math.ceil(state.form.lengths.length / 12) - 1),
  );
  const patchSegment = (
    rowKey: string,
    patch: Partial<MeterForm["segments"][number]>,
  ) =>
    edit({
      ...state.form,
      segments: state.form.segments.map((row) =>
        row.key === rowKey ? { ...row, ...patch } : row,
      ),
    });
  const patchLength = (
    rowKey: string,
    patch: Partial<MeterForm["lengths"][number]>,
  ) =>
    edit({
      ...state.form,
      lengths: state.form.lengths.map((row) =>
        row.key === rowKey ? { ...row, ...patch } : row,
      ),
    });
  const resetNative = () => {
    request.current++;
    store.adopt(song);
    setPreview(null);
    setPreviewing(false);
    setLocated(null);
    setError("");
  };
  const original = () => {
    request.current++;
    setPreviewing(false);
    store.update({
      mode: "original",
      notice: "已选择文件原始网格，请预览并保存后应用。",
    });
    setPreview(null);
    setLocated(null);
  };
  const signature = (
    <fieldset
      disabled={locked || state.mode === "original"}
      className="meter-map-editor"
    >
      <legend>拍号变化 · {state.form.segments.length} 段</legend>
      <Pager
        count={state.form.segments.length}
        page={segmentPage}
        change={(segmentPage) => store.update({ segmentPage })}
      />
      <div className="meter-table-wrap">
        <table className="meter-map-table">
          <thead>
            <tr>
              <th>从导航小节</th>
              <th>每小节拍数</th>
              <th>单位音符</th>
              <th>显示起始编号</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.form.segments
              .slice(segmentPage * 12, (segmentPage + 1) * 12)
              .map((row, offset) => {
                const index = segmentPage * 12 + offset;
                return (
                  <tr key={row.key}>
                    <td>
                      <input
                        aria-label={"第 " + (index + 1) + " 段起始小节"}
                        type="number"
                        min={1}
                        max={1000000}
                        step={1}
                        disabled={index === 0}
                        value={row.measure}
                        onChange={(event) =>
                          patchSegment(row.key, { measure: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={"第 " + (index + 1) + " 段每小节拍数"}
                        type="number"
                        min={1}
                        max={32}
                        step={1}
                        value={row.numerator}
                        onChange={(event) =>
                          patchSegment(row.key, {
                            numerator: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={"第 " + (index + 1) + " 段单位音符"}
                        value={row.denominator}
                        onChange={(event) =>
                          patchSegment(row.key, {
                            denominator: event.target.value,
                          })
                        }
                      >
                        {meterDenominators.map((denominator) => (
                          <option
                            key={denominator}
                            value={denominator}
                            disabled={(song.ppq * 4) % denominator !== 0}
                          >
                            {denominator} 分音符
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={"第 " + (index + 1) + " 段显示编号"}
                        type="number"
                        min={-9999}
                        max={999999}
                        step={1}
                        value={row.display}
                        placeholder={index ? "接续上一段" : "从 1 开始"}
                        onChange={(event) =>
                          patchSegment(row.key, { display: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      {index > 0 && (
                        <button
                          aria-label={"移除第 " + (index + 1) + " 段拍号"}
                          onClick={() =>
                            edit({
                              ...state.form,
                              segments: state.form.segments.filter(
                                (item) => item.key !== row.key,
                              ),
                            })
                          }
                        >
                          <Trash2 size={14} />
                          移除
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="meter-map-toolbar">
        <button
          disabled={state.form.segments.length >= 1024}
          onClick={() => {
            const last = state.form.segments.at(-1)!;
            edit({
              ...state.form,
              segments: [
                ...state.form.segments,
                {
                  ...last,
                  key: crypto.randomUUID(),
                  measure: String(Math.max(1, Number(last.measure) || 1) + 1),
                  display: "",
                },
              ],
            });
            store.update({
              segmentPage: Math.floor(state.form.segments.length / 12),
            });
          }}
        >
          <Plus size={15} />
          添加拍号变化
        </button>
        <label>
          首小节弱起拍数
          <input
            aria-label="网格弱起拍数"
            type="number"
            min={0}
            step="any"
            value={state.form.pickup}
            onChange={(event) =>
              edit({ ...state.form, pickup: event.target.value })
            }
          />
        </label>
      </div>
      <p className="parameter-help">
        弱起拍数使用首段的单位音符，0 表示完整首小节。显示编号可从 0
        或负数开始。修改拍号后，请核对弱起和不完整小节的拍数。
      </p>
    </fieldset>
  );
  const lengths = (
    <fieldset
      disabled={locked || state.mode === "original"}
      className="meter-map-editor"
    >
      <legend>中途不完整的小节 · {state.form.lengths.length} 项</legend>
      <p className="parameter-help">
        填写小节实际包含的拍数。下一小节从实际结束位置开始，其后恢复当前拍号的正常长度。
      </p>
      <Pager
        count={state.form.lengths.length}
        page={lengthPage}
        change={(lengthPage) => store.update({ lengthPage })}
      />
      <div className="meter-table-wrap">
        <table className="meter-map-table">
          <thead>
            <tr>
              <th>导航小节</th>
              <th>实际拍数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {state.form.lengths
              .slice(lengthPage * 12, (lengthPage + 1) * 12)
              .map((row) => (
                <tr key={row.key}>
                  <td>
                    <input
                      aria-label="不完整小节位置"
                      type="number"
                      min={2}
                      max={1000000}
                      step={1}
                      value={row.measure}
                      onChange={(event) =>
                        patchLength(row.key, { measure: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={"小节 " + row.measure + " 实际拍数"}
                      type="number"
                      min={0}
                      step="any"
                      value={row.beats}
                      onChange={(event) =>
                        patchLength(row.key, { beats: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      aria-label={"移除不完整小节 " + row.measure}
                      onClick={() =>
                        edit({
                          ...state.form,
                          lengths: state.form.lengths.filter(
                            (item) => item.key !== row.key,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                      移除
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!state.form.lengths.length && (
        <p className="parameter-help">当前没有单独指定中途小节的长度。</p>
      )}
      <button
        disabled={state.form.lengths.length >= 1024}
        onClick={() => {
          const measure = Math.max(
            2,
            ...state.form.lengths.map((row) => (Number(row.measure) || 1) + 1),
          );
          const active =
            [...state.form.segments]
              .reverse()
              .find((row) => Number(row.measure) <= measure) ??
            state.form.segments[0];
          const numerator = Number(active.numerator) || 4;
          edit({
            ...state.form,
            lengths: [
              ...state.form.lengths,
              {
                key: crypto.randomUUID(),
                measure: String(measure),
                beats: String(numerator > 1 ? numerator - 1 : 0.5),
              },
            ],
          });
          store.update({
            lengthPage: Math.floor(state.form.lengths.length / 12),
          });
        }}
      >
        <Plus size={15} />
        添加不完整小节
      </button>
    </fieldset>
  );
  const previewPanel = (
    <section aria-label="小节网格预览">
      {!validPreview ? (
        <p className="parameter-help">
          {previewing
            ? "正在计算小节网格…"
            : "预览后可以核对拍号、时间和显示编号。"}
        </p>
      ) : (
        <>
          <p className="meter-preview-summary">
            {state.mode === "original" ? "文件原始网格" : "草稿网格"} · 共{" "}
            {bars.length} 小节
            {located !== null && " · 已定位第 " + located + " 小节"}
          </p>
          <div className="meter-table-wrap">
            <table className="meter-map-table">
              <thead>
                <tr>
                  <th>导航小节</th>
                  <th>显示编号</th>
                  <th>拍号</th>
                  <th>开始—结束</th>
                  <th>长度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {bars.slice(page * 20, (page + 1) * 20).map((row) => (
                  <tr key={row.number}>
                    <td>{row.number}</td>
                    <td>{row.displayNumber ?? row.number}</td>
                    <td>
                      {row.numerator}/{row.denominator}
                    </td>
                    <td>
                      {clock(row.start)}—{clock(row.end)}
                    </td>
                    <td>{row.partial ? "不完整小节" : "完整小节"}</td>
                    <td>
                      <button
                        disabled={busy || stale || !!state.receipt}
                        onClick={() =>
                          void work(async () => {
                            await api.adjustForSong(song, {
                              type: "seek",
                              position: row.start,
                            });
                            setLocated(row.number);
                          })
                        }
                      >
                        定位
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            count={bars.length}
            page={page}
            size={20}
            change={(page) => store.update({ page })}
          />
          <div className="meter-map-toolbar">
            <label>
              导航小节
              <input
                aria-label="预览跳转小节"
                type="number"
                min={1}
                max={bars.length}
                value={state.jump}
                onChange={(event) => store.update({ jump: event.target.value })}
              />
            </label>
            <button
              disabled={
                !/^\d+$/.test(state.jump) ||
                Number(state.jump) < 1 ||
                Number(state.jump) > bars.length
              }
              onClick={() =>
                store.update({
                  page: Math.floor((Number(state.jump) - 1) / 20),
                })
              }
            >
              查看小节
            </button>
          </div>
        </>
      )}
    </section>
  );
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        className="settings-dialog meter-map-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meter-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="meter-title">修正小节网格</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={busy}
            aria-label="关闭小节网格"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <PracticeEditTaskActivity contentId={song.contentId} />
        <PersistentSessionRecovery
          store={store}
          error={state.storageError}
          busy={busy}
          label="小节网格草稿"
        />
        <div className="meter-map-toolbar">
          <span>{dirty ? "有待保存输入" : "当前网格"} · 输入自动暂存</span>
          <CopyPracticeDraft label="复制小节草稿" value={state} />
        </div>
        {stale && !state.receipt && (
          <div className="meter-source-changed" role="status">
            <p>曲目、标注或连接已变化。当前输入继续保留。</p>
            <button disabled={busy} onClick={resetNative}>
              采用当前网格
            </button>
            <button
              disabled={busy}
              onClick={() => {
                store.adopt(song, true);
                setPreview(null);
              }}
            >
              保留草稿，按当前曲目重新预览
            </button>
          </div>
        )}
        {state.receipt && (
          <section className="meter-source-changed" role="status">
            <strong>
              {state.receipt.phase === "acknowledged"
                ? "网格保存回复已收到"
                : "网格保存结果需要核对"}
            </strong>
            <p>
              {state.mode === "original"
                ? "本次提交：恢复文件原始网格。"
                : "本次提交：当前拍号、弱起与不完整小节设置。"}
              读取当前网格后可以继续，原请求会保持原状。
            </p>
            <button
              disabled={busy}
              onClick={() => void work(() => readSaved())}
            >
              读取保存结果
            </button>
            {readResult && (
              <p>
                当前网格：{readResult.song.measures.length} 小节 ·{" "}
                {nativeMeterValue(readResult.song) ? "个人修正" : "文件原始"}
                {!readResult.quiet && " · 资料仍在处理"}
              </p>
            )}
            {readResult?.quiet && (
              <>
                <button disabled={busy} onClick={() => adoptResult(false)}>
                  采用当前网格
                </button>
                <button disabled={busy} onClick={() => adoptResult(true)}>
                  保留草稿继续编辑
                </button>
              </>
            )}
          </section>
        )}
        {state.notice && (
          <p role="status" className="parameter-help">
            {state.notice}
          </p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <BrowseDetailWorkspace
          label="小节网格编辑分区"
          value={state.section}
          change={(section) => store.update({ section })}
          header={
            <div className="meter-map-toolbar">
              <button
                disabled={locked || previewing || !!problem}
                onClick={() => void inspect()}
              >
                {previewing ? "正在计算…" : "预览小节网格"}
              </button>
              <button
                disabled={busy || !!state.receipt || stale}
                onClick={original}
              >
                准备文件原始网格
              </button>
              {state.mode === "original" && (
                <button
                  disabled={locked}
                  onClick={() => {
                    request.current++;
                    setPreview(null);
                    setPreviewing(false);
                    store.update({ mode: "custom", section: "signature" });
                  }}
                >
                  返回拍号草稿
                </button>
              )}
              <button
                className="primary-button"
                disabled={
                  locked ||
                  !dirty ||
                  !validPreview ||
                  !!state.storageError ||
                  !!problem
                }
                onClick={save}
              >
                保存小节网格
              </button>
            </div>
          }
          sections={[
            {
              id: "signature",
              label: "拍号与弱起",
              count: state.form.segments.length,
              content: signature,
            },
            {
              id: "lengths",
              label: "不完整小节",
              count: state.form.lengths.length,
              content: lengths,
            },
            {
              id: "preview",
              label: "网格预览",
              count: bars.length,
              content: previewPanel,
            },
          ]}
        />
        {problem && (
          <p className="dialog-error" role="status">
            {problem}
          </p>
        )}
        <p className="parameter-help">
          导航小节按演奏顺序从 1
          开始，显示编号用于对应纸谱。保存网格后会清除当前循环和本轮成绩，历史记录、音符和速度会保留。
        </p>
        <div className="dialog-actions">
          <button disabled={locked} onClick={resetNative}>
            恢复当前已保存网格
          </button>
          <button disabled={busy} onClick={close}>
            暂存并关闭
          </button>
        </div>
      </section>
    </div>
  );
}
