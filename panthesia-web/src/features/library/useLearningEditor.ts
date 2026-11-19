import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api";
import type { LearningDraft, SongLearning } from "../../songLearning";
import {
  busyEditDraft,
  flushEditDraft,
  editDraftPersistence,
  editDraftValue,
  isEditDraftBusy,
  openEditDraft,
} from "../editing/editDraftStore";
import {
  defaultLearning,
  learningInputs,
  learningValue,
  parseLearningInputs,
  type LearningEditDraft,
  type LearningInputs,
  type LearningSection,
} from "./learningDraft";

class SupersededLearningRead extends Error {}
const equal = (a: unknown, b: unknown) =>
  editDraftValue(a) === editDraftValue(b);
const intended = (value: LearningDraft | SongLearning | null) =>
  value ? { ...learningValue(value)!, goal: value.goal.trim() } : null;
const noSubscribe = () => () => {};
export function useLearningEditor({
  contentId,
  path,
  title,
  previous,
  memory,
  engineId,
  changed,
}: {
  contentId: string;
  path: string;
  title: string;
  previous: SongLearning | null;
  memory?: Map<string, LearningEditDraft>;
  engineId?: string;
  changed: () => Promise<void>;
}) {
  const [own] = useState(() => new Map<string, LearningEditDraft>()),
    drafts = memory ?? own;
  const persistence = editDraftPersistence(drafts);
  const [, redraw] = useState(0);
  useSyncExternalStore(persistence?.subscribe ?? noSubscribe, () =>
    editDraftValue([drafts.get(contentId), isEditDraftBusy(drafts, contentId)]),
  );
  const [baseValue, setBaseValue] = useState(previous),
    [latest, setLatest] = useState(previous);
  const [verified, setVerified] = useState(false),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [discarded, setDiscarded] = useState<LearningEditDraft | null>(null);
  const [section, setSection] = useState<LearningSection>(
    () => drafts.get(contentId)?.section ?? "plan",
  );
  const alive = useRef(true),
    working = useRef(false),
    sequence = useRef(0),
    boundEngine = useRef(engineId);
  const identity = JSON.stringify([contentId, path, engineId]),
    active = useRef(identity);
  active.current = identity;
  const record = drafts.get(contentId),
    base = record ? record.base : baseValue;
  const inputs =
    record?.inputs ??
    learningInputs(record?.draft ?? base ?? defaultLearning());
  const parsed = parseLearningInputs(inputs),
    pending = record?.pending;
  const dirty = !equal(inputs, learningInputs(base));
  const conflict = verified && !equal(base, latest);
  const put = (value: LearningEditDraft) => {
    drafts.set(contentId, value);
    if (!persistence && alive.current) redraw((n) => n + 1);
  };
  const remove = () => {
    drafts.delete(contentId);
    if (!persistence && alive.current) redraw((n) => n + 1);
  };
  const keep = (
    next: LearningInputs,
    nextBase = base,
    receipt: LearningEditDraft["pending"] | null = pending,
  ) => {
    if (!receipt && equal(next, learningInputs(nextBase))) remove();
    else
      put({
        path,
        title,
        base: nextBase,
        draft: parseLearningInputs(next).value,
        inputs: next,
        section,
        ...(receipt ? { pending: receipt } : {}),
      });
  };
  const engine = async () => {
    if (!boundEngine.current) {
      const current = await api.state();
      if (!alive.current || active.current !== identity)
        throw new SupersededLearningRead();
      boundEngine.current ??= current.stateOrder?.engineId;
      if (!boundEngine.current)
        throw new Error("练习室连接尚未准备好，请稍后重新读取。");
    }
    return boundEngine.current;
  };
  const read = async () => {
    const request = ++sequence.current,
      source = identity;
    if (source !== active.current) throw new SupersededLearningRead();
    setReading(true);
    setVerified(false);
    try {
      const result = await api.readLearningState(contentId, await engine());
      if (
        !alive.current ||
        request !== sequence.current ||
        source !== active.current
      )
        throw new SupersededLearningRead();
      setLatest(result.value);
      setVerified(result.writeSettled);
      const saved = drafts.get(contentId);
      if (
        result.writeSettled &&
        saved?.pending &&
        (!saved.pending.engineId ||
          saved.pending.engineId === boundEngine.current) &&
        equal(intended(result.value), intended(saved.pending.value))
      ) {
        put({ ...saved, pending: { ...saved.pending, phase: "refresh" } });
      } else if (
        result.writeSettled &&
        saved &&
        !saved.pending &&
        equal(learningValue(saved.base), learningValue(result.value))
      ) {
        if (!equal(saved.base, result.value))
          put({ ...saved, base: result.value });
      } else if (!saved) setBaseValue(result.value);
      if (
        saved?.pending?.engineId &&
        saved.pending.engineId !== boundEngine.current
      )
        setNotice("原提交来自上次连接，可核对当前资料后保留输入继续编辑。");
      else if (!result.writeSettled)
        setNotice("学习资料仍在保存，可继续查看；完成后重新读取以核对结果。");
      return result;
    } finally {
      if (alive.current && request === sequence.current) setReading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    setError("");
    setNotice("");
    setVerified(false);
    boundEngine.current = engineId;
    const release = openEditDraft(drafts, contentId);
    void read().catch((failure) => {
      if (
        alive.current &&
        active.current === identity &&
        !(failure instanceof SupersededLearningRead)
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      alive.current = false;
      sequence.current++;
      release();
    };
  }, [identity]);
  const [writing, setWriting] = useState(false);
  const job = async (action: () => Promise<void>, editing = false) => {
    if (working.current || isEditDraftBusy(drafts, contentId)) return;
    working.current = true;
    if (editing) busyEditDraft(drafts, contentId, true);
    setWriting(editing);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      if (
        alive.current &&
        active.current === identity &&
        !(failure instanceof SupersededLearningRead)
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (editing) busyEditDraft(drafts, contentId, false);
      if (alive.current) setWriting(false);
      if (alive.current) setBusy(false);
    }
  };
  const finish = async () => {
    const saved = drafts.get(contentId),
      result = await read();
    if (
      saved?.pending?.engineId &&
      saved.pending.engineId !== boundEngine.current
    )
      throw new Error("原提交来自上次连接。可核对当前资料后保留输入继续编辑。");
    if (!result.writeSettled)
      throw new Error("资料写入尚未结束，请稍后核对。原提交内容继续保留。");
    if (
      !saved?.pending ||
      (saved.pending.phase === "unconfirmed" &&
        !equal(intended(result.value), intended(saved.pending.value)))
    )
      throw new Error("当前资料与原提交不同，请核对最新内容后继续编辑。");
    const current = drafts.get(contentId);
    if (
      !current?.pending ||
      !equal(current.inputs, saved.inputs) ||
      !equal(current.pending.value, saved.pending.value)
    )
      throw new Error("当前输入已有更新，请核对后继续。");
    await changed();
    if (!alive.current) return;
    const afterRefresh = drafts.get(contentId);
    if (
      !afterRefresh ||
      !equal(
        [
          afterRefresh.base,
          afterRefresh.inputs,
          afterRefresh.draft,
          afterRefresh.pending,
        ],
        [current.base, current.inputs, current.draft, current.pending],
      )
    )
      throw new Error("刷新期间输入已有更新，原资料与输入继续保留。");
    setBaseValue(result.value);
    setLatest(result.value);
    remove();
    setNotice("学习资料已保存并读取。");
  };
  const write = async (
    value: LearningDraft | null,
    original: LearningEditDraft,
  ) => {
    const source = await engine(),
      receipt = { phase: "unconfirmed" as const, value, engineId: source };
    if (identity !== active.current) throw new SupersededLearningRead();
    const submitting = { ...original, pending: receipt };
    put(submitting);
    flushEditDraft(drafts);
    try {
      const result = await api.commandForEngine<{ ok: boolean }>(source, {
        type: "saveSongLearning",
        path,
        content_id: contentId,
        value,
        expected: original.base,
      });
      if (result.ok !== true)
        throw new Error("学习资料保存回复不完整，请读取原结果后核对。");
      if (equal(drafts.get(contentId), submitting))
        put({ ...submitting, pending: { ...receipt, phase: "refresh" } });
    } catch (failure) {
      if (alive.current) {
        try {
          const result = await read();
          if (
            result.writeSettled &&
            equal(intended(result.value), intended(value))
          ) {
            await finish();
            return;
          }
        } catch {}
      }
      throw failure;
    }
    if (alive.current) await finish();
  };
  return {
    engineId: boundEngine.current,
    inputs,
    value: parsed.value,
    inputError: parsed.error,
    base,
    latest,
    pending,
    dirty,
    conflict,
    verified,
    reading,
    busy: busy || isEditDraftBusy(drafts, contentId),
    writing: writing || isEditDraftBusy(drafts, contentId),
    error,
    notice,
    section,
    change(next: LearningInputs) {
      if (working.current || pending) return;
      keep(next);
      setError("");
      setNotice("");
    },
    changeSection(next: LearningSection) {
      setSection(next);
      const current = drafts.get(contentId);
      if (current) put({ ...current, section: next });
    },
    refresh: () =>
      job(async () => {
        await read();
      }),
    save: (removeGoal = false) =>
      job(async () => {
        if (!verified || pending || conflict)
          throw new Error("请先核对最新资料与原提交结果。");
        if (!removeGoal && parsed.error) throw new Error(parsed.error);
        await write(removeGoal ? null : parsed.value, {
          path,
          title,
          base,
          draft: parsed.value,
          inputs,
          section,
        });
      }, true),
    retry: () =>
      job(async () => {
        const saved = drafts.get(contentId);
        if (!saved?.pending || saved.pending.phase !== "unconfirmed") return;
        if (
          saved.pending.engineId &&
          saved.pending.engineId !== (await engine())
        )
          throw new Error("原提交来自上次连接，请核对后继续编辑。");
        const result = await read();
        if (!result.writeSettled)
          throw new Error("原保存仍在进行，请稍后核对。");
        if (equal(intended(result.value), intended(saved.pending.value))) {
          await finish();
          return;
        }
        if (!equal(result.value, saved.base))
          throw new Error("资料已变化，请合并输入后重新保存。");
        await write(saved.pending.value, saved);
      }, true),
    finish: () => job(finish),
    discarded: !!discarded,
    undoDiscard() {
      if (!discarded || working.current || pending || dirty) return;
      setBaseValue(discarded.base);
      put(discarded);
      setDiscarded(null);
      setNotice("已恢复还原前的输入。");
    },
    adoptLatest() {
      if (working.current || !verified) return;
      if (dirty || pending)
        setDiscarded(
          record ?? { path, title, base, draft: parsed.value, inputs, section },
        );
      setBaseValue(latest);
      remove();
      setError("");
      setNotice("已采用最新资料。");
    },
    continueEditing(next = inputs) {
      if (working.current || !verified) return;
      setBaseValue(latest);
      keep(next, latest, null);
      setError("");
      setNotice("输入已保留，保存时会核对最新资料。");
    },
    copy: () => ({
      contentId,
      path,
      title,
      base,
      inputs,
      draft: parsed.value,
      pending,
    }),
  };
}
