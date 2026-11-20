import { useEffect, useState } from "react";
import { api } from "../../api";
import type { LibraryFolder } from "./useLibraryReads";

export function FolderManager({
  close,
  changed,
}: {
  close: () => void;
  changed: () => Promise<unknown>;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const read = async () => {
    const result = await api.command<{ folders: LibraryFolder[] }>({
      type: "libraryFolders",
    });
    setFolders(result.folders);
  };
  useEffect(() => {
    void read().catch((e) => setError(String(e)));
  }, []);
  const execute = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await read();
      await changed();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) close();
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="扫描目录管理"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-heading">
          <h2>扫描目录</h2>
          <button disabled={busy} onClick={close}>
            完成
          </button>
        </div>
        <p>默认目录和手动添加的目录在这里统一管理。</p>
        <div className="scan-folders">
          {folders.length === 0 && <p>暂无扫描目录，可添加 MIDI 文件夹。</p>}
          {folders.map((folder) => (
            <div
              className="scan-folder-entry"
              key={folder.path}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border, #dde1ed)",
              }}
            >
              <strong>
                {folder.kind === "catalog"
                  ? "默认曲库"
                  : folder.path
                      .replaceAll("\\", "/")
                      .split("/")
                      .filter(Boolean)
                      .at(-1)}
              </strong>
              <p style={{ overflowWrap: "anywhere", margin: "4px 0" }}>
                {folder.path}
              </p>
              <small>
                {folder.automatic ? "自动发现" : "手动添加"} ·{" "}
                {folder.available ? "可访问" : "当前不可访问"}
              </small>
              {folder.kind === "folder" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void execute(() =>
                      api.command({
                        type: "removeLibraryFolder",
                        path: folder.path,
                      }),
                    )
                  }
                >
                  停止扫描
                </button>
              )}
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <p className="parameter-help">停止扫描后原文件保留。</p>
        <div className="dialog-actions">
          <button
            disabled={busy || !api.desktop}
            onClick={() => void execute(() => api.importFolder())}
          >
            添加目录…
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void execute(() => api.command({ type: "refreshLibrary" }))
            }
          >
            重新扫描
          </button>
        </div>
      </section>
    </div>
  );
}
