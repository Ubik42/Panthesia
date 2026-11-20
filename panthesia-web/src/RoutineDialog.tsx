import { expressionInputs, parseExpressionInputs, type ExpressionInputs } from "./features/practice/expressionDraft";
import { requireValue } from "./engine/requireValue";
import { TaskActivity } from "./engine/TaskActivity";
import { WorkspaceReadStatus } from "./app/WorkspaceReadStatus";
import { PassageSequenceDialog } from "./PassageSequenceDialog";
import {
  ExpressionGoalControl,
  expressionGoalText,
} from "./ExpressionGoalControl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BrowseDetailWorkspace } from "./app/BrowseDetailWorkspace";
import { BrowsePaneNavigation } from "./app/BrowsePaneNavigation";
import { useBrowsePane } from "./app/useBrowsePane";
import { useBrowseScroll } from "./app/useBrowseScroll";
import type { RoutineDetailSection } from "./features/routines/routineWorkbenchStore";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import {
  createRoutineWorkbenchStore,
  routineContextKey,
  routineItemKey,
  routineValue,
  type RoutineWorkbenchStore,
  type RoutineItemDraft,
  type RoutineMetaDraft,
  type RoutinePending,
  type RoutineScheduleDraft,
} from "./features/routines/routineWorkbenchStore";
import type {
  RoutineVersion,
  RoutineChange,
} from "./engine/commands.generated";
import "./features/routines/routineWorkbench.css";
import { RoutineDraftShelf } from "./features/routines/RoutineDraftShelf";
import { useRoutineService } from "./features/routines/useRoutineService";
import { RoutineGoalEditor } from "./features/routines/RoutineGoalEditor";
import { RoutinePlanList } from "./features/routines/RoutinePlanList";
import { RoutineSourcePicker } from "./features/routines/RoutineSourcePicker";
import { RoutineLadderGoalSummary } from "./features/routines/RoutineLadderGoalSummary";
import {
  hasRoutineGoalInputDraft,
  readRoutineGoalInput,
  routineGoalInputErrors,
  routineGoalInputs,
  type RoutineGoalField,
  type RoutineGoalInputs,
} from "./features/routines/routineGoalInputs";
import { WeakPracticePanel } from "./WeakPracticePanel";
import {
  RoutineScheduleEditor,
  scheduleText,
  type RoutineSchedule,
} from "./RoutineScheduleEditor";
import {
  type Snapshot,
  type LoadedSong,
  type SongRow,
  type LadderPreset,
  type CollectionSong,
} from "./api";
import type {
  RoutineGoal,
  RoutineState,
  RoutineItem as Item,
  RoutinePlan as Plan,
  RoutineRun as Run,
} from "./features/routines/routineTypes";
export type {
  RoutineGoal,
  RoutineState,
} from "./features/routines/routineTypes";
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const modes: Record<string, string> = {
  wait: "等音",
  flow: "连续",
  recital: "完整演奏",
  memory: "背谱",
};
const range = (item: Item) =>
  item.target.kind === "whole"
    ? "全曲"
    : item.target.kind === "ladder"
      ? `阶梯 · 第 ${item.target.preset?.start}–${item.target.preset?.end} 小节`
      : item.target.kind === "scorePassage" ||
          item.target.kind === "precisePassage"
        ? (item.target.range?.description ?? "原谱选段")
        : `第 ${item.target.start}–${item.target.end} 小节`;
export function RoutineStatus({
  state,
  manage,
  next,
  end,
  disabled = false,
  resume,
}: {
  state: Pick<Snapshot, "routine" | "ladder" | "speed" | "mode">;
  manage: () => void;
  next: (r: RoutineState) => void;
  end: () => void;
  disabled?: boolean;
  resume?: (state: RoutineState) => void;
}) {
  const r = state.routine;
  if (!r) return null;
  const ladder = r.kind === "ladder" ? state.ladder : null;
  const required = Math.max(
    1,
    ladder?.preset.plan.passesRequired ?? r.goal.passes,
  );
  const achieved = r.progress.completed
    ? required
    : (ladder?.progress.successStreak ??
      (r.goal.consecutive ? r.progress.streak : r.progress.passed));
  return (
    <div className="routine-status" aria-live="polite">
      <div>
        <strong>
          {r.title} · {r.day}
        </strong>
        <span>
          {r.index}/{r.total} · {r.itemTitle} ·{" "}
          {r.progress.completed
            ? "本项已达标"
            : r.progress.skipped
              ? "本项已跳过"
              : r.progress.limited
                ? "本次轮数到上限"
                : r.kind === "ladder" && state.ladder
                  ? `当前速度 ${Math.round(state.speed * 100)}% · 本级 ${state.ladder.progress.successStreak}/${state.ladder.preset.plan.passesRequired} 轮 · 已练 ${r.progress.attempts} 轮`
                  : `达标 ${r.goal.consecutive ? r.progress.streak : r.progress.passed}/${r.goal.passes} 次 · 已练 ${r.progress.attempts} 轮`}
        </span>
        {r.goal.expression && (
          <span className="routine-expression-target">
            要求：{expressionGoalText(r.goal.expression)}
          </span>
        )}
        {r.progress.lastResult && (
          <span className="routine-last-result">
            上一轮：{r.progress.lastResult}
          </span>
        )}
        {r.notes && (
          <span className="routine-status-notes" title={r.notes}>
            {r.notes}
          </span>
        )}
        <progress
          max={required}
          value={Math.min(required, Math.max(0, achieved))}
          aria-label={ladder ? "当前速度级别达标进度" : "当前项目达标进度"}
          aria-valuetext={`已达标 ${achieved} 次，目标 ${required} 次`}
        />
      </div>
      <button disabled={disabled} onClick={manage}>
        查看安排
      </button>
      {r.progress.limited && resume && (
        <button
          disabled={disabled}
          title="保留已有进度，重新开始本次轮数计数。"
          onClick={() => resume(r)}
        >
          继续本项练习
        </button>
      )}
      <button
        disabled={disabled || !r.progress.completed || !r.nextItemId}
        title={
          !r.nextItemId
            ? "后面没有可继续的项目，可以查看安排。"
            : !r.progress.completed
              ? "本项达标后可打开下一项。"
              : undefined
        }
        onClick={() => next(r)}
      >
        打开下一项
      </button>
      <button disabled={disabled} onClick={end}>
        结束本项
      </button>
    </div>
  );
}
export function RoutineDialog({
  engineId,
  initialPlan,
  session,
  initialPassage,
  suspended,
  resumeRevision,
  song,
  songs,
  collection,
  state,
  close: dismissDialog,
  changed,
  backup,
  openLibrary,
}: {
  engineId?: string;
  initialPlan?: { id: string; day: string | null } | null;
  session?: RoutineWorkbenchStore;
  initialPassage?: {
    contentId: string;
    id: string;
    name: string;
    notes: string;
  } | null;
  suspended: boolean;
  resumeRevision: number;
  song: LoadedSong | null;
  songs: SongRow[];
  collection: CollectionSong[];
  state: Pick<Snapshot, "routine" | "ladder" | "speed" | "mode">;
  close: () => void;
  changed: () => Promise<void>;
  backup: () => void;
  openLibrary: (focus: "missing" | "review") => void;
}) {
  const service = useRoutineService(engineId);
  const refreshPractice = async () => {
    service.assertCurrent();
    await changed();
    service.assertCurrent();
  };
  const [ownSession] = useState(() => session ?? createRoutineWorkbenchStore());
  const drafts = session ?? ownSession;
  const workbench = useSyncExternalStore(
    drafts.subscribe,
    drafts.getSnapshot,
    drafts.getSnapshot,
  );
  const [initialBrowse] = useState(() =>
    !initialPlan && !initialPassage && !state.routine
      ? drafts.getSnapshot().browse
      : null,
  );
  const initialDay =
    initialPlan?.day ?? state.routine?.day ?? initialBrowse?.day ?? localDay();
  const initialTemplate = initialPlan
    ? initialPlan.day === null
    : (initialBrowse?.template ?? false);
  const restoreBrowseItems =
    initialTemplate || initialBrowse?.day === initialDay;
  const initialSelected =
    initialPlan?.id ??
    state.routine?.routineId ??
    initialBrowse?.selected ??
    null;
  const initialContext = {
    routineId: initialSelected,
    day: initialTemplate ? null : initialDay,
  };
  const [restoredMeta] = useState(
    () => drafts.getSnapshot().metadata[routineContextKey(initialContext)],
  );
  const [restoredPending] = useState(
    () => drafts.getSnapshot().pending[routineContextKey(initialContext)],
  );
  const [restoredItem] = useState(() =>
    initialPassage
      ? undefined
      : Object.values(drafts.getSnapshot().items).find(
          (draft) =>
            draft.routineId === initialSelected &&
            draft.day === initialContext.day &&
            draft.token ===
              ((restoreBrowseItems ? initialBrowse?.itemToken : null) ??
                state.routine?.itemId),
        ),
  );
  const dialogRef = useRef<HTMLElement>(null);
  const panes = useBrowsePane(
    initialBrowse?.pane ?? (initialSelected ? "detail" : "list"),
  );
  const attachDialog = useCallback(
    (node: HTMLElement | null) => {
      dialogRef.current = node;
      panes.attach(node);
    },
    [panes.attach],
  );
  const [detailSection, setDetailSection] = useState<RoutineDetailSection>(
    initialBrowse?.detailSection ?? (initialSelected ? "items" : "metadata"),
  );
  const [planQuery, setPlanQuery] = useState(initialBrowse?.planQuery ?? "");
  const [planPage, setPlanPage] = useState(initialBrowse?.planPage ?? 0);
  const itemEditor = useRef<HTMLDivElement>(null);
  const [editorRequest, setEditorRequest] = useState(0);
  const focusedEditorRequest = useRef(0);
  const scrollPositions = useRef(new Map<string, number>());
  const wasSuspended = useRef(suspended);
  const launchSource =
    initialPassage?.contentId === song?.contentId ? initialPassage : null;
  const [day, setDay] = useState(() => initialDay),
    [template, setTemplate] = useState(initialTemplate),
    [plans, setPlans] = useState<Plan[]>([]),
    [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSelected),
    [name, setName] = useState(
      restoredMeta?.name ?? state.routine?.title ?? "",
    ),
    [notes, setNotes] = useState(restoredMeta?.notes ?? "");
  const [itemId, setItemId] = useState<string | null>(
      restoredItem?.itemId ??
        (launchSource
          ? null
          : (state.routine?.itemId ??
            (restoreBrowseItems ? initialBrowse?.itemId : null) ??
            null)),
    ),
    [title, setTitle] = useState(
      restoredItem?.title ??
        launchSource?.name ??
        state.routine?.itemTitle ??
        "",
    ),
    [requirement, setRequirement] = useState(
      restoredItem?.notes ?? launchSource?.notes ?? state.routine?.notes ?? "",
    ),
    [source, setSource] = useState(
      restoredItem?.source ??
        (launchSource
          ? `passage:${launchSource.id}`
          : state.routine
            ? ""
            : "current"),
    ),
    [sourceContentId, setSourceContentId] = useState(
      restoredItem?.sourceContentId ?? song?.contentId ?? null,
    ),
    [launchPending, setLaunchPending] = useState(!!launchSource);
  const [goal, setGoal] = useState<RoutineGoal>(
    restoredItem?.goal ??
      (!launchSource ? state.routine?.goal : null) ?? {
        passes: 1,
        accuracy: 90,
        onTime: null,
        consecutive: false,
        attemptLimit: 20,
      },
  );
  const [passages, setPassages] = useState<{ id: string; name: string }[]>([]),
    [ladders, setLadders] = useState<LadderPreset[]>([]),
    [sourceLoading, setSourceLoading] = useState(!!song),
    [sourceSongId, setSourceSongId] = useState<string | null>(null),
    [sourceReloadRevision, setSourceReloadRevision] = useState(0);
  const [goalInput, setGoalInput] = useState<RoutineGoalInputs>(
    restoredItem?.goalInput ?? routineGoalInputs(goal),
  );
  const [expressionInput, setExpressionInput] = useState<ExpressionInputs>(restoredItem?.expressionInput ?? expressionInputs(goal.expression));
  const replaceGoal = (value: RoutineGoal, input?: RoutineGoalInputs, expressionRaw?: ExpressionInputs) => {
    setGoal(value);
    setGoalInput(input ?? routineGoalInputs(value));
    setExpressionInput(expressionRaw ?? expressionInputs(value.expression));
  };
  const changeGoalInput = (field: RoutineGoalField, text: string) => {
    setGoalInput((current) => ({ ...current, [field]: text }));
    const value = readRoutineGoalInput(field, text);
    if (value !== null) setGoal((current) => ({ ...current, [field]: value }));
  };
  const [compose, setCompose] = useState(false);
  const [skipReason, setSkipReason] = useState(restoredItem?.skipReason ?? "");
  const [search, setSearch] = useState(initialBrowse?.search ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [openedItem, setOpenedItem] = useState<{
      id: string;
      title: string;
      confirmed: boolean;
    } | null>(
      restoredPending?.kind === "open" && restoredPending.itemId
        ? {
            id: restoredPending.itemId,
            title: restoredPending.title,
            confirmed: restoredPending.confirmed,
          }
        : null,
    ),
    [pendingListRefresh, setPendingListRefresh] = useState<string | null>(
      restoredPending?.kind === "list" ? restoredPending.label : null,
    );
  const working = useRef(false);
  const draftItemId = useRef<string | null>(
    restoredItem?.itemId ? null : (restoredItem?.token ?? null),
  );
  const draftPlanRequest = useRef<string | null>(
    restoredMeta?.requestId ?? null,
  );
  const copyPlanRequest = useRef<string | null>(
    restoredMeta?.copyRequest ?? null,
  );
  const [versions, setVersions] = useState<RoutineVersion[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const metaBase = useRef({
    key: routineContextKey(initialContext),
    base: restoredMeta?.base ?? JSON.stringify([name, notes]),
    revision: restoredMeta?.revision ?? (null as string | null),
    initialized: !!restoredMeta,
  });
  const itemBase = useRef({
    context: routineContextKey(initialContext),
    itemId,
    base: restoredItem?.base ?? "null",
    revision: restoredItem?.revision ?? (null as string | null),
    initialized: !!restoredItem,
  });
  const listReadGeneration = useRef(0);
  const [listReadChannel] = useState(() => crypto.randomUUID());
  const [loadedDay, setLoadedDay] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listVerified, setListVerified] = useState(false);
  const [listError, setListError] = useState("");
  const [listReadAt, setListReadAt] = useState<number | null>(null);
  const previousSongId = useRef(song?.contentId);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listReadGeneration.current++;
    };
  }, []);
  const dayRuns = useMemo(
    () => (loadedDay === day ? runs.filter((run) => run.day === day) : []),
    [loadedDay, day, runs],
  );
  const listReady = loadedDay === day && !listLoading && listVerified;
  const run = dayRuns.find((r) => r.routine.id === selected),
    plan = template
      ? plans.find((p) => p.id === selected)
      : (run?.routine ?? plans.find((p) => p.id === selected));
  const editDay = template ? null : day,
    active = Boolean(
      state.routine &&
      state.routine.routineId === selected &&
      state.routine.day === day &&
      !template,
    ),
    locked =
      busy || active || !!openedItem || !!pendingListRefresh || !listReady,
    contextPending = !!openedItem || !!pendingListRefresh,
    sourceBusy = sourceLoading && source !== "" && source !== "current",
    sourcePinned = !!source && sourceContentId !== song?.contentId,
    sourceAvailable =
      !sourcePinned &&
      (source === "" ||
        source === "current" ||
        (sourceSongId === song?.contentId &&
          (source.startsWith("passage:")
            ? passages.some((item) => item.id === source.slice(8))
            : source.startsWith("ladder:") &&
              ladders.some((item) => item.id === source.slice(7)))));
  const progress = (id: string) =>
    state.routine?.routineId === selected &&
    state.routine.day === day &&
    state.routine.itemId === id
      ? state.routine.progress
      : run?.progress[id];
  const currentItem = plan?.items.find((i) => i.id === itemId),
    launchPassage = launchPending ? launchSource : null,
    ladderItem =
      source.startsWith("ladder:") ||
      (source === "" && currentItem?.target.kind === "ladder");
  const selectedLadder = source.startsWith("ladder:")
    ? ladders.find((preset) => preset.id === source.slice(7))
    : source === "" && currentItem?.target.kind === "ladder"
      ? currentItem.target.preset
      : undefined;
  const context = { routineId: selected, day: editDay };
  const contextKey = routineContextKey(context);
  const detailScroll = useBrowseScroll<HTMLDivElement>(
    JSON.stringify([contextKey, detailSection]),
    listReady && panes.detailVisible,
    0,
    () => {},
    scrollPositions.current,
  );
  const planScroll = useBrowseScroll<HTMLElement>(
    JSON.stringify(["plans", template, day, planQuery, planPage]),
    listReady && panes.listVisible,
    0,
    () => {},
    scrollPositions.current,
  );
  useLayoutEffect(() => {
    if (
      !editorRequest ||
      focusedEditorRequest.current === editorRequest ||
      !listReady ||
      !panes.detailVisible ||
      detailSection !== "items"
    )
      return;
    const node = itemEditor.current;
    const input = node?.querySelector<HTMLInputElement>("input:not(:disabled)");
    if (!node?.getClientRects().length || !input) return;
    if (
      [...document.querySelectorAll('[role="dialog"]')].some(
        (dialog) => dialog.getClientRects().length && !dialog.contains(node),
      )
    )
      return;
    focusedEditorRequest.current = editorRequest;
    node.scrollIntoView({ block: "start" });
    input.focus({ preventScroll: true });
  }, [editorRequest, listReady, panes.detailVisible, detailSection]);
  const versionFor = (
    id: string | null,
    targetDay: string | null,
    rows = versions,
  ) =>
    rows.find((row) => row.id === id && row.day === targetDay)?.revision ??
    null;
  const metadataValue = routineValue([name, notes]);
  const latestMetadata = routineValue([plan?.name ?? "", plan?.notes ?? ""]);
  const itemValue = routineValue([title, requirement, goal]);
  const latestItem = routineValue(currentItem ?? null);
  const itemFields = (base: string) => {
    try {
      const row = JSON.parse(base);
      return row &&
        typeof row.title === "string" &&
        typeof row.notes === "string"
        ? routineValue([row.title, row.notes, row.goal])
        : null;
    } catch {
      return null;
    }
  };
  const metadataDirty = metadataValue !== metaBase.current.base;
  const goalWait =
    source === "" && currentItem
      ? (currentItem.settings.mode ?? "wait") === "wait"
      : source === "current" && state.mode === "wait";
  const goalErrors = ladderItem
    ? []
    : routineGoalInputErrors(goalInput, goal.onTime != null);
  if (!ladderItem && goalWait && goal.onTime != null)
    goalErrors.push("等音模式需要关闭准时率门槛。");
  const expressionParsed = parseExpressionInputs(expressionInput);
  if (expressionParsed.error) goalErrors.push(expressionParsed.error);
  const goalInputDirty = hasRoutineGoalInputDraft(goal, goalInput) || routineValue(expressionInput) !== routineValue(expressionInputs(goal.expression));
  const itemDirty =
    !!(title || requirement || itemId || draftItemId.current) &&
    (goalInputDirty ||
      (itemId
        ? source !== "" || itemValue !== itemFields(itemBase.current.base)
        : true));
  const metadataConflict =
    !!selected &&
    metaBase.current.initialized &&
    metaBase.current.key === contextKey &&
    (!plan ||
      (metadataDirty &&
        metaBase.current.base !== latestMetadata &&
        metadataValue !== latestMetadata));
  const itemConflict =
    !!itemId &&
    itemBase.current.initialized &&
    itemBase.current.context === contextKey &&
    (!currentItem || (itemDirty && itemBase.current.base !== latestItem));
  const captureDrafts = () => {
    if (metaBase.current.key === contextKey && metaBase.current.initialized) {
      if (
        metadataValue !== metaBase.current.base ||
        draftPlanRequest.current ||
        copyPlanRequest.current
      )
        drafts.metadata({
          ...context,
          name,
          notes,
          base: metaBase.current.base,
          revision: metaBase.current.revision,
          requestId: draftPlanRequest.current,
          copyRequest: copyPlanRequest.current,
          updatedAt: Date.now(),
        });
      else drafts.removeMetadata(contextKey);
    }
    if (
      itemBase.current.context === contextKey &&
      itemBase.current.itemId === itemId &&
      itemBase.current.initialized
    ) {
      const token = itemId ?? draftItemId.current;
      if (itemDirty) {
        const actualToken =
          token ?? (draftItemId.current = crypto.randomUUID());
        drafts.item({
          ...context,
          token: actualToken,
          itemId,
          title,
          notes: requirement,
          source,
          sourceContentId,
          goal,
          goalInput,
          expressionInput,
          base: itemBase.current.base,
          revision: itemBase.current.revision,
          skipReason,
          updatedAt: Date.now(),
        });
      } else if (token) drafts.removeItem(routineItemKey(context, token));
    }
    drafts.remember({
      day,
      template,
      selected,
      itemId,
      itemToken: itemId ?? draftItemId.current,
      search,
      pane: panes.pane,
      detailSection,
      planQuery,
      planPage,
    });
  };
  const restoreMetadata = (
    target: Plan | null,
    targetDay: string | null,
    id = target?.id ?? null,
    rows = versions,
  ) => {
    const key = routineContextKey({ routineId: id, day: targetDay });
    const saved = drafts.getSnapshot().metadata[key];
    metaBase.current = {
      key,
      base:
        saved?.base ?? routineValue([target?.name ?? "", target?.notes ?? ""]),
      revision: saved?.revision ?? versionFor(id, targetDay, rows),
      initialized: true,
    };
    setName(saved?.name ?? target?.name ?? "");
    setNotes(saved?.notes ?? target?.notes ?? "");
    draftPlanRequest.current = saved?.requestId ?? null;
    copyPlanRequest.current = saved?.copyRequest ?? null;
    setEditorEpoch((value) => value + 1);
  };
  const restoreItem = (
    target: Item | null,
    targetContext = context,
    token?: string,
  ) => {
    const id = target?.id ?? null;
    const saved = token
      ? drafts.getSnapshot().items[routineItemKey(targetContext, token)]
      : id
        ? drafts.getSnapshot().items[routineItemKey(targetContext, id)]
        : undefined;
    itemBase.current = {
      context: routineContextKey(targetContext),
      itemId: saved?.itemId ?? id,
      base: saved?.base ?? routineValue(target),
      revision:
        saved?.revision ??
        versionFor(targetContext.routineId, targetContext.day),
      initialized: true,
    };
    setItemId(saved ? saved.itemId : id);
    draftItemId.current = saved?.itemId ? null : (saved?.token ?? null);
    setTitle(saved?.title ?? target?.title ?? launchPassage?.name ?? "");
    setRequirement(saved?.notes ?? target?.notes ?? launchPassage?.notes ?? "");
    replaceGoal(
      saved?.goal ??
        target?.goal ?? {
          passes: 1,
          accuracy: 90,
          onTime: null,
          consecutive: false,
          attemptLimit: 20,
        },
      saved?.goalInput,
      saved?.expressionInput,
    );
    setSource(
      saved?.source ??
        (target
          ? ""
          : launchPassage
            ? `passage:${launchPassage.id}`
            : "current"),
    );
    setSourceContentId(saved?.sourceContentId ?? song?.contentId ?? null);
    setSkipReason(saved?.skipReason ?? "");
    setEditorEpoch((value) => value + 1);
  };
  useEffect(() => {
    if (!listReady) return;
    const recovered =
      !itemId && draftItemId.current
        ? plan?.items.find((item) => item.id === draftItemId.current)
        : null;
    if (recovered) {
      itemBase.current.itemId = recovered.id;
      setItemId(recovered.id);
      setError(
        "发现同编号的已保存项目。请核对已保存条件，再决定采用已保存内容或继续修改。",
      );
      return;
    }
    if (metaBase.current.key !== contextKey || !metaBase.current.initialized) {
      restoreMetadata(plan ?? null, editDay, selected);
      return;
    }
    if (
      itemBase.current.context !== contextKey ||
      itemBase.current.itemId !== itemId ||
      !itemBase.current.initialized
    ) {
      restoreItem(
        currentItem ?? null,
        context,
        itemId ?? draftItemId.current ?? undefined,
      );
      return;
    }
    if (plan && (!metadataDirty || metadataValue === latestMetadata)) {
      metaBase.current.base = latestMetadata;
      metaBase.current.revision = versionFor(selected, editDay);
      if (!metadataDirty && metadataValue !== latestMetadata) {
        setName(plan.name);
        setNotes(plan.notes);
        return;
      }
    } else if (metaBase.current.base === latestMetadata)
      metaBase.current.revision = versionFor(selected, editDay);
    if (!itemDirty && currentItem) {
      itemBase.current.base = latestItem;
      itemBase.current.revision = versionFor(selected, editDay);
      if (itemValue !== itemFields(latestItem)) {
        setTitle(currentItem.title);
        setRequirement(currentItem.notes);
        replaceGoal(currentItem.goal);
        return;
      }
    } else if (itemBase.current.base === latestItem)
      itemBase.current.revision = versionFor(selected, editDay);
    captureDrafts();
  }, [
    listReady,
    contextKey,
    itemId,
    name,
    notes,
    title,
    requirement,
    source,
    sourceContentId,
    goal,
    goalInput,
    expressionInput,
    skipReason,
    search,
    versions,
    plan,
    busy,
    editorEpoch,
    panes.pane,
    detailSection,
    planQuery,
    planPage,
  ]);
  const checkedEdit = <T = { id: string },>(
    change: RoutineChange,
    expected = versionFor(selected, editDay),
    targetDay = editDay,
  ): Promise<T> => {
    if (!selected || !expected)
      return Promise.reject(
        new Error("尚未读取计划版本，请刷新计划列表后重试。"),
      );
    return service
      .command<T>({
        type: "editRoutine",
        request: { routineId: selected, day: targetDay, expected, change },
      })
      .catch((failure: unknown) => {
        if (/unknown variant[^\n]*editRoutine/i.test(String(failure)))
          throw new Error(
            "当前音乐服务尚不支持计划版本核对，请重启到与界面匹配的版本。草稿已保留。",
          );
        throw failure;
      });
  };
  const close = () => {
    captureDrafts();
    dismissDialog();
  };
  const visitDraft = (draft: RoutineMetaDraft | RoutineItemDraft) => {
    captureDrafts();
    const target = { routineId: draft.routineId, day: draft.day };
    setSelected(draft.routineId);
    setTemplate(draft.day === null);
    setDay(draft.day ?? day);
    const targetPlan =
      draft.day === null
        ? plans.find((plan) => plan.id === draft.routineId)
        : (dayRuns.find(
            (run) =>
              run.day === draft.day && run.routine.id === draft.routineId,
          )?.routine ?? plans.find((plan) => plan.id === draft.routineId));
    restoreMetadata(targetPlan ?? null, draft.day, draft.routineId);
    if ("token" in draft)
      restoreItem(
        targetPlan?.items.find((item) => item.id === draft.itemId) ?? null,
        target,
        draft.token,
      );
    else restoreItem(null, target);
    setLaunchPending(false);
    setError("");
    setDetailSection("token" in draft ? "items" : "metadata");
    panes.showDetails();
    if ("token" in draft) setEditorRequest((value) => value + 1);
  };
  const adoptMetadata = () => {
    if (!plan) return;
    drafts.removeMetadata(contextKey);
    restoreMetadata(plan, editDay);
  };
  const rebaseMetadata = () => {
    metaBase.current.base = latestMetadata;
    metaBase.current.revision = versionFor(selected, editDay);
    setEditorEpoch((value) => value + 1);
  };
  const adoptItem = () => {
    if (!currentItem) return;
    drafts.removeItem(routineItemKey(context, currentItem.id));
    restoreItem(currentItem);
  };
  const rebaseItem = () => {
    itemBase.current.base = latestItem;
    itemBase.current.revision = versionFor(selected, editDay);
    setEditorEpoch((value) => value + 1);
  };
  const visitPending = (pending: RoutinePending) => {
    captureDrafts();
    setSelected(pending.routineId);
    setDay(pending.day ?? day);
    setTemplate(pending.day === null);
    setPendingListRefresh(pending.kind === "list" ? pending.label : null);
    setOpenedItem(
      pending.kind === "open" && pending.itemId
        ? {
            id: pending.itemId,
            title: pending.title,
            confirmed: pending.confirmed,
          }
        : null,
    );
    setError("");
    panes.showDetails();
  };
  const visitSchedule = (draft: RoutineScheduleDraft) => {
    captureDrafts();
    setSelected(draft.routineId);
    setTemplate(true);
    setItemId(null);
    draftItemId.current = null;
    restoreMetadata(
      plans.find((plan) => plan.id === draft.routineId) ?? null,
      null,
      draft.routineId,
    );
    setError("");
    setDetailSection("metadata");
    panes.showDetails();
  };
  useEffect(() => {
    if (busy) return;
    const receipt = drafts.getSnapshot().pending[contextKey];
    setPendingListRefresh(receipt?.kind === "list" ? receipt.label : null);
    setOpenedItem(
      receipt?.kind === "open" && receipt.itemId
        ? {
            id: receipt.itemId,
            title: receipt.title,
            confirmed: receipt.confirmed,
          }
        : null,
    );
  }, [contextKey, busy]);
  const reload = useCallback(async () => {
    const request = ++listReadGeneration.current;
    setListLoading(true);
    setListVerified(false);
    setListError("");
    try {
      const data = await service.read(day, {
        channel: listReadChannel,
        sequence: request,
      });
      if (!mounted.current || request !== listReadGeneration.current)
        throw new Error("计划列表已有更新的读取请求，请重试查看最新结果");
      setPlans(data.plans);
      setRuns(data.runs);
      setVersions(data.versions ?? []);
      setListVerified(true);
      setLoadedDay(day);
      setListError("");
      setListReadAt(Date.now());
      return data;
    } catch (failure) {
      if (
        mounted.current &&
        service.isCurrent() &&
        request === listReadGeneration.current
      )
        setListError(
          failure instanceof Error ? failure.message : String(failure),
        );
      throw failure;
    } finally {
      if (mounted.current && request === listReadGeneration.current)
        setListLoading(false);
    }
  }, [day, listReadChannel, service]);
  useEffect(() => {
    void reload().catch(() => {});
    return () => {
      listReadGeneration.current++;
    };
  }, [reload, resumeRevision]);
  useEffect(() => {
    if (previousSongId.current !== song?.contentId) {
      captureDrafts();
      setLaunchPending(false);
      previousSongId.current = song?.contentId;
    }
    setPassages([]);
    setLadders([]);
    setSourceSongId(null);
    setSourceLoading(!!song);
    if (!song) {
      return;
    }
    const songId = song.contentId;
    let cancelled = false;
    void service
      .options(songId)
      .then((options) => {
        if (cancelled) return;
        if (options.contentId !== songId)
          throw new Error("曲目已切换，请重新读取计划来源");
        setPassages(options.passages);
        setLadders(options.ladders);
        setSourceSongId(songId);
        setSourceLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setSourceLoading(false);
          setError(String(e.message));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [song?.contentId, resumeRevision, sourceReloadRevision, service]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (
        e.key !== "Escape" ||
        suspended ||
        e.defaultPrevented ||
        busy ||
        compose
      )
        return;
      if (panes.compact && panes.pane === "detail") {
        e.preventDefault();
        panes.showList();
      } else close();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close, busy, compose, suspended, panes.compact, panes.pane]);
  useEffect(() => {
    if (wasSuspended.current && !suspended) dialogRef.current?.focus();
    wasSuspended.current = suspended;
  }, [suspended]);
  const work = async (
    job: () => Promise<void>,
    recoverOnError = true,
    allowPending = false,
  ) => {
    if (working.current) return;
    if (contextPending && !allowPending) {
      setError(
        pendingListRefresh
          ? "计划列表尚未刷新，请先重试读取已保存的计划。"
          : "练习项目已打开，请先重试读取当前练习。",
      );
      return;
    }
    working.current = true;
    captureDrafts();
    drafts.setBusy(true);
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      if (!service.isCurrent()) return;
      const original = e instanceof Error ? e.message : String(e);
      if (!recoverOnError) {
        setError(original);
        return;
      }
      try {
        await refreshPractice();
        await reload();
        setError(original);
      } catch (refreshError) {
        const detail =
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError);
        setError(`${original}；界面刷新也失败：${detail}`);
      }
    } finally {
      working.current = false;
      drafts.setBusy(false);
      setBusy(false);
    }
  };
  const markListPending = (label: string, target = context) => {
    setPendingListRefresh(label);
    drafts.pending({
      ...target,
      kind: "list",
      label,
      itemId: null,
      title: name,
      confirmed: true,
    });
  };
  const refreshSavedList = async (label: string, target = context) => {
    markListPending(label, target);
    const targetKey = routineContextKey(target);
    try {
      const data = await reload();
      setPendingListRefresh(null);
      drafts.clearPending(targetKey);
      return data;
    } catch (e) {
      throw new Error(
        `${label}已写入，计划列表读取失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  const createPlan = async (
    requestId: string,
    planName: string,
    planNotes: string,
    copyOf: string | null,
  ): Promise<{ id: string; recovered?: Plan; revision?: string | null }> => {
    try {
      if (copyOf)
        return await checkedEdit(
          { kind: "copy", requestId, name: planName, notes: planNotes },
          versionFor(copyOf, editDay),
        );
      return await service.command<{ id: string }>({
        type: "saveRoutine",
        id: null,
        day: copyOf ? editDay : null,
        name: planName,
        notes: planNotes,
        copy_of: copyOf,
        request_id: requestId,
      });
    } catch (saveError) {
      // A lost reply does not prove that the plan was not saved.
      try {
        const data = await service.read(day);
        const saved = data.plans.find(
          (item) => item.id === `routine-request-${requestId}`,
        );
        if (saved)
          return {
            id: saved.id,
            recovered: saved,
            revision: versionFor(saved.id, null, data.versions),
          };
      } catch {
        // Keep the original save error and the request ID for another retry.
      }
      throw saveError;
    }
  };
  const retrySavedList = () =>
    void work(
      async () => {
        await refreshPractice();
        await reload();
        setPendingListRefresh(null);
        drafts.clearPending(contextKey);
      },
      false,
      true,
    );
  const choosePlan = (p: Plan) => {
    panes.showDetails();
    setDetailSection("items");
    if (p.id === selected) return;
    captureDrafts();
    setSelected(p.id);
    restoreMetadata(p, editDay);
    restoreItem(null, { routineId: p.id, day: editDay });
    setError("");
  };
  const chooseItem = (item: Item) => {
    captureDrafts();
    setLaunchPending(false);
    restoreItem(item);
    setError("");
    setDetailSection("items");
    panes.showDetails(false);
    setEditorRequest((value) => value + 1);
  };
  const newItem = () => {
    captureDrafts();
    draftItemId.current = crypto.randomUUID();
    itemBase.current = {
      context: contextKey,
      itemId: null,
      base: "null",
      revision: versionFor(selected, editDay),
      initialized: true,
    };
    setLaunchPending(false);
    setItemId(null);
    setTitle(song?.title ?? "");
    setRequirement("");
    replaceGoal({
      passes: 1,
      accuracy: 90,
      onTime: null,
      consecutive: false,
      attemptLimit: 20,
    });
    setSource("current");
    setSourceContentId(song?.contentId ?? null);
    setDetailSection("items");
    panes.showDetails(false);
    setEditorRequest((value) => value + 1);
  };
  const patch = (value: Partial<RoutineGoal>) =>
    setGoal((g) => ({ ...g, ...value }));
  const changeView = (nextTemplate: boolean, nextDay: string) => {
    if (!nextDay || (nextTemplate === template && nextDay === day)) return;
    captureDrafts();
    setTemplate(nextTemplate);
    setDay(nextDay);
    setItemId(null);
    draftItemId.current = null;
    setPlanPage(0);
    setError("");
  };
  const newPlan = () => {
    setDetailSection("metadata");
    panes.showDetails();
    if (selected === null && template) return;
    captureDrafts();
    setTemplate(true);
    setSelected(null);
    restoreMetadata(null, null);
    restoreItem(null, { routineId: null, day: null });
    setError("");
  };
  const chooseSourceSong = (row: SongRow | CollectionSong) =>
    void work(async () => {
      const loaded = await service.command<LoadedSong>(
        "generated" in row && row.generated
          ? { type: "openRecent", content_id: row.contentId }
          : row.contentId
            ? {
                type: "loadIndexed",
                path: requireValue(row.path, "曲目位置"),
                title: row.title,
                content_id: row.contentId,
              }
            : {
                type: "load",
                path: requireValue(row.path, "曲目位置"),
                title: row.title,
              },
      );
      if (
        !loaded?.contentId ||
        (row.contentId && loaded.contentId !== row.contentId)
      )
        throw new Error("打开结果与所选曲目不一致，请重新读取当前练习。");
      const latest = await service.state();
      if (latest.contentId !== loaded.contentId)
        throw new Error("当前曲目已经切换，原项目草稿已保留。");
      await refreshPractice();
      draftItemId.current = crypto.randomUUID();
      itemBase.current = {
        context: contextKey,
        itemId: null,
        base: "null",
        revision: versionFor(selected, editDay),
        initialized: true,
      };
      setItemId(null);
      setTitle(loaded.title || row.title);
      setRequirement("");
      setSource("current");
      setSourceContentId(loaded.contentId);
      setLaunchPending(false);
      setSkipReason("");
      replaceGoal({
        passes: 1,
        accuracy: 90,
        onTime: null,
        consecutive: false,
        attemptLimit: 20,
      });
      setDetailSection("items");
      panes.showDetails(false);
      setEditorRequest((value) => value + 1);
    });
  const launchKey = JSON.stringify([
    initialPlan ?? null,
    initialPassage ?? null,
  ]);
  const handledLaunch = useRef(launchKey);
  useEffect(() => {
    if (handledLaunch.current === launchKey || busy || suspended) return;
    captureDrafts();
    handledLaunch.current = launchKey;
    if (initialPlan) {
      setSelected(initialPlan.id);
      setTemplate(initialPlan.day === null);
      setDay(initialPlan.day ?? day);
      setItemId(null);
      draftItemId.current = null;
      metaBase.current.initialized = false;
      itemBase.current.initialized = false;
    }
    if (initialPassage && initialPassage.contentId === song?.contentId) {
      newItem();
      setTitle(initialPassage.name);
      setRequirement(initialPassage.notes);
      setSource(`passage:${initialPassage.id}`);
      setSourceContentId(initialPassage.contentId);
      setLaunchPending(true);
    }
  }, [launchKey, busy, suspended]);
  const itemCommand = (
    command:
      | { type: "moveRoutineItem"; direction: number }
      | { type: "removeRoutineItem" }
      | { type: "skipRoutineItem"; reason: string }
      | { type: "resetRoutineItem" },
  ) => {
    const identity = {
      routine_id: requireValue(selected, "练习计划"),
      item_id: requireValue(itemId, "练习项目"),
    };
    if (
      command.type === "moveRoutineItem" ||
      command.type === "removeRoutineItem"
    )
      return {
        type: "editRoutine" as const,
        request: {
          routineId: identity.routine_id,
          day: editDay,
          expected: requireValue(versionFor(selected, editDay), "计划版本"),
          change:
            command.type === "moveRoutineItem"
              ? {
                  kind: "moveItem" as const,
                  itemId: identity.item_id,
                  direction: command.direction,
                }
              : { kind: "removeItem" as const, itemId: identity.item_id },
        },
      };
    return { ...command, ...identity, day: requireValue(editDay, "练习日期") };
  };
  const openSavedItem = async (savedId: string, savedTitle: string) => {
    const opened = {
      id: savedId,
      title: savedTitle || "当前项目",
      confirmed: true,
    };
    try {
      await service.command({
        type: "openRoutineItem",
        routine_id: requireValue(selected, "练习计划"),
        day,
        item_id: savedId,
        resume: true,
      });
    } catch (e) {
      let latest: Snapshot;
      try {
        latest = await service.state();
      } catch (readError) {
        setOpenedItem({ ...opened, confirmed: false });
        drafts.pending({
          ...context,
          kind: "open",
          label: "打开练习项目",
          itemId: savedId,
          title: opened.title,
          confirmed: false,
        });
        throw new Error(
          `练习是否已打开尚未确认，请重试读取当前练习：${readError instanceof Error ? readError.message : String(readError)}`,
        );
      }
      if (
        !latest.routine ||
        latest.routine.routineId !== selected ||
        latest.routine.day !== day ||
        latest.routine.itemId !== savedId
      ) {
        try {
          await refreshPractice();
        } catch (refreshError) {
          throw new Error(
            `${e instanceof Error ? e.message : String(e)}；当前曲目刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
          );
        }
        throw e;
      }
    }
    setOpenedItem(opened);
    drafts.pending({
      ...context,
      kind: "open",
      label: "打开练习项目",
      itemId: savedId,
      title: opened.title,
      confirmed: true,
    });
    try {
      await refreshPractice();
      drafts.clearPending(contextKey);
      dismissDialog();
    } catch (e) {
      throw new Error(
        `练习项目已打开，当前状态读取失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  const openItem = (item: Item) =>
    void work(() => openSavedItem(item.id, item.title), false);
  const saveItem = (startPractice: boolean) =>
    void work(async () => {
      if (goalErrors.length) throw new Error(goalErrors.join(" "));
      const [kind, ...parts] = source.split(":");
      const saveId = itemId ?? (draftItemId.current ??= crypto.randomUUID());
      if (itemConflict)
        throw new Error("已保存项目发生变化，请先核对草稿与最新内容。");
      if (sourcePinned)
        throw new Error("草稿来源属于另一首曲目，请明确选择当前曲目后再保存。");
      captureDrafts();
      const data = await checkedEdit(
        {
          kind: "item",
          contentId: source ? sourceContentId : null,
          id: saveId,
          source: source ? kind : null,
          sourceId: parts.join(":") || null,
          title,
          notes: requirement,
          goal,
        },
        itemBase.current.revision,
      );
      drafts.removeItem(routineItemKey(context, saveId));
      setGoalInput(routineGoalInputs(goal));
      setItemId(data.id);
      draftItemId.current = null;
      setSource("");
      setLaunchPending(false);
      const listed = await refreshSavedList("练习项目");
      const savedPlan =
        (editDay === null
          ? listed.plans.find((plan) => plan.id === selected)
          : listed.runs.find((run) => run.routine.id === selected)?.routine) ??
        listed.plans.find((plan) => plan.id === selected);
      const savedItem = savedPlan?.items.find((item) => item.id === data.id);
      if (savedItem) {
        itemBase.current = {
          context: contextKey,
          itemId: data.id,
          base: routineValue(savedItem),
          revision: versionFor(selected, editDay, listed.versions),
          initialized: true,
        };
        setEditorEpoch((value) => value + 1);
      }
      if (startPractice) {
        try {
          await openSavedItem(data.id, title.trim());
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          throw new Error(
            message.includes("练习项目已打开") ||
              message.includes("练习是否已打开尚未确认")
              ? message
              : `练习项目已保存，但打开失败：${message}`,
          );
        }
      }
    }, !startPractice);
  const retryOpenedItem = () =>
    void work(
      async () => {
        const latest = await service.state();
        if (
          !openedItem ||
          !latest.routine ||
          latest.routine.routineId !== selected ||
          latest.routine.day !== day ||
          latest.routine.itemId !== openedItem.id
        ) {
          setOpenedItem(null);
          drafts.clearPending(contextKey);
          throw new Error(
            "当前练习已经改变。计划和进度继续保留，可重新选择要练的项目。",
          );
        }
        setOpenedItem({ ...openedItem, confirmed: true });
        drafts.pending({
          ...context,
          kind: "open",
          label: "打开练习项目",
          itemId: openedItem.id,
          title: openedItem.title,
          confirmed: true,
        });
        await refreshPractice();
        drafts.clearPending(contextKey);
        dismissDialog();
      },
      false,
      true,
    );
  const allPlans = useMemo(
    () =>
      template
        ? plans
        : [
            ...plans.map(
              (p) => dayRuns.find((r) => r.routine.id === p.id)?.routine ?? p,
            ),
            ...dayRuns
              .filter((r) => !plans.some((p) => p.id === r.routine.id))
              .map((r) => r.routine),
          ],
    [template, plans, dayRuns],
  );
  const completed =
      plan?.items.filter((i) => progress(i.id)?.completed).length ?? 0,
    skipped = plan?.items.filter((i) => progress(i.id)?.skipped).length ?? 0;
  const nextPracticeItem =
    plan?.items.find((item) => {
      const result = progress(item.id);
      return !result?.completed && !result?.skipped && !result?.limited;
    }) ??
    plan?.items.find(
      (item) => !progress(item.id)?.completed && !progress(item.id)?.skipped,
    );
  const metadataContent = (
    <>
      <section className="routine-plan-meta">
        <h4>{plan ? `计划信息：${plan.name}` : "创建常用计划"}</h4>
        {metadataDirty && (
          <p className="parameter-help" role="status">
            计划信息有未提交修改，切换或关闭后可继续编辑。
          </p>
        )}
        {metadataConflict && (
          <div className="routine-draft-conflict" role="alert">
            <strong>
              {plan ? "计划信息已由其他操作修改" : "原计划已移除"}
            </strong>
            {plan ? (
              <>
                <details>
                  <summary>核对当前保存内容与草稿</summary>
                  <p>
                    当前保存：{plan.name}
                    <br />
                    {plan.notes}
                  </p>
                  <p>
                    当前草稿：{name}
                    <br />
                    {notes}
                  </p>
                </details>
                <div className="routine-draft-actions">
                  <button disabled={busy || !listReady} onClick={adoptMetadata}>
                    采用已保存内容
                  </button>
                  <button
                    disabled={busy || !listReady}
                    onClick={rebaseMetadata}
                  >
                    按最新版本保留我的输入
                  </button>
                </div>
              </>
            ) : (
              <p>草稿已保留。可以复制名称与备注，在新计划中使用。</p>
            )}
            <CopyPracticeDraft
              label="复制计划信息草稿"
              value={{ name, notes }}
            />
          </div>
        )}
        <label>
          计划名称
          <input
            aria-label="练习计划名称"
            value={name}
            maxLength={80}
            disabled={locked}
            placeholder="例如：每日基本功与曲目练习"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          计划备注
          <textarea
            aria-label="练习计划备注"
            value={notes}
            disabled={locked}
            rows={2}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
          />
        </label>
        <div className="routine-meta-actions">
          <button
            disabled={
              locked ||
              metadataConflict ||
              !name.trim() ||
              (!!selected && !metadataDirty)
            }
            onClick={() =>
              void work(async () => {
                if (metadataConflict)
                  throw new Error("计划信息发生变化，请先核对草稿与最新内容。");
                const requestId = selected
                  ? null
                  : (draftPlanRequest.current ??= crypto.randomUUID());
                captureDrafts();
                const data = selected
                  ? await checkedEdit(
                      { kind: "metadata", name, notes },
                      metaBase.current.revision,
                    )
                  : await createPlan(requestId!, name, notes, null);
                drafts.removeMetadata(contextKey);
                setSelected(data.id);
                if (!selected) {
                  setTemplate(true);
                  setDetailSection("items");
                }
                draftPlanRequest.current = null;
                const recovered =
                  "recovered" in data
                    ? (data.recovered as Plan | undefined)
                    : undefined;
                const base = recovered
                  ? routineValue([recovered.name, recovered.notes])
                  : metadataValue;
                const target = {
                  routineId: data.id,
                  day: selected ? editDay : null,
                };
                metaBase.current = {
                  key: routineContextKey(target),
                  base,
                  revision: null,
                  initialized: true,
                };
                if (recovered && metadataValue !== base)
                  drafts.metadata({
                    ...target,
                    name,
                    notes,
                    base,
                    revision: null,
                    requestId: null,
                    copyRequest: null,
                    updatedAt: Date.now(),
                  });
                await refreshSavedList(
                  selected ? "计划信息" : "新计划",
                  target,
                );
              })
            }
          >
            {selected ? "保存计划信息" : "创建计划"}
          </button>
          {selected && (
            <>
              <button
                disabled={busy || contextPending || !name.trim()}
                onClick={() =>
                  void work(async () => {
                    const requestId = (copyPlanRequest.current ??=
                      crypto.randomUUID());
                    captureDrafts();
                    const data = await createPlan(
                      requestId,
                      name + "（副本）",
                      notes,
                      selected,
                    );
                    if (
                      data.recovered &&
                      routineValue([name + "（副本）", notes]) !==
                        routineValue([
                          data.recovered.name,
                          data.recovered.notes,
                        ])
                    ) {
                      drafts.metadata({
                        routineId: data.id,
                        day: null,
                        name: name + "（副本）",
                        notes,
                        base: routineValue([
                          data.recovered.name,
                          data.recovered.notes,
                        ]),
                        revision: data.revision ?? null,
                        requestId: null,
                        copyRequest: null,
                        updatedAt: Date.now(),
                      });
                    }
                    const originalDraft =
                      drafts.getSnapshot().metadata[contextKey];
                    if (originalDraft) {
                      if (
                        routineValue([
                          originalDraft.name,
                          originalDraft.notes,
                        ]) === originalDraft.base &&
                        !originalDraft.requestId
                      )
                        drafts.removeMetadata(contextKey);
                      else
                        drafts.metadata({
                          ...originalDraft,
                          copyRequest: null,
                          updatedAt: Date.now(),
                        });
                    }
                    setSelected(data.id);
                    copyPlanRequest.current = null;
                    setTemplate(true);
                    setName(name + "（副本）");
                    setItemId(null);
                    draftItemId.current = null;
                    await refreshSavedList("计划副本", {
                      routineId: data.id,
                      day: null,
                    });
                  })
                }
              >
                复制为常用计划
              </button>
              {template && (
                <button
                  disabled={locked}
                  onClick={() =>
                    void work(async () => {
                      await checkedEdit(
                        { kind: "remove" },
                        versionFor(selected, null),
                        null,
                      );
                      setSelected(null);
                      setName("");
                      await refreshSavedList("常用计划移除操作");
                    })
                  }
                >
                  移除常用计划
                </button>
              )}
            </>
          )}
        </div>
      </section>
      {plan && template && (
        <RoutineScheduleEditor
          key={plan.id}
          value={plan.schedule}
          revision={versionFor(plan.id, null)}
          memory={
            workbench.schedules[
              routineContextKey({ routineId: plan.id, day: null })
            ]
          }
          remember={(draft) => {
            const key = routineContextKey({ routineId: plan.id, day: null });
            if (draft)
              drafts.schedule({
                ...draft,
                title: plan.name,
                routineId: plan.id,
                day: null,
                updatedAt: Date.now(),
              });
            else drafts.removeSchedule(key);
          }}
          day={day}
          disabled={busy || contextPending}
          save={async (schedule, expected) => {
            await work(async () => {
              await checkedEdit({ kind: "schedule", schedule }, expected, null);
              await refreshSavedList("周期安排");
            });
          }}
        />
      )}
      {plan && !template && plans.find((p) => p.id === plan.id)?.schedule && (
        <p className="parameter-help">
          {scheduleText(plans.find((p) => p.id === plan.id)?.schedule)}
          ；本日
          {run ? "已保存独立安排" : "不符合周期规则，仍可手动打开项目"}
          。修改周期请进入常用计划。
        </p>
      )}
    </>
  );
  const itemsContent = (
    <>
      {!plan && (
        <div className="browse-detail-empty">
          <strong>
            {selected ? "原计划暂不可用，草稿继续保留" : "先选择或创建计划"}
          </strong>
          <span>选定计划后，可以添加曲目、调整目标和查看当天进度。</span>
          <button
            disabled={busy}
            onClick={() => {
              setDetailSection("metadata");
              panes.showDetails();
            }}
          >
            {selected ? "查看计划信息与草稿" : "填写计划信息"}
          </button>
        </div>
      )}
      {plan && (
        <>
          <div className="routine-items-heading">
            <strong>
              {template
                ? "项目顺序"
                : `${completed}/${plan.items.length} 项达标${skipped ? ` · ${skipped} 项跳过` : ""}`}
            </strong>
            {active && (
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await service.command({ type: "stopRoutine" });
                    markListPending("结束本项操作");
                    await refreshPractice();
                    await refreshSavedList("结束本项操作");
                  })
                }
              >
                结束本项，保留进度
              </button>
            )}
          </div>
          <div className="routine-items">
            {plan.items.map((item, index) => {
              const p = progress(item.id);
              return (
                <div
                  className={`routine-item ${itemId === item.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button
                    className="routine-item-select"
                    disabled={busy}
                    onClick={() => chooseItem(item)}
                  >
                    <span className="routine-item-index">{index + 1}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.songTitle} · {range(item)} ·{" "}
                        {modes[item.settings.mode ?? "wait"] ??
                          item.settings.mode}{" "}
                        · {Math.round(item.speed * 100)}%
                      </small>
                      {item.notes && <small>{item.notes}</small>}
                    </span>
                    <b>
                      {template
                        ? ""
                        : p?.completed
                          ? "已达标"
                          : p?.skipped
                            ? "已跳过"
                            : p?.limited
                              ? "本次到上限"
                              : item.target.kind === "ladder" &&
                                  item.target.preset
                                ? `第 ${(p?.ladder?.stage ?? 0) + 1} 级 · 已练 ${p?.attempts ?? 0} 轮`
                                : `${(item.goal.consecutive ? p?.streak : p?.passed) ?? 0}/${item.goal.passes}`}
                    </b>
                  </button>
                  <button
                    className="routine-quick-open"
                    disabled={
                      busy ||
                      !!openedItem ||
                      template ||
                      p?.completed ||
                      p?.skipped
                    }
                    aria-label={`练习项目：${item.title}`}
                    onClick={() => openItem(item)}
                  >
                    练习
                  </button>
                </div>
              );
            })}
            {plan.items.length === 0 && (
              <p className="parameter-help">
                添加当前曲目、命名选段或速度阶梯，然后按顺序练习。
              </p>
            )}
          </div>
          {(itemId || title || draftItemId.current) && (
            <div className="routine-item-editor" ref={itemEditor}>
              <h3>{itemId ? "编辑项目" : "添加项目"}</h3>
              {itemDirty && (
                <p className="parameter-help" role="status">
                  项目有未提交修改，输入已保留在草稿工作台。
                </p>
              )}
              {itemConflict && (
                <div className="routine-draft-conflict" role="alert">
                  <strong>
                    {currentItem ? "已保存项目与草稿基线不同" : "原项目已移除"}
                  </strong>
                  {currentItem ? (
                    <>
                      <p>
                        当前保存：{currentItem.title} · {currentItem.songTitle}{" "}
                        · {range(currentItem)}
                      </p>
                      <p>
                        当前草稿：{title} · {requirement}
                      </p>
                      <div className="routine-draft-actions">
                        <button
                          disabled={busy || !listReady}
                          onClick={adoptItem}
                        >
                          采用已保存项目
                        </button>
                        <button
                          disabled={busy || !listReady}
                          onClick={rebaseItem}
                        >
                          按最新版本保留我的输入
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>草稿内容保留，可复制后建立新项目。</p>
                  )}
                  <CopyPracticeDraft
                    label="复制项目草稿"
                    value={{
                      title,
                      notes: requirement,
                      goal,
                      goalInput,
                      source,
                      sourceContentId,
                      skipReason,
                    }}
                  />
                </div>
              )}
              {sourcePinned && (
                <div className="routine-draft-conflict" role="status">
                  <p>
                    这份草稿的练习来源属于另一首曲目，名称、要求和达标目标均已保留。
                  </p>
                  <button
                    disabled={busy || !song}
                    onClick={() => {
                      setSource("current");
                      setSourceContentId(song?.contentId ?? null);
                      setLaunchPending(false);
                    }}
                  >
                    将来源改为当前曲目
                  </button>
                </div>
              )}
              <label>
                项目名称
                <input
                  aria-label="计划项目名称"
                  value={title}
                  disabled={locked}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                练习要求
                <textarea
                  aria-label="计划项目练习要求"
                  value={requirement}
                  rows={2}
                  disabled={locked}
                  onChange={(e) => setRequirement(e.target.value)}
                />
              </label>
              <label>
                练习条件来源
                <select
                  aria-label="计划项目条件来源"
                  disabled={locked || sourceBusy}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setSourceContentId(song?.contentId ?? null);
                    setLaunchPending(false);
                    if (e.target.value.startsWith("ladder:")) {
                      patch({
                        expression:
                          ladders.find((p) => p.id === e.target.value.slice(7))
                            ?.expression ?? null,
                      });
                    }
                  }}
                >
                  {itemId && <option value="">保留已保存的曲目与条件</option>}
                  <option value="current">当前曲目及当前练习条件</option>
                  {!sourceBusy && !sourceAvailable && (
                    <option value={source}>
                      原来源暂不可用或已移除，请重新选择
                    </option>
                  )}
                  {(sourceSongId === song?.contentId ? passages : []).map(
                    (p) => (
                      <option key={p.id} value={`passage:${p.id}`}>
                        命名选段：{p.name}
                      </option>
                    ),
                  )}
                  {(sourceSongId === song?.contentId ? ladders : []).map(
                    (p) => (
                      <option key={p.id} value={`ladder:${p.id}`}>
                        速度阶梯：{p.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                disabled={busy || contextPending || sourceBusy}
                onClick={() =>
                  setSourceReloadRevision((revision) => revision + 1)
                }
              >
                重新读取练习来源
              </button>
              {sourceBusy && (
                <p role="status">正在读取当前曲目的命名选段和速度阶梯…</p>
              )}
              {!sourceBusy && !sourceAvailable && (
                <p role="alert">
                  所选来源暂不可用或已移除。请重新读取，或改选当前曲目的练习条件。
                </p>
              )}
              {ladderItem ? (
                <RoutineLadderGoalSummary preset={selectedLadder} song={song} />
              ) : (
                <RoutineGoalEditor
                  goal={goal}
                  input={goalInput}
                  changeInput={changeGoalInput}
                  patch={patch}
                  disabled={locked || ladderItem}
                  wait={goalWait}
                />
              )}
              <ExpressionGoalControl
                value={goal.expression}
                inputs={expressionInput}
                changeInputs={(next) => { setExpressionInput(next); setGoal((old) => ({ ...old, expression: parseExpressionInputs(next).value })); }}
                wait={
                  source === "current"
                    ? state.mode === "wait"
                    : source === ""
                      ? (currentItem?.settings.mode ?? "wait") === "wait"
                      : source.startsWith("ladder:")
                        ? ladders.find((p) => p.id === source.slice(7))
                            ?.settings.mode === "wait"
                        : false
                }
                disabled={locked}
                change={(expression) => patch({ expression })}
              />
              <p className="parameter-help">
                {ladderItem
                  ? "阶梯项目逐级检查正确率、准时率和已选力度/踏板要求，达到目标速度才完成。"
                  : "完整练完目标音符后，按正确率、准时率和已选力度/踏板要求计达标；等音不支持准时率门槛。"}{" "}
                改变目标或重新捕获条件会重置当天本项进度；历史结果保留。
              </p>
              {currentItem && !template && (
                <label>
                  本次跳过原因（可选）
                  <input
                    aria-label="计划项目跳过原因"
                    disabled={busy}
                    value={skipReason}
                    onChange={(e) => setSkipReason(e.target.value)}
                  />
                </label>
              )}
              {goalErrors.length > 0 && (
                <p className="routine-goal-input-error" role="status">
                  调整目标设置后可保存。当前输入继续保留在草稿中。
                </p>
              )}
              <div className="routine-item-actions">
                <button
                  disabled={
                    locked ||
                    itemConflict ||
                    (!!itemId && !itemDirty) ||
                    goalErrors.length > 0 ||
                    sourceBusy ||
                    !sourceAvailable ||
                    !title.trim() ||
                    (!song && source !== "")
                  }
                  onClick={() => saveItem(false)}
                >
                  保存项目
                </button>
                {!template && (
                  <button
                    disabled={
                      locked ||
                      itemConflict ||
                      (!!itemId && !itemDirty) ||
                      goalErrors.length > 0 ||
                      sourceBusy ||
                      !sourceAvailable ||
                      !title.trim() ||
                      (!song && source !== "")
                    }
                    onClick={() => saveItem(true)}
                  >
                    保存并开始练习
                  </button>
                )}
                {currentItem && (
                  <>
                    <button
                      disabled={
                        busy ||
                        !!openedItem ||
                        template ||
                        progress(currentItem.id)?.completed ||
                        progress(currentItem.id)?.skipped
                      }
                      onClick={() => openItem(currentItem)}
                    >
                      打开本项练习
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        void work(async () => {
                          await service.command(
                            itemCommand({
                              type: "moveRoutineItem",
                              direction: -1,
                            }),
                          );
                          await refreshSavedList("项目上移操作");
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        void work(async () => {
                          await service.command(
                            itemCommand({
                              type: "moveRoutineItem",
                              direction: 1,
                            }),
                          );
                          await refreshSavedList("项目下移操作");
                        })
                      }
                    >
                      下移
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        void work(async () => {
                          await service.command(
                            itemCommand({ type: "removeRoutineItem" }),
                          );
                          restoreItem(null);
                          setLaunchPending(false);
                          await refreshSavedList("项目移除操作");
                        })
                      }
                    >
                      移除项目
                    </button>
                    {!template && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void work(async () => {
                              await service.command(
                                itemCommand({
                                  type: "skipRoutineItem",
                                  reason: skipReason || "本次跳过",
                                }),
                              );
                              markListPending("跳过项目操作");
                              await refreshPractice();
                              await refreshSavedList("跳过项目操作");
                            })
                          }
                        >
                          本次跳过
                        </button>
                        <button
                          disabled={locked}
                          onClick={() =>
                            void work(async () => {
                              await service.command(
                                itemCommand({ type: "resetRoutineItem" }),
                              );
                              await refreshSavedList("项目进度重置操作");
                            })
                          }
                        >
                          重置本项进度
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
              {currentItem && progress(currentItem.id) && (
                <p className="routine-evidence">
                  {progress(currentItem.id)?.lastResult} · 已练{" "}
                  {progress(currentItem.id)?.attempts} 轮 · 最佳正确率{" "}
                  {progress(currentItem.id)?.bestAccuracy === null
                    ? "—"
                    : Math.round(
                        (progress(currentItem.id)?.bestAccuracy ?? 0) * 100,
                      ) + "%"}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
  const sourcesContent = (
    <>
      <section className="routine-source-actions">
        <h4>添加练习内容</h4>
        <p className="parameter-help">
          可以把当前练习加入计划，或按顺序编排已保存的段落。
        </p>
        <div className="routine-meta-actions">
          <button disabled={locked || !song} onClick={newItem}>
            添加当前练习
          </button>
          <button disabled={locked || !plan} onClick={() => setCompose(true)}>
            编排多个段落
          </button>
        </div>
      </section>
      <WeakPracticePanel
        engineId={engineId}
        initiallyExpanded
        routineId={selected}
        day={editDay}
        disabled={locked}
        work={work}
        openLibrary={(focus) => {
          captureDrafts();
          openLibrary(focus);
        }}
        resumeRevision={resumeRevision}
        added={async (id) => {
          captureDrafts();
          const data = await reload();
          const p =
            (template
              ? data.plans.find((p) => p.id === id)
              : data.runs.find((r) => r.routine.id === id)?.routine) ??
            data.plans.find((p) => p.id === id);
          if (id !== selected) {
            setSelected(id);
            restoreMetadata(p ?? null, editDay, id, data.versions ?? []);
            restoreItem(null, { routineId: id, day: editDay });
          }
        }}
      />
      {plan && (
        <RoutineSourcePicker
          songs={songs}
          collection={collection}
          currentTitle={song?.title}
          query={search}
          changeQuery={setSearch}
          disabled={busy || active}
          choose={chooseSourceSong}
        />
      )}
    </>
  );
  return (
    <div
      className="modal-backdrop"
      style={suspended ? { display: "none" } : undefined}
      aria-hidden={suspended || undefined}
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        ref={attachDialog}
        className="settings-dialog routine-dialog"
        data-browse-compact={panes.compact ? "" : undefined}
        data-browse-pane={panes.pane}
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {busy && <TaskActivity />}
        {compose && plan && (
          <PassageSequenceDialog
            engineId={engineId}
            contentId={song?.contentId ?? ""}
            songTitle={song?.title ?? "跨曲目段落"}
            routineId={plan.id}
            day={editDay}
            planName={plan.name}
            close={() => setCompose(false)}
            added={async () => {
              await reload();
              await refreshPractice();
            }}
          />
        )}
        <div className="dialog-heading">
          <h2 id="routine-title">练习计划</h2>
          <span className="menu-spacer" />
          <button disabled={busy || contextPending} onClick={backup}>
            练习资料备份
          </button>
          <button
            autoFocus
            disabled={busy}
            aria-label="关闭练习计划"
            onClick={close}
          >
            关闭
          </button>
        </div>
        <div className="routine-toolbar">
          <button
            aria-pressed={!template}
            disabled={busy}
            onClick={() => changeView(false, day)}
          >
            当天安排
          </button>
          <button
            aria-pressed={template}
            disabled={busy}
            onClick={() => changeView(true, day)}
          >
            常用计划
          </button>
          <input
            aria-label="练习计划日期"
            type="date"
            value={day}
            disabled={busy || template}
            onChange={(e) => changeView(template, e.target.value)}
          />
          <span>
            {template
              ? "编辑模板，不改变已建立的当天安排"
              : "实际结果记录达标；跳过单独标记"}
          </span>
        </div>
        {launchPassage && (
          <p role="status" className="parameter-help">
            已选择“{launchPassage.name}
            ”。
            {plan
              ? "可在项目与目标中核对条件并保存。"
              : "请选择或创建计划，核对达标目标后保存项目。"}
            {plan && (
              <button
                className="browse-detail-inline-action"
                disabled={busy}
                onClick={() => {
                  setDetailSection("items");
                  panes.showDetails(false);
                  setEditorRequest((value) => value + 1);
                }}
              >
                查看带入的选段
              </button>
            )}
          </p>
        )}
        <WorkspaceReadStatus
          compact
          label={day + " 的计划与进度"}
          pending={listLoading}
          error={listError}
          hasData={loadedDay !== null}
          current={loadedDay === day && listVerified}
          readAt={loadedDay === day ? listReadAt : null}
          disabled={busy}
          retry={() => {
            void reload().catch(() => {});
          }}
        />
        {error && (
          <p role="alert" className="routine-error">
            {error}
          </p>
        )}
        <RoutineDraftShelf
          store={drafts}
          state={workbench}
          blocked={busy}
          currentMetadata={contextKey}
          currentItem={
            itemId || draftItemId.current
              ? routineItemKey(context, itemId ?? draftItemId.current!)
              : null
          }
          openMetadata={visitDraft}
          openItem={visitDraft}
          openPending={visitPending}
          openSchedule={visitSchedule}
        />
        {pendingListRefresh && (
          <p role="status">
            {pendingListRefresh}已写入。计划列表尚未刷新，重试不会再次执行修改。
            <button disabled={busy} onClick={retrySavedList}>
              重试读取已保存的计划
            </button>
          </p>
        )}
        {openedItem && (
          <p role="status">
            “{openedItem.title}”
            {openedItem.confirmed
              ? "已打开，当前界面尚未刷新。"
              : "是否已打开尚未确认。"}
            重试只读取当前练习状态，不会再次打开项目。
            <button disabled={busy} onClick={retryOpenedItem}>
              重试读取当前练习
            </button>
          </p>
        )}
        <BrowsePaneNavigation
          compact={panes.compact}
          pane={panes.pane}
          title={plan?.name ?? name}
          available={!!plan || detailSection === "metadata"}
          blocked={busy}
          listLabel="计划列表"
          detailLabel="计划详情"
          showList={() => panes.showList()}
          showDetails={() => panes.showDetails()}
        />
        <fieldset className="routine-layout" disabled={!listReady}>
          <aside
            {...planScroll}
            className="routine-plans"
            hidden={!panes.listVisible}
          >
            <RoutinePlanList
              plans={allPlans}
              templates={plans}
              runs={dayRuns}
              template={template}
              selected={selected}
              query={planQuery}
              page={planPage}
              busy={busy}
              create={newPlan}
              choose={choosePlan}
              changeQuery={(value) => {
                setPlanQuery(value);
                setPlanPage(0);
              }}
              changePage={setPlanPage}
            />
          </aside>
          <div
            {...detailScroll}
            className="routine-main"
            hidden={!panes.detailVisible}
          >
            <BrowseDetailWorkspace<RoutineDetailSection>
              value={detailSection}
              change={setDetailSection}
              label="练习计划详情分类"
              header={
                <>
                  <h3
                    className="browse-detail-heading"
                    tabIndex={-1}
                    data-browse-detail-heading
                    title={plan?.name ?? name}
                  >
                    {plan?.name ?? (name.trim() || "创建常用计划")}
                  </h3>
                  <p className="browse-detail-subtitle">
                    {template ? "常用计划模板" : day + " 的安排"}
                    {plan && (
                      <>
                        {" "}
                        · {plan.items.length} 个项目
                        {!template && (
                          <>
                            {" "}
                            · {completed} 项达标
                            {skipped > 0 && <> · {skipped} 项跳过</>}
                          </>
                        )}
                      </>
                    )}
                  </p>
                  {plan && (
                    <div className="browse-detail-actions">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          contextPending ||
                          !listReady ||
                          (!template && !active && !nextPracticeItem)
                        }
                        onClick={() => {
                          if (template) {
                            changeView(false, day);
                            setDetailSection("items");
                          } else if (active && state.routine) {
                            const current = state.routine;
                            if (current.progress.limited) {
                              const item = plan.items.find(
                                (item) => item.id === current.itemId,
                              );
                              if (item) openItem(item);
                              return;
                            }
                            void work(async () => {
                              const latest = await service.state();
                              if (
                                latest.routine?.routineId !==
                                  current.routineId ||
                                latest.routine.day !== current.day ||
                                latest.routine.itemId !== current.itemId
                              )
                                throw new Error(
                                  "当前项目已经改变，请重新读取练习计划。",
                                );
                              await refreshPractice();
                              dismissDialog();
                            }, false);
                          } else if (nextPracticeItem)
                            openItem(nextPracticeItem);
                        }}
                      >
                        {busy
                          ? "正在处理…"
                          : template
                            ? "查看当天安排"
                            : active
                              ? state.routine?.progress.limited
                                ? "继续未达标项目"
                                : "继续本项练习"
                              : nextPracticeItem
                                ? progress(nextPracticeItem.id)?.limited
                                  ? "继续未达标项目"
                                  : "开始下一项练习"
                                : "本日项目已处理"}
                      </button>
                      <button disabled={locked || !song} onClick={newItem}>
                        添加当前练习
                      </button>
                    </div>
                  )}
                  {active && detailSection !== "items" && (
                    <p className="browse-detail-note">
                      当前正在进行计划项目。结束本项后，可编辑安排或切换曲目。
                      <button
                        className="browse-detail-inline-action"
                        onClick={() => {
                          setDetailSection("items");
                          panes.showDetails();
                        }}
                      >
                        查看当前项目
                      </button>
                    </p>
                  )}
                  {metadataDirty && detailSection !== "metadata" && (
                    <p className="browse-detail-note">
                      计划信息有未保存修改。
                      <button
                        className="browse-detail-inline-action"
                        onClick={() => {
                          setDetailSection("metadata");
                          panes.showDetails();
                        }}
                      >
                        继续编辑计划信息
                      </button>
                    </p>
                  )}
                  {plan && itemDirty && detailSection !== "items" && (
                    <p className="browse-detail-note">
                      当前项目有未保存修改。
                      <button
                        className="browse-detail-inline-action"
                        onClick={() => {
                          setDetailSection("items");
                          setEditorRequest((value) => value + 1);
                        }}
                      >
                        继续编辑项目
                      </button>
                    </p>
                  )}
                </>
              }
              sections={[
                {
                  id: "items",
                  label: "项目与目标",
                  count: plan?.items.length,
                  content: itemsContent,
                },
                { id: "metadata", label: "计划信息", content: metadataContent },
                { id: "sources", label: "添加与编排", content: sourcesContent },
              ]}
            />
          </div>
        </fieldset>
        <p className="routine-footnote">
          常用计划是模板。当天安排首次使用时复制模板；修改某一天不会改动其他日期或模板。打开项目后按主界面“开始练习”，达标后再选择下一项。
        </p>
      </section>
    </div>
  );
}
