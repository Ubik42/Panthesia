import { useEffect, useState } from "react";
import type { SongRow } from "../../api";
import type { RepertoireView } from "../../engine/commands.generated";
import { readRepertoire } from "./repertoireClient";
import { SongPerformanceManager } from "../practice/SongPerformanceManager";

export function BrowserSongVersions({
  row,
  disabled,
  open,
  changed,
}: {
  row: SongRow;
  disabled: boolean;
  open: (path: string) => Promise<unknown>;
  changed: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [view, setView] = useState<RepertoireView | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setExpanded(false);
    setView(null);
    setError("");
  }, [row.contentId, row.path]);
  useEffect(() => {
    if (!expanded || !row.contentId) return;
    let current = true;
    setPending(true);
    setError("");
    void readRepertoire(row.path, row.contentId)
      .then((value) => {
        if (current) setView(value);
      })
      .catch((error) => {
        if (current)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (current) setPending(false);
      });
    return () => {
      current = false;
    };
  }, [expanded, row.contentId, row.path, revision]);
  if (row.path.startsWith("exercise:") || row.path === "内置技术练习")
    return null;
  return (
    <section className="browser-song-version-manager" aria-label="歌曲版本管理">
      <button
        disabled={disabled || !row.contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起版本管理" : "管理同歌演奏版本"}
      </button>
      {expanded && (
        <>
          {pending && <p role="status">正在读取演奏版本…</p>}
          {error && (
            <p role="status">
              {error}{" "}
              <button onClick={() => setRevision((value) => value + 1)}>
                重新读取
              </button>
            </p>
          )}
          {view?.project && (
            <SongPerformanceManager
              embedded
              view={view}
              disabled={disabled || pending}
              open={(path) => open(path)}
              change={async (action) => {
                setPending(true);
                setError("");
                try {
                  await action();
                  if (row.contentId)
                    setView(await readRepertoire(row.path, row.contentId));
                  changed();
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  setPending(false);
                }
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
