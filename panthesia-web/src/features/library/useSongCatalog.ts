import { useCallback, useEffect, useState } from "react";
import { api, type SongRow } from "../../api";
import type { SongCatalog } from "../../engine/commands.generated";

export function useSongCatalog(rows: readonly SongRow[]) {
  const [catalog, setCatalog] = useState<SongCatalog | null>(null),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () =>
        void api
          .command<SongCatalog>({ type: "songCatalog" })
          .then((value) => {
            if (
              !value ||
              !Array.isArray(value.performances) ||
              typeof value.revision !== "string" ||
              value.performances.some(
                (row) =>
                  !row ||
                  typeof row.contentId !== "string" ||
                  typeof row.workId !== "string" ||
                  typeof row.title !== "string",
              )
            )
              throw new Error("歌曲关系回复不完整，请重新读取。");
            if (current) {
              setCatalog(value);
              setError("");
            }
          })
          .catch((error) => {
            if (current)
              setError(error instanceof Error ? error.message : String(error));
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      current = false;
    };
  }, [rows, revision]);
  return { catalog, error, reload };
}
