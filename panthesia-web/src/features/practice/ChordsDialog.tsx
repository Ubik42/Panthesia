import { useMemo, useState } from "react";
import { Dialog } from "../../app/Dialog";
import type { LoadedSong } from "../../engine/sessionTypes";
import type { EngineCommand } from "../../api";
import "./chordsDialog.css";

type Row = { tick: number; label: string };

/** Measure and beat (1-based) of a tick on the song's grid. */
function position(song: LoadedSong, tick: number) {
  const measure = [...song.measures].reverse().find((m) => m.startTick <= tick) ?? song.measures[0];
  if (!measure) return { measure: 1, beat: 1 };
  const beat = (song.ppq * 4) / measure.denominator;
  return { measure: measure.number, beat: Math.floor((tick - measure.startTick) / beat) + 1 };
}
function tickAt(song: LoadedSong, measureNumber: number, beatNumber: number) {
  const measure = song.measures.find((m) => m.number === measureNumber);
  if (!measure) return null;
  const tick = measure.startTick + (beatNumber - 1) * ((song.ppq * 4) / measure.denominator);
  return tick < measure.endTick ? tick : null;
}

/** Edit the song's chords; saved chords are the song's own and analysis never replaces them. */
export function ChordsDialog({
  song,
  close,
  run,
}: {
  song: LoadedSong;
  close: () => void;
  run: (command: EngineCommand, changesSong?: boolean) => Promise<boolean>;
}) {
  const harmony = song.harmony;
  const initial = useMemo<Row[]>(
    () => (harmony?.chords ?? []).map((c) => ({ tick: c.tick, label: c.harte ? c.name : "N" })),
    [harmony],
  );
  const [rows, setRows] = useState(initial);
  const [added, setAdded] = useState({ measure: 1, beat: 1, label: "" });
  const [error, setError] = useState("");
  const changed = rows.length !== initial.length || rows.some((row, i) => row.label !== initial[i]?.label || row.tick !== initial[i]?.tick);

  const save = async () => {
    if (await run({ type: "saveChords", content_id: song.contentId, chords: rows }, true)) close();
  };
  const adopt = async () => {
    if (await run({ type: "adoptChords", content_id: song.contentId }, true)) close();
  };
  const add = () => {
    const tick = tickAt(song, added.measure, added.beat);
    if (tick === null || !added.label.trim()) {
      setError("请填写存在的小节和拍，以及和弦。");
      return;
    }
    setError("");
    setRows((previous) => [...previous.filter((row) => row.tick !== tick), { tick, label: added.label.trim() }].sort((a, b) => a.tick - b.tick));
    setAdded((previous) => ({ ...previous, label: "" }));
  };

  return (
    <Dialog title="和弦" close={close}>
      <div className="chords-dialog">
        <p className="chords-source">
          {harmony?.origin === "generated" && harmony.saved
            ? "已采用自动分析结果，不再随分析变化。"
            : harmony?.origin === "generated"
            ? "当前是自动分析结果，可以修改后保存，或直接采用。保存后不再随分析变化。"
            : harmony?.origin === "imported"
              ? "当前和弦来自乐谱或标注文件。修改后保存为这首歌自己的和弦。"
              : "这首歌的和弦已经编辑过。"}
          写法：<code>Bm7</code>、<code>F#7/A#</code>、<code>Dsus2</code>，无和弦写 <code>N</code>。
        </p>
        {error && <p className="chords-error" role="alert">{error}</p>}
        <ol className="chords-list">
          {rows.map((row, index) => {
            const at = position(song, row.tick);
            return (
              <li key={row.tick}>
                <span>第 {at.measure} 小节 第 {at.beat} 拍</span>
                <input
                  aria-label={`第 ${at.measure} 小节第 ${at.beat} 拍的和弦`}
                  value={row.label}
                  onChange={(event) => setRows((previous) => previous.map((r, i) => (i === index ? { ...r, label: event.target.value } : r)))}
                />
                <button aria-label="删除这个和弦" onClick={() => setRows((previous) => previous.filter((_, i) => i !== index))}>
                  删除
                </button>
              </li>
            );
          })}
        </ol>
        <div className="chords-add">
          <label>
            小节 <input type="number" min={1} value={added.measure} onChange={(e) => setAdded({ ...added, measure: Number(e.target.value) })} />
          </label>
          <label>
            拍 <input type="number" min={1} value={added.beat} onChange={(e) => setAdded({ ...added, beat: Number(e.target.value) })} />
          </label>
          <input aria-label="新和弦" placeholder="和弦" value={added.label} onChange={(e) => setAdded({ ...added, label: e.target.value })} />
          <button onClick={add}>添加</button>
        </div>
        <footer>
          {harmony?.origin === "generated" && !harmony.saved && (
            <button onClick={adopt} disabled={changed}>
              采用自动分析结果
            </button>
          )}
          <button className="primary" onClick={save} disabled={!changed}>
            保存
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
