import { useEffect, useRef, useState } from "react";
import { api } from "../../api";

type AuditionState = {
  id: string | null;
  phase: "idle" | "preparing" | "playing";
  position: number;
  duration: number;
};
const idle: AuditionState = { id: null, phase: "idle", position: 0, duration: 0 };

/** The browser owns the request; the engine owns MIDI timing and sound release. */
export function useSongAudition(path: string | undefined) {
  const request = useRef<string | null>(null);
  const [state, setState] = useState(idle);
  const [error, setError] = useState("");
  const stop = async () => {
    const id = request.current;
    request.current = null;
    setState(idle);
    if (id) await api.command({ type: "stopSongAudition", id });
  };
  useEffect(() => {
    setError("");
    return () => { void stop().catch(() => {}); };
  }, [path]);
  useEffect(() => {
    if (state.phase !== "playing" || !state.id) return;
    const id = state.id;
    let live = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api.command<AuditionState>({ type: "songAuditionState", id })
        .then(value => {
          if (!live || request.current !== id) return;
          if (value.id !== id || value.phase === "idle") {
            request.current = null;
            setState(idle);
          } else setState(value);
        })
        .catch(e => {
          if (live && request.current === id) {
            setError(String(e));
            void stop().catch(() => {});
          }
        })
        .finally(() => { pending = false; });
    }, 400);
    return () => { live = false; clearInterval(timer); };
  }, [state.id, state.phase]);
  const start = async () => {
    if (!path) return;
    const previous = request.current;
    const id = `song-audition-${crypto.randomUUID()}`;
    request.current = id;
    setError("");
    setState({ ...idle, id, phase: "preparing" });
    try {
      if (previous) await api.command({ type: "stopSongAudition", id: previous });
      if (request.current !== id) return;
      const value = await api.command<AuditionState>({ type: "startSongAudition", path, id });
      if (request.current === id) {
        if (value.id !== id || value.phase === "idle") {
          request.current = null;
          setState(idle);
        } else setState(value);
      }
    } catch (e) {
      if (request.current === id) {
        setError(String(e));
        void stop().catch(() => {});
      }
    }
  };
  return { ...state, error, active: state.phase !== "idle", start, stop };
}
