import { useRequestScope } from "./engine/useRequestScope";
import { fingeringApi } from "./engine/fingeringApi";
import type {
  AcceptanceReview as WireAcceptanceReview,
  FingeringPlan as Plan,
  Proposal,
  CrossHandPlanReview as CrossHandReview,
} from "./engine/commands.generated";
import {
  HandSpanProfileValues,
  type HandSpanProfile,
} from "./engine/commands.generated";
import { PracticeEditTaskActivity } from "./engine/PracticeEditTaskActivity";
import { FingerPlanComparison } from "./FingerPlanComparison";
import { FingerPairDialog } from "./FingerPairDialog";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCloseParticipant } from "./app/closePreparation";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import { BrowseDetailWorkspace } from "./app/BrowseDetailWorkspace";
import { useBrowseScroll } from "./app/useBrowseScroll";
import {
  createFingeringWorkbenchStore,
  fingeringDraftId,
  fingeringDraftKey,
  fingeringSource,
  type FingeringDraft,
  type FingeringResult,
  type FingeringSection,
  type FingeringWorkbenchStore,
} from "./features/fingering/fingeringWorkbenchStore";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { FingerDemoControls } from "./FingerDemoControls";
import { FingerPracticeBuilder } from "./FingerPracticeBuilder";
import { HeldFingerPlans } from "./HeldFingerPlans";
import {
  FingerCoverageReview,
  type FingerCoverageNote,
} from "./FingerCoverageReview";
import { api, pitchName, type LoadedSong, type Note } from "./api";
const suggestedForAcceptance = (proposal: Proposal) =>
  proposal.confidence >= 60 && proposal.saved !== proposal.finger;
type Result = FingeringResult;
type AcceptanceReview = WireAcceptanceReview & { key: string };
export function FingeringDialog({
  song,
  note,
  start,
  end,
  close: finishDialog,
  changed,
  workbench,
  initialDraft,
  openWorkbench,
}: {
  song: LoadedSong;
  note: Note | null;
  start: number;
  end: number;
  close: () => void;
  changed: () => Promise<void>;
  workbench?: FingeringWorkbenchStore;
  initialDraft?: FingeringDraft | null;
  openWorkbench?: () => void;
}) {
  const [ownWorkbench] = useState(
    () => workbench ?? createFingeringWorkbenchStore(),
  );
  const drafts = workbench ?? ownWorkbench;
  const workbenchState = useSyncExternalStore(
    drafts.subscribe,
    drafts.getSnapshot,
    drafts.getSnapshot,
  );
  const [originKey] = useState(() =>
    fingeringDraftKey(song.contentId, note, start, end),
  );
  const [origin] = useState(() => ({
    note: note ? { track: note.track, index: note.index } : null,
    start,
    end,
  }));
  const [restored] = useState(() =>
    initialDraft?.key === originKey ? initialDraft : drafts.get(originKey),
  );
  const sourceVersion = fingeringSource(song);
  const [cached] = useState(() =>
    restored ? drafts.cached(restored, sourceVersion) : undefined,
  );
  const [section, setSection] = useState<FingeringSection>(
    restored?.section ?? (cached ? "plans" : "setup"),
  );
  const [restoredSelection, setRestoredSelection] = useState<
    FingeringDraft["selection"]
  >(restored?.selection ?? null);
  const forgetOnClose = useRef(false);
  const playable = useMemo(
    () => song.tracks.filter((track) => track.notes > 0),
    [song.tracks],
  );
  const handsByTrack = useMemo(() => {
    const tracks = new Map<number, Set<string>>();
    for (const note of song.notes) {
      const hands = tracks.get(note.track) ?? new Set<string>();
      hands.add(note.part);
      tracks.set(note.track, hands);
    }
    return tracks;
  }, [song.notes]);
  const trackName = (id: number) =>
    song.tracks.find((t) => t.id === id)?.name || `音轨 ${id + 1}`;
  const [track, setTrack] = useState(
    () =>
      restored?.form.track ??
      note?.track ??
      playable.find((t) => t.part !== "other")?.id ??
      playable[0]?.id ??
      0,
  );
  const [hand, setHand] = useState(
    () =>
      restored?.form.hand ??
      (note?.part === "left" ||
      (!note &&
        song.notes.find((n) => n.track === track && n.part !== "other")
          ?.part === "left")
        ? "left"
        : "right"),
  );
  const [pair, setPair] = useState(false);
  const [profile, setProfile] = useState<HandSpanProfile>(
      restored?.form.profile ?? "Standard",
    ),
    [scope, setScope] = useState(
      restored?.form.scope ?? (note ? "note" : "range"),
    ),
    [first, setFirst] = useState(restored?.form.first ?? start),
    [last, setLast] = useState(restored?.form.last ?? end);
  const [firstText, setFirstText] = useState(
    restored?.form.firstText ?? String(first),
  );
  const [lastText, setLastText] = useState(
    restored?.form.lastText ?? String(last),
  );
  const [result, setResult] = useState<Result | null>(cached ?? null),
    [accepted, setAccepted] = useState<Set<number>>(
      () =>
        new Set(
          cached?.proposals.flatMap((proposal, index) =>
            (
              restored?.selection
                ? restored.selection.some(
                    (selected) =>
                      selected.track === proposal.track &&
                      selected.index === proposal.index,
                  )
                : suggestedForAcceptance(proposal)
            )
              ? [index]
              : [],
          ) ?? [],
        ),
    ),
    [operationBusy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pendingRefresh, setPendingRefresh] = useState<FingeringDraft["receipt"]>(
      restored?.receipt ?? null,
    ),
    [page, setPage] = useState(cached ? (restored?.page ?? 0) : 0);
  const [heldBusy, setHeldBusy] = useState(false);
  const busy = operationBusy || heldBusy;
  const locked = busy || !!pendingRefresh;
  const working = useRef(false);
  const [values, setValues] = useState<Record<string, number>>(
    (cached ? restored?.values : restored?.pins) ?? {},
  );
  const changedCount = useMemo(() => Object.keys(values).length, [values]);
  const [additionalTracks, setAdditionalTracks] = useState<number[]>(
    restored?.form.additionalTracks ?? [],
  );
  const targetSignature = additionalTracks.join(",");

  const candidates = playable.filter(
    (t) => t.id !== track && handsByTrack.get(t.id)?.has(hand),
  );
  const positionKey = (n: { track: number; index: number }) =>
    `${n.track}:${n.index}`;
  const isBatch =
    (result?.targetTracks.length ?? additionalTracks.length + 1) > 1;
  const noteLabel = (n: { track: number; index: number }) =>
    `${isBatch ? `${trackName(n.track)} · ` : ""}音符 ${n.index + 1}`;
  const trackContext = JSON.stringify([
    track,
    hand,
    song.engineId,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision,
  ]);
  const previousTrackContext = useRef(trackContext);
  useEffect(() => {
    if (previousTrackContext.current === trackContext) return;
    previousTrackContext.current = trackContext;
    setAdditionalTracks([]);
  }, [
    track,
    hand,
    song.engineId,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision,
  ]);
  const [planIndex, setPlanIndex] = useState(
    cached
      ? Math.min(restored?.planIndex ?? 0, Math.max(0, cached.plans.length - 1))
      : 0,
  );
  const [keepSaved, setKeepSaved] = useState(restored?.form.keepSaved ?? !note);
  const [preview, setPreview] = useState(cached ? (restored?.preview ?? 0) : 0);
  const [practiceRate, setPracticeRate] = useState(
    restored?.form.practiceRate ?? 1,
  );
  const rangeValid =
    scope === "note" ||
    (/^\d+$/.test(firstText.trim()) &&
      /^\d+$/.test(lastText.trim()) &&
      Number.isInteger(first) &&
      Number.isInteger(last) &&
      first >= 1 &&
      first <= last &&
      last <= song.measures.length);
  const rangeErrorId = useId();
  const restoreRange = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing || rangeValid)
      return;
    event.preventDefault();
    event.stopPropagation();
    const count = Math.max(1, song.measures.length);
    const first = Math.min(count, Math.max(1, origin.start));
    const last = Math.min(count, Math.max(first, origin.end));
    setFirst(first);
    setLast(last);
    setFirstText(String(first));
    setLastText(String(last));
  };
  const scrollPositions = useRef(new Map<string, number>());
  const detailScroll = useBrowseScroll<HTMLDivElement>(
    `${originKey}:${section}`,
    true,
    0,
    () => {},
    scrollPositions.current,
  );
  const requestScopeKey = useMemo(
    () =>
      JSON.stringify([
        song.engineId,
        song.contentId,
        song.scoreRevision,
        song.annotationRevision,
        track,
        hand,
        profile,
        scope,
        first,
        last,
        keepSaved,
        practiceRate,
        targetSignature,
        values,
      ]),
    [
      song.engineId,
      song.contentId,
      song.scoreRevision,
      song.annotationRevision,
      track,
      hand,
      profile,
      scope,
      first,
      last,
      keepSaved,
      practiceRate,
      targetSignature,
      values,
    ],
  );
  const captureRequest = useRequestScope(requestScopeKey);
  const [reviewPage, setReviewPage] = useState(0);
  const [acceptance, setAcceptance] = useState<AcceptanceReview | null>(null);
  const [acceptanceError, setAcceptanceError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [acceptancePage, setAcceptancePage] = useState(0);
  const [expressionPage, setExpressionPage] = useState(0);
  const [previewSaved, setPreviewSaved] = useState(false);
  const [demoReset, setDemoReset] = useState(0);
  const stopPreview = () => setDemoReset((value) => value + 1);
  const inputSignature = JSON.stringify([
    sourceVersion,
    track,
    hand,
    profile,
    scope,
    first,
    last,
    keepSaved,
    practiceRate,
    targetSignature,
  ]);
  const [inputOwner, setInputOwner] = useState(inputSignature);
  const previousInput = useRef(inputSignature);
  const receiptSource = useRef(
    restored?.receipt ? restored.source : sourceVersion,
  );
  const previousEditor = useRef<{
    signature: string;
    row: FingeringDraft;
    result: Result | null;
  } | null>(null);
  const root = useRef<HTMLElement>(null);
  const [focusPosition, setFocusPosition] = useState<{
    key: string | null;
    fingerprint: string;
  } | null>(null);
  const draftForm = useMemo(
    () => ({
      track,
      hand,
      profile,
      scope: scope === "note" ? ("note" as const) : ("range" as const),
      first,
      last,
      firstText,
      lastText,
      keepSaved,
      practiceRate,
      additionalTracks,
    }),
    [
      track,
      hand,
      profile,
      scope,
      first,
      last,
      firstText,
      lastText,
      keepSaved,
      practiceRate,
      additionalTracks,
    ],
  );
  const draftPins = useMemo(
    () => ({
      ...Object.fromEntries(
        (result?.request.pins ?? []).map((pin) => [
          `${pin.track ?? track}:${pin.index}`,
          pin.finger,
        ]),
      ),
      ...values,
    }),
    [result?.request.pins, track, values],
  );
  const draftSelection = useMemo(
    () =>
      result
        ? result.proposals
            .filter((_, index) => accepted.has(index))
            .map(({ track, index }) => ({ track, index }))
        : restoredSelection,
    [result?.proposals, accepted, restoredSelection],
  );
  const buildDraft = (receipt = pendingRefresh): FingeringDraft => ({
    key: originKey,
    contentId: song.contentId,
    title: song.title,
    path: song.sourcePath,
    source: receipt ? receiptSource.current : sourceVersion,
    origin: origin.note,
    start: origin.start,
    end: origin.end,
    form: draftForm,
    values,
    pins: draftPins,
    selection: draftSelection,
    receipt,
    section,
    page,
    planIndex,
    preview,
    updatedAt: Date.now(),
  });
  const captureWorkbench = () => {
    if (forgetOnClose.current) return;
    if (inputOwner !== inputSignature) {
      const previous = previousEditor.current;
      if (previous) drafts.remember(previous.row, previous.result);
      return;
    }
    drafts.remember(buildDraft(), result);
  };
  const latestCapture = useRef(captureWorkbench);
  latestCapture.current = captureWorkbench;
  useLayoutEffect(() => {
    const previous = previousEditor.current;
    if (
      previous &&
      previous.signature !== inputSignature &&
      (previous.result ||
        previous.row.receipt ||
        Object.keys(previous.row.pins).length)
    )
      drafts.remember(previous.row, previous.result);
    if (inputOwner === inputSignature)
      previousEditor.current = {
        signature: inputSignature,
        row: buildDraft(),
        result,
      };
  });
  useEffect(() => {
    const timer = window.setTimeout(() => latestCapture.current(), 500);
    return () => window.clearTimeout(timer);
  }, [
    inputSignature,
    inputOwner,
    firstText,
    lastText,
    values,
    accepted,
    result,
    pendingRefresh,
    page,
    planIndex,
    preview,
    section,
  ]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      latestCapture.current();
      if (drafts.getSnapshot().error) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("beforeunload", unload);
      latestCapture.current();
    };
  }, [drafts]);
  useCloseParticipant(
    "指法输入",
    () => drafts.getSnapshot().error || null,
    captureWorkbench,
  );
  const close = () => {
    captureWorkbench();
    finishDialog();
  };
  const refreshActual = async () => {
    await changed();
    const current = await api.state();
    if (
      current.contentId !== song.contentId ||
      (song.engineId && current.stateOrder?.engineId !== song.engineId)
    )
      throw new Error("当前曲目或连接已经改变，请返回练习核对实际指法。");
  };
  const locateProposal = (position?: { track: number; index: number }) => {
    if (!result) return;
    const index = position
      ? result.proposals.findIndex(
          (proposal) => positionKey(proposal) === positionKey(position),
        )
      : -1;
    if (index >= 0) setPage(Math.floor(index / 40));
    setSection("plans");
    setFocusPosition({
      key: index >= 0 && position ? positionKey(position) : null,
      fingerprint: result.fingerprint,
    });
  };
  useLayoutEffect(() => {
    if (
      !focusPosition ||
      section !== "plans" ||
      busy ||
      inputOwner !== inputSignature ||
      result?.fingerprint !== focusPosition.fingerprint
    )
      return;
    const node = root.current?.querySelector<HTMLElement>(
      focusPosition.key
        ? `select[data-finger-position="${focusPosition.key}"]`
        : ".finger-position",
    );
    if (!node?.getClientRects().length) return;
    if (
      [...document.querySelectorAll('[role="dialog"]')].some(
        (dialog) => dialog.getClientRects().length && !dialog.contains(node),
      )
    )
      return;
    node.scrollIntoView({ block: "center" });
    node.focus({ preventScroll: true });
    setFocusPosition(null);
  }, [focusPosition, section, page, busy, result, inputOwner, inputSignature]);
  const acceptanceEdits = useMemo(
    () =>
      result?.proposals
        .filter((_, i) => accepted.has(i))
        .map((p) => ({
          track_id: p.track,
          note_index: p.index,
          finger: p.finger,
        })) ?? [],
    [result, accepted],
  );
  const recommendedIndices = useMemo(
    () =>
      result?.proposals.flatMap((proposal, index) =>
        suggestedForAcceptance(proposal) ? [index] : [],
      ) ?? [],
    [result],
  );
  const recommendedByTrack = useMemo(() => {
    const tracks = new Map<number, number[]>();
    result?.proposals.forEach((proposal, index) => {
      if (!suggestedForAcceptance(proposal)) return;
      const indices = tracks.get(proposal.track) ?? [];
      indices.push(index);
      tracks.set(proposal.track, indices);
    });
    return tracks;
  }, [result]);
  const acceptanceKey = useMemo(
    () => JSON.stringify([result?.fingerprint, acceptanceEdits]),
    [result?.fingerprint, acceptanceEdits],
  );
  const hasChanges = changedCount > 0;
  const comparisonCurrent = useMemo(
    () =>
      result?.proposals.map((proposal) => ({
        ...proposal,
        finger: values[positionKey(proposal)] ?? proposal.finger,
      })) ?? [],
    [result?.proposals, values],
  );
  const comparisonRevision = useMemo(
    () =>
      JSON.stringify([
        result?.fingerprint,
        planIndex,
        [...accepted].sort((a, b) => a - b),
      ]),
    [result?.fingerprint, planIndex, accepted],
  );
  const currentAcceptance =
    acceptance?.key === acceptanceKey && !hasChanges ? acceptance : null;
  useEffect(() => {
    let disposed = false;
    setAcceptance(null);
    setAcknowledged(false);
    setAcceptancePage(0);
    setExpressionPage(0);
    setAcceptanceError("");
    setPreviewSaved(false);
    if (!result || !acceptanceEdits.length || hasChanges) return;
    void fingeringApi
      .review(song, {
        request: result.request,
        fingerprint: result.fingerprint,
        edits: acceptanceEdits,
      })
      .then((data) => {
        if (!disposed) setAcceptance({ ...data, key: acceptanceKey });
      })
      .catch((e) => {
        if (!disposed)
          setAcceptanceError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      disposed = true;
    };
  }, [acceptanceKey, hasChanges]);
  useEffect(() => {
    if (!song.tracks.some((item) => item.id === track))
      setTrack(song.tracks.find((item) => item.notes > 0)?.id ?? 0);
  }, [
    song.engineId,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision,
  ]);
  const profileChanged = useRef(false);
  const restoreProfile = useRef(!!restored);
  const profileTarget = useRef(
    JSON.stringify([song.engineId, song.contentId, track, hand]),
  );
  useEffect(() => {
    const target = JSON.stringify([song.engineId, song.contentId, track, hand]);
    if (restoreProfile.current) {
      restoreProfile.current = false;
      profileChanged.current = true;
      return;
    }
    if (profileTarget.current === target && profileChanged.current) return;
    profileTarget.current = target;
    let cancelled = false;
    profileChanged.current = false;
    void api
      .readPractice<{
        profiles: Record<string, HandSpanProfile> | null;
        profilesByHand: Record<string, HandSpanProfile> | null;
        defaults: Record<string, HandSpanProfile>;
      }>(song, {
        type: "fingerProfiles",
      })
      .then((data) => {
        if (!cancelled && !profileChanged.current)
          setProfile(
            data.profilesByHand?.[`${track}:${hand}`] ??
              data.defaults[hand === "left" ? "LeftHand" : "RightHand"] ??
              data.profiles?.[String(track)] ??
              "Standard",
          );
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message));
      });
    return () => {
      cancelled = true;
    };
  }, [
    track,
    hand,
    song.engineId,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision,
  ]);
  useLayoutEffect(() => {
    if (previousInput.current === inputSignature) return;
    previousInput.current = inputSignature;
    setResult(null);
    setValues({});
    setAccepted(new Set());
    setPage(0);
    setInputOwner(inputSignature);
    setFocusPosition(null);
    setRestoredSelection(null);
  }, [
    track,
    hand,
    profile,
    scope,
    first,
    last,
    keepSaved,
    practiceRate,
    targetSignature,
    song.engineId,
    song.contentId,
    song.scoreRevision,
    song.annotationRevision,
  ]);
  const perform = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const generate = () =>
    perform(async () => {
      if (pendingRefresh) return;
      if (!rangeValid)
        throw new Error(
          `请输入 1 到 ${song.measures.length} 之间的小节，起始小节不能大于结束小节。`,
        );
      profileChanged.current = true;
      const isCurrent = captureRequest();
      const index =
        note?.track === track
          ? note.index
          : (song.notes.find((n) => n.track === track)?.index ?? 0);
      const response = await fingeringApi.plans(song, {
        content_id: song.contentId,
        track,
        index,
        profile,
        hand: hand === "left" ? "LeftHand" : "RightHand",
        range: scope === "range" ? [first, last] : null,
        keep_saved: keepSaved,
        practice_rate: practiceRate,
        target_tracks: additionalTracks,
        pins: Object.entries({
          ...Object.fromEntries(
            (
              (result?.request.pins ?? []) as {
                track?: number | null;
                index: number;
                finger: number;
              }[]
            ).map((p) => [`${p.track ?? track}:${p.index}`, p.finger]),
          ),
          ...values,
        }).map(([key, finger]) => ({
          track: Number(key.split(":")[0]),
          index: Number(key.split(":")[1]),
          finger,
        })),
      });
      if (!isCurrent()) return;
      const data: Result = {
        ...response,
        proposals: response.plans[0]?.proposals ?? [],
      };
      setResult(data);
      setPlanIndex(0);
      setPreview(0);
      setReviewPage(0);
      setValues({});
      setPage(0);
      const previouslyAccepted = result
        ? new Set(
            result.proposals.filter((_, i) => accepted.has(i)).map(positionKey),
          )
        : restoredSelection
          ? new Set(restoredSelection.map(positionKey))
          : null;
      setAccepted(
        new Set(
          data.proposals.flatMap((p, i) =>
            (
              previouslyAccepted
                ? previouslyAccepted.has(positionKey(p)) &&
                  suggestedForAcceptance(p)
                : suggestedForAcceptance(p)
            )
              ? [i]
              : [],
          ),
        ),
      );
      setRestoredSelection(null);
      setSection("plans");
    });
  const apply = () =>
    perform(async () => {
      if (
        pendingRefresh ||
        !result ||
        !currentAcceptance?.valid ||
        ((currentAcceptance.selected < currentAcceptance.total ||
          currentAcceptance.contextUnmarked > 0) &&
          !acknowledged)
      )
        return;
      receiptSource.current = sourceVersion;
      drafts.remember(buildDraft("saving"), null);
      setPendingRefresh("saving");
      await api.editPractice(song, {
        type: "acceptFingerPlan",
        request: result.request,
        fingerprint: result.fingerprint,
        edits: acceptanceEdits,
      });
      receiptSource.current = sourceVersion;
      const receipt = buildDraft("saved");
      drafts.remember(receipt, null);
      setPendingRefresh("saved");
      setResult(null);
      try {
        await refreshActual();
        drafts.remove(fingeringDraftId(receipt));
        forgetOnClose.current = true;
        close();
      } catch (cause) {
        setError(
          `指法已保存，但界面刷新失败：${String(cause)}。请只重试读取，不要再次提交。`,
        );
      }
    });
  const retryRefresh = () =>
    perform(async () => {
      if (!pendingRefresh) return;
      const receipt = buildDraft();
      try {
        await refreshActual();
        drafts.remove(fingeringDraftId(receipt));
        if (pendingRefresh === "saved") {
          forgetOnClose.current = true;
          close();
        } else {
          setPendingRefresh(null);
          setResult(null);
          setValues(receipt.pins);
          setRestoredSelection(receipt.selection);
          setSection("setup");
          if (pendingRefresh === "saving" || pendingRefresh === "undoing")
            setError(
              "已重新读取当前实际指法。上次请求的回执未确认，原输入继续保留；请按当前指法重新推荐后再保存。",
            );
        }
      } catch (cause) {
        throw new Error(
          `${pendingRefresh === "saved" ? "指法已保存" : pendingRefresh === "undone" ? "上次指法修改已撤销" : "上次请求的结果尚未确认"}，当前指法读取失败：${String(cause)}。请只重试读取。`,
        );
      }
    });
  const visible = result?.proposals.slice(page * 40, (page + 1) * 40) ?? [];
  const setupContent = (
    <>
      {note && (
        <p className="parameter-help" aria-label="当前指法音符">
          当前音符：第{" "}
          {song.measures.find(
            (m) => note.start >= m.start - 0.001 && note.start < m.end - 0.001,
          )?.displayNumber ??
            song.measures.find(
              (m) =>
                note.start >= m.start - 0.001 && note.start < m.end - 0.001,
            )?.number ??
            "?"}{" "}
          小节 · {trackName(note.track)} · {pitchName(note.pitch)} · 音符{" "}
          {note.index + 1} · 已存指法 {note.finger ?? "未标记"}
          。建议仅用于检查教学指法，历史 MIDI 不记录实际使用的手指。
        </p>
      )}
      {restored && !cached && !pendingRefresh && !result && (
        <p className="fingering-help" role="status">
          已恢复推荐条件与固定手指。请按原输入重新生成建议，再核对要保存的位置。
        </p>
      )}
      {workbenchState.error && (
        <div className="fingering-workbench-storage" role="alert">
          <p>{workbenchState.error}</p>
          <div className="fingering-workbench-actions">
            <button onClick={drafts.retry}>重试暂存</button>
            <button onClick={drafts.preserveAndSave}>
              保留原文副本并暂存当前输入
            </button>
            <CopyPracticeDraft label="复制当前指法输入" value={buildDraft()} />
          </div>
        </div>
      )}
      <button disabled={locked} onClick={() => setPair(true)}>
        双手一起审阅
      </button>
      <div className="fingering-options">
        <label>
          音轨
          <select
            aria-label="建议指法音轨"
            value={track}
            disabled={locked}
            onChange={(e) => {
              const id = Number(e.target.value);
              setTrack(id);
              const part = song.notes.find(
                (n) => n.track === id && n.part !== "other",
              )?.part;
              if (part === "left" || part === "right") setHand(part);
            }}
          >
            {playable.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name} ·{" "}
                {t.part === "left"
                  ? "左手"
                  : t.part === "right"
                    ? "右手"
                    : "未分手"}
              </option>
            ))}
          </select>
        </label>
        <label>
          演奏手
          <select
            aria-label="指法演奏手"
            value={hand}
            disabled={locked}
            onChange={(e) => setHand(e.target.value as "left" | "right")}
          >
            <option value="left">左手</option>
            <option value="right">右手</option>
          </select>
        </label>
        <label>
          手的跨度
          <select
            aria-label="指法手跨度"
            value={profile}
            disabled={locked}
            onChange={(e) => {
              profileChanged.current = true;
              const value = HandSpanProfileValues.find(
                (value) => value === e.target.value,
              );
              if (value) setProfile(value);
            }}
          >
            <option value="Compact">较小 · 七度内</option>
            <option value="Standard">一般 · 八度内</option>
            <option value="Large">较大 · 九度内</option>
          </select>
        </label>
        <button
          disabled={locked}
          onClick={() =>
            void perform(async () => {
              await api.commandForEngine(song.engineId ?? undefined, {
                type: "handSpanDefault",
                hand: hand === "left" ? "LeftHand" : "RightHand",
                profile,
              });
            })
          }
        >
          设为{hand === "left" ? "左手" : "右手"}默认跨度
        </button>
        <label>
          建议范围
          <select
            aria-label="指法建议范围"
            value={scope}
            disabled={locked}
            onChange={(e) =>
              setScope(e.target.value === "note" ? "note" : "range")
            }
          >
            {note && <option value="note">所选音符 / 整个和弦</option>}
            <option value="range">小节选段</option>
          </select>
        </label>
        <label>
          推荐使用速度
          <select
            aria-label="指法推荐速度"
            value={practiceRate}
            disabled={locked}
            onChange={(e) => setPracticeRate(Number(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <option key={rate} value={rate}>
                {Math.round(rate * 100)}% 原速
              </option>
            ))}
          </select>
        </label>
        {scope === "range" && (
          <>
            <label>
              起始小节
              <input
                disabled={locked}
                aria-label="指法起始小节"
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={firstText}
                aria-invalid={!rangeValid}
                aria-describedby={!rangeValid ? rangeErrorId : undefined}
                onChange={(event) => {
                  setFirstText(event.target.value);
                  setFirst(
                    /^\d+$/.test(event.target.value.trim())
                      ? Number(event.target.value)
                      : 0,
                  );
                }}
                onKeyDown={restoreRange}
              />
            </label>
            <label>
              结束小节
              <input
                disabled={locked}
                aria-label="指法结束小节"
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={lastText}
                aria-invalid={!rangeValid}
                aria-describedby={!rangeValid ? rangeErrorId : undefined}
                onChange={(event) => {
                  setLastText(event.target.value);
                  setLast(
                    /^\d+$/.test(event.target.value.trim())
                      ? Number(event.target.value)
                      : 0,
                  );
                }}
                onKeyDown={restoreRange}
              />
            </label>
          </>
        )}
      </div>
      <HeldFingerPlans
        onBusy={setHeldBusy}
        song={song}
        disabled={locked || !rangeValid || section !== "setup"}
        changed={refreshActual}
        request={{
          content_id: song.contentId,
          track,
          index:
            note?.track === track
              ? note.index
              : (song.notes.find((n) => n.track === track)?.index ?? 0),
          hand: hand === "left" ? "LeftHand" : "RightHand",
          profile,
          range: scope === "range" ? [first, last] : null,
          keep_saved: keepSaved,
          practice_rate: practiceRate,
          target_tracks: additionalTracks,
          pins: Object.entries(values).map(([key, finger]) => ({
            track: Number(key.split(":")[0]),
            index: Number(key.split(":")[1]),
            finger,
          })),
        }}
      />
      {candidates.length > 0 && (
        <fieldset className="finger-batch-targets" disabled={locked}>
          <legend>共同编辑的同手音轨</legend>
          <span>{trackName(track)} 已选</span>
          {candidates.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                aria-label={`共同编辑 ${trackName(t.id)}`}
                checked={additionalTracks.includes(t.id)}
                onChange={(e) =>
                  setAdditionalTracks((current) =>
                    (e.target.checked
                      ? [...current, t.id]
                      : current.filter((id) => id !== t.id)
                    ).sort((a, b) => a - b),
                  )
                }
              />
              {trackName(t.id)}
            </label>
          ))}
          <small>
            勾选后一起推荐和保存；未勾选声部只作联动参考，其已有指法保持固定。
          </small>
        </fieldset>
      )}
      <label className="finger-anchor-toggle">
        <input
          type="checkbox"
          disabled={locked}
          checked={keepSaved}
          onChange={(e) => {
            setKeepSaved(e.target.checked);
            setValues({});
          }}
        />
        固定选段内已有指法
      </label>
      {!handsByTrack.get(track)?.has("left") &&
        !handsByTrack.get(track)?.has("right") && (
          <div className="fingering-hand-setup">
            <span>这条音轨还未指定手。先确认其演奏手，再生成建议。</span>
            {[
              ["left", "指定左手"],
              ["right", "指定右手"],
            ].map(([part, label]) => (
              <button
                key={part}
                disabled={locked}
                onClick={() =>
                  void perform(async () => {
                    const t = playable.find((t) => t.id === track)!;
                    await api.adjustForSong(song, {
                      type: "track",
                      id: track,
                      mode: t.mode,
                      part,
                      visible: t.visible,
                    });
                    await refreshActual();
                    setResult(null);
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}
      <p className="fingering-help">
        综合旋律走向、黑白键、手型、穿指、和弦连接、持音与演奏速度。推荐使用速度影响换指代价，不改变当前练习速度。选段外已有指法始终保留。规则评分用于比较建议，不代表正确率。宽和弦或大幅移手等评分低于
        60
        的位置，以及与已存指法相同的位置，默认不勾选；你仍可逐音采用，接受后才保存。
      </p>
      {!rangeValid && (
        <p id={rangeErrorId} className="dialog-error" role="alert">
          请输入 1 到 {song.measures.length}{" "}
          之间的小节，起始小节不能大于结束小节。
        </p>
      )}
    </>
  );
  const plansContent = result ? (
    <>
      {result.jointStatus && (
        <p className="fingering-help" role="status">
          双手候选：{result.jointStatus}
          。组合评分只比较琴键位置与持音时间，不判断身体动作。
        </p>
      )}
      {result.scoreArticulations && (
        <p className="fingering-help" role="status">
          {result.scoreArticulations.slurLinks +
            result.scoreArticulations.staccatoNotes >
          0
            ? `已核对配对乐谱：${result.scoreArticulations.slurLinks} 处连线衔接、${result.scoreArticulations.staccatoNotes} 个断奏音符参与本次指法比较。逐音原因会标出谱面依据。`
            : result.scoreArticulations.paired
              ? "当前配对乐谱没有可可靠对应到这些音符的连线或断奏标记，已按 MIDI 指法生成。"
              : "当前没有可信的配对乐谱，已按 MIDI 指法生成。"}
        </p>
      )}
      <div
        className="finger-plan-options"
        role="group"
        aria-label="备选指法方案"
      >
        {result.plans.map((plan, i) => (
          <button
            key={i}
            disabled={locked || changedCount > 0}
            aria-pressed={i === planIndex}
            onClick={() => {
              setPlanIndex(i);
              setResult({ ...result, proposals: plan.proposals });
              setAccepted(
                new Set(
                  plan.proposals.flatMap((p, j) =>
                    suggestedForAcceptance(p) ? [j] : [],
                  ),
                ),
              );
              setPage(0);
              setReviewPage(0);
            }}
          >
            <strong>方案 {i + 1}</strong>
            <span>
              需复核 {plan.review.length + (plan.crossHandReview?.length ?? 0)}{" "}
              处
            </span>
            <small>
              穿 / 跨指 {plan.crossings} · 移手 {plan.shifts} · 宽手型{" "}
              {plan.wide} · 改动已有 {plan.changed}
            </small>
            {typeof plan.jointCost === "number" && (
              <small>
                双手交叠代价 {plan.jointCost} · 组合规则分 {plan.cost}
              </small>
            )}
          </button>
        ))}
      </div>
      <FingerPlanComparison
        key={result.fingerprint}
        label="指法方案比较"
        plans={result.plans}
        current={comparisonCurrent}
        revision={comparisonRevision}
        disabled={locked}
        trackName={trackName}
        apply={(notes) => {
          setValues((v) => ({
            ...v,
            ...Object.fromEntries(notes.map((n) => [positionKey(n), n.finger])),
          }));
          const keys = new Set(notes.map(positionKey));
          setAccepted(
            (a) =>
              new Set([
                ...a,
                ...result.proposals.flatMap((p, i) =>
                  keys.has(positionKey(p)) ? [i] : [],
                ),
              ]),
          );
        }}
        locate={(note) => locateProposal(note)}
      />
      {changedCount > 0 && (
        <p className="fingering-help">
          已保留逐音修改。点击“按修改重新推荐”将这些手指固定后重新求解，再核对实际保存结果；未勾选位置继续保持未采用。
        </p>
      )}
      {result.plans.length === 1 && (
        <p className="fingering-help">
          当前锚点和持音条件下只找到一个不同方案。可取消固定已有指法，重新比较。
        </p>
      )}
      {result.contextTracks.length > 0 && (
        <p className="fingering-help">
          联合参考同一只手的音轨：
          {result.contextTracks.map(trackName).join("、")}
          ，包含同时发音与持音；本次只保存{" "}
          {result.targetTracks.map(trackName).join("、")}{" "}
          的勾选建议。未选择音轨的已有指法保持固定，未标记指法仅参与方案预览。
        </p>
      )}
      {currentAcceptance && (
        <div
          className="fingering-selection"
          role="group"
          aria-label="手位预览内容"
        >
          <span>手位查看</span>
          {[false, true].map((saved) => (
            <button
              key={String(saved)}
              disabled={locked}
              aria-pressed={previewSaved === saved}
              onClick={() => {
                stopPreview();
                setPreviewSaved(saved);
              }}
            >
              {saved ? "保存后的实际指法" : "完整推荐方案"}
            </button>
          ))}
        </div>
      )}
      <FingerPosition
        resetKey={demoReset}
        song={song}
        result={result}
        plan={result.plans[planIndex]}
        preview={preview}
        setPreview={setPreview}
        hand={hand}
        disabled={locked || changedCount > 0 || section !== "plans"}
        previewFingers={
          previewSaved ? currentAcceptance?.contextFingers : undefined
        }
      />
      <section className="finger-review" aria-label="指法难点复核">
        <div className="finger-review-heading">
          <strong>
            需要复核的位置 ·{" "}
            {result.plans[planIndex].review.length +
              (result.plans[planIndex].crossHandReview?.length ?? 0)}{" "}
            处
          </strong>
          <span>
            {Math.round(result.plans[planIndex].practiceRate * 100)}% 原速
          </span>
        </div>
        <p>
          跨度按所选手型估算；快速穿 / 跨指以 180 毫秒、移手以 250
          毫秒为复核阈值。请结合手位示范判断，固定指法也会检查。
        </p>
        <FingerPracticeBuilder
          song={song}
          key={`${result.fingerprint}:${planIndex}`}
          review={result.plans[planIndex].review}
          rate={result.plans[planIndex].practiceRate}
          hand={hand}
          request={result.request}
          fingerprint={result.fingerprint}
          measures={song.measures.length}
          disabled={locked || changedCount > 0}
          changed={changed}
        />
        {result.plans[planIndex].review
          .slice(reviewPage * 8, (reviewPage + 1) * 8)
          .map((r, i) => (
            <button
              key={`${r.index}:${r.kind}:${i}`}
              disabled={locked || changedCount > 0}
              onClick={() => {
                stopPreview();
                setPreview(r.contextIndex);
                const row = result.proposals.findIndex(
                  (p) => p.track === r.track && p.index === r.index,
                );
                if (row >= 0) setPage(Math.floor(row / 40));
              }}
            >
              <span>
                {trackName(r.fromTrack)} → {trackName(r.track)} · 第 {r.measure}{" "}
                小节 · {pitchName(r.fromPitch)} → {pitchName(r.pitch)}
              </span>
              <strong>
                {r.kind === "wideReach"
                  ? `跨度 ${r.semitones} 半音，当前手型 ${r.comfortableSemitones} 半音`
                  : `${r.kind === "rapidTurn" ? "快速穿 / 跨指" : r.kind === "rapidShift" ? "快速移手" : "同指换键"} · ${r.intervalMs} 毫秒`}
              </strong>
              <small>
                {r.kind === "wideReach"
                  ? "查看持音与手位；可调整分手、指法或改用分解演奏"
                  : "查看前后手位；可降低速度，或固定手指后重新推荐"}
              </small>
            </button>
          ))}
        {!result.plans[planIndex].review.length &&
          !result.plans[planIndex].crossHandReview?.length && (
            <span>当前规则没有发现上述难点；仍可逐位置审阅。</span>
          )}
        {result.plans[planIndex].review.length > 8 && (
          <div className="fingering-pages">
            <button
              aria-label="上一页指法难点"
              disabled={!reviewPage}
              onClick={() => setReviewPage(reviewPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {reviewPage + 1} /{" "}
              {Math.ceil(result.plans[planIndex].review.length / 8)}
            </span>
            <button
              aria-label="下一页指法难点"
              disabled={
                (reviewPage + 1) * 8 >= result.plans[planIndex].review.length
              }
              onClick={() => setReviewPage(reviewPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        <CrossHandReviewList
          items={result.plans[planIndex].crossHandReview ?? []}
          title="双手音区交叠"
          disabled={locked || changedCount > 0}
          trackName={trackName}
          choose={(item) => {
            setPreview(item.contextIndex);
            setPreviewSaved(false);
            const row = result.proposals.findIndex(
              (p) => p.track === item.track && p.index === item.index,
            );
            if (row >= 0) setPage(Math.floor(row / 40));
          }}
        />
      </section>
      {changedCount > 0 && (
        <div className="fingering-selection">
          <span>已固定 {changedCount} 个手指；重新计算后才能保存。</span>
          <button disabled={locked} onClick={() => void generate()}>
            按修改重新推荐
          </button>
          <button disabled={locked} onClick={() => setValues({})}>
            放弃未计算的修改
          </button>
        </div>
      )}
      <div className="fingering-selection">
        <label>
          <input
            type="checkbox"
            aria-label="选择全部高评分指法改动"
            disabled={locked || recommendedIndices.length === 0}
            checked={
              recommendedIndices.length > 0 &&
              recommendedIndices.every((index) => accepted.has(index))
            }
            onChange={(e) =>
              setAccepted((current) => {
                const next = new Set(current);
                recommendedIndices.forEach((index) =>
                  e.target.checked ? next.add(index) : next.delete(index),
                );
                return next;
              })
            }
          />
          选择全部高评分改动（{recommendedIndices.length}）
        </label>
        <span>
          已选择 {accepted.size} 个 · 只保存勾选音符，未勾选的位置保留已有标记
        </span>
        {result.proposals.some(
          (proposal) =>
            proposal.confidence < 60 && proposal.saved !== proposal.finger,
        ) && (
          <span role="status">
            {
              result.proposals.filter(
                (proposal) =>
                  proposal.confidence < 60 &&
                  proposal.saved !== proposal.finger,
              ).length
            }{" "}
            个宽和弦或移手等低评分位置需要逐音复核，再手动勾选。
          </span>
        )}
      </div>

      <div className="fingering-table-wrap">
        <table className="fingering-table">
          <thead>
            <tr>
              <th scope="col">接受</th>
              {isBatch && <th scope="col">音轨</th>}
              <th scope="col">小节</th>
              <th scope="col">音符</th>
              <th scope="col">已有</th>
              <th scope="col">建议</th>
              <th scope="col">规则评分</th>
              <th scope="col">原因</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, j) => {
              const i = page * 40 + j;
              return (
                <tr
                  key={positionKey(p)}
                  className={
                    result.context.find(
                      (n) => n.track === p.track && n.index === p.index,
                    )?.onset === result.context[preview]?.onset
                      ? "finger-preview-row"
                      : ""
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`接受${noteLabel(p)} 指法`}
                      disabled={locked}
                      checked={accepted.has(i)}
                      onChange={(e) =>
                        setAccepted((s) => {
                          const next = new Set(s);
                          e.target.checked ? next.add(i) : next.delete(i);
                          return next;
                        })
                      }
                    />
                  </td>
                  {isBatch && <td>{trackName(p.track)}</td>}
                  <td>{p.measure}</td>
                  <td>
                    <button
                      onClick={() => {
                        void api
                          .command({ type: "stopFingerDemo" })
                          .catch((error) => setError(String(error)));
                        setPreview(
                          result.context.findIndex(
                            (n) => n.track === p.track && n.index === p.index,
                          ),
                        );
                      }}
                    >
                      {pitchName(p.pitch)}
                    </button>
                  </td>
                  <td>{p.saved ?? "—"}</td>
                  <td>
                    <select
                      disabled={locked}
                      aria-label={`${noteLabel(p)} 建议手指`}
                      data-finger-position={positionKey(p)}
                      value={values[positionKey(p)] ?? p.finger}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [positionKey(p)]: Number(e.target.value),
                        }))
                      }
                    >
                      {[1, 2, 3, 4, 5].map((f) => (
                        <option value={f} key={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{p.confidence}%</td>
                  <td>{p.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!result.proposals.length && (
          <p>该选段没有可安全推荐的指法。可尝试缩小选段或手动标注。</p>
        )}
      </div>
      <div className="fingering-pages">
        <button
          aria-label="上一页指法"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(result.proposals.length / 40))}
        </span>
        <button
          aria-label="下一页指法"
          disabled={(page + 1) * 40 >= result.proposals.length}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </>
  ) : (
    <div className="fingering-empty">
      先选择推荐条件并生成建议，再查看逐音修改和保存结果。
    </div>
  );
  const acceptanceContent = result ? (
    <>
      <p className="fingering-help">
        当前选择 {accepted.size}{" "}
        个位置。请核对勾选建议与保留指法组合后的结果，再接受并保存。
      </p>
      <section
        className="finger-review finger-acceptance"
        aria-label="指法保存结果审阅"
      >
        <strong>保存后的实际指法</strong>
        {!currentAcceptance && !acceptanceError && (
          <p>
            {hasChanges
              ? "修改手指后，请先重新推荐。"
              : accepted.size
                ? "正在核对勾选建议与保留指法…"
                : "勾选要接受的音符后审阅保存结果。"}
          </p>
        )}
        {acceptanceError && <p role="alert">{acceptanceError}</p>}
        {currentAcceptance && (
          <>
            <p>
              接受 {currentAcceptance.selected} 个 · 保留已有{" "}
              {currentAcceptance.retained} 个 · 未标记{" "}
              {currentAcceptance.unmarked} 个
            </p>
            <p>
              {currentAcceptance.markedSubsetValid
                ? "已标记部分的同时按键检查通过。"
                : "已标记部分存在同时按键冲突。"}{" "}
              {currentAcceptance.fullPassageValidated
                ? "整个选段的指法覆盖与衔接检查通过。"
                : "整个选段仍有未标记音、连线衔接难点或冲突，不能视为完整通过。"}
            </p>
            {currentAcceptance.coverageTotal > 0 && (
              <FingerCoverageReview
                key={currentAcceptance.key}
                notes={currentAcceptance.coverage}
                total={currentAcceptance.coverageTotal}
                truncated={currentAcceptance.coverageTruncated}
                trackName={trackName}
                disabled={locked}
                locate={(note) => {
                  setPreview(note.contextIndex);
                  setPreviewSaved(true);
                  setSection("plans");
                  locateProposal(note);
                }}
                adopt={(n) => {
                  const index = result.proposals.findIndex(
                    (p) => p.track === n.track && p.index === n.index,
                  );
                  if (index >= 0) {
                    setAccepted((current) => new Set([...current, index]));
                    setPreview(n.contextIndex);
                    setPreviewSaved(true);
                    setSection("plans");
                    setPage(Math.floor(index / 40));
                  }
                }}
              />
            )}
            {currentAcceptance.tracks.length > 1 && (
              <div className="finger-batch-summary">
                {currentAcceptance.tracks.map((summary) => {
                  const high = recommendedByTrack.get(summary.track) ?? [];
                  const allHighSelected =
                    high.length > 0 &&
                    high.every((index) => accepted.has(index));
                  return (
                    <div key={summary.track}>
                      <strong>{trackName(summary.track)}</strong>
                      <span>
                        范围内 {summary.total} 个 · 接受 {summary.selected} 个 ·
                        保留 {summary.retained} 个 · 未标记 {summary.unmarked}{" "}
                        个 · 新标记 {summary.new} 个 · 改已有 {summary.changed}{" "}
                        个
                      </span>
                      <button
                        disabled={locked || high.length === 0}
                        onClick={() =>
                          setAccepted((current) => {
                            const next = new Set(current);
                            high.forEach((index) =>
                              allHighSelected
                                ? next.delete(index)
                                : next.add(index),
                            );
                            return next;
                          })
                        }
                      >
                        {allHighSelected
                          ? "取消该轨高评分选择"
                          : `选择该轨高评分改动（${high.length}）`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p>
              检查所选手在各音轨的同时按键及已标记位置。未标记位置仍无指法，不会填入未勾选的建议。
            </p>
            {currentAcceptance.contextUnmarked > 0 && (
              <p>
                同手其他音轨在本选段还有 {currentAcceptance.contextUnmarked}{" "}
                个未标记位置；未保存的参考指法不能保证实际衔接。
              </p>
            )}
            {!currentAcceptance.valid && (
              <p role="alert">
                勾选建议与保留指法发生冲突，这笔推荐不能保存。请调整选择，或固定已有指法重新推荐。
              </p>
            )}
            {currentAcceptance.conflicts
              .slice(acceptancePage * 8, (acceptancePage + 1) * 8)
              .map((r, i) => (
                <button
                  key={i}
                  disabled={locked}
                  onClick={() => {
                    stopPreview();
                    setPreview(r.contextIndex);
                    setPreviewSaved(true);
                    setSection("plans");
                    const position = result.context[r.contextIndex];
                    const row = result.proposals.findIndex(
                      (p) =>
                        p.track === position?.track &&
                        p.index === position?.index,
                    );
                    if (row >= 0) setPage(Math.floor(row / 40));
                  }}
                >
                  <span>
                    {trackName(r.fromTrack)} 第 {r.fromMeasure} 小节{" "}
                    {pitchName(r.fromPitch)}（{r.fromFinger} 指）与{" "}
                    {trackName(r.track)} 第 {r.measure} 小节{" "}
                    {pitchName(r.pitch)}（{r.finger} 指）
                  </span>
                  <strong>{r.reason}</strong>
                </button>
              ))}
            {currentAcceptance.conflicts.length > 8 && (
              <div className="fingering-pages">
                <button
                  aria-label="上一页保存冲突"
                  disabled={!acceptancePage}
                  onClick={() => setAcceptancePage(acceptancePage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {acceptancePage + 1} /{" "}
                  {Math.ceil(currentAcceptance.conflicts.length / 8)}
                </span>
                <button
                  aria-label="下一页保存冲突"
                  disabled={
                    (acceptancePage + 1) * 8 >=
                    currentAcceptance.conflicts.length
                  }
                  onClick={() => setAcceptancePage(acceptancePage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            {currentAcceptance.truncated && (
              <p>冲突较多，目前显示前 100 处；调整后重新检查。</p>
            )}
            {currentAcceptance.valid && (
              <p>
                勾选指法与已标记位置没有发现同时按键冲突。实际保存结果还有{" "}
                {currentAcceptance.review.length +
                  currentAcceptance.expressionReview.length +
                  (currentAcceptance.crossHandReview?.length ?? 0)}{" "}
                处跨度、连线衔接、快速换指或双手交叠需要复核；原方案的难点不代替局部保存结果。
              </p>
            )}
            {currentAcceptance.valid && currentAcceptance.review.length > 0 && (
              <FingerPracticeBuilder
                song={song}
                key={currentAcceptance.key}
                review={currentAcceptance.review}
                rate={result.plans[planIndex].practiceRate}
                hand={hand}
                request={result.request}
                fingerprint={result.fingerprint}
                measures={song.measures.length}
                disabled={locked || changedCount > 0}
                changed={changed}
              />
            )}
            {currentAcceptance.valid &&
              currentAcceptance.review
                .slice(acceptancePage * 8, (acceptancePage + 1) * 8)
                .map((r, i) => (
                  <button
                    key={i}
                    disabled={locked}
                    onClick={() => {
                      stopPreview();
                      setPreview(r.contextIndex);
                      setPreviewSaved(true);
                      setSection("plans");
                    }}
                  >
                    <span>
                      第 {r.measure} 小节 · {pitchName(r.fromPitch)} →{" "}
                      {pitchName(r.pitch)}
                    </span>
                    <strong>
                      {r.kind === "wideReach"
                        ? `跨度 ${r.semitones} 半音，当前手型 ${r.comfortableSemitones} 半音`
                        : `换指需复核 · ${r.intervalMs} 毫秒`}
                    </strong>
                  </button>
                ))}
            {currentAcceptance.valid && currentAcceptance.review.length > 8 && (
              <div className="fingering-pages">
                <button
                  aria-label="上一页保存难点"
                  disabled={!acceptancePage}
                  onClick={() => setAcceptancePage(acceptancePage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {acceptancePage + 1} /{" "}
                  {Math.ceil(currentAcceptance.review.length / 8)}
                </span>
                <button
                  aria-label="下一页保存难点"
                  disabled={
                    (acceptancePage + 1) * 8 >= currentAcceptance.review.length
                  }
                  onClick={() => setAcceptancePage(acceptancePage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            {currentAcceptance.expressionReview.length > 0 && (
              <p>
                谱面连线复核：请检查保存后的两音是否能连贯弹奏。点击一处可定位到后一个音。
              </p>
            )}
            {currentAcceptance.expressionReview
              .slice(expressionPage * 8, (expressionPage + 1) * 8)
              .map((item) => (
                <button
                  key={`${item.fromTrack}:${item.fromIndex}:${item.track}:${item.index}`}
                  disabled={locked}
                  onClick={() => {
                    stopPreview();
                    setPreview(item.contextIndex);
                    setPreviewSaved(true);
                    setSection("plans");
                    const row = result.proposals.findIndex(
                      (p) => p.track === item.track && p.index === item.index,
                    );
                    if (row >= 0) setPage(Math.floor(row / 40));
                  }}
                >
                  <span>
                    {trackName(item.fromTrack)}第 {item.fromMeasure} 小节{" "}
                    {pitchName(item.fromPitch)}（{item.fromFinger} 指）
                    {" → "}
                    {trackName(item.track)}第 {item.measure} 小节{" "}
                    {pitchName(item.pitch)}（{item.finger} 指）
                  </span>
                  <strong>{item.reason}</strong>
                </button>
              ))}
            {currentAcceptance.expressionReview.length > 8 && (
              <div className="fingering-pages">
                <button
                  aria-label="上一页连线复核"
                  disabled={!expressionPage}
                  onClick={() => setExpressionPage(expressionPage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {expressionPage + 1} /{" "}
                  {Math.ceil(currentAcceptance.expressionReview.length / 8)}
                </span>
                <button
                  aria-label="下一页连线复核"
                  disabled={
                    (expressionPage + 1) * 8 >=
                    currentAcceptance.expressionReview.length
                  }
                  onClick={() => setExpressionPage(expressionPage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            {currentAcceptance.expressionReviewTruncated && (
              <p>
                连线复核超过 100 处，目前列出前 100 处。请缩小小节范围继续核对。
              </p>
            )}
            <CrossHandReviewList
              items={currentAcceptance.crossHandReview ?? []}
              title="保存后双手音区交叠"
              disabled={locked}
              trackName={trackName}
              choose={(item) => {
                setPreview(item.contextIndex);
                setPreviewSaved(true);
                setSection("plans");
              }}
            />
            {currentAcceptance.reviewTruncated && (
              <p>保存难点较多，目前列出前 100 处；可缩小选段继续审阅。</p>
            )}
            {!currentAcceptance.valid && (
              <button
                disabled={locked}
                onClick={() => {
                  setKeepSaved(true);
                  setValues({});
                  setResult(null);
                }}
              >
                固定已有指法后重新选择建议
              </button>
            )}
            {(currentAcceptance.selected < currentAcceptance.total ||
              currentAcceptance.contextUnmarked > 0) && (
              <label className="finger-anchor-toggle">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={locked || !currentAcceptance.valid}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                已审阅保留指法和未标记位置，只保存勾选音符
              </label>
            )}
          </>
        )}
      </section>
    </>
  ) : (
    <div className="fingering-empty">
      先选择推荐条件并生成建议，再查看逐音修改和保存结果。
    </div>
  );
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        ref={root}
        className="settings-dialog fingering-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fingering-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="fingering-title">指法建议</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            disabled={busy}
            aria-label="关闭指法建议"
            onClick={() => {
              if (!busy) close();
            }}
          >
            <X size={18} />
          </button>
        </div>
        {pair && (
          <FingerPairDialog
            song={song}
            start={first}
            end={last}
            close={() => setPair(false)}
            changed={async () => {
              setResult(null);
              await changed();
            }}
          />
        )}
        <PracticeEditTaskActivity contentId={song.contentId} />
        <div {...detailScroll} className="fingering-workspace-body">
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          {pendingRefresh && (
            <p role="status">
              {pendingRefresh === "saved"
                ? "指法已保存。"
                : pendingRefresh === "undone"
                  ? "上次指法修改已撤销。"
                  : pendingRefresh === "saving"
                    ? "上次保存的结果尚未确认。请读取实际指法后继续。"
                    : "上次撤销的结果尚未确认。请读取实际指法后继续。"}
              <button disabled={busy} onClick={() => void retryRefresh()}>
                重试读取实际指法
              </button>
            </p>
          )}

          <BrowseDetailWorkspace<FingeringSection>
            value={section}
            change={setSection}
            label="指法工作区分类"
            header={
              <>
                <h3 className="browse-detail-heading">
                  {trackName(track)} · {hand === "left" ? "左手" : "右手"}
                </h3>
                <p className="browse-detail-subtitle">
                  {scope === "note" && note
                    ? `所选音符 ${note.index + 1}`
                    : `第 ${first}–${last} 小节`}{" "}
                  · {Math.round(practiceRate * 100)}% 原速
                  {result && (
                    <>
                      {" "}
                      · {result.proposals.length} 个建议 · 已选择{" "}
                      {accepted.size} 个
                    </>
                  )}
                </p>
                <div className="browse-detail-actions">
                  <button
                    className="primary"
                    disabled={locked || !rangeValid || !playable.length}
                    onClick={() => {
                      void generate();
                    }}
                  >
                    {busy
                      ? "正在处理…"
                      : hasChanges
                        ? "按修改重新推荐"
                        : result
                          ? "重新生成建议"
                          : "生成建议"}
                  </button>
                  {openWorkbench && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        captureWorkbench();
                        openWorkbench();
                      }}
                    >
                      {workbenchState.error ? "暂存需处理" : "指法工作台"}
                    </button>
                  )}
                </div>
              </>
            }
            sections={[
              { id: "setup", label: "推荐条件", content: setupContent },
              {
                id: "plans",
                label: "建议与逐音",
                count: result?.proposals.length,
                content: plansContent,
              },
              {
                id: "acceptance",
                label: "保存前核对",
                count: accepted.size || undefined,
                content: acceptanceContent,
              },
            ]}
          />
        </div>
        <div className="dialog-actions">
          <button
            disabled={busy || !!pendingRefresh}
            onClick={() =>
              void perform(async () => {
                receiptSource.current = sourceVersion;
                drafts.remember(buildDraft("undoing"), null);
                setPendingRefresh("undoing");
                await api.editPractice(song, {
                  type: "undoFingersFor",
                  content_id: song.contentId,
                });
                receiptSource.current = sourceVersion;
                const receipt = buildDraft("undone");
                drafts.remember(receipt, null);
                setPendingRefresh("undone");
                setResult(null);
                try {
                  await refreshActual();
                  drafts.remove(fingeringDraftId(receipt));
                  setPendingRefresh(null);
                } catch (cause) {
                  setError(
                    `上次指法修改已撤销，但界面刷新失败：${String(cause)}。请只重试读取，不要再次撤销。`,
                  );
                }
              })
            }
          >
            撤销上次指法修改
          </button>
          <span className="menu-spacer" />
          <button
            disabled={busy}
            onClick={() => {
              if (!busy) close();
            }}
          >
            关闭并保留输入
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              !!pendingRefresh ||
              !result ||
              (section === "acceptance" &&
                (!accepted.size ||
                  !currentAcceptance?.valid ||
                  ((currentAcceptance.selected < currentAcceptance.total ||
                    currentAcceptance.contextUnmarked > 0) &&
                    !acknowledged) ||
                  changedCount > 0))
            }
            onClick={() => {
              if (section === "acceptance") void apply();
              else setSection("acceptance");
            }}
          >
            {section === "acceptance"
              ? `接受并保存 ${accepted.size || ""}`
              : "查看保存结果"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CrossHandReviewList({
  items,
  title,
  disabled,
  trackName,
  choose,
}: {
  items: CrossHandReview[];
  title: string;
  disabled: boolean;
  trackName: (track: number) => string;
  choose: (item: CrossHandReview) => void;
}) {
  const [page, setPage] = useState(0);
  if (!items.length) return null;
  return (
    <div className="finger-review">
      <strong>
        {title} · {items.length} 处
      </strong>
      <p>
        两手在同一时段按同键，或左手音高超过右手时，请检查分手与手位。对侧未保存的手指会标为临时建议。
      </p>
      {items.length >= 100 && (
        <p>这里最多列出 100 处。请缩小小节范围，查看其余位置。</p>
      )}
      {items.slice(page * 8, (page + 1) * 8).map((item) => (
        <button
          key={`${item.track}:${item.index}:${item.oppositeTrack}:${item.oppositeIndex}`}
          disabled={disabled}
          onClick={() => choose(item)}
        >
          <span>
            {trackName(item.track)}第 {item.measure} 小节{" "}
            {pitchName(item.pitch)}（{item.finger} 指） 与{" "}
            {trackName(item.oppositeTrack)}第 {item.oppositeMeasure} 小节{" "}
            {pitchName(item.oppositePitch)}（{item.oppositeFinger} 指
            {item.oppositeSaved ? "，已保存" : "，临时建议"}）
          </span>
          <strong>
            {item.kind === "sameKey"
              ? "双手同时占用同一琴键"
              : "左右手音区交叉"}{" "}
            · 重叠 {item.overlapMs} 毫秒
          </strong>
          <small>
            打开这个位置，检查谱面分手；必要时修改指法或重新分配声部。
          </small>
        </button>
      ))}
      {items.length > 8 && (
        <div className="fingering-pages">
          <button
            aria-label={`上一页${title}`}
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {page + 1} / {Math.ceil(items.length / 8)}
          </span>
          <button
            aria-label={`下一页${title}`}
            disabled={(page + 1) * 8 >= items.length}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function FingerPosition({
  song,
  result,
  plan,
  preview,
  setPreview,
  hand,
  disabled,
  previewFingers,
  resetKey,
}: {
  song: LoadedSong;
  result: Result;
  plan: Plan;
  preview: number;
  setPreview: (n: number) => void;
  hand: string;
  disabled: boolean;
  previewFingers?: (number | null)[];
  resetKey?: number;
}) {
  const [demoTime, setDemoTime] = useState<number | null>(null);
  const [demonstrating, setDemonstrating] = useState(false);
  const context = result.context;
  const selected = context[Math.min(preview, Math.max(0, context.length - 1))];
  const targetOnset = useMemo(
    () => context.find((position) => position.target)?.onset,
    [context],
  );
  const firstTarget = targetOnset ?? selected?.onset ?? 0;
  const currentContext = useMemo(
    () =>
      context.map((note, index) => ({
        ...note,
        finger: previewFingers
          ? previewFingers[index]
          : plan?.contextFingers[index],
        part: hand,
      })),
    [context, previewFingers, plan?.contextFingers, hand],
  );
  const oppositeContext = useMemo(
    () =>
      (result.oppositeContext ?? []).map((note, index) => ({
        ...note,
        finger: previewFingers
          ? note.saved
          : (plan?.oppositeContextFingers?.[index] ?? note.saved),
        tentative:
          !previewFingers &&
          note.saved == null &&
          plan?.oppositeContextFingers?.[index] != null,
        part: hand === "left" ? "right" : "left",
      })),
    [
      result.oppositeContext,
      previewFingers,
      plan?.oppositeContextFingers,
      hand,
    ],
  );
  const demoKeyboardContext = useMemo(
    () =>
      context.filter(
        (note) =>
          note.target ||
          note.track !== result.request.track ||
          (note.onset < firstTarget && note.end > firstTarget),
      ),
    [context, result.request.track, firstTarget],
  );
  const groups = useMemo(
    () =>
      context.flatMap((note, index) =>
        index === 0 || note.onset !== context[index - 1].onset ? [index] : [],
      ),
    [context],
  );
  if (!plan || !selected) return null;
  const onset = demoTime ?? selected.onset;
  const activeCurrent = currentContext.filter(
    (note) =>
      ((note.onset <= onset && note.end > onset) || note.onset === onset) &&
      (demoTime === null ||
        note.target ||
        note.track !== result.request.track ||
        note.onset < firstTarget),
  );
  const activeOpposite = oppositeContext.filter(
    (note) => (note.onset <= onset && note.end > onset) || note.onset === onset,
  );
  const active = [...activeCurrent, ...activeOpposite];
  const keyboardNotes =
    demoTime !== null
      ? [...demoKeyboardContext, ...activeOpposite]
      : active.length
        ? active
        : [selected];
  let lowestPitch = keyboardNotes[0]?.pitch ?? selected.pitch;
  let highestPitch = lowestPitch;
  for (const note of keyboardNotes) {
    lowestPitch = Math.min(lowestPitch, note.pitch);
    highestPitch = Math.max(highestPitch, note.pitch);
  }
  const low = Math.max(21, Math.floor(lowestPitch / 12) * 12);
  const high = Math.min(
    108,
    Math.max(low + 12, Math.ceil(highestPitch / 12) * 12),
  );
  const black = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
  const whites = Array.from(
    { length: high - low + 1 },
    (_, i) => low + i,
  ).filter((p) => !black(p));
  const width = 36;
  const x = (p: number) =>
    black(p)
      ? whites.filter((w) => w < p).length * width - 11
      : whites.indexOf(p) * width;
  const at = groups.findIndex((i) => context[i].onset === selected.onset);
  return (
    <div className="finger-position" tabIndex={-1}>
      <div>
        <strong>
          {previewFingers ? "保存结果手位" : "推荐方案手位"} ·{" "}
          {hand === "left" ? "左手" : "右手"} · 第 {selected.measure} 小节
        </strong>
        <button
          disabled={demonstrating || at <= 0}
          onClick={() => {
            setDemoTime(null);
            setPreview(groups[at - 1]);
          }}
        >
          上一个位置
        </button>
        <span>
          {at + 1} / {groups.length}
        </span>
        <button
          disabled={demonstrating || at >= groups.length - 1}
          onClick={() => {
            setDemoTime(null);
            setPreview(groups[at + 1]);
          }}
        >
          下一个位置
        </button>
      </div>
      <FingerDemoControls
        resetKey={resetKey}
        song={song}
        result={result}
        plan={plan}
        time={setDemoTime}
        active={setDemonstrating}
        move={setPreview}
        disabled={disabled || !!previewFingers}
      />
      <svg
        viewBox={`-2 -2 ${Math.max(width * whites.length, 72) + 4} 116`}
        role="img"
        aria-label="当前和弦及仍按住的音符指法"
      >
        {[false, true].flatMap((b) =>
          Array.from({ length: high - low + 1 }, (_, i) => low + i)
            .filter((p) => black(p) === b)
            .map((p) => {
              const keyNotes = active.filter((n) => n.pitch === p);
              const n = keyNotes[0];
              const label = [
                ...new Set(
                  keyNotes.map(
                    (n) =>
                      `${n.part === "left" ? "L" : "R"}${n.finger ?? "·"}${"tentative" in n && n.tentative ? "*" : ""}`,
                  ),
                ),
              ].join("/");
              return (
                <g key={p}>
                  <rect
                    x={x(p)}
                    y={0}
                    width={b ? 22 : width}
                    height={b ? 68 : 104}
                    rx={2}
                    fill={
                      n
                        ? n.part === "left"
                          ? "#639bec"
                          : "#69c5a3"
                        : b
                          ? "#252a32"
                          : "#dedfdc"
                    }
                    stroke="#171b21"
                    strokeWidth={1}
                  />
                  {n && (
                    <text
                      x={x(p) + (b ? 11 : 18)}
                      y={b ? 48 : 86}
                      textAnchor="middle"
                      fill="#111820"
                      fontSize={label.length > 1 ? 12 : 17}
                      fontWeight={700}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            }),
        )}
      </svg>
      <small>
        键上 L/R 表示左/右手，数字为手指，* 表示对侧尚未保存的临时建议
        {previewFingers
          ? "，· 表示仍未标记；当前显示保存后的实际组合。切回完整推荐方案可示范声音。"
          : "；当前显示完整推荐方案。"}
        显示本次发音和仍在按住的音符。
      </small>
    </div>
  );
}
