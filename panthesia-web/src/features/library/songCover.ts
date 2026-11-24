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
