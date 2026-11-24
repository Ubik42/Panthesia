import {
  AudioLines,
  FileMusic,
  FileText,
  FolderOpen,
  Layers,
  Library,
  Link2,
  LoaderCircle,
  Image,
  Mic,
  Music,
  PencilLine,
  Play,
  Plus,
  Repeat,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../api";
import { reportDiagnostic } from "../../lib/diagnostics";
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
} from "../../features/library/songSummary";
import type { Variant } from "../../engine/commands.generated";
import "../../ui/controls.css";
import { Dialog } from "../../ui/Dialog";
import { useSongCover } from "../../features/library/songCover";
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
  cover: <Image />,
};
/** Which file kind the picker offers, and how the file is registered, per material. */
const ATTACH: Record<string, { pick: "performance" | "audio" | "paper" | "score" | "image"; role: string; stem?: string }> = {
  performance: { pick: "performance", role: "performance" },
  musicxml: { pick: "score", role: "score" },
  abc: { pick: "score", role: "score" },
  paper: { pick: "paper", role: "paper" },
  source: { pick: "audio", role: "source" },
  vocals: { pick: "audio", role: "stem", stem: "vocals" },
  accompaniment: { pick: "audio", role: "stem", stem: "accompaniment" },
  cover: { pick: "image", role: "cover" },
};
/** Background task labels of the external generators (`song_generate.rs`). */
const TOOL_TASKS: Record<string, string> = { transcribe: "从原曲转录 MIDI", separate: "从原曲分离人声与伴奏" };

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

/** Song details (interface-design.md 3.2, frontend-architecture.md §3): a dialog over the
 * library with what belongs to this song: its picture and facts, its practice version
 * (transposition, quantization), its materials — every kind of the song model as one row, input
 * and generated files side by side — its layers, and an overview of the music. Parts, practice
 * mode and hands are set on the stage; starting uses the last ones. Global settings (keyboard,
 * sound) stay on the settings page. */
export function SongDetails({
  song,
  store,
  disabled,
  engineId,
  back,
  variant,
  scores,
  tools,
  editLayer,
  editInfo,
  openVersion,
  start,
}: {
  song: LoadedSong;
  store: PlaybackStore;
  disabled: boolean;
  engineId?: string;
  back: () => void;
  variant: (value: Variant) => Promise<boolean>;
  /** The score manager (score files, paper pages, sources). */
  scores: () => void;
  /** Open the settings page where the transcription tool is chosen. */
  tools: () => void;
  editLayer: (name: string) => void;
  /** The song information editor (title, artist, source link, notes…). */
  editInfo: () => void;
  openVersion: (path: string) => Promise<boolean>;
  start: (mode: Mode, hands: HandChoice) => Promise<boolean>;
}) {
  const { summary, error: loadError, reload } = useSongSummary(`${song.contentId}:${song.annotationRevision ?? 0}`);
  // Mode and hands are the stage's last ones; they are changed on the stage.
  const mode: Mode = store.getSnapshot().mode === "listen" ? "listen" : "wait";
  const hand: HandChoice = (() => {
    const value = store.getSnapshot().hands;
    return value === "left" || value === "right" ? value : "both";
  })();
  const [pending, setPending] = useState<string | null>(null);
  // Source link and notes, read from the song's manifest (they change with the annotation revision).
  const [info, setInfo] = useState<{ source?: string | null; notes?: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .readPractice<{ source?: string | null; notes?: string | null }>(song, { type: "metadata" })
      .then((value) => live && setInfo(value))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [song.contentId, song.annotationRevision]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const startLabel = mode === "listen" ? "开始播放" : "开始练习";
  const summaryText = `按上次的方式开始：${mode === "listen" ? "连续播放" : `等待按键 · ${hand === "left" ? "左手" : hand === "right" ? "右手" : "双手"}`}`;
  const materials = summary?.materials ?? [];
  const cover = useSongCover(materials.find((m) => m.kind === "cover")?.items.find((i) => i.state !== "missing")?.path);
  const busyGenerating = (g: Generator) => running.has(g.id) || pending === `generate:${g.id}`;
  const readOnly = !!summary?.manifest?.readOnly;
  const fileLine = (material: Material, item: MaterialItem) => (
    <li key={`${item.id ?? ""}:${item.path ?? item.relative}`} className="material-file" data-state={item.state}>
      <span className="material-name" title={item.path ?? item.relative}>
        {fileName(item.relative)}
      </span>
      {item.state === "current" && <em>当前</em>}
      {item.paired && <em>谱面</em>}
      {item.state === "missing" && <em data-state="missing">缺失</em>}
      {item.state === "found" && <em data-state="found">未登记</em>}
      <span className="material-actions">
        {item.state === "found" && (
          <button className="ui-icon-button" title="登记到歌曲清单" aria-label="登记到歌曲清单" disabled={locked || readOnly} onClick={() => void register(item)}>
            <Plus />
          </button>
        )}
        {material.kind === "performance" && item.state === "present" && (
          <button className="ui-icon-button" title="切换到这个版本" aria-label="切换到这个版本" disabled={locked} onClick={() => void switchTo(item)}>
            <Repeat />
          </button>
        )}
        {material.kind === "musicxml" && summary?.kind === "midi" && item.state === "present" && !item.paired && (
          <button className="ui-icon-button" title="用作谱面" aria-label="用作谱面" disabled={locked} onClick={() => void pair(item)}>
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
      </span>
    </li>
  );
  const files = (material: Material, list: MaterialItem[]) =>
    list.length ? <ul>{list.map((item) => fileLine(material, item))}</ul> : <span className="material-empty">—</span>;

  return (
    <Dialog
      title={title}
      subtitle={facts?.artist ?? undefined}
      close={back}
      className="song-details"
    >
      {(loadError || message || failure) && (
        <p className="song-message" role="alert">
          {message || loadError || `${failure?.label}失败：${failure?.error}`}
        </p>
      )}

      <section className="song-head" aria-label="歌曲">
        <div className="song-cover" data-empty={!cover || undefined}>
          {cover ? <img src={cover} alt="" /> : <Music aria-hidden="true" />}
        </div>
        <div className="song-head-main">
          <button className="ui-button ui-button--primary ui-button--large song-start" disabled={locked} title={summaryText} onClick={() => void launch()}>
            {pending === "start" ? <LoaderCircle className="spin" /> : <Play />}
            {pending === "start" ? "正在准备…" : startLabel}
          </button>
        <dl className="song-facts">
          <Fact name="时长" value={formatDuration(facts?.durationSeconds ?? song.duration)} />
          <Fact name="速度" value={facts?.bpm ? `${Math.round(facts.bpm)} BPM` : "—"} note={facts && facts.bpmSource !== "midi" ? SOURCE_NAMES[facts.bpmSource] : undefined} />
          <Fact name="拍号" value={facts?.timeSignature ?? "—"} />
          <Fact name="调" value={keyLabel(facts?.key) ?? "—"} note={facts && facts.keySource !== "midi" ? SOURCE_NAMES[facts.keySource] : undefined} />
          <Fact name="音域" value={facts?.pitchRange ? `${noteName(facts.pitchRange[0])}–${noteName(facts.pitchRange[1])}` : "—"} />
          <Fact name="小节" value={facts ? String(facts.measures) : "—"} />
          <Fact name="轨道 · 音符" value={facts ? `${facts.tracks} · ${facts.notes}` : "—"} />
        </dl>
        <dl className="song-info">
          <div>
            <dt>来源</dt>
            <dd>
              {info?.source ? (
                /^https?:\/\//i.test(info.source) ? (
                  <a href={info.source} title={info.source} onClick={(e) => { e.preventDefault(); void api.openLink(info.source!).catch((error) => setMessage(String(error))); }}>
                    {info.source}
                  </a>
                ) : (
                  info.source
                )
              ) : (
                <span className="song-info-empty">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt>备注</dt>
            <dd>{info?.notes ? <span className="song-info-notes">{info.notes}</span> : <span className="song-info-empty">—</span>}</dd>
          </div>
          <button className="ui-icon-button song-info-edit" title="编辑歌曲信息（标题、作者、来源链接、备注…）" aria-label="编辑歌曲信息" disabled={locked} onClick={editInfo}>
            <PencilLine />
          </button>
        </dl>
        </div>
      </section>

      <section className="song-section" aria-labelledby="song-version-title">
        <h3 id="song-version-title">练习版本</h3>
        <VariantRow song={song} disabled={locked} apply={variant} />
      </section>

      <section className="song-section" aria-labelledby="song-materials-title">
        <div className="song-section-head">
          <h3 id="song-materials-title">资料</h3>
          <span className="song-section-actions">
            <button className="ui-icon-button" title="谱面管理（谱页、原谱来源）" aria-label="谱面管理" disabled={locked} onClick={scores}>
              <Library />
            </button>
            {summary && !summary.tool.available && (
              <button className="ui-icon-button" title="指定转录工具" aria-label="指定转录工具" disabled={locked} onClick={tools}>
                <Settings2 />
              </button>
            )}
          </span>
        </div>
        {!summary && !loadError && <p className="song-loading">正在读取资料…</p>}
        {summary && (
          <div className="material-columns">
            <MaterialColumn
              title="输入"
              rows={materials
                .filter((m) => INPUT_KINDS.has(m.kind) || m.items.some((i) => i.origin !== "generated"))
                .map((m) => ({ material: m, items: m.items.filter((i) => i.origin !== "generated") }))
                .filter((r) => INPUT_KINDS.has(r.material.kind) || r.items.length)}
              render={(material, items) => (
                <>
                  {files(material, items)}
                  {ATTACH[material.kind] && INPUT_KINDS.has(material.kind) && (
                    <button className="ui-icon-button" title={`关联${material.label}文件…`} aria-label={`关联${material.label}文件`} disabled={locked || readOnly} onClick={() => void attach(material)}>
                      <Plus />
                    </button>
                  )}
                </>
              )}
            />
            <MaterialColumn
              title="生成"
              rows={materials
                .filter((m) => !INPUT_KINDS.has(m.kind) || m.items.some((i) => i.origin === "generated"))
                .map((m) => ({ material: m, items: m.items.filter((i) => i.origin === "generated") }))}
              render={(material, items) => (
                <>
                  {files(material, items)}
                  {material.generators.map((generator) => (
                    <button
                      key={generator.id}
                      className="ui-icon-button"
                      disabled={locked || busyGenerating(generator) || !generator.available || readOnly}
                      title={`${generator.label}${generator.reason ? `（${generator.reason}）` : ""}`}
                      aria-label={generator.label}
                      onClick={() => generate(generator)}
                    >
                      {busyGenerating(generator) ? <LoaderCircle className="spin" /> : <Sparkles />}
                    </button>
                  ))}
                </>
              )}
            />
          </div>
        )}
      </section>

      <section className="song-section" aria-labelledby="song-layers-title">
        <h3 id="song-layers-title">图层</h3>
        <div className="song-layers">
          {(summary?.layers ?? []).map((layer) => (
            <LayerChip key={layer.name} layer={layer} edit={EDITABLE.has(layer.name) ? () => editLayer(layer.name) : undefined} disabled={locked} />
          ))}
        </div>
      </section>

      <section className="song-section song-overview" aria-label="MIDI 总览">
        <h3>MIDI 总览</h3>
        <PianoRoll song={song} />
      </section>
    </Dialog>
  );
}

/** Kinds the player brings (the rest are made from them): the performance, the recording, paper
 * pages, the picture. A transcribed MIDI or a player's own MusicXML shows in both columns. */
const INPUT_KINDS = new Set(["performance", "source", "paper", "cover", "stems"]);

/** One column of the materials: a row per kind, its files and its actions. */
function MaterialColumn({ title, rows, render }: { title: string; rows: { material: Material; items: MaterialItem[] }[]; render: (material: Material, items: MaterialItem[]) => ReactNode }) {
  return (
    <div className="material-column">
      <h4>{title}</h4>
      <ul className="material-rows">
        {rows.map(({ material, items }) => (
          <li key={material.kind} className="material-row" data-has={items.some((i) => i.state !== "missing" && i.state !== "found") || undefined}>
            <span className="material-kind">
              {ICONS[material.kind]}
              {material.label}
            </span>
            <span className="material-cell">{render(material, items)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KEY_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
/** The practice version in one row: transposition, the original key, quantization. Changes
 * apply at once and are saved with the song. */
function VariantRow({ song, disabled, apply }: { song: LoadedSong; disabled: boolean; apply: (value: Variant) => Promise<boolean> }) {
  const info = song.practiceVariant;
  if (!info) return <p className="material-none">这首歌没有可调整的练习版本。</p>;
  const v = { transpose: 0, quantize: 0, durations: true, tonic: null, minor: null, ...info.settings };
  const change = (patch: Partial<Variant>) => void apply({ ...v, ...patch } as Variant);
  const target = (info.tonic + v.transpose + 120) % 12;
  const outside = (info.minPitch ?? 60) + v.transpose < 21 || (info.maxPitch ?? 60) + v.transpose > 108;
  return (
    <div className="variant-row">
      <span className="variant-field">
        <span>转调</span>
        <span className="variant-stepper">
          <button className="ui-icon-button" aria-label="降低一个半音" title="降低一个半音" disabled={disabled || v.transpose <= -24} onClick={() => change({ transpose: v.transpose - 1 })}>
            −
          </button>
          <output title={`练习调：${KEY_NAMES[target]} ${info.minor ? "小调" : "大调"}`}>{v.transpose > 0 ? `+${v.transpose}` : v.transpose}</output>
          <button className="ui-icon-button" aria-label="升高一个半音" title="升高一个半音" disabled={disabled || v.transpose >= 24} onClick={() => change({ transpose: v.transpose + 1 })}>
            +
          </button>
        </span>
        <small>
          {KEY_NAMES[target]} {info.minor ? "小调" : "大调"}
        </small>
      </span>
      <span className="variant-field">
        <span>原调</span>
        <select aria-label="原曲主音" disabled={disabled} value={info.tonic} onChange={(e) => change({ tonic: Number(e.target.value) })}>
          {KEY_NAMES.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select aria-label="原曲调式" disabled={disabled} value={info.minor ? "minor" : "major"} onChange={(e) => change({ minor: e.target.value === "minor" })}>
          <option value="major">大调</option>
          <option value="minor">小调</option>
        </select>
      </span>
      <span className="variant-field">
        <span>量化</span>
        <select aria-label="练习量化" disabled={disabled} value={v.quantize} onChange={(e) => change({ quantize: Number(e.target.value) })}>
          <option value={0}>原始时值</option>
          <option value={8}>1/8</option>
          <option value={16}>1/16</option>
          <option value={32}>1/32</option>
        </select>
        <label className="variant-check" title="音符时值也对齐到网格">
          <input type="checkbox" disabled={disabled || !v.quantize} checked={v.durations} onChange={(e) => change({ durations: e.target.checked })} />
          时值
        </label>
      </span>
      {outside && (
        <p className="song-message" role="alert">
          转调后部分音符超出 88 键音域。
        </p>
      )}
    </div>
  );
}

const EDITABLE = new Set(["fingering"]);
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

