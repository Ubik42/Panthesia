import { useEffect, useRef, useState } from "react";
import { api, type LoadedSong, type EngineCommand } from "../../api";
import type {
  HandUndoState,
  PracticePart,
} from "../../engine/commands.generated";
export type PartChoice = {
  track: number;
  kind: "hand" | "color" | "instrument" | "volume";
};
export type PartDrag = {
  track: number;
  kind: "hand" | "color" | "instrument" | "volume" | "reset";
};
export function usePartSettings(
  song: LoadedSong,
  disabled: boolean,
  command: (value: EngineCommand) => Promise<boolean>,
) {
  const [choice, setChoice] = useState<PartChoice | null>(null),
    [group, setGroup] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const track = song.tracks.find((t) => t.id === choice?.track),
    sound = track ? song.trackSounds?.[String(track.id)] : undefined;
  const act = async (value: EngineCommand, close = true) => {
    if (pending || disabled) return;
    setPending(true);
    setError("");
    try {
      if (await command(value)) {
        if (close) setChoice(null);
      } else setError("设置未能保存，请重试。");
    } finally {
      setPending(false);
    }
  };
  const chooseColor = async (color: string | null) => {
    if (!track || disabled || pending) return;
    setPending(true);
    setError("");
    try {
      const appearance =
        track.name === track.sourceName && !color
          ? null
          : {
              name: track.name === track.sourceName ? null : track.name,
              color,
            };
      if (
        !(await command({ type: "trackAppearance", id: track.id, appearance }))
      )
        return;
      if (
        !track.visible &&
        !(await command({
          type: "track",
          id: track.id,
          mode: track.mode,
          part: track.part,
          visible: true,
        }))
      )
        return;
      setChoice(null);
    } finally {
      setPending(false);
    }
  };
  const chooseHand = async (part: PracticePart) => {
    if (!track || disabled || pending) return;
    setPending(true);
    setError("");
    try {
      const state = await api.commandForEngine<HandUndoState>(
        song.engineId ?? undefined,
        { type: "handUndoState" },
      );
      if (
        await command({
          type: "setPartHands",
          content_id: song.contentId,
          track: track.id,
          part,
          split_pitch: null,
          proof: state.proof,
          hints: [],
          clear: [],
        })
      )
        setChoice(null);
      else setError("手别未能保存，请重试。");
    } catch {
      setError("手别设置暂不可用，请重新打开。");
    } finally {
      setPending(false);
    }
  };
  const update = (
    t: LoadedSong["tracks"][number],
    values: Partial<{ mode: string; part: string; visible: boolean }>,
  ) => ({
    type: "track" as const,
    id: t.id,
    mode: t.mode,
    part: t.part,
    visible: t.visible,
    ...values,
  });
  const soundChange = (
    patch: Partial<{ volume: number; program: number | null }>,
  ) =>
    track &&
    act(
      {
        type: "trackSound",
        id: track.id,
        sound: {
          volume: sound?.volume ?? 100,
          pan: sound?.pan ?? null,
          program: sound?.program ?? null,
          ...patch,
        },
      },
      false,
    );

  const busy = useRef(false);
  const [drag, setDrag] = useState<PartDrag | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    setPreview(false);
  }, [choice?.track, choice?.kind]);
  useEffect(() => {
    if (
      !preview ||
      !track ||
      choice?.kind !== "instrument" ||
      pending ||
      disabled
    )
      return;
    const id = `song-audition-instrument-${crypto.randomUUID()}`;
    let disposed = false;
    const stop = () => {
      void api
        .commandForEngine(song.engineId ?? undefined, {
          type: "stopSongAudition",
          id,
        })
        .catch(() => {});
    };
    const active = () =>
      api.commandForEngine<{ phase: string }>(song.engineId ?? undefined, {
        type: "songAuditionState",
        id,
      });
    void api
      .commandForEngine(song.engineId ?? undefined, {
        type: "startInstrumentPreview",
        id,
        content_id: song.contentId,
        track: track.id,
        program: sound?.program ?? null,
      })
      .then(() => {
        if (disposed) stop();
      })
      .catch((e) => {
        if (!disposed) {
          setPreview(false);
          setError(String(e));
        }
      });
    const timer = window.setInterval(() => {
      void active()
        .then((s) => {
          if (!disposed && s.phase === "idle") setPreview(false);
        })
        .catch(() => {
          if (!disposed) setPreview(false);
        });
    }, 800);
    const blur = () => {
      setPreview(false);
      stop();
    };
    const hide = () => {
      if (document.hidden) blur();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hide);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hide);
      stop();
    };
  }, [
    preview,
    choice?.kind,
    track?.id,
    sound?.program,
    pending,
    disabled,
    song.contentId,
    song.engineId,
  ]);
  const applyMany = async (
    operation: (target: LoadedSong["tracks"][number]) => Promise<boolean>,
    targets: LoadedSong["tracks"],
  ) => {
    if (pending || disabled || busy.current) return;
    busy.current = true;
    setPending(true);
    setPreview(false);
    setError("");
    let done = 0;
    try {
      for (const target of targets) {
        if (!(await operation(target))) throw new Error("设置未能保存");
        done++;
      }
    } catch (e) {
      setError(`已应用 ${done} 个声部。${String(e)}`);
    } finally {
      busy.current = false;
      setPending(false);
      setDrag(null);
    }
  };
  const copyTo = async (ids: number[]) => {
    if (drag?.kind === "reset") {
      await applyMany(
        async (target) => {
          const state = await api.commandForEngine<HandUndoState>(
            song.engineId ?? undefined,
            { type: "handUndoState" },
          );
          return command({
            type: "resetPartSettings",
            content_id: song.contentId,
            track: target.id,
            proof: state.proof,
          });
        },
        song.tracks.filter((t) => ids.includes(t.id)),
      );
      return;
    }
    const source = song.tracks.find((t) => t.id === drag?.track);
    if (!source || !drag) return;
    const kind = drag.kind;
    if (
      kind === "hand" &&
      song.notes.some((n) => n.track === source.id && n.manualHand)
    ) {
      setError("逐音分手依赖当前声部的音符，请在目标声部的自定义页面分配。");
      setDrag(null);
      return;
    }
    const sourceSound = song.trackSounds?.[String(source.id)] ?? null;
    await applyMany(
      async (target) => {
        if (kind === "hand") {
          const state = await api.commandForEngine<HandUndoState>(
            song.engineId ?? undefined,
            { type: "handUndoState" },
          );
          return command({
            type: "setPartHands",
            content_id: song.contentId,
            track: target.id,
            part:
              source.part === "left"
                ? "LeftHand"
                : source.part === "right"
                  ? "RightHand"
                  : "Other",
            split_pitch: null,
            proof: state.proof,
            hints: [],
            clear: [],
          });
        }
        if (kind === "color")
          return (
            (await command({
              type: "trackAppearance",
              id: target.id,
              appearance: {
                name: target.name === target.sourceName ? null : target.name,
                color: source.color ?? null,
              },
            })) && command(update(target, { visible: source.visible }))
          );
        if (kind === "volume")
          return command(
            update(target, {
              mode:
                source.mode === "mute"
                  ? "mute"
                  : target.part === "other"
                    ? "auto"
                    : "human",
            }),
          );
        return command({
          type: "trackSound",
          id: target.id,
          sound: {
            volume: song.trackSounds?.[String(target.id)]?.volume ?? 100,
            pan: song.trackSounds?.[String(target.id)]?.pan ?? null,
            program: sourceSound?.program ?? null,
          },
        });
      },
      song.tracks.filter((t) => ids.includes(t.id) && t.id !== source.id),
    );
  };
  const autoColor = () => {
    const assigned = song.tracks.some(
      (t) => t.part === "left" || t.part === "right",
    );
    return applyMany(
      async (t) =>
        (await command({
          type: "trackAppearance",
          id: t.id,
          appearance: {
            name: t.name === t.sourceName ? null : t.name,
            color: null,
            handColors: {
              left: { color: null, visible: true },
              right: { color: null, visible: true },
              other: { color: null, visible: !assigned },
            },
          },
        })) && command(update(t, { visible: !assigned || t.part !== "other" })),
      song.tracks,
    );
  };
  return {
    choice,
    setChoice,
    group,
    setGroup,
    pending,
    error,
    track,
    sound,
    act,
    chooseColor,
    chooseHand,
    update,
    soundChange,
    drag,
    setDrag,
    copyTo,
    autoColor,
    preview,
    setPreview,
  };
}
