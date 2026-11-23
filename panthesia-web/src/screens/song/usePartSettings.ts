import { useEffect, useRef, useState } from "react";
import { api, type LoadedSong, type EngineCommand } from "../../api";
import type { HandUndoState, PracticePart } from "../../engine/commands.generated";

type Track = LoadedSong["tracks"][number];
/** The one picker open at a time: a track's note colour or its instrument. */
export type PartPicker = { track: number; kind: "color" | "instrument" };

/** Hand, colour, sound and instrument of each part (track) of the song, applied through the
 * engine one command at a time. */
export function usePartSettings(song: LoadedSong, disabled: boolean, command: (value: EngineCommand) => Promise<boolean>) {
  const [picker, setPicker] = useState<PartPicker | null>(null),
    [group, setGroup] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const busy = useRef(false);
  const pickerTrack = song.tracks.find((t) => t.id === picker?.track);
  const soundOf = (t: Track) => song.trackSounds?.[String(t.id)];

  /** Run one or more engine commands as a single user action. */
  const run = async (work: () => Promise<boolean>, failure = "设置未能保存，请重试。") => {
    if (pending || disabled || busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const ok = await work();
      if (!ok) setError(failure);
      return ok;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const trackCommand = (t: Track, values: Partial<{ mode: string; part: string; visible: boolean }>): EngineCommand => ({
    type: "track",
    id: t.id,
    mode: t.mode,
    part: t.part,
    visible: t.visible,
    ...values,
  });
  const handProof = async () =>
    (await api.commandForEngine<HandUndoState>(song.engineId ?? undefined, { type: "handUndoState" })).proof;

  const setHand = (t: Track, part: PracticePart) =>
    run(
      async () =>
        command({ type: "setPartHands", content_id: song.contentId, track: t.id, part, split_pitch: null, proof: await handProof(), hints: [], clear: [] }),
      "手别未能保存，请重试。",
    );
  const setColor = (t: Track, color: string | null) =>
    run(async () => {
      const appearance = t.name === t.sourceName && !color ? null : { name: t.name === t.sourceName ? null : t.name, color };
      if (!(await command({ type: "trackAppearance", id: t.id, appearance }))) return false;
      if (!t.visible && !(await command(trackCommand(t, { visible: true })))) return false;
      setPicker(null);
      return true;
    });
  const hideNotes = (t: Track) =>
    run(async () => {
      const ok = await command(trackCommand(t, { visible: false }));
      if (ok) setPicker(null);
      return ok;
    });
  const toggleSound = (t: Track) =>
    run(() => command(trackCommand(t, { mode: t.mode === "mute" ? (t.part === "other" ? "auto" : "human") : "mute" })));
  const setSound = (t: Track, patch: Partial<{ volume: number; program: number | null }>) => {
    const sound = soundOf(t);
    return run(() =>
      command({ type: "trackSound", id: t.id, sound: { volume: sound?.volume ?? 100, pan: sound?.pan ?? null, program: sound?.program ?? null, ...patch } }),
    );
  };
  const resetAll = () =>
    run(async () => {
      for (const t of song.tracks)
        if (!(await command({ type: "resetPartSettings", content_id: song.contentId, track: t.id, proof: await handProof() }))) return false;
      return true;
    });
  const autoColor = () =>
    run(async () => {
      const assigned = song.tracks.some((t) => t.part === "left" || t.part === "right");
      for (const t of song.tracks) {
        const ok =
          (await command({
            type: "trackAppearance",
            id: t.id,
            appearance: {
              name: t.name === t.sourceName ? null : t.name,
              color: null,
              handColors: { left: { color: null, visible: true }, right: { color: null, visible: true }, other: { color: null, visible: !assigned } },
            },
          })) && (await command(trackCommand(t, { visible: !assigned || t.part !== "other" })));
        if (!ok) return false;
      }
      return true;
    });

  // Instrument preview while the instrument picker is open.
  useEffect(() => setPreview(false), [picker?.track, picker?.kind]);
  const previewProgram = pickerTrack ? soundOf(pickerTrack)?.program ?? null : null;
  useEffect(() => {
    if (!preview || !pickerTrack || picker?.kind !== "instrument" || pending || disabled) return;
    const id = `song-audition-instrument-${crypto.randomUUID()}`;
    let disposed = false;
    const stop = () => void api.commandForEngine(song.engineId ?? undefined, { type: "stopSongAudition", id }).catch(() => {});
    void api
      .commandForEngine(song.engineId ?? undefined, { type: "startInstrumentPreview", id, content_id: song.contentId, track: pickerTrack.id, program: previewProgram })
      .then(() => disposed && stop())
      .catch((e) => {
        if (!disposed) {
          setPreview(false);
          setError(String(e));
        }
      });
    const timer = window.setInterval(() => {
      void api
        .commandForEngine<{ phase: string }>(song.engineId ?? undefined, { type: "songAuditionState", id })
        .then((s) => !disposed && s.phase === "idle" && setPreview(false))
        .catch(() => !disposed && setPreview(false));
    }, 800);
    const blur = () => {
      setPreview(false);
      stop();
    };
    const hide = () => document.hidden && blur();
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hide);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hide);
      stop();
    };
  }, [preview, picker?.kind, pickerTrack?.id, previewProgram, pending, disabled, song.contentId, song.engineId]);

  return { picker, setPicker, pickerTrack, group, setGroup, pending, error, soundOf, setHand, setColor, hideNotes, toggleSound, setSound, resetAll, autoColor, preview, setPreview };
}
