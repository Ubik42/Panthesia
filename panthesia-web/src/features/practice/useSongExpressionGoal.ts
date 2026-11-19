import {
  expressionKey,
  sameExpressionGoal as equal,
  expressionInputError,
  expressionInputs,
  parseExpressionInputs,
  type ExpressionInputs,
  type ExpressionDraft,
} from "./expressionDraft";
export type { ExpressionDraft } from "./expressionDraft";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type LoadedSong, type Snapshot } from "../../api";
import type {
  ExpressionGoal,
  ExpressionGoalSnapshot,
} from "../../engine/commands.generated";
import { capturePracticeScope } from "../../engine/useCatalogRead";
import { matchesSong } from "../../engine/stateOrder";
import {
  busyEditDraft,
  flushEditDraft,
  editDraftPersistence,
  editDraftValue,
  isEditDraftBusy,
} from "../editing/editDraftStore";

const noSubscribe = () => () => {};
const emptySnapshot = () => "";

/** The draft map owns inputs and receipts; playback snapshots own saved targets. */
export function useSongExpressionGoal(
  song: LoadedSong | null,
  goal: ExpressionGoal | null,
  memory: Map<string, ExpressionDraft>,
  refresh: () => Promise<Snapshot>,
  ready = true,
) {
  const contentId = song?.contentId ?? "";
  const persistence = editDraftPersistence(memory);
  const selectedState = useSyncExternalStore(
    persistence?.subscribe ?? noSubscribe,
    () =>
      editDraftValue([
        memory.get(contentId),
        isEditDraftBusy(memory, contentId),
      ]),
    emptySnapshot,
  );
  const [localRevision, redraw] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const working = useRef(false),
    mounted = useRef(true);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const sourceKey = song
    ? JSON.stringify([capturePracticeScope(song), song.sourcePath])
    : "";
  const active = useRef({ key: sourceKey, generation: 0 });
  if (active.current.key !== sourceKey)
    active.current = {
      key: sourceKey,
      generation: active.current.generation + 1,
    };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setNotice("");
  }, [sourceKey]);
  const record = memory.get(contentId);
  const base = record ? record.base : goal,
    draft = record ? record.draft : goal;
  const pending = record?.pending;
  const inputs = record?.inputs ?? expressionInputs(draft);
  const parsedInputs = parseExpressionInputs(inputs);
  const dirty =
    !equal(base, draft) ||
    editDraftValue(inputs) !== editDraftValue(expressionInputs(base));
  const conflict =
    !!record && pending?.phase !== "refresh" && !equal(base, goal);
  const notify = () => {
    if (mounted.current && !persistence) redraw((value) => value + 1);
  };
  const put = (id: string, value: ExpressionDraft) => {
    memory.set(id, value);
    notify();
  };
  const remove = (id: string) => {
    memory.delete(id);
    notify();
  };
  const fields = (value?: ExpressionDraft) => ({
    path: value?.path ?? song?.sourcePath ?? undefined,
    title: value?.title ?? song?.title ?? "原曲目",
  });
  useEffect(() => {
    if (
      !ready ||
      !record ||
      working.current ||
      isEditDraftBusy(memory, contentId)
    )
      return;
    if (
      !pending &&
      !parsedInputs.error &&
      equal(goal, draft) &&
      editDraftValue(inputs) === editDraftValue(expressionInputs(goal))
    ) {
      remove(contentId);
      if (dirty) setNotice("当前目标已与输入一致。");
    }
  }, [
    contentId,
    expressionKey(goal),
    selectedState,
    localRevision,
    busy,
    ready,
  ]);
  const job = async (action: () => Promise<void>) => {
    if (
      !ready ||
      working.current ||
      isEditDraftBusy(memory, contentId) ||
      !song
    )
      return;
    const id = contentId,
      generation = active.current.generation;
    working.current = true;
    busyEditDraft(memory, id, true);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      if (mounted.current && active.current.generation === generation)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      busyEditDraft(memory, id, false);
      if (mounted.current) setBusy(false);
    }
  };
  const readCurrent = async () => {
    const key = active.current.key,
      generation = active.current.generation;
    const snapshot = await refresh();
    if (
      !mounted.current ||
      !readyRef.current ||
      active.current.key !== key ||
      active.current.generation !== generation ||
      !matchesSong(snapshot, song) ||
      (snapshot.stateOrder?.engineId ?? null) !== (song?.engineId ?? null)
    )
      throw new Error(
        "曲目或练习来源已变化，原输入与保存回执继续保留，请返回原曲目处理。",
      );
    return snapshot;
  };
  const readProof = async (allowNewConnection = false) => {
    if (!song) throw new Error("原曲目尚未读到。");
    const originalEngine = memory.get(contentId)?.pending?.engineId;
    if (
      !allowNewConnection &&
      originalEngine &&
      originalEngine !== song.engineId
    )
      throw new Error("原提交来自上次连接，请核对当前目标后保留输入继续编辑。");
    const generation = active.current.generation;
    const result = await api.commandForEngine<ExpressionGoalSnapshot>(
      song.engineId ?? undefined,
      { type: "readSongExpressionGoal", content_id: contentId },
    );
    if (
      !mounted.current ||
      generation !== active.current.generation ||
      !readyRef.current
    )
      throw new Error("曲目或连接已改变，原输入与回执继续保留。");
    if (
      !result ||
      result.contentId !== contentId ||
      !Object.hasOwn(result, "goal") ||
      typeof result.writeSettled !== "boolean"
    )
      throw new Error("专项要求结果不完整，请重新读取。");
    if (!result.writeSettled)
      throw new Error(
        "资料写入尚未结束，请稍后核对专项要求。原提交内容继续保留。",
      );
    return result;
  };
  const finishRefresh = async (saved: ExpressionDraft) => {
    const actual = await readProof();
    if (
      !saved.pending ||
      (saved.pending.phase === "unconfirmed" &&
        !equal(actual.goal, saved.pending.goal))
    )
      throw new Error("当前目标与原提交不同，请核对最新目标后继续编辑。");
    await readCurrent();
    if (editDraftValue(memory.get(contentId)) !== editDraftValue(saved))
      throw new Error("暂存内容已有更新，请核对当前输入后继续。");
    remove(contentId);
    setNotice("已核对并读取当前曲目的专项要求。");
  };
  const write = async (
    desired: ExpressionGoal | null,
    original: ExpressionDraft,
  ) => {
    if (!song) return;
    const invalid = expressionInputError(desired);
    if (invalid) throw new Error(invalid);
    const source = capturePracticeScope(song),
      generation = active.current.generation;
    const current = () =>
      mounted.current && active.current.generation === generation;
    const submitting: ExpressionDraft = {
      ...original,
      ...fields(original),
      pending: {
        phase: "unconfirmed",
        goal: desired,
        expected: original.base,
        engineId: source.engineId ?? undefined,
      },
    };
    put(source.contentId, submitting);
    flushEditDraft(memory);
    let result: ExpressionGoalSnapshot;
    try {
      result = await api.editPractice<ExpressionGoalSnapshot>(source, {
        type: "editSongExpressionGoal",
        goal: desired,
        expected: original.base,
      });
      if (
        !result ||
        result.contentId !== source.contentId ||
        !Object.hasOwn(result, "goal") ||
        !equal(result.goal, desired)
      )
        throw new Error("专项要求保存结果不完整，请读取原结果后核对。");
    } catch (failure) {
      if (current()) {
        try {
          const snapshot = await readProof();
          if (
            equal(snapshot.goal, desired) &&
            editDraftValue(memory.get(source.contentId)) ===
              editDraftValue(submitting)
          ) {
            await finishRefresh(submitting);
            setNotice("当前目标与提交内容一致，已恢复保存结果。");
            return;
          }
        } catch {
          /* The original request remains available when its result cannot be read. */
        }
      }
      throw failure;
    }
    const receipt: ExpressionDraft = {
      ...submitting,
      base: result.goal,
      draft: result.goal,
      pending: {
        phase: "refresh",
        goal: result.goal,
        expected: original.base,
        engineId: source.engineId ?? undefined,
      },
    };
    put(source.contentId, receipt);
    if (current()) {
      setNotice("曲目专项要求已保存。");
      try {
        await finishRefresh(receipt);
      } catch (failure) {
        throw new Error(
          `目标已保存，界面读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
    }
  };
  return {
    draft,
    base,
    savedGoal: pending?.phase === "refresh" ? pending.goal : goal,
    dirty,
    conflict,
    pendingRefresh: pending?.phase === "refresh",
    pendingPhase: pending?.phase,
    busy: busy || isEditDraftBusy(memory, contentId),
    error,
    notice,
    inputs,
    inputError: parsedInputs.error || expressionInputError(draft),
    changeInputs: (next: ExpressionInputs) => {
      if (
        !ready ||
        !song ||
        working.current ||
        isEditDraftBusy(memory, contentId) ||
        pending
      )
        return;
      const parsed = parseExpressionInputs(next);
      if (editDraftValue(next) === editDraftValue(expressionInputs(base)))
        remove(contentId);
      else
        put(contentId, {
          base,
          draft: parsed.value,
          inputs: next,
          ...fields(record),
        });
      setError("");
      setNotice("");
    },
    save: () =>
      job(async () => {
        if (pending || conflict || !dirty) return;
        if (parsedInputs.error) throw new Error(parsedInputs.error);
        await write(draft, { base, draft, inputs, ...fields(record) });
      }),
    retryRefresh: () =>
      job(async () => {
        const saved = memory.get(contentId);
        if (saved?.pending) await finishRefresh(saved);
        else {
          await readCurrent();
          setNotice("已读取最新专项要求，原输入继续保留。");
        }
      }),
    retrySave: () =>
      job(async () => {
        const saved = memory.get(contentId);
        if (saved?.pending?.phase !== "unconfirmed") return;
        const actual = await readProof();
        if (equal(actual.goal, saved.pending.goal)) {
          await finishRefresh(saved);
          return;
        }
        if (!equal(saved.base, actual.goal))
          throw new Error("目标已在其他操作中修改，请核对后继续编辑。");
        await write(saved.pending.goal, saved);
      }),
    continueEditing: () =>
      job(async () => {
        if (!pending) return;
        const actual = await readProof(true);
        await readCurrent();
        const next = { base: actual.goal, draft, inputs, ...fields(record) };
        if (
          equal(actual.goal, draft) &&
          editDraftValue(inputs) ===
            editDraftValue(expressionInputs(actual.goal))
        )
          remove(contentId);
        else put(contentId, next);
        setError("");
        setNotice("原输入已保留，再次保存会核对最新目标。");
      }),
    change: (next: ExpressionGoal | null) => {
      if (
        !ready ||
        !song ||
        working.current ||
        isEditDraftBusy(memory, contentId) ||
        pending
      )
        return;
      if (equal(base, next)) remove(contentId);
      else put(contentId, { base, draft: next, ...fields(record) });
      setError("");
      setNotice("");
    },
    undo: () => {
      if (
        !ready ||
        working.current ||
        isEditDraftBusy(memory, contentId) ||
        pending
      )
        return;
      remove(contentId);
      setError("");
      setNotice("");
    },
    resolveConflictInputs: (next: ExpressionInputs) => {
      if (
        !ready ||
        working.current ||
        isEditDraftBusy(memory, contentId) ||
        pending
      )
        return;
      const parsed = parseExpressionInputs(next);
      if (editDraftValue(next) === editDraftValue(expressionInputs(goal)))
        remove(contentId);
      else
        put(contentId, {
          base: goal,
          draft: parsed.value,
          inputs: next,
          ...fields(record),
        });
      setError("");
      setNotice("合并后的输入已保留，请核对后保存。");
    },
    resolveConflict: (merged: ExpressionGoal | null) => {
      if (
        !ready ||
        working.current ||
        isEditDraftBusy(memory, contentId) ||
        pending
      )
        return;
      if (equal(goal, merged)) remove(contentId);
      else put(contentId, { base: goal, draft: merged, ...fields(record) });
      setError("");
      setNotice(
        equal(goal, merged)
          ? "已采用最新目标。"
          : "合并结果已保留，请核对后保存。",
      );
    },
  };
}
