import { FolderOpen, Keyboard, Music, RefreshCw, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { product } from "../../product.generated";
import { formatDuration, keyLabel, type SongFacts } from "../song/songSummary";
import "../../ui/controls.css";
import "./homeScreen.css";

export type RecentFile = { path: string; title: string; openedAt: number; exists: boolean };
type Marks = { performance: boolean; score: boolean; audio: boolean; vocals: boolean; accompaniment: boolean };
type Brief = { facts?: SongFacts; has?: Marks; error?: string };
type FolderStatus = { root: string | null; songs: number; files: number; shortcuts: number; scannedAt: number | null; error: string | null };
type Found = { path: string; title: string; artist: string | null; kind: "manifest" | "midi" | "musicxml" | "abc"; folder: string };
const KIND_NAMES: Record<Found["kind"], string> = { manifest: "已整理", midi: "MIDI", musicxml: "五线谱", abc: "ABC" };

const MARKS: [keyof Marks, string][] = [
  ["performance", "MIDI"],
  ["score", "谱"],
  ["audio", "原曲"],
  ["vocals", "人声"],
  ["accompaniment", "伴奏"],
];

function folderOf(path: string) {
  const parts = path.split(/[\\/]/);
  return parts.slice(-3, -1).join(" / ");
}
function ago(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ms).toLocaleDateString("zh-CN");
}

/** Start page (interface-design.md 3.1): open a file, reopen a recent song, play freely. */
export function HomeScreen({
  recent,
  disabled,
  chooseFile,
  open,
  forget,
  freePlay,
  settings,
}: {
  recent: readonly RecentFile[];
  disabled: boolean;
  chooseFile: () => Promise<unknown>;
  open: (path: string) => Promise<boolean>;
  forget: (path: string) => void;
  freePlay: () => void;
  settings: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [briefs, setBriefs] = useState<Record<string, Brief>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const searchSeq = useRef(0);
  // The music folder is scanned when the program starts; ask again until the scan has finished.
  useEffect(() => {
    if (disabled) return;
    let timer = 0;
    let tries = 0;
    const read = () =>
      api
        .command<FolderStatus>({ type: "songFolder" })
        .then((status) => {
          setFolder(status);
          if (status.root && !status.scannedAt && ++tries < 20) timer = window.setTimeout(read, 1000);
        })
        .catch(() => {});
    void read();
    return () => window.clearTimeout(timer);
  }, [disabled]);
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setFound(null);
      return;
    }
    const mine = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      api
        .command<{ results: Found[] }>({ type: "songSearch", query: text })
        .then((value) => mine === searchSeq.current && setFound(value.results))
        .catch(() => mine === searchSeq.current && setFound([]));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query, folder?.scannedAt]);
  const chooseFolder = async () => {
    const path = api.desktop ? await api.pickFolder("选择曲目文件夹") : window.prompt("曲目文件夹的完整路径", folder?.root ?? "")?.trim();
    if (path) setFolder(await api.command<FolderStatus>({ type: "setSongFolder", path }));
  };
  const rescan = async () => setFolder(await api.command<FolderStatus>({ type: "rescanSongFolder" }));
  const busy = disabled || pending;
  const paths = recent.filter((file) => file.exists).map((file) => file.path).join("\n");
  useEffect(() => {
    if (!paths || disabled) return;
    let current = true;
    api
      .command<Record<string, Brief>>({ type: "songSummaries", paths: paths.split("\n") })
      .then((value) => current && setBriefs(value))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [paths, disabled]);
  const guard = async (work: () => Promise<unknown>) => {
    setPending(true);
    try {
      await work();
    } finally {
      setPending(false);
    }
  };
  return (
    <main className="home-screen ui-screen" aria-label="主页">
      <aside className="home-side">
        <header className="home-brand">
          <img src="/brand.svg" alt="" />
          <h1>{product.name}</h1>
        </header>
        <nav className="home-actions" aria-label="主菜单">
          <button className="ui-button ui-button--primary ui-button--large" disabled={busy} onClick={() => void guard(chooseFile)}>
            <FolderOpen />
            打开乐曲…
          </button>
          <button className="ui-button ui-button--large" disabled={busy} onClick={freePlay}>
            <Keyboard />
            自由演奏
          </button>
          <button className="ui-link-row" disabled={busy} onClick={settings}>
            <Settings />
            <span>设置</span>
          </button>
        </nav>
        <p className="home-hint">支持 MIDI、MusicXML、ABC 与 .panthesia。也可以在资源管理器或 Keel 中双击乐曲打开。</p>
      </aside>
      <section className="home-recent" aria-labelledby="home-recent-title">
        <div className="home-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={folder?.root ? `在 ${folder.files} 首曲目中搜索：歌名、艺术家或文件夹` : "设置曲目文件夹后可以搜索全部曲目"}
            aria-label="搜索曲目"
            disabled={!folder?.root}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && found?.[0]) void guard(() => open(found[0].path));
              if (event.key === "Escape") setQuery("");
            }}
          />
        </div>
        <p className="home-folder">
          {folder?.root ? (
            <>
              <span title={folder.root}>曲目文件夹 {folder.root}</span>
              <span>{folder.scannedAt ? `${folder.songs} 首已整理 · ${folder.files} 个文件` : "正在扫描…"}</span>
              {folder.error && <span className="home-folder-error">{folder.error}</span>}
              <button className="ui-icon-button" title="重新扫描" aria-label="重新扫描" disabled={busy} onClick={() => void rescan()}>
                <RefreshCw />
              </button>
              <button className="ui-button ui-button--ghost" disabled={busy} onClick={() => void chooseFolder()}>更改…</button>
            </>
          ) : (
            <button className="ui-button" disabled={busy} onClick={() => void chooseFolder()}>
              <FolderOpen />
              设置曲目文件夹…
            </button>
          )}
        </p>
        {found !== null ? (
          <>
            <h2 className="ui-section-title">搜索结果 · {found.length >= 200 ? "前 200 个" : `${found.length} 个`}</h2>
            {found.length === 0 && <div className="home-empty"><p>没有找到“{query.trim()}”。</p></div>}
            <ul className="home-list">
              {found.map((item) => (
                <li key={item.path}>
                  <button className="home-song home-found" disabled={busy} title={item.path} onClick={() => void guard(() => open(item.path))}>
                    <span className="home-song-main">
                      <strong>{item.artist ? `${item.title} · ${item.artist}` : item.title}</strong>
                      <small>{item.folder || "曲目文件夹"}</small>
                    </span>
                    <span className="home-song-marks">
                      <span data-on={item.kind === "manifest" || undefined}>{KIND_NAMES[item.kind]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
        <h2 id="home-recent-title" className="ui-section-title">最近打开</h2>
        {recent.length === 0 && (
          <div className="home-empty">
            <Music />
            <p>还没有打开过乐曲。打开一个 MIDI 或乐谱文件，就可以开始练习。</p>
          </div>
        )}
        <ul className="home-list">
          {recent.map((file) => {
            const brief = briefs[file.path];
            const facts = brief?.facts;
            return (
              <li key={file.path}>
                <button
                  className="home-song"
                  data-missing={!file.exists || undefined}
                  disabled={busy || !file.exists}
                  title={file.path}
                  onClick={() => void guard(() => open(file.path))}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (window.confirm(`从最近打开中移除“${file.title}”？文件本身不受影响。`)) forget(file.path);
                  }}
                >
                  <span className="home-song-main">
                    <strong>{facts?.title ?? file.title}</strong>
                    <small>{file.exists ? folderOf(file.path) : "文件不存在"}</small>
                  </span>
                  <span className="home-song-marks" aria-label="资料">
                    {MARKS.map(([key, label]) => (
                      <span key={key} data-on={brief?.has?.[key] || undefined}>
                        {label}
                      </span>
                    ))}
                  </span>
                  <span className="home-song-facts">
                    {facts ? [formatDuration(facts.durationSeconds), keyLabel(facts.key)].filter(Boolean).join(" · ") : ""}
                  </span>
                  <span className="home-song-time">{ago(file.openedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
          </>
        )}
      </section>
    </main>
  );
}
