import { useEffect, useRef, useState } from "react";
import type { ReplayClip, ReplayClipRows } from "./historyTypes";
import { registerCloseParticipant } from "../../app/closePreparation";

export interface ReplayClipDraft {
  id: string | null;
  name: string;
  notes: string;
  baseRevision: string | null;
}
type Range = { start: number; end: number };
const usableRange = (range: Range | null): Range | null =>
  range &&
  Number.isFinite(range.start) &&
  Number.isFinite(range.end) &&
  range.start >= 0 &&
  range.end - range.start >= 0.1
    ? range
    : null;
type RetainedDraft = {
  draft: ReplayClipDraft;
  range: Range | null;
  error: string;
  original: string | null;
  readPending: boolean;
};
const memory = new Map<string, RetainedDraft>();
let listening = false;
const emptyDraft = (): ReplayClipDraft => ({
  id: null,
  name: "",
  notes: "",
  baseRevision: null,
});
const hasInput = (draft: ReplayClipDraft) =>
  !!(draft.id || draft.name || draft.notes);
function parseDraft(text: string): Pick<RetainedDraft, "draft" | "range"> {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("草稿格式无法识别");
  const saved = raw as Record<string, unknown>;
  if (
    (saved.id != null &&
      (typeof saved.id !== "string" || saved.id.length > 160)) ||
    (saved.name != null &&
      (typeof saved.name !== "string" || saved.name.length > 80)) ||
    (saved.notes != null &&
      (typeof saved.notes !== "string" || saved.notes.length > 2000)) ||
    (saved.baseRevision != null &&
      (typeof saved.baseRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(saved.baseRevision)))
  )
    throw new Error("草稿字段超出支持范围");
  let range: Range | null = null;
  if (saved.start !== undefined || saved.end !== undefined) {
    if (
      typeof saved.start !== "number" ||
      typeof saved.end !== "number" ||
      !Number.isFinite(saved.start) ||
      !Number.isFinite(saved.end) ||
      saved.start < 0 ||
      saved.end - saved.start < 0.1
    )
      throw new Error("草稿范围无效");
    range = { start: saved.start, end: saved.end };
  }
  return {
    draft: {
      id: (saved.id as string | null | undefined) ?? null,
      name: (saved.name as string | null | undefined) ?? "",
      notes: (saved.notes as string | null | undefined) ?? "",
      baseRevision: (saved.baseRevision as string | null | undefined) ?? null,
    },
    range,
  };
}
function readDraft(key: string): RetainedDraft {
  if (!listening) {
    listening = true;
    registerCloseParticipant("replay-clip-drafts", { label: "回放片段输入", pending: () =>
      [...memory.values()].some((value) => value.error && hasInput(value.draft)) ? "回放片段的名称或范围尚未暂存，可返回重试或复制输入。" : null });
    // Keep the warning active after the editor unmounts: these drafts remain
    // in this application session when browser storage cannot retain them.
    window.addEventListener("beforeunload", (event) => {
      if (
        [...memory.values()].some(
          (value) => value.error && hasInput(value.draft),
        )
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  const retained = memory.get(key);
  if (retained) return retained;
  const value: RetainedDraft = {
    draft: emptyDraft(),
    range: null,
    error: "",
    original: null,
    readPending: false,
  };
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    value.readPending = true;
    value.error = "暂时无法读取窗口草稿，当前输入仅保留在本次会话中。";
    memory.set(key, value);
    return value;
  }
  if (raw !== null) {
    try {
      Object.assign(value, parseDraft(raw));
    } catch {
      value.original = raw;
      value.error =
        "旧草稿无法读取，原始内容已保留。当前输入仅保留在本次会话中。";
    }
  }
  memory.set(key, value);
  return value;
}
function retain(key: string, value: RetainedDraft, replaceOriginal: boolean) {
  const next = { ...value };
  try {
    if (next.readPending) {
      const raw = sessionStorage.getItem(key);
      next.readPending = false;
      // Storage became readable after editing started. Preserve the old value
      // until the user can copy or explicitly replace it.
      if (raw !== null) next.original = raw;
    }
    if (next.original !== null && !replaceOriginal) {
      next.error =
        "旧草稿原文已保留。可复制原文，或用当前输入替换；当前输入暂留本次会话。";
    } else {
      if (hasInput(next.draft))
        sessionStorage.setItem(
          key,
          JSON.stringify({ ...next.draft, ...next.range }),
        );
      else sessionStorage.removeItem(key);
      next.original = null;
      next.error = "";
    }
  } catch {
    next.error =
      "窗口草稿暂存失败。当前输入仍在本次会话中，可重试或复制后保存。";
  }
  // Retain empty tombstones after failed removal, so reopening cannot restore
  // an obsolete draft from storage.
  if (!next.error && !hasInput(next.draft)) memory.delete(key);
  else memory.set(key, next);
  return next;
}

// A draft keeps its original list revision until the user reviews a conflict;
// reloading cannot silently rebase it. The parent keys editors by recording.
export function useReplayClipDraft(
  key: string,
  rows: ReplayClipRows | null,
  range: Range,
) {
  const [saved] = useState(() => readDraft(key));
  const [draft, setDraft] = useState(saved.draft);
  const [savedRange, setSavedRange] = useState(saved.range);
  const retained = useRef(saved);
  const [storage, setStorage] = useState(saved);
  const [retry, setRetry] = useState(0);
  const replace = useRef(false);
  const hasDraft = hasInput(draft);
  const conflict = !!draft.id && !!rows && draft.baseRevision !== rows.revision;
  const currentClip = rows?.clips.find((clip) => clip.id === draft.id) ?? null;
  const serialized = JSON.stringify({
    ...draft,
    ...usableRange(savedRange ?? range),
  });
  useEffect(() => {
    if (
      savedRange &&
      savedRange.start === range.start &&
      savedRange.end === range.end
    )
      setSavedRange(null);
  }, [savedRange, range.start, range.end]);
  useEffect(() => {
    const next = retain(
      key,
      {
        ...retained.current,
        draft,
        range: usableRange(savedRange ?? range),
      },
      replace.current,
    );
    replace.current = false;
    retained.current = next;
    setStorage((current) =>
      current.error === next.error &&
      current.original === next.original &&
      current.readPending === next.readPending
        ? current
        : next,
    );
  }, [key, draft, savedRange, range.start, range.end, retry]);
  const clearDraft = () => {
    setDraft(emptyDraft());
    setSavedRange(null);
  };
  const beginEdit = (clip: ReplayClip, revision: string) => {
    setDraft({
      id: clip.id,
      name: clip.name,
      notes: clip.notes,
      baseRevision: revision,
    });
    setSavedRange(null);
  };
  return {
    draft,
    setDraft,
    hasDraft,
    conflict,
    currentClip,
    savedRange,
    clearDraft,
    beginEdit,
    storageError: storage.error,
    original: storage.original,
    serialized,
    retryStorage: () => setRetry((value) => value + 1),
    replaceOriginal: () => {
      replace.current = true;
      setRetry((value) => value + 1);
    },
    acceptCurrentRevision: () => {
      if (rows && currentClip)
        setDraft((value) => ({ ...value, baseRevision: rows.revision }));
    },
    restoreRange: () => {
      const value = savedRange;
      setSavedRange(null);
      return value;
    },
  };
}
