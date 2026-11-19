import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api";
import {
  annotationText,
  annotationInputError,
  type AnnotationDraft,
  type AnnotationText,
} from "./annotationDraft";
import type { Annotation, HistoryEntry } from "./historyTypes";
import {
  busyEditDraft,
  flushEditDraft,
  editDraftPersistence,
  editDraftValue,
  isEditDraftBusy,
  openEditDraft,
} from "../editing/editDraftStore";

class SupersededAnnotationRead extends Error {}
const equal = (a: unknown, b: unknown) =>
    editDraftValue(a) === editDraftValue(b),
  noSubscribe = () => () => {};
export function useAnnotationEditor({
  value,
  entry,
  memory,
  draftKey,
  engineId,
  active,
  save,
  refresh,
  received,
}: {
  value: Annotation | null;
  entry?: HistoryEntry;
  memory?: Map<string, AnnotationDraft>;
  draftKey: string;
  engineId?: string;
  active: boolean;
  save: (
    value: AnnotationText,
    expected: Annotation | null,
    engineId?: string,
  ) => Promise<Annotation | null>;
  refresh?: () => void;
  received?: (value: Annotation | null) => void;
}) {
  const [own] = useState(() => new Map<string, AnnotationDraft>()),
    drafts = memory ?? own;
  const persistence = editDraftPersistence(drafts),
    [, redraw] = useState(0);
  useSyncExternalStore(persistence?.subscribe ?? noSubscribe, () =>
    editDraftValue([drafts.get(draftKey), isEditDraftBusy(drafts, draftKey)]),
  );
  const [baseValue, setBaseValue] = useState(value),
    [latest, setLatest] = useState(value);
  const [verified, setVerified] = useState(false),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false);
  const [field, setField] = useState<keyof AnnotationText>(
    () => drafts.get(draftKey)?.field ?? "note",
  );
  const [discarded, setDiscarded] = useState<AnnotationDraft | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const alive = useRef(true),
    working = useRef(false),
    sequence = useRef(0),
    boundEngine = useRef(engineId);
  const source = JSON.stringify([
      entry?.contentId,
      entry?.id,
      draftKey,
      engineId,
    ]),
    sourceRef = useRef(source);
  sourceRef.current = source;
  const record = drafts.get(draftKey),
    base = record ? record.base : baseValue,
    draft = record?.draft ?? annotationText(base),
    pending = record?.pending;
  const dirty = !equal(draft, annotationText(base)),
    conflict = !equal(latest, base);
  const put = (next: AnnotationDraft) => {
    drafts.set(draftKey, next);
    if (!persistence && alive.current) redraw((n) => n + 1);
  };
  const remove = () => {
    drafts.delete(draftKey);
    if (!persistence && alive.current) redraw((n) => n + 1);
  };
  const adopt = (stored: Annotation | null) => {
    setBaseValue(stored);
    setLatest(stored);
    remove();
  };
  const engine = async () => {
    if (!boundEngine.current) {
      const snapshot = await api.state();
      if (!alive.current || sourceRef.current !== source)
        throw new SupersededAnnotationRead();
      boundEngine.current ??= snapshot.stateOrder?.engineId;
      if (!boundEngine.current)
        throw new Error("练习室连接尚未准备好，请稍后再读取。");
    }
    return boundEngine.current;
  };
  const read = async () => {
    if (!entry) throw new Error("原演奏记录身份尚未读到，可重新打开原记录。");
    if (source !== sourceRef.current) throw new SupersededAnnotationRead();
    const request = ++sequence.current;
    setReading(true);
    setVerified(false);
    try {
      const result = await api.commandForEngine<
        import("../../engine/commands.generated").AnnotationRead
      >(await engine(), {
        type: "readHistoryAnnotation",
        content_id: entry.contentId,
        id: entry.id,
      });
      if (
        !alive.current ||
        source !== sourceRef.current ||
        request !== sequence.current
      )
        throw new SupersededAnnotationRead();
      if (
        !result ||
        result.contentId !== entry.contentId ||
        result.id !== entry.id ||
        !Object.hasOwn(result, "annotation") ||
        typeof result.writeSettled !== "boolean"
      )
        throw new Error("评语读取结果不完整，请重新读取。");
      if (result.writeSettled) received?.(result.annotation);
      setLatest(result.annotation);
      setVerified(result.writeSettled);
      const saved = drafts.get(draftKey);
      if (
        result.writeSettled &&
        saved?.pending &&
        (!saved.pending.engineId ||
          saved.pending.engineId === boundEngine.current) &&
        equal(annotationText(result.annotation), saved.pending.value)
      )
        put({ ...saved, pending: { ...saved.pending, phase: "refresh" } });
      else if (
        result.writeSettled &&
        saved &&
        !saved.pending &&
        equal(annotationText(saved.base), annotationText(result.annotation))
      ) {
        if (!equal(saved.base, result.annotation))
          put({ ...saved, base: result.annotation });
      } else if (!saved) setBaseValue(result.annotation);
      if (
        saved?.pending?.engineId &&
        saved.pending.engineId !== boundEngine.current
      )
        setNotice("原提交来自上次连接，可核对当前评语后保留输入继续编辑。");
      else if (!result.writeSettled)
        setNotice("评语相关资料仍在保存，完成后可重新核对。");
      return result;
    } finally {
      if (alive.current && request === sequence.current) setReading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    const release = openEditDraft(drafts, draftKey);
    return () => {
      alive.current = false;
      sequence.current++;
      release();
    };
  }, [draftKey]);
  useEffect(() => {
    boundEngine.current = engineId;
    setVerified(false);
  }, [engineId]);
  useEffect(() => {
    setVerified(false);
    if (!active && !working.current) {
      sequence.current++;
      setReading(false);
    }
  }, [active]);
  useEffect(() => {
    if (!active || !entry || working.current || verified) return;
    void read().catch((failure) => {
      if (
        alive.current &&
        sourceRef.current === source &&
        !(failure instanceof SupersededAnnotationRead)
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    });
  }, [source, active, busy, verified]);
  useEffect(() => {
    if (!working.current && !equal(value, latest)) {
      setLatest(value);
      if (!drafts.get(draftKey)) setBaseValue(value);
      setVerified(false);
    }
  }, [editDraftValue(value)]);
  const [writing, setWriting] = useState(false);
  const job = async (action: () => Promise<void>, editing = false) => {
    if (working.current || isEditDraftBusy(drafts, draftKey)) return;
    working.current = true;
    if (editing) busyEditDraft(drafts, draftKey, true);
    setWriting(editing);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      if (
        alive.current &&
        sourceRef.current === source &&
        !(failure instanceof SupersededAnnotationRead)
      )
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      working.current = false;
      if (editing) busyEditDraft(drafts, draftKey, false);
      if (alive.current) setWriting(false);
      if (alive.current) setBusy(false);
    }
  };
  const finish = async () => {
    const original = drafts.get(draftKey),
      result = await read();
    if (!result.writeSettled)
      throw new Error("资料写入尚未结束，原提交内容继续保留。");
    if (
      !original?.pending ||
      (original.pending.engineId &&
        original.pending.engineId !== boundEngine.current) ||
      (original.pending.phase === "unconfirmed" &&
        !equal(annotationText(result.annotation), original.pending.value))
    )
      throw new Error("当前评语与原提交不同，请核对后继续编辑。");
    const current = drafts.get(draftKey);
    if (
      !current?.pending ||
      !equal(current.pending.value, original.pending.value) ||
      !equal(current.draft, original.draft)
    )
      throw new Error("评语输入已有更新，请重新核对。");
    adopt(result.annotation);
    if (!received) refresh?.();
    setNotice("已核对并读取保存的评语。");
  };
  const write = async (
    desired: AnnotationText,
    expected: Annotation | null,
  ) => {
    const invalid = annotationInputError(desired);
    if (invalid) throw new Error(invalid);
    const origin = entry ? await engine() : engineId;
    if (source !== sourceRef.current)
      throw new Error("来源已变化，评语输入继续保留。");
    const submitting: AnnotationDraft = {
      base: expected,
      draft: desired,
      entry,
      field,
      pending: {
        phase: "unconfirmed",
        value: desired,
        expected,
        engineId: origin,
      },
    };
    put(submitting);
    flushEditDraft(drafts);
    try {
      const stored = await save(desired, expected, origin);
      if (!stored || !equal(annotationText(stored), desired))
        throw new Error("评语保存回复不完整，请核对原结果。");
      if (!entry) {
        if (alive.current) {
          adopt(stored);
          setNotice("评语已保存。");
        }
        return;
      }
      if (equal(drafts.get(draftKey), submitting))
        put({
          ...submitting,
          pending: { ...submitting.pending!, phase: "refresh" },
        });
    } catch (failure) {
      if (alive.current) {
        try {
          const result = await read();
          if (
            result.writeSettled &&
            equal(annotationText(result.annotation), desired)
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
    field,
    changeField(next: keyof AnnotationText) {
      setField(next);
      const saved = drafts.get(draftKey);
      if (saved) put({ ...saved, field: next });
    },
    base,
    draft,
    latest,
    pending,
    dirty,
    conflict,
    verified,
    reading,
    busy: busy || isEditDraftBusy(drafts, draftKey),
    writing: writing || isEditDraftBusy(drafts, draftKey),
    error,
    notice,
    inputError: annotationInputError(draft),
    change(next: AnnotationText) {
      if (working.current || pending) return;
      if (equal(next, annotationText(base))) remove();
      else put({ base, draft: next, entry, field });
      setNotice("");
      setError("");
    },
    save: () =>
      job(async () => {
        if (pending) return;
        const result = entry ? await read() : null;
        if (result && (!result.writeSettled || !equal(result.annotation, base)))
          throw new Error("最新评语或保存状态已变化，请先核对输入。");
        await write(draft, base);
      }, true),
    refresh: () =>
      job(async () => {
        await read();
        if (!received) refresh?.();
      }),
    finish: () => job(finish),
    retry: () =>
      job(async () => {
        const saved = drafts.get(draftKey);
        if (!saved?.pending || saved.pending.phase !== "unconfirmed") return;
        if (
          saved.pending.engineId &&
          saved.pending.engineId !== (await engine())
        )
          throw new Error("原提交来自上次连接，请核对当前资料后继续编辑。");
        const result = await read();
        if (!result.writeSettled)
          throw new Error("原保存仍在进行，请稍后核对。");
        if (equal(annotationText(result.annotation), saved.pending.value)) {
          await finish();
          return;
        }
        if (!equal(result.annotation, saved.pending.expected))
          throw new Error("评语已有更新，请合并输入后重新保存。");
        await write(saved.pending.value, saved.pending.expected);
      }, true),
    discarded: !!discarded,
    undoDiscard() {
      if (!discarded || working.current || pending || dirty) return;
      setBaseValue(discarded.base);
      put(discarded);
      setDiscarded(null);
      setNotice("已恢复还原前的评语输入。");
    },
    adoptLatest() {
      if (working.current) return;
      if (dirty || pending) setDiscarded(record ?? { base, draft, entry });
      adopt(latest);
      setNotice("已采用最新评语。");
      setError("");
    },
    merge(next: AnnotationText) {
      if (working.current || !verified) return;
      setBaseValue(latest);
      if (equal(next, annotationText(latest))) remove();
      else put({ base: latest, draft: next, entry, field });
      setError("");
      setNotice("输入已保留，保存时会核对最新评语。");
    },
    copy: () => ({ entry, base, draft, pending }),
  };
}
