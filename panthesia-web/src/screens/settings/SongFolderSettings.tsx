import { useEffect, useState } from "react";
import { api } from "../../api";

type FolderStatus = { root: string | null; songs: number; files: number; shortcuts: number; scannedAt: number | null; error: string | null };

/** The music folder the start page searches (scanned at start-up; its 索引库 subfolder gets a
 * shortcut per organised song). */
export function SongFolderSettings({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<FolderStatus>) => {
    setError("");
    try {
      setStatus(await work());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void run(() => api.command<FolderStatus>({ type: "songFolder" }));
  }, []);
  const choose = () =>
    run(async () => {
      const path = api.desktop ? await api.pickFolder("选择曲目文件夹") : window.prompt("曲目文件夹的完整路径", status?.root ?? "")?.trim();
      return path ? api.command<FolderStatus>({ type: "setSongFolder", path }) : (status as FolderStatus);
    });
  return (
    <section aria-labelledby="folder-title">
      <h3 id="folder-title">曲目文件夹</h3>
      <div className="ui-row">
        <span>
          位置
          <br />
          <small className="selectable">{status?.root ?? "未指定"}</small>
        </span>
        <span className="settings-row-actions">
          <button type="button" disabled={disabled} onClick={() => void choose()}>
            {status?.root ? "更改…" : "选择…"}
          </button>
          <button type="button" disabled={disabled || !status?.root} onClick={() => void run(() => api.command<FolderStatus>({ type: "rescanSongFolder" }))}>
            重新扫描
          </button>
        </span>
      </div>
      {status?.root && (
        <p className="parameter-help">
          {status.scannedAt ? `${status.songs} 首已整理 · ${status.files} 个文件 · 索引库中 ${status.shortcuts} 个快捷方式` : "正在扫描…"}
        </p>
      )}
      <p className="parameter-help">启动时扫描这个文件夹，主界面可以搜索其中的全部曲目；每首整理过的曲目在其“索引库”子文件夹中有一个快捷方式。文件夹本身只读。</p>
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    </section>
  );
}
