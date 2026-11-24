import {
  AudioLines,

  ChevronRight,

  FileMusic,
  FileText,
  FolderOpen,
  Hand,
  Layers,
  Link2,
  LoaderCircle,
  Mic,
  Music,
  Piano as PianoIcon,
  Play,
  Plus,
  Repeat,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { reportDiagnostic } from "../../app/diagnostics";
import type { LoadedSong } from "../../api";
import type { PlaybackStore } from "../../features/practice/playbackStore";
import { useTasks } from "../../engine/taskStore";
import {
  ORIGIN_NAMES,
  SOURCE_NAMES,
  formatDuration,
  keyLabel,
  noteName,
  useSongSummary,
  type Generator,
  type Layer,
  type Material,
  type MaterialItem,
} from "./songSummary";
import "../../ui/controls.css";
import { Sheet } from "../../ui/components";
import "./songScreen.css";

type Mode = "listen" | "wait";
type HandChoice = "left" | "right" | "both";

const ICONS: Record<string, ReactNode> = {
  performance: <FileMusic />,
  musicxml: <Music />,
  abc: <FileText />,
  paper: <FileText />,
  source: <AudioLines />,
  vocals: <Mic />,
  accompaniment: <Layers />,
  stems: <AudioLines />,
};
/** Which file kind the picker offers, and how the file is registered, per material. */
const ATTACH: Record<string, { pick: "performance" | "audio" | "paper" | "score"; role: string; stem?: string }> = {
  performance: { pick: "performance", role: "performance" },
  musicxml: { pick: "score", role: "score" },
  abc: { pick: "score", role: "score" },
  paper: { pick: "paper", role: "paper" },
  source: { pick: "audio", role: "source" },
  vocals: { pick: "audio", role: "stem", stem: "vocals" },
  accompaniment: { pick: "audio", role: "stem", stem: "accompaniment" },
};
/** Background task labels of the external generators (`song_generate.rs`). */
const TOOL_TASKS: Record<string, string> = { transcribe: "从原曲转录 MIDI", separate: "从原曲分离人声与伴奏" };

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** Song details (interface-design.md 3.2, frontend-architecture.md §3): a sheet over the library
 * with the way to start, the song's facts, materials and layers. */
export function SongDetails({
  song,
  store,
  disabled,
  engineId,
  back,
  parts,
  options,
  scores,
  sound,
  tools,
  editLayer,
  openVersion,
  start,
}: {
  song: LoadedSong;
  store: PlaybackStore;
  disabled: boolean;
  engineId?: string;
  back: () => void;
  parts: () => void;
  options: () => void;
  scores: () => void;
  sound: () => void;
  /** Open the settings page where the transcription tool is chosen. */
  tools: () => void;
  editLayer: (name: string) => void;
  openVersion: (path: string) => Promise<boolean>;
  start: (mode: Mode, hands: HandChoice) => Promise<boolean>;
}) {
  const { summary, error: loadError, reload } = useSongSummary(`${song.contentId}:${song.annotationRevision ?? 0}`);
  const [mode, setMode] = useState<Mode>(() => (store.getSnapshot().mode === "listen" ? "listen" : "wait"));
  const [hand, setHand] = useState<HandChoice>(() => {
    const value = store.getSnapshot().hands;
    return value === "left" || value === "right" ? value : "both";
  });
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const locked = disabled || pending !== null;

  // External generators run as background tasks; the summary reloads when one ends.
  const tasks = useTasks(engineId);
  const running = useMemo(() => {
    const active = new Set<string>();
    for (const [id, label] of Object.entries(TOOL_TASKS)) {
      if (tasks.some((t) => t.label === label && ["queued", "running", "committing"].includes(t.state))) active.add(id);
    }
    return active;
  }, [tasks]);
  const finished = tasks.filter((t) => Object.values(TOOL_TASKS).includes(t.label) && ["succeeded", "failed"].includes(t.state)).map((t) => t.id).join();
  useEffect(() => {
    if (finished) void reload();
  }, [finished, reload]);
  const failure = tasks.find((t) => Object.values(TOOL_TASKS).includes(t.label) && t.state === "failed" && t.error);

  const act = async (key: string, work: () => Promise<unknown>) => {
    if (locked) return;
    setPending(key);
    setMessage("");
    try {
      await work();
      await reload();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(null);
    }
  };
  const generate = (generator: Generator) =>
    act(`generate:${generator.id}`, async () => {
      await api.command({ type: "generateMaterial", kind: generator.id, path: summary?.performancePath ?? null });
    });
  const attach = (material: Material) =>
    act(`attach:${material.kind}`, async () => {
      const how = ATTACH[material.kind];
      const path = api.desktop ? await api.pickSongFile(how.pick, summary?.performancePath) : window.prompt(`${material.label}文件的完整路径`)?.trim();
      if (!path) return;
      await api.command({ type: "editSongFile", action: "add", path, role: how.role, stem: how.stem ?? null, label: null });
    });
  const register = (item: MaterialItem) =>
    act(`register:${item.path}`, async () => {
      await api.command({ type: "editSongFile", action: "add", path: item.path, role: item.role ?? "source", stem: item.stem ?? null, label: item.label });
    });
  const unregister = (item: MaterialItem) => {
    if (!item.id || !window.confirm(`从歌曲清单中移除“${item.relative}”？文件本身不受影响。`)) return;
    void act(`remove:${item.id}`, async () => {
      await api.command({ type: "editSongFile", action: "remove", id: item.id, path: null, role: null, stem: null, label: null });
    });
  };
  const pair = (item: MaterialItem) =>
    act(`pair:${item.path}`, async () => {
      if (item.path) await api.command({ type: "pairScoreFile", path: item.path, content_id: song.contentId });
    });
  const switchTo = (item: MaterialItem) =>
    act(`open:${item.path}`, async () => {
      if (item.path) await openVersion(item.path);
    });
  const launch = async () => {
    if (locked) return;
    setPending("start");
    setMessage("");
    try {
      if (!(await start(mode, hand))) setMessage("暂时未能开始，请稍后重试。");
    } catch (failure) {
      reportDiagnostic("开始演奏", failure);
      setMessage("暂时未能开始，详情已记入日志。");
    } finally {
      setPending(null);
    }
  };

  const facts = summary?.facts;
  const title = facts?.title ?? song.title;
  const startLabel = mode === "listen" ? "开始播放" : `开始${hand === "left" ? "左手" : hand === "right" ? "右手" : "双手"}练习`;

  return (
    <Sheet
      width={620}
      close={back}
      title={
        <div className="song-title">
          <h1 title={title}>{title}</h1>
          {facts?.artist && <p>{facts.artist}</p>}
        </div>
      }
    >
      <div className="song-body">
        <section className="song-practice ui-card" aria-label="练习">
          <h2 className="ui-section-title">练习</h2>
          <div className="song-practice-group">
            <span>方式</span>
            <div className="ui-segmented" role="group" aria-label="练习方式">
              <button aria-pressed={mode === "listen"} disabled={locked} onClick={() => setMode("listen")}>连续播放</button>
              <button aria-pressed={mode === "wait"} disabled={locked} onClick={() => setMode("wait")}>等待按键</button>
            </div>
            <p>{mode === "listen" ? "音乐连续播放，跟着弹或只是听。" : "弹下所需的琴键后，音乐才继续。"}</p>
          </div>
          <div className="song-practice-group">
            <span>手</span>
            <div className="ui-segmented" role="group" aria-label="练习的手">
              {(
                [
                  ["left", "左手"],
                  ["right", "右手"],
                  ["both", "双手"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} aria-pressed={hand === value} data-hand={value} disabled={locked} onClick={() => setHand(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="ui-button ui-button--primary ui-button--large song-start" disabled={locked} onClick={() => void launch()}>
            {pending === "start" ? <LoaderCircle className="spin" /> : <Play />}
            {pending === "start" ? "正在准备…" : startLabel}
          </button>
          <nav className="song-practice-links" aria-label="练习设置">
            <button className="ui-link-row" disabled={locked} onClick={parts}>
              <Hand />
              <span>声部、手别与乐器</span>
              <ChevronRight />
            </button>
            <button className="ui-link-row" disabled={locked} onClick={options}>
              <SlidersHorizontal />
              <span>转调与量化</span>
              <ChevronRight />
            </button>
            <button className="ui-link-row" disabled={locked} onClick={scores}>
              <Music />
              <span>谱面</span>
              <ChevronRight />
            </button>
            <button className="ui-link-row" disabled={locked} onClick={sound}>
              <PianoIcon />
              <span>键盘与音源</span>
              <ChevronRight />
            </button>
          </nav>
        </section>
        <div className="song-main">
          <section className="song-hero ui-card" aria-label="歌曲概览">
            <PianoRoll song={song} />
            <dl className="song-facts">
              <Fact name="时长" value={formatDuration(facts?.durationSeconds ?? song.duration)} />
              <Fact name="速度" value={facts?.bpm ? `${Math.round(facts.bpm)} BPM` : "—"} note={facts && facts.bpmSource !== "midi" ? SOURCE_NAMES[facts.bpmSource] : undefined} />
              <Fact name="拍号" value={facts?.timeSignature ?? "—"} />
              <Fact name="调" value={keyLabel(facts?.key) ?? "—"} note={facts && facts.keySource !== "midi" ? SOURCE_NAMES[facts.keySource] : undefined} />
              <Fact name="音域" value={facts?.pitchRange ? `${noteName(facts.pitchRange[0])}–${noteName(facts.pitchRange[1])}` : "—"} />
              <Fact name="小节" value={facts ? String(facts.measures) : "—"} />
              <Fact name="轨道 · 音符" value={facts ? `${facts.tracks} · ${facts.notes}` : "—"} />
            </dl>
          </section>

          <section aria-labelledby="song-materials-title">
            <div className="song-section-head">
              <h2 id="song-materials-title" className="ui-section-title">资料</h2>
              {summary && !summary.tool.available && (
                <button className="ui-button ui-button--ghost" disabled={locked} onClick={tools}>
                  <Settings2 />
                  指定转录工具…
                </button>
              )}
            </div>
            {(loadError || message || failure) && (
              <p className="song-message" role="alert">
                {message || loadError || `${failure?.label}失败：${failure?.error}`}
              </p>
            )}
            <div className="song-materials">
              {(summary?.materials ?? []).map((material) => (
                <MaterialCard
                  key={material.kind}
                  material={material}
                  running={material.generators.some((g) => running.has(g.id))}
                  locked={locked}
                  pending={pending}
                  readOnly={!!summary?.manifest?.readOnly}
                  generate={generate}
                  attach={() => void attach(material)}
                  register={(item) => void register(item)}
                  unregister={unregister}
                  pair={material.kind === "musicxml" && summary?.kind === "midi" ? (item) => void pair(item) : undefined}
                  switchTo={(item) => void switchTo(item)}
                />
              ))}
              {!summary && !loadError && <p className="song-loading">正在读取资料…</p>}
            </div>
          </section>

          <section aria-labelledby="song-layers-title">
            <h2 id="song-layers-title" className="ui-section-title">图层</h2>
            <div className="song-layers">
              {(summary?.layers ?? []).map((layer) => (
                <LayerChip key={layer.name} layer={layer} edit={EDITABLE.has(layer.name) ? () => editLayer(layer.name) : undefined} disabled={locked} />
              ))}
            </div>
          </section>
        </div>

      </div>
    </Sheet>
  );
}

const EDITABLE = new Set(["hands", "fingering"]);
const EMPTY: Record<string, string> = {
  musicxml: "没有五线谱文件",
  abc: "没有 ABC 文件",
  paper: "没有 PDF 或图片谱",
  source: "没有原曲录音",
  vocals: "没有人声分轨",
  accompaniment: "没有伴奏分轨",
};

function Fact({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        {value}
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

function stateOf(material: Material): { tone: string; text: string } {
  const items = material.items;
  if (items.some((i) => i.state !== "found" && i.state !== "missing")) return { tone: items.some((i) => i.origin === "generated") ? "generated" : "ok", text: "有" };
  if (items.some((i) => i.state === "missing")) return { tone: "missing", text: "文件缺失" };
  if (items.length) return { tone: "warn", text: "发现未登记的文件" };
  return { tone: "none", text: "没有" };
}

function MaterialCard({
  material,
  running,
  locked,
  pending,
  readOnly,
  generate,
  attach,
  register,
  unregister,
  pair,
  switchTo,
}: {
  material: Material;
  running: boolean;
  locked: boolean;
  pending: string | null;
  readOnly: boolean;
  generate: (generator: Generator) => void;
  attach: () => void;
  register: (item: MaterialItem) => void;
  unregister: (item: MaterialItem) => void;
  pair?: (item: MaterialItem) => void;
  switchTo: (item: MaterialItem) => void;
}) {
  const status = stateOf(material);
  const busy = running || material.generators.some((g) => pending === `generate:${g.id}`);
  return (
    <article className="material-card" data-kind={material.kind} data-tone={status.tone}>
      <header>
        <span className="material-icon">{ICONS[material.kind]}</span>
        <h3>{material.label}</h3>
        <span className="material-status">
          <span className="ui-dot" data-tone={status.tone} />
          {status.text}
        </span>
      </header>
      {material.items.length === 0 && <p className="material-empty">{EMPTY[material.kind] ?? "没有文件"}</p>}
      {material.items.length > 0 && (
        <ul className="material-items">
          {material.items.map((item) => (
            <li key={`${item.id ?? ""}:${item.path ?? item.relative}`} data-state={item.state}>
              <div className="material-file">
                <span title={item.path ?? item.relative}>{fileName(item.relative)}</span>
                <small>
                  {item.label && <em>{item.label}</em>}
                  {item.state === "current" && <em>当前</em>}
                  {item.origin && item.origin !== "human" && <em data-origin={item.origin}>{ORIGIN_NAMES[item.origin]}</em>}
                  {item.paired && <em>用作谱面</em>}
                  {item.state === "missing" && <em data-state="missing">找不到文件</em>}
                  {item.state === "found" && <em>{item.reason ?? "同名文件"}</em>}
                </small>
              </div>
              <div className="material-item-actions">
                {item.state === "found" && (
                  <button className="ui-button" disabled={locked || readOnly} onClick={() => register(item)}>
                    <Plus />
                    登记
                  </button>
                )}
                {material.kind === "performance" && item.state === "present" && (
                  <button className="ui-icon-button" title="切换到这个版本" aria-label="切换到这个版本" disabled={locked} onClick={() => switchTo(item)}>
                    <Repeat />
                  </button>
                )}
                {pair && item.state === "present" && !item.paired && (
                  <button className="ui-icon-button" title="用作谱面" aria-label="用作谱面" disabled={locked} onClick={() => pair(item)}>
                    <Link2 />
                  </button>
                )}
                {api.desktop && item.path && item.state !== "missing" && (
                  <button className="ui-icon-button" title="在资源管理器中显示" aria-label="在资源管理器中显示" onClick={() => void api.revealFile(item.path!)}>
                    <FolderOpen />
                  </button>
                )}
                {item.id && item.state !== "current" && item.state !== "found" && (
                  <button className="ui-icon-button" title="从清单移除" aria-label="从清单移除" disabled={locked || readOnly} onClick={() => unregister(item)}>
                    <Trash2 />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {busy && (
        <p className="material-progress" role="status">
          <LoaderCircle className="spin" />
          {running ? "正在后台生成，可以先去练习…" : "正在生成…"}
        </p>
      )}
      <footer>
        {material.generators.map((generator) => (
          <button
            key={generator.id}
            className="ui-button"
            disabled={locked || busy || !generator.available || readOnly}
            title={generator.reason ?? undefined}
            onClick={() => generate(generator)}
          >
            <Sparkles />
            {generator.label}
          </button>
        ))}
        {ATTACH[material.kind] && (
          <button className="ui-button ui-button--ghost" disabled={locked || readOnly} onClick={attach}>
            <Plus />
            关联文件…
          </button>
        )}
        {material.generators.some((g) => !g.available && g.reason) && (
          <small className="material-hint">{material.generators.find((g) => !g.available)?.reason}</small>
        )}
      </footer>
    </article>
  );
}

function LayerChip({ layer, edit, disabled }: { layer: Layer; edit?: () => void; disabled: boolean }) {
  const tone = layer.origin === "generated" ? "generated" : layer.origin ? "ok" : "none";
  const body = (
    <>
      <span className="ui-dot" data-tone={tone} />
      {layer.label}
      <small>{layer.origin ? ORIGIN_NAMES[layer.origin] : "—"}</small>
      {layer.review === "pending" && <small className="song-layer-review">待检查</small>}
    </>
  );
  return edit ? (
    <button className="ui-chip" data-origin={layer.origin ?? "none"} disabled={disabled} onClick={edit} title={layer.review === "pending" ? `编辑${layer.label}（算法生成，尚未经 AI 检查润色）` : `编辑${layer.label}`}>
      {body}
    </button>
  ) : (
    <span className="ui-chip" data-origin={layer.origin ?? "none"} title={layer.review === "pending" ? "算法生成，尚未经 AI 检查润色" : undefined}>
      {body}
    </span>
  );
}

/** Piano-roll overview of the song: time left to right, pitch bottom to top, hands in their colors. */
function PianoRoll({ song }: { song: LoadedSong }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const g = element.getContext("2d");
      if (!g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, width, height);
      const style = getComputedStyle(element);
      const color = (name: string) => style.getPropertyValue(name).trim();
      const notes = song.notes;
      if (!notes.length) return;
      let low = 127;
      let high = 0;
      let end = 0.1;
      for (const n of notes) {
        low = Math.min(low, n.pitch);
        high = Math.max(high, n.pitch);
        end = Math.max(end, n.start + n.duration);
      }
      low -= 2;
      high += 2;
      const rows = high - low + 1;
      const row = height / rows;
      g.fillStyle = color("--line-subtle");
      for (let p = Math.ceil(low / 12) * 12; p <= high; p += 12) g.fillRect(0, Math.round((high - p) * row), width, 1);
      const tones: Record<string, string> = { left: color("--hand-left"), right: color("--hand-right"), other: color("--accent") };
      for (const n of notes) {
        g.fillStyle = tones[n.part] ?? tones.other;
        const x = (n.start / end) * width;
        const w = Math.max(1.5, (n.duration / end) * width);
        g.fillRect(x, (high - n.pitch) * row, w, Math.max(1.5, row - 0.5));
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [song.notes]);
  return <canvas ref={canvas} className="song-roll" aria-hidden />;
}

