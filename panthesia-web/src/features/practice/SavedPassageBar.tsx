import {
  passageNeedsReview,
  passageTransformLabel,
  passageInitialBpm,
} from "./passagePractice";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, FolderOpen } from "lucide-react";
import { api, type LoadedSong } from "../../api";
import type {
  PassageCatalog,
  PassagePreset,
} from "../../engine/commands.generated";
import {
  capturePracticeScope,
  useCatalogRead,
} from "../../engine/useCatalogRead";
import { usePracticeEdits } from "../../engine/usePracticeEdits";
import { SavedEditNotice } from "../../engine/SavedEditNotice";
import type { PlaybackStore } from "./playbackStore";
import { usePlaybackFields } from "./PlaybackView";
import type { PracticeRangeController } from "./usePracticeRange";
import { rangeTime } from "./PracticeRangeControls";
import {
  secondsAtTick,
  tickAtSeconds,
  practiceModes,
} from "./practicePresentation";
import "./savedPassages.css";

const fields = ["status", "pressed", "passage"] as const;
export function savedPassageBounds(song: LoadedSong, row: PassagePreset) {
  const ticks = row.preciseRange ?? row.scoreRange;
  if (ticks)
    return {
      start: secondsAtTick(song, ticks.startTick),
      end: secondsAtTick(song, ticks.endTick),
    };
  const first = song.measures[row.start - 1],
    last = song.measures[row.end - 1];
  return first && last
    ? { start: first.start, end: Math.min(song.duration, last.end) }
    : null;
}

/** Save and reopen the existing passage catalog; the transport owns the active loop. */
export function SavedPassageBar({
  song,
  store,
  range,
  disabled,
  visible,
  changed,
  manage,
}: {
  song: LoadedSong;
  store: PlaybackStore;
  range: PracticeRangeController;
  disabled: boolean;
  visible: boolean;
  changed: () => Promise<void>;
  manage: () => void;
}) {
  const state = usePlaybackFields(store, fields);
  const scope = capturePracticeScope(song);
  const scopeKey = JSON.stringify(scope);
  const latestScopeKey = useRef(scopeKey);
  latestScopeKey.current = scopeKey;
  const read = useCatalogRead(scope, song);
  const [catalog, setCatalog] = useState<PassageCatalog | null>(null);
  const [catalogFor, setCatalogFor] = useState("");
  const [reading, setReading] = useState(false),
    [working, setWorking] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [selected, setSelected] = useState(""),
    [naming, setNaming] = useState(false),
    [name, setName] = useState("");
  const alive = useRef(true),
    operation = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = async () => {
    const requestedScope = latestScopeKey.current;
    const request = read<PassageCatalog>({ type: "passages" });
    setReading(true);
    try {
      const value = await request.result;
      if (!request.isCurrent() || value.contentId !== song.contentId) return;
      setCatalog(value);
      setCatalogFor(requestedScope);
      setSelected((previous) =>
        value.passages.some((row) => row.id === previous)
          ? previous
          : (value.passages[0]?.id ?? ""),
      );
    } finally {
      if (request.isCurrent()) setReading(false);
    }
  };
  useEffect(() => {
    if (visible)
      void reload().catch((cause) => {
        if (alive.current)
          setError(String(cause instanceof Error ? cause.message : cause));
      });
  }, [visible, read, scopeKey]);
  const edits = usePracticeEdits(scope, reload, catalog?.catalogRevision);
  const locked =
    disabled ||
    working ||
    reading ||
    !!edits.pendingRefresh ||
    !catalog ||
    catalogFor !== scopeKey ||
    !visible;
  useEffect(() => {
    if (state.status === "playing") setMessage("");
  }, [state.status]);
  const canSave =
    !locked &&
    !!range.range &&
    !["playing", "countIn"].includes(state.status) &&
    state.pressed.length === 0;
  const row = catalog?.passages.find((row) => row.id === selected);
  const stale = !!row && passageNeedsReview(row, catalog?.grid);
  const bounds = row ? savedPassageBounds(song, row) : null;
  const savedTempo = useMemo(
    () => (row ? passageInitialBpm(song, row) : null),
    [row, song.tempo, song.measures],
  );
  const startNaming = () => {
    if (!canSave || !range.range) return;
    if (!name)
      setName(
        `选段 ${rangeTime(range.range.start)}–${rangeTime(range.range.end)}`,
      );
    setNaming(true);
    setError("");
    setMessage("");
  };
  const run = async (job: () => Promise<void>, refreshOnly = false) => {
    if (
      operation.current ||
      disabled ||
      working ||
      reading ||
      !visible ||
      (!refreshOnly && (!!edits.pendingRefresh || !catalog))
    )
      return;
    operation.current = true;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await job();
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operation.current = false;
      if (alive.current) setWorking(false);
    }
  };
  const save = () =>
    void run(async () => {
      const selection = range.range;
      if (!canSave || !selection || !catalog || !range.matches()) return;
      if (!name.trim() || Array.from(name.trim()).length > 80)
        throw Error("请输入 1–80 字的选段名称。");
      await edits.commit<{ passage: PassagePreset }>(
        {
          type: "saveTickPassage",
          id: null,
          name: name.trim(),
          notes: "",
          range: {
            contentId: song.contentId,
            grid: catalog.grid,
            description: "",
            startTick: tickAtSeconds(song, selection.start),
            endTick: tickAtSeconds(song, selection.end),
          },
        },
        "练习选段已保存",
        (result) => {
          if (!alive.current) return;
          setSelected(result.passage.id);
          setName("");
          setNaming(false);
          setMessage(`已保存“${result.passage.name}”`);
        },
      );
    });
  const open = () =>
    void run(async () => {
      if (!row || stale || !catalog || !range.matches()) return;
      await api.editPractice(
        scope,
        { type: "openPassage", id: row.id },
        catalog.catalogRevision,
      );
      range.reset();
      await changed();
      if (alive.current)
        setMessage(
          `已打开“${row.name}”，使用保存的转调、量化、速度、声部和练习模式。`,
        );
    });
  return (
    <section className="saved-passage-bar" aria-label="已保存练习选段">
      <div className="saved-passage-actions">
        <label>
          练习段{" "}
          <select
            aria-label="已保存选段"
            value={selected}
            disabled={locked || !catalog?.passages.length}
            onChange={(event) => {
              setSelected(event.target.value);
              setMessage("");
            }}
          >
            {!catalog?.passages.length && (
              <option value="">{reading ? "正在读取…" : "尚未保存"}</option>
            )}
            {catalog?.passages.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {passageNeedsReview(row, catalog.grid) ? " · 条件需核对" : ""}
              </option>
            ))}
          </select>
        </label>
        <button disabled={locked || !row || stale} onClick={open}>
          练习此段
        </button>
        <button
          disabled={!canSave}
          title={
            !range.range
              ? "先设置 A/B 或点选两个音符"
              : ["playing", "countIn"].includes(state.status)
                ? "暂停演奏后保存当前范围"
                : "保存当前 A/B 范围及练习设置"
          }
          onClick={startNaming}
        >
          <BookmarkPlus size={13} />
          保存 A/B
        </button>
        <button disabled={working} onClick={manage}>
          <FolderOpen size={13} />
          管理
        </button>
        {bounds && !stale && (
          <span
            className="saved-passage-summary"
            title={`第 ${row!.start}–${row!.end} 小节`}
          >
            {rangeTime(bounds.start)}–{rangeTime(bounds.end)} · {savedTempo} BPM
            · {row?.practice ? passageTransformLabel(row) + " · " : ""}{" "}
            {practiceModes.find((mode) => mode.value === row!.settings.mode)
              ?.label ?? "练习"}
          </span>
        )}
      </div>
      {naming && (
        <form
          className="saved-passage-name"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label>
            选段名称
            <input
              autoFocus
              aria-label="保存选段名称"
              value={name}
              maxLength={160}
              disabled={working || !!edits.pendingRefresh}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            disabled={
              !canSave || !name.trim() || Array.from(name.trim()).length > 80
            }
            type="submit"
          >
            保存选段
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => setNaming(false)}
          >
            收起
          </button>
          <span>同时保存当前转调、量化、速度、声部和练习模式。</span>
        </form>
      )}
      {stale && (
        <p role="status">
          当前转调、量化或小节网格与保存时不同，请到“管理”核对范围。
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            disabled={working || reading}
            onClick={() =>
              void reload()
                .then(() => setError(""))
                .catch((cause) => setError(String(cause)))
            }
          >
            重新读取
          </button>
        </p>
      )}
      <SavedEditNotice
        message={edits.pendingRefresh}
        busy={working}
        refresh={() =>
          void run(async () => {
            await edits.refresh();
          }, true)
        }
      />
    </section>
  );
}
