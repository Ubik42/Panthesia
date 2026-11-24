import { useEffect, useState } from "react";
import { api } from "../../api";

const covers = new Map<string, Promise<string | null>>();
/** A song picture (cover) as a data URL, read once per path and kept for the session. */
export function useSongCover(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let current = true;
    if (!covers.has(path)) {
      if (covers.size > 200) covers.clear();
      covers.set(
        path,
        api
          .command<{ dataUrl: string }>({ type: "songCover", path })
          .then((v) => v.dataUrl)
          .catch(() => null),
      );
    }
    void covers.get(path)!.then((value) => current && setUrl(value));
    return () => {
      current = false;
    };
  }, [path]);
  return url;
}

/** The open song's cover as a data URL; `key` (the song's content id) is null when not needed. */
export function useOpenSongCover(key: string | null | undefined) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    setPath(null);
    if (!key) return;
    let current = true;
    api
      .command<{ materials: { kind: string; items: { path: string | null; state: string }[] }[] }>({ type: "songSummary", path: null })
      .then((summary) => current && setPath(summary.materials.find((m) => m.kind === "cover")?.items.find((i) => i.state !== "missing")?.path ?? null))
      .catch(() => current && setPath(null));
    return () => {
      current = false;
    };
  }, [key]);
  return useSongCover(path);
}
