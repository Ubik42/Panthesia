import { useEffect, useRef, useState } from "react";
import { Folder, RefreshCw } from "lucide-react";
import { api, type SongRow } from "../../api";
import type { LibraryFolder } from "./useLibraryReads";
export const libraryPath = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\//, "")
    .toLowerCase()
    .replace(/\/$/, "");
export function ScanFolders({
  rows,
  selected,
  change,
  manage,
}: {
  rows: readonly SongRow[];
  selected: string | null;
  change: (path: string | null) => void;
  manage: () => void;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]),
    [error, setError] = useState("");
  const initialized = useRef(false);
  const read = async () => {
    try {
      const value = await api.command<{ folders: LibraryFolder[] }>({
        type: "libraryFolders",
      });
      setFolders(value.folders);
      setError("");
      if (!initialized.current) {
        initialized.current = true;
        const local = value.folders.find(
          (f) => f.automatic && f.kind === "folder" && f.available,
        );
        if (local) change(local.path);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void read();
  }, []);
  return (
    <section className="scan-folders" aria-label="已扫描目录">
      <div className="scan-folders-heading">
        <strong>扫描目录</strong>
        <button
          className="icon-button"
          aria-label="刷新扫描目录"
          onClick={() => void read()}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <button
        className={!selected ? "active" : ""}
        onClick={() => change(null)}
      >
        <Folder size={14} />
        <span>全部曲库</span>
        <small>{rows.length.toLocaleString()}</small>
      </button>
      {folders.map((f) => {
        const count = rows.filter((row) =>
          libraryPath(row.path).startsWith(libraryPath(f.path) + "/"),
        ).length;
        return (
          <button
            key={f.path}
            className={selected === f.path ? "active" : ""}
            title={f.path}
            aria-pressed={selected === f.path}
            onClick={() => change(f.path)}
          >
            <Folder size={14} />
            <span>
              <b>
                {f.kind === "catalog"
                  ? "默认曲库"
                  : f.path
                      .replaceAll("\\", "/")
                      .split("/")
                      .filter(Boolean)
                      .at(-1)}
              </b>
              <small className="scan-folder-path">{f.path}</small>
            </span>
            <small>{f.available ? count.toLocaleString() : "未连接"}</small>
          </button>
        );
      })}
      {error && <p role="alert">{error}</p>}
      <button className="scan-folders-manage" onClick={manage}>
        管理扫描目录…
      </button>
    </section>
  );
}
