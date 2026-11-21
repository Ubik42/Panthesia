import {
  requireHistorySource,
  type HistorySource,
} from "./features/review/historySource";
import { useBrowseScroll } from "./app/useBrowseScroll";
import {
  getPerformanceArchive,
  type PerformanceArchive as Archive,
} from "./features/review/performanceArchiveStore";
import { HistoryReplayClips } from "./features/review/HistoryReplayClips";
import { BrowsePagination } from "./app/BrowsePagination";
import { getReplayEditor } from "./features/review/replayEditorStore";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useHistoryReplay } from "./useHistoryReplay";
import { HistoryReplayTransport } from "./HistoryReplayTransport";
import { TaskActivity } from "./engine/TaskActivity";
import { HistoryPerformanceTimeline } from "./HistoryPerformanceTimeline";
const gradeName = (kind: string) =>
  ({
    onTime: "准时",
    early: "偏早",
    late: "偏晚",
    missed: "漏音",
    pending: "未计分",
    approximate: "近似对照",
  })[kind] ?? kind;
type ExpressionNote = NonNullable<
  NonNullable<Archive["expressionReview"]>[number]
>;
type Input = Archive["inputs"][number];
const referenceColors: Record<string, string> = {
  missed: "#f28d8d",
  early: "#eeb96d",
  late: "#eeb96d",
  onTime: "#a9df74",
};
const pedalEvidenceText = (note: ExpressionNote) => {
  if (note.pedalSame === false)
    return `踏板状态不同：参考${note.referencePedalDown ? "踩下" : "松开"}，实际${note.actualPedalDown ? "踩下" : "松开"}。重练时检查该音起音前的踏板动作。`;
  if (note.pedalSame === true) return "起音时踏板状态一致";
  switch (note.pedalEvidence) {
    case "noReferenceEvents":
      return "本轮没有参考踏板动作，无法逐音判断踏板";
    case "noActualEvents":
      return "本轮没有采到实际踏板动作，无法判断踏板是否松开";
    case "beforeReferenceEvent":
      return "这个音早于首个参考踏板动作，参考状态未知";
    case "beforeActualEvent":
      return "这个音早于首个实际踏板动作，实际状态未知";
    default:
      return "踏板对照证据不足";
  }
};
const velocityFeedback = (note: ExpressionNote, threshold: number) => {
  const difference = Math.abs(note.velocityDelta);
  if (difference < threshold) return "力度差未达到当前筛查值";
  return `MIDI 力度值${note.velocityDelta > 0 ? "偏高" : "偏低"} ${difference} 级；重练时${note.velocityDelta > 0 ? "减轻" : "增加"}这个音的落键力度`;
};
type Actual = {
  input: number;
  at: number;
  end: number;
  judgedAt: number;
  pitch: number;
  velocity: number;
};
const pitch = (n: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][n % 12]}${Math.floor(n / 12) - 1}`;
export function HistoryPerformance({
  engineId,
  title,
  contentId,
  id,
  goalThreshold,
  available,
  practice,
  review,
  blocked,
  visible = true,
  embedded = false,
  practiceBlocked = false,
}: {
  engineId?: string;
  title?: string;
  contentId: string;
  id: string;
  goalThreshold?: number | null;
  available: boolean;
  practice: (
    reference: number,
    before: number,
    after: number,
    destination?: "score" | "paper" | "finger",
    source?: HistorySource,
  ) => Promise<void>;
  blocked: boolean;
  visible?: boolean;
  embedded?: boolean;
  practiceBlocked?: boolean;
  review: (source?: HistorySource) => Promise<void>;
}) {
  const replayEditor = getReplayEditor(contentId, id);
  const replayState = useSyncExternalStore(
    replayEditor.subscribe,
    replayEditor.getReviewSnapshot,
    replayEditor.getReviewSnapshot,
  );
  const { source, rate, view } = replayState;
  const {
    measure,
    before,
    after,
    gradeFilter,
    expressionFilter,
    referencePage,
    wrongPage,
    practiceDestination,
  } = view;
  const velocityThreshold =
    view.velocityThreshold ?? (goalThreshold == null ? 20 : goalThreshold + 1);
  const thresholdDraft = view.thresholdDraft ?? String(velocityThreshold);
  const setMeasure = (measure: number) => replayEditor.review({ measure });
  const setBefore = (before: number) => replayEditor.review({ before });
  const setAfter = (after: number) => replayEditor.review({ after });
  const setGradeFilter = (gradeFilter: string) =>
    replayEditor.review({ gradeFilter });
  const setExpressionFilter = (expressionFilter: string) =>
    replayEditor.review({ expressionFilter });
  const setReferencePage = (referencePage: number) =>
    replayEditor.review({ referencePage });
  const setWrongPage = (wrongPage: number) =>
    replayEditor.review({ wrongPage });
  const setPracticeDestination = (
    practiceDestination: typeof view.practiceDestination,
  ) => replayEditor.review({ practiceDestination });
  const setThresholdDraft = (thresholdDraft: string) =>
    replayEditor.review({ thresholdDraft });
  const archiveStore = getPerformanceArchive(contentId, id, engineId);
  const archiveState = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );
  const { data, reading: loadBusy } = archiveState;
  const [error, setError] = useState("");
  const [thresholdError, setThresholdError] = useState("");
  const thresholdErrorId = useId();
  const commitThreshold = () => {
    const value = /^\d+$/.test(thresholdDraft.trim())
      ? Number(thresholdDraft)
      : NaN;
    if (!Number.isInteger(value) || value < 1 || value > 127) {
      setThresholdError("请输入 1 到 127 之间的整数。");
      return;
    }
    replayEditor.review({
      velocityThreshold: value,
      thresholdDraft: String(value),
    });
    setThresholdError("");
  };
  const [followupBusy, setFollowupBusy] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const followupRevision = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    if (title && replayEditor.getSnapshot().title !== title)
      replayEditor.update({ title });
  }, [replayEditor, title]);
  const replay = useHistoryReplay(
    contentId,
    id,
    !blocked && visible,
    undefined,
    undefined,
    engineId,
    data?.source,
  );
  const active = replay.phase !== "idle",
    position = replay.position,
    busy = loadBusy || replay.busy || followupBusy;
  const stop = replay.stop;
  const play = () => replay.play(source, rate);
  const cannotPractice = blocked || practiceBlocked;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setThresholdError("");
  }, [contentId, id, engineId]);
  const load = () => {
    setError("");
    return archiveStore.load();
  };
  useEffect(() => {
    if (
      !available ||
      !visible ||
      !replayState.rangeOpen ||
      !replayState.clipsOpen ||
      data ||
      loadBusy ||
      archiveState.error ||
      archiveState.canceled
    )
      return;
    const timer = setTimeout(() => void archiveStore.load(), 150);
    return () => clearTimeout(timer);
  }, [
    archiveStore,
    available,
    visible,
    replayState.rangeOpen,
    replayState.clipsOpen,
    data,
    loadBusy,
    archiveState.error,
    archiveState.canceled,
  ]);
  const actual = useMemo(() => {
    const notes: Actual[] = [],
      held = new Map<number, Actual>();
    for (const [input, e] of (data?.inputs ?? []).entries()) {
      const [kind, n, v] = e.bytes;
      if (kind === 144 && v > 0) {
        const old = held.get(n);
        if (old) old.end = e.at;
        const note = {
          input,
          at: e.at,
          end: data?.duration ?? e.at,
          judgedAt: e.judgedAt,
          pitch: n,
          velocity: v,
        };
        notes.push(note);
        held.set(n, note);
      } else if (kind === 128 || kind === 144) {
        const note = held.get(n);
        if (note) {
          note.end = Math.max(note.at, e.at);
          held.delete(n);
        }
      }
    }
    return notes;
  }, [data]);
  const refs = useMemo(
    () =>
      data?.references.filter((n) => !measure || n.measure === measure) ?? [],
    [data, measure],
  );
  const start = measure && refs.length ? Math.min(...refs.map((n) => n.at)) : 0;
  const end =
    measure && refs.length
      ? Math.max(...refs.map((n) => n.end))
      : (data?.duration ?? 1);
  const seen = useMemo(
    () => actual.filter((n) => n.end >= start - 0.5 && n.at <= end + 0.5),
    [actual, start, end],
  );
  const exact = data?.judgments != null;
  const referenceIndexes = useMemo(
    () => new Map((data?.references ?? []).map((r, i) => [r, i])),
    [data],
  );
  const decisions = useMemo(
    () =>
      new Map(
        (data?.judgments ?? [])
          .filter((d) => d.reference != null)
          .map((d) => [d.reference!, d]),
      ),
    [data],
  );
  const inputDecisions = useMemo(
    () =>
      new Map(
        (data?.judgments ?? [])
          .filter((d) => d.input != null)
          .map((d) => [d.input!, d]),
      ),
    [data],
  );
  const pairs = useMemo(() => {
    if (data?.judgments != null) {
      const inputs = new Map(actual.map((n) => [n.input, n]));
      return data.references.map((r, index) => {
        const decision = decisions.get(index);
        return {
          reference: r,
          index,
          actual:
            decision?.input != null ? inputs.get(decision.input) : undefined,
          offset: decision?.offsetMs ?? null,
          grade: decision?.kind ?? "pending",
        };
      });
    }

    const grouped = new Map<number, { note: Actual; used: boolean }[]>();
    for (const n of actual) {
      const g = grouped.get(n.pitch) ?? [];
      g.push({ note: n, used: false });
      grouped.set(n.pitch, g);
    }
    for (const group of grouped.values())
      group.sort((a, b) => a.note.judgedAt - b.note.judgedAt);
    return (data?.references ?? []).map((r, index) => {
      const group = grouped.get(r.pitch) ?? [];
      let lo = 0,
        hi = group.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (group[m].note.judgedAt < r.at) lo = m + 1;
        else hi = m;
      }
      const candidates = group
        .slice(Math.max(0, lo - 4), lo + 5)
        .filter((n) => !n.used && Math.abs(n.note.judgedAt - r.at) <= 0.5)
        .sort(
          (a, b) =>
            Math.abs(a.note.judgedAt - r.at) - Math.abs(b.note.judgedAt - r.at),
        );
      const selected = candidates[0];
      if (selected) selected.used = true;
      return {
        reference: r,
        grade: "approximate",
        index,
        actual: selected?.note,
        offset: selected
          ? Math.round((selected.note.judgedAt - r.at) * 1000)
          : null,
      };
    });
  }, [actual, data, decisions]);
  const rows = useMemo(
    () =>
      pairs.filter((p) => {
        const expression = data?.expressionReview?.[p.index];
        return (
          (!measure || p.reference.measure === measure) &&
          (!exact ||
            gradeFilter === "all" ||
            (gradeFilter === "problems"
              ? ["early", "late", "missed"].includes(p.grade)
              : p.grade === gradeFilter)) &&
          (!exact ||
            expressionFilter === "all" ||
            (expressionFilter === "velocity"
              ? expression != null &&
                Math.abs(expression.velocityDelta) >= velocityThreshold
              : expression?.pedalSame === false))
        );
      }),
    [
      pairs,
      data?.expressionReview,
      measure,
      exact,
      gradeFilter,
      expressionFilter,
      velocityThreshold,
    ],
  );
  const {
    pairedExpressionCount,
    velocityIssueCount,
    pedalIssueCount,
    pedalEvidenceCount,
  } = useMemo(() => {
    let pairedExpressionCount = 0,
      velocityIssueCount = 0,
      pedalIssueCount = 0,
      pedalEvidenceCount = 0;
    for (const note of data?.expressionReview ?? []) {
      if (!note) continue;
      pairedExpressionCount++;
      if (Math.abs(note.velocityDelta) >= velocityThreshold)
        velocityIssueCount++;
      if (note.pedalSame != null) pedalEvidenceCount++;
      if (note.pedalSame === false) pedalIssueCount++;
    }
    return {
      pairedExpressionCount,
      velocityIssueCount,
      pedalIssueCount,
      pedalEvidenceCount,
    };
  }, [data?.expressionReview, velocityThreshold]);
  const allWrong = useMemo(
    () =>
      (data?.judgments ?? []).filter((decision) => decision.kind === "wrong"),
    [data?.judgments],
  );
  const wrong = useMemo(
    () =>
      allWrong.filter((decision) => !measure || decision.measure === measure),
    [allWrong, measure],
  );
  const gradeTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pair of pairs)
      counts.set(pair.grade, (counts.get(pair.grade) ?? 0) + 1);
    return counts;
  }, [pairs]);
  const measureChoices = useMemo(
    () =>
      [...new Set((data?.references ?? []).map((note) => note.measure))].sort(
        (left, right) => left - right,
      ),
    [data?.references],
  );
  const pedalText = useMemo(() => {
    const actual = (data?.inputs ?? []).filter(
      (event) =>
        event.bytes[0] === 176 && event.bytes[1] === 64 && !event.synthetic,
    );
    const reference = data?.referencePedals ?? [];
    const describe = (events: Input[]) =>
      events
        .slice(0, 80)
        .map(
          (event) =>
            `${event.at.toFixed(2)} 秒 ${event.bytes[2] >= 64 ? "踩下" : "松开"}`,
        )
        .join("；");
    return {
      actual: describe(actual),
      reference: describe(reference),
      actualCount: actual.length,
      referenceCount: reference.length,
    };
  }, [data?.inputs, data?.referencePedals]);
  const referencePlot = useMemo(
    () =>
      refs.map((n) => ({
        ...n,
        color: !exact
          ? "#a9df74"
          : (referenceColors[
              decisions.get(referenceIndexes.get(n) ?? -1)?.kind ?? ""
            ] ?? "#87919b"),
      })),
    [refs, exact, decisions, referenceIndexes],
  );
  const actualPlot = useMemo(
    () =>
      seen.map((n) => ({
        ...n,
        color:
          exact && inputDecisions.get(n.input)?.kind === "wrong"
            ? "#f28d8d"
            : "#70b7e8",
      })),
    [seen, exact, inputDecisions],
  );
  const feedbackPageSize = 50;
  const currentReferencePage = Math.min(
    referencePage,
    Math.max(0, Math.ceil(rows.length / feedbackPageSize) - 1),
  );
  const currentWrongPage = Math.min(
    wrongPage,
    Math.max(0, Math.ceil(wrong.length / feedbackPageSize) - 1),
  );
  const referenceScrollKey = JSON.stringify([
    contentId,
    id,
    currentReferencePage,
    measure,
    gradeFilter,
    expressionFilter,
    velocityThreshold,
  ]);
  const referenceTable = useBrowseScroll<HTMLDivElement>(
    referenceScrollKey,
    visible && !!data,
    0,
    () => {},
    archiveStore.scrollPositions,
  );
  const actionScope = JSON.stringify([
    engineId,
    contentId,
    id,
    blocked,
    practiceBlocked,
    visible,
  ]);
  const currentActionScope = useRef(actionScope);
  if (currentActionScope.current !== actionScope) {
    currentActionScope.current = actionScope;
    followupRevision.current++;
  }
  useEffect(() => {
    setFollowupBusy(false);
  }, [actionScope]);
  const listenReference = useCallback(
    (index: number) => {
      if (!data || blocked || !visible || busy) return;
      const note = data.references[index];
      if (!note) return;
      const span = data.measures?.find(
        (span) =>
          span.at <= note.at + 0.000001 && span.end > note.at + 0.000001,
      );
      const start =
        span && span.end - span.at >= 0.1
          ? span.at
          : Math.max(0, note.at - 0.3);
      const end = Math.min(
        data.duration,
        span && span.end - span.at >= 0.1
          ? span.end
          : Math.max(note.end, note.at + 0.1) + 0.3,
      );
      if (end - start < 0.1) {
        setError("这段保留数据不足 0.1 秒，可通过整轮回放收听。");
        return;
      }
      replayEditor.pick(start, end, data.source);
      replayEditor.update({ rangeOpen: true });
      void replay.play(source, rate, { start, end });
    },
    [data, blocked, visible, busy, replayEditor, replay.play, source, rate],
  );
  const practiceAction = useRef(practice);
  practiceAction.current = practice;
  const practiceReference = useCallback(
    async (
      index: number,
      before: number,
      after: number,
      destination?: "score" | "paper" | "finger",
    ) => {
      if (!data?.references[index])
        throw new Error("所选参考音尚未读到，请重新读取演奏。");
      const source = requireHistorySource(data.source, contentId, id, true);
      await practiceAction.current(index, before, after, destination, source);
    },
    [data, contentId, id],
  );
  const afterStop = useCallback(
    (job: () => Promise<void>) => {
      if (cannotPractice || !visible) return;
      const revision = ++followupRevision.current;
      setFollowupBusy(true);
      void stop()
        .then(async (stopped) => {
          if (!stopped)
            throw new Error("回放停止结果尚未确认，请核对后再打开练习。");
          if (
            !alive.current ||
            revision !== followupRevision.current ||
            currentActionScope.current !== actionScope ||
            !root.current?.open
          )
            return;
          if (
            [...document.querySelectorAll('[role="dialog"]')].some(
              (node) =>
                node.getClientRects().length && !node.contains(root.current),
            )
          )
            return;
          await job();
        })
        .catch((failure) => {
          if (
            alive.current &&
            revision === followupRevision.current &&
            currentActionScope.current === actionScope
          )
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
        })
        .finally(() => {
          if (alive.current && revision === followupRevision.current)
            setFollowupBusy(false);
        });
    },
    [cannotPractice, visible, actionScope, stop],
  );
  // The playback cursor updates frequently; the feedback cells depend only on review inputs.
  const referenceFeedback = useMemo(() => {
    if (!data) return null;
    return (
      <table>
        <caption className="history-table-caption">
          参考音与实际按键对照 ·{" "}
          {measure ? `第 ${measure} 小节` : "全部演奏小节"}
        </caption>
        <thead>
          <tr>
            <th scope="col">小节 / 音</th>
            <th scope="col">判定</th>
            <th scope="col">起音差值</th>
            <th scope="col">力度对照</th>
            <th scope="col">踏板对照</th>
            <th scope="col">专项反馈</th>
            <th scope="col">持音对照</th>
            <th scope="col">收听与练习</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice(
              currentReferencePage * feedbackPageSize,
              (currentReferencePage + 1) * feedbackPageSize,
            )
            .map((p) => (
              <tr key={p.index}>
                <td>
                  第 {p.reference.measure} 小节 · {pitch(p.reference.pitch)}
                </td>
                <td>{gradeName(p.grade)}</td>
                <td>
                  {p.offset === null
                    ? exact
                      ? "—"
                      : "附近未找到同音起音"
                    : `${p.offset > 0 ? "晚" : p.offset < 0 ? "早" : "一致"} ${Math.abs(p.offset)} ms`}
                </td>
                <td>
                  {p.actual
                    ? `${p.actual.velocity} / ${p.reference.velocity}${data.expressionReview?.[p.index] ? `（${data.expressionReview[p.index]!.velocityDelta > 0 ? "+" : ""}${data.expressionReview[p.index]!.velocityDelta}）` : ""}`
                    : "—"}
                </td>
                <td>
                  {data.expressionReview?.[p.index]
                    ? pedalEvidenceText(data.expressionReview[p.index]!)
                    : "没有确切配对，不作踏板判断"}
                </td>
                <td>
                  {data.expressionReview?.[p.index]
                    ? velocityFeedback(
                        data.expressionReview[p.index]!,
                        velocityThreshold,
                      )
                    : "没有确切配对，不作力度判断"}
                </td>
                <td>
                  {p.actual
                    ? `${(p.actual.end - p.actual.at).toFixed(2)} / ${(p.reference.end - p.reference.at).toFixed(2)} 秒`
                    : "—"}
                </td>
                <td>
                  <button
                    disabled={busy || blocked}
                    onClick={() => listenReference(p.index)}
                    aria-label={`循环听第 ${p.reference.measure} 小节参考音 ${p.index + 1} 所在选段`}
                  >
                    听这一段
                  </button>
                  <button
                    disabled={busy || cannotPractice}
                    aria-label={
                      (practiceDestination === "finger" ? "检查指法" : "重练") +
                      "：第 " +
                      p.reference.measure +
                      " 小节参考音 " +
                      (p.index + 1)
                    }
                    title={
                      practiceDestination === "paper"
                        ? "打开纸质谱面"
                        : practiceDestination === "finger"
                          ? "打开指法检查"
                          : practiceDestination === "score"
                            ? "打开演奏乐谱"
                            : "返回练习主界面"
                    }
                    onClick={() =>
                      afterStop(() =>
                        practiceReference(
                          p.index,
                          before,
                          after,
                          practiceDestination === "practice"
                            ? undefined
                            : practiceDestination,
                        ),
                      )
                    }
                  >
                    {practiceDestination === "finger" ? "检查指法" : "重练这里"}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }, [
    rows,
    currentReferencePage,
    feedbackPageSize,
    measure,
    exact,
    data,
    velocityThreshold,
    practiceDestination,
    busy,
    cannotPractice,
    afterStop,
    practiceReference,
    before,
    after,
    listenReference,
  ]);
  return (
    <details
      ref={root}
      className={`history-performance${embedded ? " history-performance-embedded" : ""}`}
      open={embedded || undefined}
      onToggle={(e) => {
        if (!e.currentTarget.open) void stop();
      }}
    >
      <summary hidden={embedded}>演奏回放与起音对照</summary>
      {followupBusy && <p role="status">正在停止回放并准备所选操作…</p>}
      {available && practiceBlocked && (
        <p className="browse-detail-note">
          这条记录缺少可恢复的完整条件。可以查看已有演奏数据，重练时请先打开曲目。
        </p>
      )}
      {(!available || (!data && replayState.hasDraft)) && (
        <HistoryReplayClips
          replay={replay}
          duration={0}
          refreshSource={archiveStore.load}
        />
      )}
      {!available ? (
        <p>
          这条记录暂时没有可读取的逐次按键数据。已保存的片段仍可查看、复制或删除；恢复演奏资料后可继续回放。
        </p>
      ) : (
        <>
          <button disabled={busy || active} onClick={() => void load()}>
            {loadBusy
              ? "正在读取演奏…"
              : data
                ? "重新读取演奏"
                : "查看这次演奏"}
          </button>
          {loadBusy && (
            <button
              disabled={archiveState.canceled}
              onClick={archiveStore.cancel}
            >
              {archiveState.canceled ? "正在停止读取…" : "停止演奏读取"}
            </button>
          )}
          {archiveState.canceled && !loadBusy && (
            <p role="status">已停止演奏读取，可重新读取后继续。</p>
          )}
          {loadBusy && (
            <TaskActivity
              contentId={contentId}
              label="读取历史演奏"
              cancelLabel="取消演奏读取"
            />
          )}
          {(error || archiveState.error || replay.error) && (
            <div className="history-performance-error" role="alert">
              <p>{error || archiveState.error || replay.error}</p>
              {replay.sourceIssue && (
                <button disabled={busy} onClick={() => void load()}>
                  重新读取这次演奏
                </button>
              )}
            </div>
          )}
          {data && archiveState.readAt && (
            <p className="history-performance-cache-note">
              已保留本次会话读取的演奏，读取于{" "}
              {new Date(archiveState.readAt).toLocaleTimeString("zh-CN")}
              。可重新读取以核对备份恢复后的资料。
            </p>
          )}
          {data && (
            <>
              {exact && (
                <p className="history-performance-facts">
                  全轮判定 · 准时 {gradeTotals.get("onTime") ?? 0} · 偏早{" "}
                  {gradeTotals.get("early") ?? 0} · 偏晚{" "}
                  {gradeTotals.get("late") ?? 0} · 漏音{" "}
                  {gradeTotals.get("missed") ?? 0} · 错音 {allWrong.length} ·
                  未计分 {gradeTotals.get("pending") ?? 0}
                </p>
              )}
              <details className="history-performance-methods">
                <summary>数据说明与判断方法</summary>
                <p>
                  {exact
                    ? "逐音结果来自当轮计分器：准时、偏早、偏晚、漏音及错音均保留实际判定；匹配音直接关联当次按键。红色参考音为漏音，橙色为偏早/偏晚，灰色为尚未计分。原成绩保持。"
                    : "这次记录没有保存逐音判定，仍按同音前后 0.5 秒就近对照；近似起音和未找到不能代替原计分结果。原成绩保持。"}
                </p>
                <p className="muted">
                  演奏回放随“个人成绩与演奏回放”一起备份，可迁移到其他机器。
                </p>
                {exact && (
                  <p aria-label="逐音力度踏板反馈概况">
                    全轮逐音表达 · 确切配对 {pairedExpressionCount} 个音 ·
                    力度差达到 {velocityThreshold} 级的 {velocityIssueCount}{" "}
                    个音 · 有踏板证据 {pedalEvidenceCount} 个音，其中状态不同{" "}
                    {pedalIssueCount} 个音。
                    {goalThreshold == null
                      ? `力度 ${velocityThreshold} 级是本页筛查值，可在下方调整；它不等于练习计划的平均力度要求，也不改变原来的音符准确率。`
                      : `本轮保存的逐音目标是力度差最多 ${goalThreshold} 级。下方默认筛查超过目标的音符（差值至少 ${goalThreshold + 1} 级）；调整筛查值不会改动历史目标或成绩。`}
                  </p>
                )}
              </details>
              {data.truncated && (
                <p>本轮达到回放容量上限，后续数据未完整保留。</p>
              )}
              <div className="history-replay-controls">
                <select
                  aria-label="历史回放来源"
                  disabled={active || busy}
                  value={source}
                  onChange={(e) =>
                    replayEditor.update({
                      source: e.target.value as "actual" | "reference",
                    })
                  }
                >
                  <option value="actual">实际演奏</option>
                  <option value="reference">当轮参考音</option>
                </select>
                <select
                  aria-label="历史回放速度"
                  disabled={busy}
                  value={rate}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (active)
                      void replay.control("rate", value).then((ok) => {
                        if (ok) replayEditor.update({ rate: value });
                      });
                    else replayEditor.update({ rate: value });
                  }}
                >
                  {[0.25, 0.5, 0.75, 1].map((v) => (
                    <option key={v} value={v}>
                      {v * 100}%
                    </option>
                  ))}
                </select>
                <button
                  disabled={
                    busy ||
                    blocked ||
                    replay.phase === "running" ||
                    replay.phase === "paused"
                  }
                  onClick={() => void play()}
                >
                  {replay.busy && !active ? "正在准备回放…" : "回放声音"}
                </button>
                <button
                  disabled={busy || cannotPractice}
                  onClick={() => afterStop(() => review(data.source))}
                >
                  整轮谱面批阅
                </button>
                <button
                  disabled={!active && !replay.busy && !replay.stopPending}
                  onClick={() => void stop()}
                >
                  {replay.stopPending ? "重试停止回放" : "停止回放"}
                </button>
                {replay.busy && <TaskActivity contentId={contentId} />}
                <HistoryReplayTransport
                  duration={data.duration}
                  refreshSource={archiveStore.load}
                  replay={replay}
                  prefix="历史"
                  references={data.references}
                  measures={data.measures}
                />
                {exact && (
                  <select
                    aria-label="历史逐音判定筛选"
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                  >
                    {[
                      ["all", "全部判定"],
                      ["problems", "偏早、偏晚与漏音"],
                      ["missed", "漏音"],
                      ["early", "偏早"],
                      ["late", "偏晚"],
                      ["onTime", "准时"],
                      ["pending", "未计分"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                {exact && (
                  <>
                    <select
                      aria-label="逐音表现筛选"
                      value={expressionFilter}
                      onChange={(e) => setExpressionFilter(e.target.value)}
                    >
                      <option value="all">全部力度与踏板</option>
                      <option value="velocity">力度差达到筛查值</option>
                      <option value="pedal">踏板状态不同</option>
                    </select>
                    <label>
                      逐音力度差至少{" "}
                      <input
                        aria-label="逐音力度差筛查值"
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        value={thresholdDraft}
                        aria-invalid={!!thresholdError}
                        aria-describedby={
                          thresholdError ? thresholdErrorId : undefined
                        }
                        onChange={(event) => {
                          setThresholdDraft(event.target.value);
                          setThresholdError("");
                        }}
                        onBlur={commitThreshold}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            commitThreshold();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setThresholdDraft(String(velocityThreshold));
                            setThresholdError("");
                          }
                        }}
                      />{" "}
                      级
                    </label>
                    {thresholdError && (
                      <span
                        id={thresholdErrorId}
                        role="alert"
                        className="history-threshold-error"
                      >
                        {thresholdError}当前按 {velocityThreshold} 级筛选。
                      </span>
                    )}
                  </>
                )}
                <select
                  aria-label="演奏对照小节"
                  value={measure}
                  onChange={(e) => setMeasure(Number(e.target.value))}
                >
                  <option value={0}>全部演奏小节</option>
                  {!!measure && !measureChoices.includes(measure) && (
                    <option value={measure}>
                      第 {measure} 小节（当前数据未包含）
                    </option>
                  )}
                  {measureChoices.map((m) => (
                    <option key={m} value={m}>
                      第 {m} 小节
                    </option>
                  ))}
                </select>
              </div>
              <div className="history-performance-timeline">
                <HistoryPerformanceTimeline
                  references={referencePlot}
                  actual={actualPlot}
                  start={start}
                  end={end}
                  position={active ? position : null}
                />
              </div>
              <div className="history-performance-controls">
                <label>
                  前面{" "}
                  <select
                    aria-label="重练前置小节"
                    value={before}
                    disabled={cannotPractice}
                    onChange={(e) => setBefore(Number(e.target.value))}
                  >
                    {[0, 1, 2, 4, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} 小节
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  后面{" "}
                  <select
                    aria-label="重练后置小节"
                    value={after}
                    disabled={cannotPractice}
                    onChange={(e) => setAfter(Number(e.target.value))}
                  >
                    {[0, 1, 2, 4, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} 小节
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  重练打开方式
                  <select
                    aria-label="重练打开方式"
                    value={practiceDestination}
                    disabled={busy || cannotPractice}
                    onChange={(event) =>
                      setPracticeDestination(
                        event.target.value as
                          "practice" | "score" | "paper" | "finger",
                      )
                    }
                  >
                    <option value="practice">练习主界面</option>
                    <option value="score">演奏乐谱</option>
                    <option value="paper">纸质谱面</option>
                    <option value="finger">指法检查</option>
                  </select>
                </label>
                <button
                  disabled={busy || cannotPractice || !measure}
                  onClick={() => {
                    const index = pairs.find(
                      (pair) => pair.reference.measure === measure,
                    )?.index;
                    if (index !== undefined)
                      afterStop(() =>
                        practiceReference(
                          index,
                          before,
                          after,
                          practiceDestination === "practice"
                            ? undefined
                            : practiceDestination,
                        ),
                      );
                  }}
                >
                  {practiceDestination === "finger"
                    ? "检查所选小节指法"
                    : "重练所选小节"}
                </button>
              </div>
              <p>
                按当轮声部、速度和输入校准重练，可带前后小节连起来练。完整演奏/背谱改为连续练习，自适应速度关闭；准备好选段后按“开始练习”。
              </p>
              <BrowsePagination
                label="逐音反馈"
                unit="个参考音"
                page={currentReferencePage}
                total={rows.length}
                pageSize={feedbackPageSize}
                disabled={busy}
                change={setReferencePage}
              />
              <div
                className="history-performance-table"
                ref={referenceTable.ref}
                onScroll={referenceTable.onScroll}
                tabIndex={0}
                role="region"
                aria-label="逐音反馈表，可滚动查看"
              >
                {referenceFeedback}
                {!rows.length && <p>该筛选范围没有对应参考音。</p>}
                {exact && (
                  <p className="muted">
                    本页只对当轮计分器确切配对的按键给出力度差。踏板对照还需要参考和实际两侧在该音之前各有踏板动作。使用上方“重练打开方式”选择练习主界面、演奏乐谱、纸质谱面或指法检查，再通过本行按钮恢复原练习条件并定位小节；逐音反馈只用于筛查，不更改原成绩。
                  </p>
                )}
                {rows.length > feedbackPageSize && (
                  <p>
                    可以翻页查看其余参考音，也可以按小节、判定或力度与踏板问题筛选。
                  </p>
                )}
              </div>
              {!!wrong.length && (
                <div className="history-wrong-inputs">
                  <h4>错音按键 · {wrong.length} 次</h4>
                  <BrowsePagination
                    label="错音按键"
                    unit="次按键"
                    page={currentWrongPage}
                    total={wrong.length}
                    pageSize={feedbackPageSize}
                    disabled={busy}
                    change={setWrongPage}
                  />
                  <p>
                    下列起音被当轮计分器判为错音。小节表示当时参考位置，不代表该按键匹配了那个参考音。
                  </p>
                  <table>
                    <caption className="history-table-caption">
                      当轮计分器保存的错音按键 · 第 {currentWrongPage + 1} 页
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">音</th>
                        <th scope="col">实际起音</th>
                        <th scope="col">计分起音</th>
                        <th scope="col">当时参考小节</th>
                        <th scope="col">力度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wrong
                        .slice(
                          currentWrongPage * feedbackPageSize,
                          (currentWrongPage + 1) * feedbackPageSize,
                        )
                        .map((d, i) => {
                          const n =
                            d.input != null ? data.inputs[d.input] : undefined;
                          return (
                            <tr key={i}>
                              <td>{n ? pitch(n.bytes[1]) : "—"}</td>
                              <td>{n?.at.toFixed(3)} 秒</td>
                              <td>{n?.judgedAt.toFixed(3)} 秒</td>
                              <td>
                                {d.measure
                                  ? `第 ${d.measure} 小节`
                                  : "尚无参考位置"}
                              </td>
                              <td>{n?.bytes[2]}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {wrong.length > feedbackPageSize && (
                    <p>可翻页查看全部错音按键，或选择具体小节缩小范围。</p>
                  )}
                </div>
              )}
              <details className="history-pedal-summary">
                <summary>踏板动作摘要</summary>
                <p>
                  实际踏板动作（{pedalText.actualCount} 条）：
                  {pedalText.actual || "无实际踏板动作"}
                </p>
                <p>
                  参考踏板动作（{pedalText.referenceCount} 条）：
                  {pedalText.reference || "本轮参考没有踏板动作"}
                </p>
                {(pedalText.actualCount > 80 ||
                  pedalText.referenceCount > 80) && (
                  <p className="parameter-help">
                    摘要分别显示前 80
                    条动作。上方逐音反馈可以按小节查看对应的踏板状态。
                  </p>
                )}
              </details>
            </>
          )}
        </>
      )}
    </details>
  );
}
