import { PersistentSessionRecovery } from "./app/PersistentSessionRecovery";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { X } from "lucide-react";
import { api } from "./api";
import type {
  PaperPracticeReview,
  PaperPracticeRequest,
} from "./engine/commands.generated";
import {
  paperPracticeDraftSession,
  type PaperPracticeForm,
  type PaperPracticeReceipt,
} from "./features/scores/paperPracticeDraftStore";
import "./features/scores/paperPracticeBuilder.css";

const modes: Record<string, string> = {
  wait: "等音",
  flow: "连续",
  listen: "聆听",
  recital: "完整演奏",
  memory: "背谱",
};
const hands: Record<string, string> = {
  both: "双手",
  left: "左手",
  right: "右手",
};
const trackModes: Record<string, string> = {
  Human: "自己弹",
  Auto: "伴奏",
  Mute: "静音",
  human: "自己弹",
  auto: "伴奏",
  mute: "静音",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const number = (text: string) => (text.trim() ? Number(text) : NaN);
const receiptValid = (value: PaperPracticeReceipt) =>
  !!value &&
  typeof value.id === "string" &&
  /^paper-practice-[a-f\d]{64}$/i.test(value.id) &&
  typeof value.existing === "boolean";
function formFromReview(review: PaperPracticeReview): PaperPracticeForm {
  return {
    name: review.name,
    notes: "",
    start: String(review.start),
    end: String(review.end),
    speed: String(Math.round(review.speed * 10000) / 100),
    rounds: String(review.rounds),
  };
}
function validReview(
  value: PaperPracticeReview,
  contentId: string,
  book: string,
  measure: number,
) {
  return (
    !!value &&
    value.contentId === contentId &&
    value.book === book &&
    value.measure === measure &&
    typeof value.proof === "string" &&
    /^[a-f\d]{64}$/i.test(value.proof) &&
    Number.isSafeInteger(value.page) &&
    value.page > 0 &&
    Number.isSafeInteger(value.measures) &&
    value.measures >= measure &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    value.start >= 1 &&
    value.start <= measure &&
    value.end >= measure &&
    value.end <= value.measures &&
    typeof value.name === "string" &&
    Number.isFinite(value.speed) &&
    Number.isSafeInteger(value.rounds) &&
    !!value.settings &&
    Array.isArray(value.settings.tracks)
  );
}
export function PaperPracticeBuilder({
  contentId,
  book,
  measure,
  engineId,
  close,
}: {
  contentId: string;
  book: string;
  measure: number;
  engineId?: string;
  close: () => void;
}) {
  const session = useMemo(
    () => paperPracticeDraftSession(contentId, book, measure),
    [contentId, book, measure],
  );
  const draft = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [review, setReview] = useState<PaperPracticeReview | null>(null),
    [reading, setReading] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const root = useRef<HTMLElement>(null),
    live = useRef(true),
    epoch = useRef(0);
  const operation = useRef(false),
    closeRef = useRef(close);
  const identity = JSON.stringify([contentId, book, measure, engineId]),
    currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  closeRef.current = close;
  const busy = reading || draft.busy;
  const current = () => live.current && identity === currentIdentity.current;
  const read = async () => {
    const token = ++epoch.current;
    setReading(true);
    setError("");
    try {
      const value = await api.commandForEngine<PaperPracticeReview>(engineId, {
        type: "previewPaperPractice",
        content_id: contentId,
        book,
        measure,
      });
      if (!current() || token !== epoch.current) return;
      if (!validReview(value, contentId, book, measure))
        throw new Error("练习段条件回复不完整，请重新读取。");
      setReview(value);
      if (!session.getSnapshot().form)
        session.update({ form: formFromReview(value) });
      setNotice("已读取当前谱页对应与练习条件。已有输入继续保留。");
    } catch (error) {
      if (current() && token === epoch.current) {
        setError(message(error));
        setReview(null);
      }
    } finally {
      if (current() && token === epoch.current) setReading(false);
    }
  };
  useEffect(() => {
    live.current = true;
    setReview(null);
    void read();
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, [identity, session]);
  const update = (change: Partial<PaperPracticeForm>) => {
    if (draft.form && !busy && !draft.pending && !draft.saved)
      session.update({ form: { ...draft.form, ...change } });
  };
  const form = draft.form;
  const start = form ? number(form.start) : NaN,
    end = form ? number(form.end) : NaN;
  const speed = form ? number(form.speed) / 100 : NaN,
    rounds = form ? number(form.rounds) : NaN;
  let invalid = "";
  if (form) {
    if (!form.name.trim() || Array.from(form.name).length > 80)
      invalid = "请填写 1–80 字的练习段名称。";
    else if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      start > measure ||
      end < measure ||
      (!!review && end > review.measures)
    )
      invalid = `小节范围须包含第 ${measure} 小节，并位于当前曲目内。`;
    else if (!Number.isFinite(speed) || speed < 0.25 || speed > 2)
      invalid = "速度范围为 25%–200%。";
    else if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 99)
      invalid = "重复遍数为 1–99 的整数。";
    else if (new TextEncoder().encode(form.notes).length > 8192)
      invalid = "练习要求超过保存容量，请缩短文字。";
  }
  const acceptReceipt = (value: PaperPracticeReceipt) => {
    if (!receiptValid(value))
      throw new Error("保存回执不完整，原请求继续保留，请重新核对保存结果。");
    session.update({
      saved: { id: value.id, existing: value.existing, changed: value.changed },
      pending: null,
    });
  };
  const save = async () => {
    const latest = session.getSnapshot();
    if (
      operation.current ||
      busy ||
      latest.busy ||
      !review ||
      !form ||
      invalid ||
      latest.pending ||
      latest.saved
    )
      return;
    const request: PaperPracticeRequest = {
      contentId,
      book,
      measure,
      proof: review.proof,
      name: form.name,
      notes: form.notes,
      start,
      end,
      speed,
      rounds,
      confirmOnly: false,
    };
    operation.current = true;
    setError("");
    setNotice("");
    session.update({ pending: request, busy: true });
    try {
      const value = await api.commandForEngine<PaperPracticeReceipt>(engineId, {
        type: "savePaperPractice",
        request,
      });
      acceptReceipt(value);
      if (current())
        setNotice(
          value.existing
            ? "已找到之前保存的练习段。"
            : "练习段已保存，可立即打开。",
        );
    } catch (error) {
      if (current())
        setError(`${message(error)}。原保存请求已保留，请先核对保存结果。`);
    } finally {
      operation.current = false;
      session.update({ busy: false });
    }
  };
  const reconcile = async () => {
    const request = session.getSnapshot().pending;
    if (!request || operation.current || busy || session.getSnapshot().busy)
      return;
    operation.current = true;
    setError("");
    session.update({ busy: true });
    try {
      const value = await api.commandForEngine<
        PaperPracticeReceipt & { found: boolean }
      >(engineId, {
        type: "savePaperPractice",
        request: { ...request, confirmOnly: true },
      });
      if (typeof value.found !== "boolean")
        throw new Error("保存结果回复不完整，请保持原请求并重试。");
      if (value.found) acceptReceipt(value);
      else {
        session.update({ pending: null });
        if (current()) {
          setReview(null);
          setNotice(
            "尚未找到这次保存的练习段。输入已恢复，请重新核对条件后保存。",
          );
        }
      }
    } catch (error) {
      if (current()) setError(`保存结果尚未核对：${message(error)}`);
    } finally {
      operation.current = false;
      session.update({ busy: false });
    }
  };
  const open = async () => {
    const saved = session.getSnapshot().saved;
    if (!saved || operation.current || busy || session.getSnapshot().busy)
      return;
    operation.current = true;
    setError("");
    session.update({ busy: true });
    try {
      await api.commandForEngine(engineId, {
        type: "openPassage",
        id: saved.id,
      });
      if (current()) closeRef.current();
    } catch (error) {
      if (current()) setError(`练习段已保存，打开尚未完成：${message(error)}`);
    } finally {
      operation.current = false;
      session.update({ busy: false });
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        ref={root}
        tabIndex={-1}
        className="settings-dialog paper-practice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paper-practice-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="paper-practice-title">从纸谱建立练习段</h2>
            <p>
              第 {review?.page ?? "—"} 页 · 第 {measure} 演奏小节
            </p>
          </div>
          <button
            autoFocus
            disabled={busy}
            aria-label="关闭纸谱练习段"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="paper-practice-notice">
            {notice}
          </p>
        )}
        <PersistentSessionRecovery
          store={session}
          error={draft.storageError}
          busy={busy}
          label="纸谱练习段"
        />
        {reading && <p role="status">正在读取谱页对应与练习条件…</p>}
        {review && !draft.saved && !draft.pending && (
          <div className="paper-practice-context">
            <span>
              {modes[review.settings.mode ?? ""] ?? review.settings.mode}
            </span>
            <span>{hands[review.settings.hands] ?? review.settings.hands}</span>
            <span>预备 {review.settings.countIn} 拍</span>
            <span>
              {review.settings.metronome ? "节拍器已开" : "节拍器已关"}
            </span>
            <span>输入补偿 {review.settings.latency} ms</span>
          </div>
        )}
        {review && !draft.saved && !draft.pending && (
          <div className="paper-practice-tracks">
            {review.settings.tracks.map((track) => (
              <span key={track.track_id}>
                音轨 {track.track_id + 1} ·{" "}
                {trackModes[track.mode] ?? track.mode}
              </span>
            ))}
          </div>
        )}
        {form && (
          <fieldset
            disabled={busy || !!draft.pending || !!draft.saved}
            className="paper-practice-fields"
          >
            {(draft.saved || draft.pending) && (
              <p className="parameter-help">
                以下保留本次提交的内容；打开已保存的段落时，使用该段落的当前内容。
              </p>
            )}
            <label>
              名称
              <input
                aria-label="纸谱练习段名称"
                maxLength={160}
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <div className="paper-practice-range">
              <label>
                起始小节
                <input
                  aria-label="纸谱练习起始小节"
                  type="number"
                  min={1}
                  max={measure}
                  value={form.start}
                  onChange={(event) => update({ start: event.target.value })}
                />
              </label>
              <label>
                结束小节
                <input
                  aria-label="纸谱练习结束小节"
                  type="number"
                  min={measure}
                  max={review?.measures}
                  value={form.end}
                  onChange={(event) => update({ end: event.target.value })}
                />
              </label>
              <label>
                速度 %
                <input
                  aria-label="纸谱练习速度"
                  type="number"
                  min={25}
                  max={200}
                  step="any"
                  value={form.speed}
                  onChange={(event) => update({ speed: event.target.value })}
                />
              </label>
              <label>
                重复遍数
                <input
                  aria-label="纸谱练习遍数"
                  type="number"
                  min={1}
                  max={99}
                  value={form.rounds}
                  onChange={(event) => update({ rounds: event.target.value })}
                />
              </label>
            </div>
            <label>
              练习要求
              <textarea
                aria-label="纸谱练习要求"
                rows={3}
                maxLength={8192}
                value={form.notes}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
            {invalid && (
              <p role="status" className="paper-practice-invalid">
                {invalid}
              </p>
            )}
            <p className="parameter-help">
              范围须包含第 {measure}{" "}
              演奏小节。输入会暂存在本机，保存后的练习段可加入练习计划。
            </p>
          </fieldset>
        )}
        {draft.pending && (
          <div className="paper-practice-pending" role="status">
            <strong>这次保存需要核对结果</strong>
            <p>
              原请求与输入已保留。核对只读取已保存的段落；完成后可打开原段落，或继续编辑。
            </p>
          </div>
        )}
        {draft.saved && (
          <p role="status">
            {draft.saved.changed
              ? "已找到原练习段，保存后部分内容已有修改。打开时使用该段落的当前内容。"
              : draft.saved.existing
                ? "已找到保存的练习段，可继续打开。"
                : "练习段已保存。"}
          </p>
        )}
        <div className="dialog-actions">
          {draft.pending ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void reconcile()}
            >
              核对保存结果
            </button>
          ) : draft.saved ? (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  session.update({ saved: null });
                  setReview(null);
                  setNotice(
                    "输入继续保留，请重新核对条件后另存。原练习段继续保留。",
                  );
                }}
              >
                继续编辑并另存
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void open()}
              >
                打开练习段
              </button>
            </>
          ) : (
            <>
              <button disabled={busy} onClick={() => void read()}>
                重新核对条件
              </button>
              <button
                className="primary"
                disabled={busy || !review || !form || !!invalid}
                onClick={() => void save()}
              >
                {draft.busy ? "正在保存…" : "保存练习段"}
              </button>
            </>
          )}
          <button disabled={busy} onClick={close}>
            {draft.saved ? "完成" : "保留草稿并关闭"}
          </button>
        </div>
      </section>
    </div>
  );
}
