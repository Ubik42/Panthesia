import {
  AudioLines,
  FileMusic,
  FileText,
  FolderOpen,
  Layers,
  Library,
  Link2,
  LoaderCircle,
  Mic,
  Music,
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
import { PartsList, type PartsListProps } from "./PartsList";
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

/** Song details (interface-design.md 3.2, frontend-architecture.md §3): a dialog over the
 * library with everything that belongs to this song, set in place: its parts, its practice
 * version (transposition, quantization), its materials (input and generated files) and layers,
 * and an overview of the music. Practice mode and hands are chosen on the stage; starting uses
 * the last ones. Global settings (keyboard, sound) stay on the settings page. */
export function SongDetails({
  song,
  store,
  disabled,
  engineId,
  back,
  parts,
  variant,
  scores,
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
  /** The parts list's own props (sound and track commands). */
  parts: Omit<PartsListProps, "song" | "disabled">;
  variant: (value: Variant) => Promise<boolean>;
  /** The score manager (score files, paper pages, sources). */
  scores: () => void;
  /** Open the settings page where the transcription tool is chosen. */
  tools: () => void;
  editLayer: (name: string) => void;
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
  const summaryText = `${mode === "listen" ? "连续播放" : "等待按键"} · ${hand === "left" ? "左手" : hand === "right" ? "右手" : "双手"}`;
  const materials = summary?.materials ?? [];
  const items = materials.flatMap((m) => m.items.map((item) => ({ material: m, item })));
  const inputs = items.filter(({ item }) => item.origin !== "generated");
  const generated = items.filter(({ item }) => item.origin === "generated");
  // One button per generator, named by what it makes (separation makes vocals and accompaniment).
  const generators = [...new Map(materials.flatMap((m) => m.generators.map((g) => [g.id, { generator: g, makes: materials.filter((x) => x.generators.some((y) => y.id === g.id)).map((x) => x.label) }] as const))).values()];
  const missingAttach = materials.filter((m) => ATTACH[m.kind] && !m.items.some((i) => i.state !== "missing" && i.state !== "found"));
  const busyGenerating = (g: Generator) => running.has(g.id) || pending === `generate:${g.id}`;
  const fileRow = ({ material, item }: { material: Material; item: MaterialItem }) => (
    <li key={`${material.kind}:${item.id ?? ""}:${item.path ?? item.relative}`} className="material-row" data-state={item.state}>
      <span className="material-kind" title={material.label}>
        {ICONS[material.kind]}
        <span>{material.label}</span>
      </span>
      <span className="material-name" title={item.path ?? item.relative}>
        {fileName(item.relative)}
      </span>
      <span className="material-tags">
        {item.state === "current" && <em>当前</em>}
        {item.paired && <em>谱面</em>}
        {item.state === "missing" && <em data-state="missing">缺失</em>}
        {item.state === "found" && <em data-state="found">未登记</em>}
      </span>
      <span className="material-actions">
        {item.state === "found" && (
          <button className="ui-icon-button" title="登记到歌曲清单" aria-label="登记到歌曲清单" disabled={locked || !!summary?.manifest?.readOnly} onClick={() => void register(item)}>
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
          <button className="ui-icon-button" title="从清单移除" aria-label="从清单移除" disabled={locked || !!summary?.manifest?.readOnly} onClick={() => unregister(item)}>
            <Trash2 />
          </button>
        )}
      </span>
    </li>
  );

  return (
    <Dialog
      title={title}
      subtitle={facts?.artist ?? undefined}
      close={back}
      className="song-details"
      footer={
        <>
          <span className="song-start-note">{summaryText}（在演奏界面调整）</span>
          <button className="ui-button ui-button--primary ui-button--large song-start" disabled={locked} onClick={() => void launch()}>
            {pending === "start" ? <LoaderCircle className="spin" /> : <Play />}
            {pending === "start" ? "正在准备…" : startLabel}
          </button>
        </>
      }
    >
      {(loadError || message || failure) && (
        <p className="song-message" role="alert">
          {message || loadError || `${failure?.label}失败：${failure?.error}`}
        </p>
      )}

      <section className="song-section" aria-labelledby="song-parts-title">
        <h3 id="song-parts-title">声部</h3>
        <PartsList song={song} disabled={locked} {...parts} />
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
          <div className="song-materials">
            <div className="material-column">
              <h4>输入文件</h4>
              <ul className="material-list">{inputs.map(fileRow)}</ul>
              {missingAttach.length > 0 && (
                <div className="material-add">
                  {missingAttach.map((m) => (
                    <button key={m.kind} className="ui-button ui-button--ghost" disabled={locked || !!summary.manifest?.readOnly} title={`关联${m.label}文件`} onClick={() => void attach(m)}>
                      <Plus />
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="material-column">
              <h4>生成文件</h4>
              {generated.length > 0 ? <ul className="material-list">{generated.map(fileRow)}</ul> : <p className="material-none">还没有生成的文件</p>}
              {generators.length > 0 && (
                <div className="material-add">
                  {generators.map(({ generator, makes }) => (
                    <button
                      key={generator.id}
                      className="ui-button"
                      disabled={locked || busyGenerating(generator) || !generator.available || !!summary.manifest?.readOnly}
                      title={`${generator.label}：${makes.join("、")}${generator.reason ? `（${generator.reason}）` : ""}`}
                      onClick={() => generate(generator)}
                    >
                      {busyGenerating(generator) ? <LoaderCircle className="spin" /> : <Sparkles />}
                      {makes.join(" + ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
    </Dialog>
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

