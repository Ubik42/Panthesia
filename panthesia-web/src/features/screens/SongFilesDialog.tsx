import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Dialog } from "../../Dialog";
import "./songFiles.css";

type Version = { id: string; label: string | null; path: string | null; missing?: boolean; current: boolean; default: boolean };
type SongFile = { id: string; role: string; stem?: string | null; label?: string | null; path: string; relative: string; missing: boolean };
type SongFiles = {
  manifest: string | null;
  readOnly: boolean;
  current: string;
  performances: Version[];
  files: SongFile[];
  unmatched: number;
};

const STEMS: [string, string][] = [
  ["accompaniment", "伴奏"],
  ["vocals", "人声"],
  ["piano", "钢琴"],
  ["other", "其他"],
];
const ROLE_NAMES: Record<string, string> = {
  performance: "演奏",
  score: "谱面",
  paper: "谱页",
  source: "原音频",
  "annotation-source": "标注来源",
};
function roleName(file: SongFile) {
  if (file.role === "stem") return STEMS.find(([id]) => id === file.stem)?.[1] ?? file.stem ?? "音轨";
  return ROLE_NAMES[file.role] ?? file.role;
}
const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** Versions and companion files of the current song, as listed in its `.panthesia` manifest. */
export function SongFilesDialog({
  close,
  openVersion,
}: {
  close: () => void;
  openVersion: (path: string) => Promise<boolean>;
}) {
  const [files, setFiles] = useState<SongFiles | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stem, setStem] = useState("accompaniment");
  const [manualPath, setManualPath] = useState("");

  const load = useCallback(async () => {
    try {
      setFiles(await api.command<SongFiles>({ type: "songFiles" }));
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const current = files?.performances.find((p) => p.current);
  const edit = async (request: { action: string; path?: string; id?: string; role?: string; stem?: string; label?: string | null }) => {
    if (busy) return;
    setBusy(true);
    try {
      setFiles(await api.command<SongFiles>({ type: "editSongFile", ...request }));
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const add = async (kind: "performance" | "audio", role: string) => {
    const path = api.desktop ? await api.pickSongFile(kind, current?.path ?? undefined) : manualPath.trim();
    if (!path) return;
    await edit({ action: "add", path, role, stem: role === "stem" ? stem : undefined });
    setManualPath("");
  };
  const switchTo = async (version: Version) => {
    if (!version.path || busy) return;
    setBusy(true);
    try {
      if (await openVersion(version.path)) await load();
    } finally {
      setBusy(false);
    }
  };
  const rename = (version: Version) => {
    const label = window.prompt("版本名称", version.label ?? "");
    if (label !== null) void edit({ action: "label", id: version.id, label });
  };
  const companions = files?.files.filter((f) => f.role !== "performance") ?? [];
  const locked = busy || !!files?.readOnly;

  return (
    <Dialog title="歌曲文件与版本" close={close}>
      <div className="song-files">
        {error && <p className="song-files-error" role="alert">{error}</p>}
        {files && (
          <>
            <p className="song-files-manifest">
              {files.manifest
                ? <>歌曲清单：<code>{fileName(files.manifest)}</code>{files.readOnly && "（来自更新版本的程序，只读）"}</>
                : "这首歌还没有歌曲清单；第一次修改设置或登记文件时在乐曲文件旁创建。"}
            </p>
            {files.unmatched > 0 && (
              <p className="song-files-warning">演奏文件改动后，有 {files.unmatched} 条标注无法对应到音符，已原样保留在清单中。</p>
            )}
            <section>
              <h3>版本</h3>
              <ul className="song-files-list">
                {files.performances.map((version) => (
                  <li key={version.id} aria-current={version.current}>
                    <span className="song-files-name">
                      <strong>{version.label || (version.path ? fileName(version.path) : version.id)}</strong>
                      {version.default && <small>默认</small>}
                      {version.missing && <small className="song-files-missing">文件缺失</small>}
                    </span>
                    <span className="song-files-actions">
                      {version.current
                        ? <small>当前</small>
                        : <button disabled={locked || version.missing} onClick={() => void switchTo(version)}>切换</button>}
                      {files.manifest && <button disabled={locked} onClick={() => rename(version)}>命名</button>}
                      {!version.current && !version.default && (
                        <button disabled={locked} onClick={() => void edit({ action: "remove", id: version.id })}>移除</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button disabled={locked} onClick={() => void add("performance", "performance")}>添加 MIDI 版本…</button>
            </section>
            <section>
              <h3>伴奏与其他文件</h3>
              {companions.length === 0 ? (
                <p className="song-files-empty">没有登记伴奏、人声或原音频。</p>
              ) : (
                <ul className="song-files-list">
                  {companions.map((file) => (
                    <li key={file.id}>
                      <span className="song-files-name">
                        <small>{roleName(file)}</small>
                        <span title={file.path}>{file.label || fileName(file.relative)}</span>
                        {file.missing && <small className="song-files-missing">文件缺失</small>}
                      </span>
                      <span className="song-files-actions">
                        {file.role !== "score" && (
                          <button disabled={locked} onClick={() => void edit({ action: "remove", id: file.id })}>移除</button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="song-files-add">
                <select value={stem} disabled={locked} aria-label="音轨类型" onChange={(e) => setStem(e.target.value)}>
                  {STEMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                {!api.desktop && (
                  <input value={manualPath} placeholder="文件完整路径" aria-label="文件完整路径" onChange={(e) => setManualPath(e.target.value)} />
                )}
                <button disabled={locked} onClick={() => void add("audio", "stem")}>登记音轨…</button>
                <button disabled={locked} onClick={() => void add("audio", "source")}>登记原音频…</button>
              </div>
              <p className="song-files-note">登记的音频随歌曲清单保存，播放与对齐在后续版本提供。</p>
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
