import { useEffect, useMemo, useState } from "react";
import { api, type LoadedSong } from "../../api";
import { metadataDefaultsReply } from "../library/metadataClient";
import type { Metadata } from "../library/metadataTypes";
import "./songCredits.css";

export function SongCredits({ song, fallback, editing }: {
  song: LoadedSong | null;
  fallback: string;
  editing: boolean;
}) {
  const source = useMemo(() => song ? ({ contentId: song.contentId, engineId: song.engineId,
    scoreRevision: song.scoreRevision, annotationRevision: song.annotationRevision }) : null,
    [song?.contentId, song?.engineId, song?.scoreRevision, song?.annotationRevision]);
  const key = JSON.stringify(source);
  const [stored, setStored] = useState<{key: string; value: Metadata} | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!source || editing) return;
    let active = true;
    setError("");
    void api.readPractice<unknown>(source, {type: "readMetadataDefaults"})
      .then(reply => metadataDefaultsReply(reply, source.contentId).value)
      .then(value => { if (active) setStored({key, value}); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { active = false; };
  }, [source, key, editing, retry, song?.title]);
  const value = stored?.key === key ? stored.value : null;
  const credits = value ? [["演奏者", value.artist], ["版权", value.copyright], ["许可", value.license]]
    .filter(([, text]) => text) : [];
  const byline = value ? [value.composer && `作曲：${value.composer}`, value.arranger && `改编：${value.arranger}`]
    .filter(Boolean).join(" · ") : fallback;
  return <div className="song-credits">
    {value?.subtitle && <p className="song-subtitle" title={value.subtitle}>{value.subtitle}</p>}
    <div className="song-credits-line"><span title={byline || undefined}>{byline || (song ? "本地 MIDI" : fallback)}</span>
      {!!credits.length && <details key={key} className="song-attribution"><summary>署名与许可</summary>
        <dl>{credits.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
      </details>}
      {error && <button className="song-credits-retry" title={error} onClick={() => setRetry(value => value + 1)}>重新读取资料</button>}
    </div>
  </div>;
}
