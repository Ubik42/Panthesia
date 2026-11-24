import { FolderOpen, Keyboard, LayoutGrid, Music, Rows3, Search, Settings, SearchX, Grid3x3 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { product } from "../../product.generated";
import { Badge, Button, Empty, IconButton, Segmented } from "../../ui/components";
import { setDisplay, useDisplay } from "../../features/settings/interfaceSettingsStore";
import { useSongCover } from "../../features/library/songCover";
import { formatDuration, keyLabel, type SongFacts } from "../../features/library/songSummary";
import "../../ui/controls.css";
import "./homeScreen.css";

export type RecentFile = { path: string; title: string; openedAt: number; exists: boolean };
type Marks = { performance: boolean; score: boolean; audio: boolean; vocals: boolean; accompaniment: boolean };
type Brief = { facts?: SongFacts; has?: Marks; cover?: string | null; error?: string };
type FolderStatus = { root: string | null; songs: number; files: number; scannedAt: number | null; error: string | null };
type Found = { path: string; title: string; artist: string | null; kind: "manifest" | "midi" | "musicxml" | "abc"; folder: string; materials: string[] };

const MARKS: [keyof Marks, string][] = [
  ["performance", "MIDI"],
  ["score", "谱"],
  ["audio", "原曲"],
  ["vocals", "人声"],
  ["accompaniment", "伴奏"],
];
const FOUND_MARKS: [string, string][] = [
  ["midi", "MIDI"],
  ["score", "谱"],
  ["audio", "原曲"],
  ["vocals", "人声"],
  ["accompaniment", "伴奏"],
];

function folderOf(path: string) {
  return path.split(/[\\/]/).slice(-3, -1).join(" / ");
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

/** The start page (frontend-architecture.md §3): a top bar and the recently opened songs as
 * a grid of cards (size chosen in the bar, columns follow the window), or search results from
 * the music folder. Choosing a card opens the song;
 * its details slide in over this page (`details`). */
export function HomeScreen({
  recent,
  current,
  disabled,
  chooseFile,
  open,
  forget,
  freePlay,
  settings,
  details,
}: {
  recent: readonly RecentFile[];
  /** Path of the song whose details are open. */
  current?: string | null;
  disabled: boolean;
  chooseFile: () => Promise<unknown>;
  open: (path: string) => Promise<boolean>;
  forget: (path: string) => void;
  freePlay: () => void;
  settings: () => void;
  details?: ReactNode;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, Brief>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [folder, setFolder] = useState<FolderStatus | null>(null);
  const searchSeq = useRef(0);
  const grid = useDisplay().homeGrid;
  /** A missing file's card asks what to do: find it elsewhere or forget it. */
  const [asking, setAsking] = useState<string | null>(null);
  const relocate = async (file: RecentFile) => {
    const path = api.desktop ? await api.pickSongFile("music", file.path) : window.prompt("曲目的新位置（完整路径）", file.path)?.trim();
    if (!path) return;
    setAsking(null);
    if (await open(path)) forget(file.path);
  };
  const busy = disabled || pending !== null;
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
  const choose = async (path: string) => {
    if (busy) return;
    setPending(path);
    try {
      await open(path);
    } finally {
      setPending(null);
    }
  };
  const searching = found !== null;
  return (
    <main className="home-screen ui-screen" aria-label="主页">
      <header className="home-bar">
        <div className="home-brand">
          <img src="/brand.svg" alt="" />
          <span>{product.name}</span>
        </div>
        <label className="home-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            spellCheck={false}
            value={query}
            placeholder={folder?.root ? (folder.scannedAt ? `在 ${folder.files} 首曲目中搜索歌名、艺术家或文件夹` : "正在扫描曲目文件夹…") : "在设置中指定曲目文件夹后可以搜索"}
            aria-label="搜索曲目"
            disabled={!folder?.root}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && found?.[0]) void choose(found[0].path);
              if (event.key === "Escape") setQuery("");
            }}
          />
        </label>
        <div className="home-actions">
          <Segmented
            label="卡片大小"
            className="home-density"
            value={grid}
            onChange={(homeGrid) => setDisplay((previous) => ({ ...previous, homeGrid }))}
            options={[
              { value: "compact", label: <Grid3x3 aria-hidden="true" />, title: "紧凑" },
              { value: "normal", label: <LayoutGrid aria-hidden="true" />, title: "标准" },
              { value: "roomy", label: <Rows3 aria-hidden="true" />, title: "宽松" },
            ]}
          />
          <Button variant="primary" icon={FolderOpen} disabled={busy} onClick={() => void chooseFile()}>
            打开文件…
          </Button>
          <IconButton label="自由演奏" icon={Keyboard} disabled={busy} onClick={freePlay} />
          <IconButton label="设置" icon={Settings} onClick={settings} />
        </div>
      </header>
      <section className="home-content" aria-label={searching ? "搜索结果" : "最近打开"}>
        <h2 className="ui-section-title">{searching ? `搜索结果 · ${found.length >= 200 ? "前 200 个" : `${found.length} 个`}` : "最近打开"}</h2>
        {searching && found.length === 0 && <Empty icon={SearchX}>没有找到“{query.trim()}”。</Empty>}
        {!searching && recent.length === 0 && <Empty icon={Music}>打开一个 MIDI、MusicXML 或 ABC 文件，或从 Keel、资源管理器双击曲目。</Empty>}
        <ul className="home-grid" data-size={grid}>
          {searching
            ? found.map((item) => (
                <li key={item.path}>
                  <SongCard
                    title={item.artist ? `${item.title} · ${item.artist}` : item.title}
                    place={item.folder || "曲目文件夹"}
                    path={item.path}
                    active={item.path === current}
                    pending={pending === item.path}
                    disabled={busy}
                    marks={FOUND_MARKS.map(([key, label]) => [label, item.materials.includes(key)])}
                    open={choose}
                  />
                </li>
              ))
            : recent.map((file) => {
                const brief = briefs[file.path];
                const facts = brief?.facts;
                return (
                  <li key={file.path}>
                    <SongCard
                      title={facts?.title ?? file.title}
                      place={file.exists ? folderOf(file.path) : "文件不存在"}
                      path={file.path}
                      missing={!file.exists}
                      active={file.path === current}
                      pending={pending === file.path}
                      disabled={busy}
                      asking={asking === file.path}
                      ask={() => setAsking(asking === file.path ? null : file.path)}
                      relocate={() => void relocate(file)}
                      marks={MARKS.map(([key, label]) => [label, !!brief?.has?.[key]])}
                      facts={facts ? [formatDuration(facts.durationSeconds), keyLabel(facts.key)].filter(Boolean).join(" · ") : ""}
                      time={ago(file.openedAt)}
                      cover={brief?.cover}
                      open={choose}
                      forget={() => {
                        if (!file.exists || window.confirm(`从最近打开中移除“${file.title}”？文件本身不受影响。`)) forget(file.path);
                      }}
                    />
                  </li>
                );
              })}
        </ul>
      </section>
      {details}
    </main>
  );
}

function SongCard({
  title,
  place,
  path,
  marks,
  facts,
  time,
  missing,
  active,
  pending,
  disabled,
  open,
  forget,
  asking,
  ask,
  relocate,
  cover,
}: {
  title: string;
  place: string;
  path: string;
  marks: [string, boolean][];
  facts?: string;
  time?: string;
  missing?: boolean;
  active: boolean;
  pending: boolean;
  disabled: boolean;
  open: (path: string) => void;
  forget?: () => void;
  asking?: boolean;
  ask?: () => void;
  relocate?: () => void;
  /** Path of the song's picture. */
  cover?: string | null;
}) {
  const picture = useSongCover(cover);
  if (missing && asking)
    return (
      <div className="home-card ui-card" data-missing="true" data-asking="true" title={path}>
        <span className="home-card-main">
          <strong>{title}</strong>
          <small>找不到这个文件：{path}</small>
        </span>
        <span className="home-card-ask">
          <Button variant="primary" onClick={relocate}>
            重新定位…
          </Button>
          <Button onClick={forget}>从列表中移除</Button>
          <Button variant="ghost" onClick={ask}>
            取消
          </Button>
        </span>
      </div>
    );
  return (
    <button
      className="home-card ui-card"
      data-missing={missing || undefined}
      aria-current={active || undefined}
      aria-busy={pending || undefined}
      disabled={disabled}
      title={path}
      onClick={() => (missing ? ask?.() : open(path))}
      onContextMenu={
        forget
          ? (event) => {
              event.preventDefault();
              forget();
            }
          : undefined
      }
    >
      <span className="home-card-cover" data-empty={!picture || undefined} aria-hidden="true">
        {picture ? <img src={picture} alt="" /> : <Music />}
      </span>
      <span className="home-card-main">
        <strong>{title}</strong>
        <small>{place}</small>
      </span>
      <span className="home-card-meta">
        <span className="home-card-marks" aria-label="资料">
          {marks
            .filter(([, on]) => on)
            .map(([label]) => (
              <Badge key={label} tone="accent">
                {label}
              </Badge>
            ))}
        </span>
        <span className="home-card-facts">{[facts, time].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
}
