import { useEffect, useRef, useState } from "react";
import { api, pitchName, type LoadedSong } from "../../api";
import type { PlaybackPage, PlayerConfig } from "../../engine/commands.generated";
import { capturePracticeScope } from "../../engine/useCatalogRead";
import "./notePlaybackEditor.css";

const modeName = (mode: PlayerConfig | null | undefined) =>
  mode === "Human" ? "需要弹奏" : mode === "Auto" ? "自动伴奏" : mode === "Mute" ? "忽略" : "沿用音轨";

/** Read the original note list, including discarded notes, in bounded pages. */
export function NotePlaybackEditor({ song, locked, changed, onBusy }: {
  song: LoadedSong; locked: boolean; changed: () => Promise<void>; onBusy: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState(song.tracks[0]?.id ?? 0);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PlaybackPage | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [mode, setMode] = useState<PlayerConfig | "inherit">("Auto");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setPage(null); setSelected([]);
    void api.readPractice<PlaybackPage>(capturePracticeScope(song), { type: "readNotePlayback", track, offset, limit: 100 })
      .then(value => { if (!cancelled) setPage(value); })
      .catch(error => { if (!cancelled) setError(String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, track, offset, song.engineId, song.contentId, song.scoreRevision, song.annotationRevision, refresh]);
  const busy = locked || loading || saving;
  const save = async () => {
    if (!page || busy || !selected.length) return;
    setSaving(true); onBusy(true); setError(""); setMessage("");
    try {
      await api.editPractice(capturePracticeScope(song), { type: "editNotePlayback", track, indices: selected,
        mode: mode === "inherit" ? null : mode, expected: page.revision });
      if (alive.current) { setMessage(`已保存 ${selected.length} 个音符的播放规则`); setSelected([]); }
      await changed();
    } catch (error) {
      if (alive.current) setError(`保存结果需要核对：${String(error)}。请重新读取当前规则。`);
    } finally {
      if (alive.current) { setSaving(false); setRefresh(value => value + 1); }
      onBusy(false);
    }
  };
  return <details className="note-playback-editor" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>逐音播放规则 <span>弹奏 · 伴奏 · 忽略</span></summary>
    {open && <>
      <p>需要弹奏的音符用于按键后继续。自动伴奏由软件播放。忽略的音符停止发声，并从瀑布与 MIDI 练习谱中隐藏。音轨的静音与伴奏设置继续生效。</p>
      <div className="note-playback-controls">
        <label>音轨<select aria-label="播放规则音轨" value={track} disabled={busy} onChange={event => { setTrack(Number(event.target.value)); setOffset(0); }}>
          {song.tracks.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label>设为<select aria-label="逐音播放方式" value={mode} disabled={busy} onChange={event => setMode(event.target.value as PlayerConfig | "inherit")}>
          <option value="Human">需要弹奏</option><option value="Auto">自动伴奏</option><option value="Mute">忽略</option><option value="inherit">沿用音轨</option>
        </select></label>
        <button type="button" disabled={busy || !selected.length} onClick={() => void save()}>保存所选 {selected.length ? `· ${selected.length} 音` : ""}</button>
        <button type="button" disabled={busy} onClick={() => { setError(""); setMessage(""); setRefresh(value => value + 1); }}>重新读取</button>
      </div>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {loading && <p role="status">正在读取原始音符…</p>}
      {page && <>
        <div className="note-playback-paging">
          <label><input type="checkbox" aria-label="选择本页音符" disabled={busy || !page.notes.length}
            checked={!!page.notes.length && selected.length === page.notes.length}
            onChange={event => setSelected(event.target.checked ? page.notes.map(note => note.index) : [])} />选择本页</label>
          <span>{page.total ? `${offset + 1}–${Math.min(offset + page.notes.length, page.total)}` : 0} / {page.total} 音</span>
          <button type="button" disabled={busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>上一页</button>
          <button type="button" disabled={busy || offset + page.notes.length >= page.total} onClick={() => setOffset(value => value + 100)}>下一页</button>
        </div>
        <div className="note-playback-list" aria-label="原始音符播放规则">
          {page.notes.map(note => <label key={note.index}>
            <input type="checkbox" aria-label={`选择播放规则音符 ${note.index + 1}`} checked={selected.includes(note.index)} disabled={busy}
              onChange={event => setSelected(values => event.target.checked ? [...values, note.index] : values.filter(index => index !== note.index))} />
            <strong>{pitchName(note.pitch)}</strong><span>第 {note.measure} 小节 · {note.start.toFixed(2)} 秒</span><span data-mode={note.mode ?? "inherit"}>{modeName(note.mode)}</span>
          </label>)}
        </div>
      </>}
    </>}
  </details>;
}
