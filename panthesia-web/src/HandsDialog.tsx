import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { X } from "lucide-react";
import { api, pitchName, type LoadedSong, type Note } from "./api";
import type {
  PracticePart,
  HandSpanProfile,
  HandProposal,
  HandSuggestionRead,
  HandUndoState,
  FingerProfileCatalog,
  HandAssignmentRead,
} from "./engine/commands.generated";
import { capturePracticeScope } from "./engine/useCatalogRead";
import { useRequestScope } from "./engine/useRequestScope";
import { PracticeEditTaskActivity } from "./engine/PracticeEditTaskActivity";
import { PersistentSessionRecovery } from "./app/PersistentSessionRecovery";
import { CopyPracticeDraft } from "./features/practice/CopyPracticeDraft";
import { practiceScopeKey } from "./features/practice/practiceEditorStore";
import {
  getHandEditor,
  handDraftKey,
  emptyHandDraft,
  type HandDraft,
  type HandChoice,
} from "./features/practice/handEditorStore";
import {
  integerInput,
  validMeasureRange,
} from "./features/practice/practiceEditorForms";
import "./features/practice/handEditor.css";
import { NotePlaybackEditor } from "./features/practice/NotePlaybackEditor";
import {
  mergeHandSuggestions,
  rebaseHandDraft,
} from "./features/practice/handEditorModel";

const spanName: Record<HandSpanProfile, string> = {
  Compact: "较小 · 七度内",
  Standard: "一般 · 八度内",
  Large: "较大 · 九度内",
};
const partName = (part: HandChoice) =>
  part === "LeftHand"
    ? "左手"
    : part === "RightHand"
      ? "右手"
      : part === "Inherit"
        ? "沿用音轨手别"
        : "未分手";
const nativePart = (part: string): PracticePart =>
  part === "left" ? "LeftHand" : part === "right" ? "RightHand" : "Other";
const sameNote = (
  left: { pitch: number; start: number } | undefined,
  right: { pitch: number; start: number },
) => !!left && left.pitch === right.pitch && left.start === right.start;
export function HandsDialog({
  song,
  start,
  end,
  close,
  changed,
}: {
  song: LoadedSong;
  start: number;
  end: number;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [store] = useState(() => getHandEditor(song, start, end));
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const first = integerInput(state.first),
    last = integerInput(state.last),
    validRange = validMeasureRange(first, last, song.measures.length);
  const contextKey =
      Number.isInteger(first) &&
      first >= 1 &&
      Number.isInteger(last) &&
      last >= first
        ? handDraftKey(state.track, first, last)
        : null,
    sourceKey = practiceScopeKey(song);
  const draft =
    (contextKey && state.drafts[contextKey]) ||
    emptyHandDraft(song, state.track, first, last);
  const stale = draft.source !== sourceKey;
  const [proposals, setProposals] = useState<HandProposal[] | null>(null),
    [proposalProof, setProposalProof] = useState<string | null>(null),
    [profiles, setProfiles] = useState<FingerProfileCatalog | null>(null),
    [undo, setUndo] = useState<HandUndoState | null>(null),
    [reading, setReading] = useState(false),
    [reload, setReload] = useState(0),
    [loadedSource, setLoadedSource] = useState(""),
    [error, setError] = useState(""),
    [actionBusy, setActionBusy] = useState(false);
  const [result, setResult] = useState<{
    song: LoadedSong;
    quiet: boolean;
    matched: number;
    total: number;
    undoAvailable: boolean;
  } | null>(null);
  const working = useRef(false),
    alive = useRef(true);
  const captureRequest = useRequestScope(
    JSON.stringify([
      sourceKey,
      contextKey,
      state.reference,
      profiles?.catalogRevision,
    ]),
  );
  const busy = actionBusy || state.busy,
    locked = busy || !!state.receipt;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setProposals(null);
    setProposalProof(null);
  }, [sourceKey, contextKey, state.reference, profiles?.catalogRevision]);
  useEffect(() => {
    let cancelled = false;
    setReading(true);
    setProfiles(null);
    setUndo(null);
    void Promise.all([
      api.readPractice<FingerProfileCatalog>(song, { type: "fingerProfiles" }),
      api.readPractice<HandUndoState>(song, { type: "handUndoState" }),
    ])
      .then(([profiles, undo]) => {
        if (cancelled) return;
        if (
          undo.contentId !== song.contentId ||
          profiles.contentId !== song.contentId
        )
          throw new Error("曲目已切换，请重新打开逐音分手。");
        if (undo.profileRevision !== profiles.catalogRevision)
          throw new Error("跨度设置在读取期间更新，请重新读取当前设置。");
        setProfiles(profiles);
        setUndo(undo);
        setLoadedSource(sourceKey);
      })
      .catch((error) => {
        if (!cancelled)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setReading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey, reload]);
  const tracks = useMemo(() => {
    const map = new Map<number, Note[]>();
    for (const note of song.notes) {
      const rows = map.get(note.track);
      if (rows) rows.push(note);
      else map.set(note.track, [note]);
    }
    for (const rows of map.values())
      rows.sort(
        (left, right) => left.start - right.start || left.index - right.index,
      );
    return map;
  }, [song]);
  const currentNotes = useMemo(() => {
    if (!validRange) return [];
    const rows = tracks.get(state.track) ?? [],
      begin = song.measures[first - 1].start,
      finish = song.measures[last - 1].end;
    const boundary = (at: number) => {
      let low = 0,
        high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows[middle].start < at) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    return rows.slice(boundary(begin), boundary(finish));
  }, [tracks, state.track, first, last, validRange, song.measures]);
  const noteMap = useMemo(
    () => new Map(currentNotes.map((note) => [note.index, note])),
    [currentNotes],
  );
  const rows = useMemo<HandProposal[]>(
    () =>
      proposals ??
      currentNotes.map((note) => {
        let low = 0,
          high = song.measures.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (song.measures[middle].start <= note.start) low = middle + 1;
          else high = middle;
        }
        const part = nativePart(note.part);
        return {
          track: note.track,
          index: note.index,
          pitch: note.pitch,
          start: note.start,
          measure: song.measures[Math.max(0, low - 1)]?.number ?? 1,
          part,
          saved: part,
          confidence: 0,
          reason: note.manualHand ? "已保存的逐音分手" : "沿用音轨声部",
        };
      }),
    [currentNotes, proposals, song.measures],
  );
  const rowMap = useMemo(
    () => new Map(rows.map((row) => [row.index, row])),
    [rows],
  );
  const chosen = new Set(draft.accepted),
    touched = new Set(draft.touched);
  const generation = JSON.stringify([
    sourceKey,
    state.reference,
    profiles?.catalogRevision,
  ]);
  const generationStale =
    draft.accepted.some((index) => !touched.has(index)) &&
    draft.generation !== generation;
  const currentRead = loadedSource === sourceKey;
  const proof = currentRead ? (proposalProof ?? undo?.proof) : null;
  const perform = async (job: () => Promise<void>) => {
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
  const updateDraft = (patch: Partial<HandDraft>) => {
    if (!contextKey || !validRange) return;
    try {
      const next = { ...draft, ...patch },
        needed = new Set([
          ...next.accepted,
          ...next.touched,
          ...Object.keys(next.values).map(Number),
        ]);
      const anchors = Object.fromEntries(
        [...needed].flatMap((index) => {
          const row = rowMap.get(index),
            old = next.anchors[index];
          return old
            ? [[index, old]]
            : row && next.source === sourceKey
              ? [[index, { pitch: row.pitch, start: row.start }]]
              : [];
        }),
      );
      store.edit(contextKey, { ...next, anchors });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const validateDraft = () => {
    if (!contextKey) return;
    try {
      const rebased = rebaseHandDraft(song, draft, sourceKey),
        key = handDraftKey(rebased.track, rebased.first, rebased.last);
      if (key !== contextKey && state.drafts[key])
        throw new Error(
          "当前小节范围已有另一份草稿，请先续接或复制那份输入，原草稿继续保留。",
        );
      store.edit(key, rebased);
      store.select(rebased);
      setProposals(null);
      setProposalProof(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const readResults = async (automatic = false) => {
    const session = await api.session(),
      current = session.song;
    if (!current || current.contentId !== song.contentId)
      throw new Error("请返回原曲目读取结果，原提交内容继续保留。");
    current.engineId = session.state.stateOrder?.engineId ?? current.engineId;
    let quiet = false;
    const receipt = store.getSnapshot().receipt;
    if (!receipt) {
      await changed();
      setReload((value) => value + 1);
      return;
    }
    const [actualUndo, actualProfiles, actual] = await Promise.all([
      api.readPractice<HandUndoState>(current, { type: "handUndoState" }),
      api.readPractice<FingerProfileCatalog>(current, {
        type: "fingerProfiles",
      }),
      receipt.kind === "save"
        ? api.readPractice<HandAssignmentRead>(current, {
            type: "readHandAssignments",
            track: receipt.track,
            indices: receipt.rows.map((row) => row.index),
          })
        : Promise.resolve(null),
    ]);
    quiet =
      actualUndo.writeSettled === true &&
      actualProfiles.writeSettled === true &&
      actualUndo.profileRevision === actualProfiles.catalogRevision &&
      (!actual ||
        (actual.writeSettled === true &&
          actual.revision === actualUndo.revision));
    const actualMap = new Map(
      actual?.assignments.map((row) => [row.index, row]) ?? [],
    );
    const matched =
      receipt.kind === "save"
        ? receipt.rows.filter((row) => {
            const found = actualMap.get(row.index);
            return (
              found &&
              sameNote(found, row) &&
              found.manual === (row.choice === "Inherit" ? null : row.choice)
            );
          }).length
        : receipt.kind === "span"
          ? Number(
              (actualProfiles.profilesByHand?.[
                receipt.track + ":" + receipt.span!.side
              ] ?? null) === receipt.span!.profile,
            )
          : 0;
    const total =
      receipt.kind === "save"
        ? receipt.rows.length
        : receipt.kind === "span"
          ? 1
          : 0;
    if (alive.current)
      setResult({
        song: current,
        quiet,
        matched,
        total,
        undoAvailable: actualUndo.undoAvailable,
      });
    if (!quiet) throw new Error("资料仍在保存或恢复，请稍后重新读取结果。");
    if (
      automatic &&
      (receipt.kind === "undo"
        ? receipt.phase === "acknowledged"
        : total > 0 && matched === total)
    ) {
      await changed();
      store.resolve(current, receipt.kind === "save");
      setProposals(null);
      setProposalProof(null);
      setUndo(actualUndo);
      setProfiles(actualProfiles);
      setReload((value) => value + 1);
    }
  };
  const finishRead = () =>
    void perform(async () => {
      if (!result?.quiet) return;
      await changed();
      store.resolve(result.song, false);
      setResult(null);
      setProposals(null);
      setProposalProof(null);
      setReload((value) => value + 1);
    });
  const suggest = () =>
    void perform(async () => {
      if (!validRange || stale || !profiles || !currentRead || state.receipt)
        return;
      const isCurrent = captureRequest();
      const data = await api.readPractice<HandSuggestionRead>(song, {
        type: "suggestHands",
        track: state.track,
        range: [first, last],
        reference: state.reference,
      });
      if (!isCurrent() || !alive.current || data.contentId !== song.contentId)
        return;
      const merged = mergeHandSuggestions(
        draft,
        data.proposals,
        generation,
        sourceKey,
      );
      store.edit(contextKey!, merged);
      setProposals(data.proposals);
      setProposalProof(data.proof);
      if (merged.accepted.length === 4096)
        setError("已预选最多 4096 个音符，可以保存后继续处理其余音符。");
    });
  const save = () =>
    void perform(async () => {
      if (!proof || !contextKey || stale || generationStale || !chosen.size)
        return;
      const submitted = rows
        .filter((row) => chosen.has(row.index))
        .map((row) => ({
          index: row.index,
          pitch: row.pitch,
          start: row.start,
          choice: draft.values[row.index] ?? row.part,
        }));
      if (
        submitted.length !== chosen.size ||
        submitted.some((row) => !sameNote(draft.anchors[row.index], row))
      )
        throw new Error("所选音符位置需要重新核对，请读取当前选段。");
      await store.commit(
        song,
        {
          type: "applyHands",
          content_id: song.contentId,
          proof,
          hints: submitted
            .filter((row) => row.choice !== "Inherit")
            .map((row) => ({
              track_id: state.track,
              note_index: row.index,
              part: row.choice as PracticePart,
            })),
          clear: submitted
            .filter((row) => row.choice === "Inherit")
            .map((row) => [state.track, row.index]),
        },
        {
          kind: "save",
          context: contextKey,
          track: state.track,
          rows: submitted,
        },
      );
      await readResults(true);
    });
  const query = draft.query.trim().toLocaleLowerCase("zh-CN");
  const filtered = rows.filter((row) => {
    if (
      query &&
      ![pitchName(row.pitch), row.measure, row.reason]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query)
    )
      return false;
    if (draft.filter === "selected") return chosen.has(row.index);
    if (draft.filter === "manual") return !!noteMap.get(row.index)?.manualHand;
    if (draft.filter === "changes")
      return draft.values[row.index]
        ? draft.values[row.index] !==
            (noteMap.get(row.index)?.manualHand ? row.saved : "Inherit")
        : row.part !== row.saved;
    if (draft.filter === "review")
      return !!proposals && (row.confidence < 80 || row.part === "Other");
    return true;
  });
  const page = Math.min(
      draft.page,
      Math.max(0, Math.ceil(filtered.length / 40) - 1),
    ),
    visible = filtered.slice(page * 40, (page + 1) * 40);
  const validTrack = song.tracks.some((track) => track.id === state.track);
  const editingLocked = locked || !validRange || !validTrack || stale;
  const selectRows = (items: HandProposal[]) => {
    const values = { ...draft.values };
    for (const row of items) values[row.index] = values[row.index] ?? row.part;
    updateDraft({
      values,
      accepted: [
        ...new Set([...draft.accepted, ...items.map((row) => row.index)]),
      ],
      touched: [
        ...new Set([...draft.touched, ...items.map((row) => row.index)]),
      ],
    });
  };
  const bulk = (choice: HandChoice) => {
    const values = { ...draft.values };
    for (const index of chosen) values[index] = choice;
    updateDraft({
      values,
      touched: [...new Set([...draft.touched, ...chosen])],
    });
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        className="settings-dialog hand-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hands-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="hands-title">逐音分手</h2>
            <p>{song.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={busy}
            aria-label="关闭逐音分手"
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
          label="逐音分手输入"
        />
        <NotePlaybackEditor song={song} locked={locked} changed={changed} onBusy={setActionBusy} />
        <div className="hand-editor-toolbar">
          <CopyPracticeDraft label="复制分手草稿" value={state} />
          <button
            disabled={busy}
            onClick={() => {
              if (state.receipt) void perform(() => readResults(true));
              else setReload((value) => value + 1);
            }}
          >
            {reading
              ? "正在读取…"
              : state.receipt
                ? "读取操作结果"
                : "重新读取设置"}
          </button>
          {Object.keys(state.drafts).length > 0 && (
            <label>
              续接选段
              <select
                aria-label="续接分手选段"
                disabled={locked}
                value={contextKey && state.drafts[contextKey] ? contextKey : ""}
                onChange={(event) => {
                  const saved = state.drafts[event.target.value];
                  if (saved) store.select(saved);
                }}
              >
                <option value="">当前选段</option>
                {Object.entries(state.drafts).map(([key, draft]) => (
                  <option key={key} value={key}>
                    音轨 {draft.track} · {draft.first}–{draft.last} 小节 ·{" "}
                    {draft.accepted.length} 音
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {state.receipt && (
          <section className="hand-editor-receipt" role="status">
            <strong>
              {state.receipt.phase === "acknowledged"
                ? "操作回复已收到"
                : "操作结果需要核对"}
            </strong>
            <p>
              {state.receipt.kind === "undo"
                ? "本次操作：撤销上次已保存分手。"
                : state.receipt.kind === "span"
                  ? (state.receipt.span?.side === "left" ? "左手" : "右手") +
                    "跨度：" +
                    (state.receipt.span?.profile
                      ? spanName[state.receipt.span.profile as HandSpanProfile]
                      : "沿用默认")
                  : "本次提交：音轨 " +
                    state.receipt.track +
                    "，共 " +
                    state.receipt.rows.length +
                    " 个音符。"}
            </p>
            <p>输入与原操作已保留，读取实际分手后继续。</p>
            <button
              disabled={busy}
              onClick={() => void perform(() => readResults(true))}
            >
              读取当前资料
            </button>
            {result && (
              <p>
                {result.total
                  ? "提交内容与当前资料相符 " +
                    result.matched +
                    " / " +
                    result.total +
                    " 项"
                  : "当前" +
                    (result.undoAvailable ? "仍有" : "没有") +
                    "可撤销的分手修改"}
                {!result.quiet && " · 资料仍在处理"}
              </p>
            )}
            {result && result.total > 0 && result.matched < result.total && (
              <p>当前资料与提交内容不同，原输入继续保留。</p>
            )}
            {result?.quiet && (
              <button disabled={busy} onClick={finishRead}>
                已核对，保留输入继续编辑
              </button>
            )}
          </section>
        )}
        <div className="hand-editor-options">
          <label>
            音轨
            <select
              aria-label="分手音轨"
              disabled={locked}
              value={state.track}
              onChange={(event) =>
                store.update({ track: Number(event.target.value) })
              }
            >
              {song.tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name} · {track.notes} 音
                </option>
              ))}
            </select>
          </label>
          <label>
            起始小节
            <input
              aria-label="分手起始小节"
              type="number"
              min={1}
              max={song.measures.length}
              disabled={locked}
              value={state.first}
              onChange={(event) => store.update({ first: event.target.value })}
            />
          </label>
          <label>
            结束小节
            <input
              aria-label="分手结束小节"
              type="number"
              min={Number.isFinite(first) ? first : 1}
              max={song.measures.length}
              disabled={locked}
              value={state.last}
              onChange={(event) => store.update({ last: event.target.value })}
            />
          </label>
          <label>
            参考手位
            <select
              aria-label="分手参考手位"
              disabled={locked}
              value={state.reference}
              onChange={(event) =>
                store.update({ reference: Number(event.target.value) })
              }
            >
              {[48, 53, 55, 60, 65, 67, 72].map((pitch) => (
                <option key={pitch} value={pitch}>
                  {pitchName(pitch)}
                </option>
              ))}
            </select>
          </label>
          {(["left", "right"] as const).map((side) => {
            const current =
                profiles?.profilesByHand?.[state.track + ":" + side] ?? null,
              inherited =
                profiles?.defaults[
                  side === "left" ? "LeftHand" : "RightHand"
                ] ??
                profiles?.profiles?.[state.track] ??
                "Standard";
            return (
              <label key={side}>
                {side === "left" ? "左手跨度" : "右手跨度"}
                <select
                  aria-label={side === "left" ? "左手分手跨度" : "右手分手跨度"}
                  disabled={locked || reading || !profiles || !currentRead}
                  value={current ?? ""}
                  onChange={(event) => {
                    const profile = (event.target.value ||
                      null) as HandSpanProfile | null;
                    void perform(async () => {
                      await store.commit(
                        song,
                        {
                          type: "handSpanFor",
                          content_id: song.contentId,
                          track: state.track,
                          hand: side === "left" ? "LeftHand" : "RightHand",
                          profile,
                        },
                        {
                          kind: "span",
                          context: contextKey,
                          track: state.track,
                          rows: [],
                          span: { side, profile },
                        },
                        profiles?.catalogRevision,
                      );
                      await readResults(true);
                    });
                  }}
                >
                  <option value="">沿用默认（{spanName[inherited]}）</option>
                  {(Object.keys(spanName) as HandSpanProfile[]).map(
                    (profile) => (
                      <option key={profile} value={profile}>
                        {spanName[profile]}
                      </option>
                    ),
                  )}
                </select>
              </label>
            );
          })}
        </div>
        {!validRange && (
          <p className="hand-editor-warning" role="status">
            请填写当前曲目内的完整起止小节。
          </p>
        )}
        {!validTrack && (
          <p className="hand-editor-warning" role="status">
            原音轨已变化，请选择当前音轨。旧输入继续保留，可从选段入口查看或复制。
          </p>
        )}
        {stale && (
          <div className="hand-editor-warning" role="status">
            <p>
              分手资料或曲目版本已变化，输入继续保留。请核对音符位置与当前手别。
            </p>
            <button disabled={locked} onClick={validateDraft}>
              核对位置并沿用输入
            </button>
          </div>
        )}
        {generationStale && !stale && (
          <div className="hand-editor-warning" role="status">
            <p>建议条件已变化，请重新生成建议。已手动修改的音符会继续保留。</p>
            <button
              disabled={editingLocked}
              onClick={() =>
                updateDraft({
                  touched: [...new Set([...draft.touched, ...draft.accepted])],
                  generation: null,
                })
              }
            >
              所选手别已核对，按手工输入保留
            </button>
          </div>
        )}
        <div className="hand-editor-toolbar">
          <button
            className="primary-button"
            disabled={
              editingLocked ||
              reading ||
              !profiles ||
              !currentRead ||
              rows.length > 4096
            }
            onClick={suggest}
          >
            生成分手建议
          </button>
          <button
            disabled={locked || !undo?.undoAvailable || !currentRead}
            onClick={() =>
              void perform(async () => {
                await store.commit(
                  song,
                  { type: "undoHandsFor", expected: undo!.revision },
                  {
                    kind: "undo",
                    context: contextKey,
                    track: state.track,
                    rows: [],
                    beforeUndo: undo!.revision,
                  },
                );
                await readResults(true);
              })
            }
          >
            撤销上次已保存分手
          </button>
          <button
            disabled={locked}
            onClick={() =>
              store.update({ first: String(start), last: String(end) })
            }
          >
            使用主界面选段
          </button>
        </div>
        <p className="parameter-help">
          建议结合跨度、持续音和声部走向。先预选信心较高且需要改动的音符；伸展、交叉和未判断的音请逐项核对。“沿用音轨手别”清除逐音指定，“未分手”保存明确的未分配状态。保存分手后会停止演奏并重置本轮成绩，历史记录会保留；跨度设置只影响建议。
        </p>
        {rows.length > 4096 && (
          <p className="hand-editor-warning" role="status">
            当前选段超过 4096
            个音符，请缩小范围后生成建议。手工分手可以按筛选结果分批选择和保存。
          </p>
        )}
        <div className="hand-editor-toolbar">
          <label>
            查找音符
            <input
              type="search"
              aria-label="查找分手音符"
              disabled={locked || !contextKey}
              maxLength={1024}
              placeholder="小节、音名或依据"
              value={draft.query}
              onChange={(event) =>
                updateDraft({ query: event.target.value, page: 0 })
              }
            />
          </label>
          <label>
            筛选
            <select
              aria-label="分手音符筛选"
              disabled={locked || !contextKey}
              value={draft.filter}
              onChange={(event) =>
                updateDraft({
                  filter: event.target.value as HandDraft["filter"],
                  page: 0,
                })
              }
            >
              <option value="all">全部音符</option>
              <option value="selected">已选择</option>
              <option value="manual">已有逐音指定</option>
              <option value="changes">手别有变化</option>
              <option value="review">建议需重点核对</option>
            </select>
          </label>
          <button
            disabled={editingLocked || !visible.length}
            onClick={() => selectRows(visible)}
          >
            选择本页
          </button>
          <button
            disabled={editingLocked || !rows.length || rows.length > 4096}
            onClick={() => selectRows(rows)}
          >
            选择整个选段
          </button>
          {filtered.length > 4096 && (
            <button
              disabled={editingLocked || chosen.size >= 4096}
              onClick={() =>
                selectRows(
                  filtered
                    .filter((row) => !chosen.has(row.index))
                    .slice(0, 4096 - chosen.size),
                )
              }
            >
              选择当前筛选的前一批
            </button>
          )}
          <button
            disabled={editingLocked || !chosen.size}
            onClick={() =>
              updateDraft({
                accepted: [],
                touched: [...new Set([...draft.touched, ...draft.accepted])],
              })
            }
          >
            取消选择
          </button>
          {(["LeftHand", "RightHand", "Other", "Inherit"] as HandChoice[]).map(
            (part) => (
              <button
                key={part}
                disabled={editingLocked || !chosen.size}
                onClick={() => bulk(part)}
              >
                所选：{partName(part)}
              </button>
            ),
          )}
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        {state.notice && (
          <p className="parameter-help" role="status">
            {state.notice}
          </p>
        )}
        <div className="fingering-table-wrap">
          <table className="fingering-table">
            <thead>
              <tr>
                <th>采用</th>
                <th>小节</th>
                <th>音符</th>
                <th>当前手别</th>
                <th>演奏手</th>
                <th>建议依据</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.index}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"采用分手 " + row.index}
                      disabled={editingLocked}
                      checked={chosen.has(row.index)}
                      onChange={(event) => {
                        const accepted = new Set(draft.accepted);
                        if (event.target.checked) accepted.add(row.index);
                        else accepted.delete(row.index);
                        updateDraft({
                          accepted: [...accepted],
                          touched: [...new Set([...draft.touched, row.index])],
                          values: {
                            ...draft.values,
                            [row.index]: draft.values[row.index] ?? row.part,
                          },
                        });
                      }}
                    />
                  </td>
                  <td>{row.measure}</td>
                  <td>{pitchName(row.pitch)}</td>
                  <td>
                    {partName(row.saved)}
                    <small>
                      {noteMap.get(row.index)?.manualHand
                        ? " · 逐音指定"
                        : " · 沿用音轨"}
                    </small>
                  </td>
                  <td>
                    <select
                      aria-label={"音符 " + row.index + " 演奏手"}
                      disabled={editingLocked}
                      value={draft.values[row.index] ?? row.part}
                      onChange={(event) =>
                        updateDraft({
                          values: {
                            ...draft.values,
                            [row.index]: event.target.value as HandChoice,
                          },
                          accepted: [
                            ...new Set([...draft.accepted, row.index]),
                          ],
                          touched: [...new Set([...draft.touched, row.index])],
                        })
                      }
                    >
                      {(
                        [
                          "LeftHand",
                          "RightHand",
                          "Other",
                          "Inherit",
                        ] as HandChoice[]
                      ).map((choice) => (
                        <option key={choice} value={choice}>
                          {partName(choice)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.reason}
                    {row.confidence > 0 &&
                      row.confidence < 80 &&
                      " · 请重点核对"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="parameter-help">当前条件下没有音符。</p>
          )}
        </div>
        <div className="dialog-actions">
          <span>
            {filtered.length} / {rows.length} 音 · 已选择 {chosen.size} / 4096
          </span>
          <button
            disabled={locked || page <= 0}
            onClick={() => updateDraft({ page: page - 1 })}
          >
            上一页
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}
          </span>
          <button
            disabled={locked || (page + 1) * 40 >= filtered.length}
            onClick={() => updateDraft({ page: page + 1 })}
          >
            下一页
          </button>
          <button
            className="primary-button"
            disabled={
              editingLocked ||
              generationStale ||
              !proof ||
              !chosen.size ||
              chosen.size > 4096 ||
              !!state.storageError
            }
            onClick={save}
          >
            保存所选分手
          </button>
          {contextKey && state.drafts[contextKey] && (
            <button
              disabled={locked}
              onClick={() => {
                store.clear(contextKey);
                setProposals(null);
                setProposalProof(null);
              }}
            >
              清除这份选段输入
            </button>
          )}
          <button disabled={busy} onClick={close}>
            暂存并关闭
          </button>
        </div>
      </section>
    </div>
  );
}
