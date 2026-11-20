import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookmarkPlus, Flag, Pencil, Trash2 } from "lucide-react";
import type { LoadedSong } from "../../api";
import type {
  BookmarkCatalog,
  BookmarkEntry,
} from "../../engine/commands.generated";
import {
  capturePracticeScope,
  useCatalogRead,
} from "../../engine/useCatalogRead";
import { usePracticeEdits } from "../../engine/usePracticeEdits";
import { SavedEditNotice } from "../../engine/SavedEditNotice";
import type { PlaybackStore } from "./playbackStore";
import type { PracticeRangeController } from "./usePracticeRange";
import { tickAtSeconds } from "./practicePresentation";
import { rangeTime } from "./PracticeRangeControls";
import "./songBookmarks.css";
export type BookmarkNavigation = { jump: (index: number) => void };
type Props = {
  song: LoadedSong;
  shortcutHint: string;
  store: PlaybackStore;
  range: PracticeRangeController;
  disabled: boolean;
  visible: boolean;
  seek: (position: number) => Promise<boolean>;
  loop: (start: number, end: number, enabled: boolean) => Promise<boolean>;
};
export const SongBookmarks = forwardRef<BookmarkNavigation, Props>(
  function SongBookmarks(
    { song, store, range, disabled, visible, seek, loop, shortcutHint },
    ref,
  ) {
    const scope = capturePracticeScope(song),
      key = JSON.stringify(scope);
    const latest = useRef(key);
    latest.current = key;
    const read = useCatalogRead(scope, song);
    const [catalog, setCatalog] = useState<BookmarkCatalog | null>(null),
      [catalogFor, setCatalogFor] = useState("");
    const [selected, setSelected] = useState(""),
      [end, setEnd] = useState("");
    const [reading, setReading] = useState(false),
      [working, setWorking] = useState(false),
      [error, setError] = useState(""),
      [message, setMessage] = useState("");
    const [editor, setEditor] = useState<{
      id: string | null;
      tick: number;
      name: string;
    } | null>(null);
    const operation = useRef(false),
      alive = useRef(true);
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
      };
    }, []);
    const reload = async () => {
      const origin = latest.current,
        request = read<BookmarkCatalog>({ type: "bookmarks" });
      setReading(true);
      try {
        const result = await request.result;
        if (!request.isCurrent() || result.contentId !== song.contentId) return;
        setCatalog(result);
        setCatalogFor(origin);
        setSelected((old) =>
          result.bookmarks.some((row) => row.id === old)
            ? old
            : (result.bookmarks[0]?.id ?? ""),
        );
      } finally {
        if (request.isCurrent()) setReading(false);
      }
    };
    useEffect(() => {
      if (visible)
        void reload().catch((cause) => {
          if (alive.current) setError(String(cause));
        });
    }, [visible, read, key]);
    const edits = usePracticeEdits(scope, reload, catalog?.catalogRevision);
    const locked =
      disabled ||
      working ||
      reading ||
      !visible ||
      !!edits.pendingRefresh ||
      catalogFor !== key ||
      !catalog;
    const rows = catalogFor === key ? (catalog?.bookmarks ?? []) : [];
    const row = rows.find((row) => row.id === selected);
    const after = rows.filter(
      (mark) => mark.available && row && mark.seconds - row.seconds >= 0.1,
    );
    const endpoint = after.find((mark) => mark.id === end) ?? after[0];
    const run = async (action: () => Promise<void>) => {
      if (locked || operation.current || !range.matches()) return;
      operation.current = true;
      setWorking(true);
      setError("");
      setMessage("");
      try {
        await action();
      } catch (cause) {
        if (alive.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        operation.current = false;
        if (alive.current) setWorking(false);
      }
    };
    const navigate = (mark: BookmarkEntry) =>
      void run(async () => {
        if (!mark.available) return;
        const active = store.getSnapshot().passage;
        if (
          active &&
          (mark.seconds < active.start || mark.seconds >= active.end)
        ) {
          if (!(await loop(0, song.duration, false))) return;
        }
        if (!range.matches()) return;
        if (await seek(mark.seconds)) {
          range.reset();
          setSelected(mark.id);
          setMessage(`已定位“${mark.name}” · ${rangeTime(mark.seconds)}`);
        }
      });
    // The app owns keyboard focus, user bindings and modal priority; this component owns musical navigation.
    useImperativeHandle(ref, () => ({
      jump(index) {
        const mark = rows.filter((row) => row.available)[index];
        if (mark) navigate(mark);
      },
    }));
    const marks = useMemo(() => {
      const every = Math.max(1, Math.ceil(rows.length / 100));
      return rows.filter((_, i) => i % every === 0);
    }, [rows]);
    const add = () => {
      if (!locked && range.matches())
        setEditor({
          id: null,
          tick: tickAtSeconds(song, store.getSnapshot().position),
          name: `书签 ${rows.filter((row) => !row.midi).length + 1}`,
        });
    };
    const save = () =>
      void run(async () => {
        if (!editor) return;
        await edits.commit<{ id: string }>(
          {
            type: "saveBookmark",
            content_id: song.contentId,
            id: editor.id ?? `bookmark-${crypto.randomUUID()}`,
            name: editor.name,
            tick: editor.tick,
          },
          "书签已保存",
          (result) => {
            setSelected(result.id);
            setEditor(null);
            setMessage("书签已保存");
          },
        );
      });
    return (
      <section className="song-bookmarks" aria-label="演奏书签">
        <div className="bookmark-actions">
          <span className="bookmark-heading">
            <Flag size={13} />
            书签
          </span>
          <label>
            <span className="sr-only">选择书签</span>
            <select
              aria-label="选择书签"
              disabled={locked || !rows.length}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setEnd("");
              }}
            >
              {!rows.length && (
                <option value="">{reading ? "正在读取…" : "尚无书签"}</option>
              )}
              {rows.map((mark, i) => (
                <option key={mark.id} value={mark.id}>
                  {i < 9 ? `${i + 1} · ` : ""}
                  {mark.name} · {rangeTime(mark.seconds)}
                  {mark.midi ? " · MIDI" : ""}
                  {mark.available ? "" : " · 超出当前范围"}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={locked || !row?.available}
            onClick={() => row && navigate(row)}
          >
            定位书签
          </button>
          <button disabled={locked} onClick={add}>
            <BookmarkPlus size={13} />
            保存当前位置
          </button>
          {row && !row.midi && (
            <>
              <button
                disabled={locked}
                aria-label="修改书签名称"
                onClick={() =>
                  setEditor({ id: row.id, tick: row.tick, name: row.name })
                }
              >
                <Pencil size={13} />
              </button>
              <button
                disabled={locked}
                aria-label="删除书签"
                onClick={() =>
                  void run(async () => {
                    await edits.commit(
                      {
                        type: "removeBookmark",
                        content_id: song.contentId,
                        id: row.id,
                      },
                      "书签已删除",
                    );
                    setMessage("书签已删除");
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          {row?.midi && (
            <button
              disabled={locked}
              onClick={() =>
                setEditor({ id: null, tick: row.tick, name: row.name })
              }
            >
              保存为个人书签
            </button>
          )}
          {!!after.length && (
            <>
              <span>循环到</span>
              <select
                aria-label="书签循环终点"
                disabled={locked}
                value={endpoint?.id ?? ""}
                onChange={(e) => setEnd(e.target.value)}
              >
                {after.map((mark) => (
                  <option key={mark.id} value={mark.id}>
                    {mark.name} · {rangeTime(mark.seconds)}
                  </option>
                ))}
              </select>
              <button
                disabled={locked || !endpoint || !row?.available}
                onClick={() =>
                  void run(async () => {
                    if (
                      row &&
                      endpoint &&
                      (await loop(row.seconds, endpoint.seconds, true))
                    ) {
                      range.reset();
                      setMessage(`循环：${row.name} → ${endpoint.name}`);
                    }
                  })
                }
              >
                书签间循环
              </button>
            </>
          )}
          <small>{shortcutHint}</small>
        </div>
        {!!marks.length && (
          <div className="bookmark-ruler" aria-label="书签在全曲中的位置">
            {marks.map((mark) => (
              <button
                key={mark.id}
                className={`${mark.midi ? "midi" : "user"} ${mark.id === selected ? "selected" : ""}`}
                style={{
                  left: `${Math.min(100, (mark.seconds / Math.max(0.01, song.duration)) * 100)}%`,
                }}
                aria-label={`定位书签 ${mark.name}`}
                title={`${mark.name} · ${rangeTime(mark.seconds)}${mark.midi ? " · MIDI 标记" : ""}`}
                disabled={locked || !mark.available}
                onClick={() => navigate(mark)}
              >
                <Flag size={11} />
              </button>
            ))}
          </div>
        )}
        {editor && (
          <form
            className="bookmark-editor"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              书签名称
              <input
                autoFocus
                aria-label="书签名称"
                value={editor.name}
                maxLength={80}
                disabled={locked}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <button disabled={locked || !editor.name.trim()} type="submit">
              保存书签
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => setEditor(null)}
            >
              取消
            </button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <SavedEditNotice
          message={edits.pendingRefresh}
          busy={working || reading}
          refresh={() =>
            void edits.refresh().catch((cause) => setError(String(cause)))
          }
        />
      </section>
    );
  },
);
