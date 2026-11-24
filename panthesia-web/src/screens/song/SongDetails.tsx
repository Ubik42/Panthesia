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
  Hand,
  Mic,
  MicVocal,
  Milestone,
  Music,
  Music2,
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
  const summaryText = `按上次的方式开始：${mode === "listen" ? "连续播放" : `等待按键 · ${hand === "left" ? "左手" : hand === "right" ? "右手" : "双手"}`}`;
  const materials = summary?.materials ?? [];
  const cover = useSongCover(materials.find((m) => m.kind === "cover")?.items.find((i) => i.state !== "missing")?.path);
  const busyGenerating = (g: Generator) => running.has(g.id) || pending === `generate:${g.id}`;
  const readOnly = !!summary?.manifest?.readOnly;
  const fileLine = (material: Material, item: MaterialItem) => (
    <li key={`${item.id ?? ""}:${item.path ?? item.relative}`} className="material-file" data-state={item.state}>
      <span className="material-name" title={item.path ?? item.relative}>
        {displayName(item)}
      </span>
      {item.origin === "generated" && item.step && <em data-state="made" title={item.tool ? `由 ${item.tool} ${STEP_NAMES[item.step] ?? item.step}` : undefined}>{STEP_NAMES[item.step] ?? item.step}</em>}
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

  const generatorButtons = (material: Material) =>
    material.generators.map((generator) => (
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
    ));

  return (
    <Dialog
      title={title}
      subtitle={facts?.artist ?? undefined}
      close={back}
      className="song-details"
      actions={
        <button className="ui-button ui-button--primary song-start" disabled={locked} title={summaryText} onClick={() => void launch()}>
          {pending === "start" ? <LoaderCircle className="spin" /> : <Play />}
          {pending === "start" ? "正在准备…" : "开始练习"}
        </button>
      }
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
        <h3 id="song-version-title">演奏</h3>
        <PerformanceChoice
          items={materials.find((m) => m.kind === "performance")?.items.filter((i) => i.state !== "missing" && i.state !== "found") ?? []}
          disabled={locked}
          choose={(item) => switchTo(item)}
        />
        <VariantRow song={song} disabled={locked} apply={variant} />
        <PlayNotes
          current={materials.find((m) => m.kind === "performance")?.items.find((i) => i.state === "current")}
          quantized={!!song.practiceVariant?.settings?.quantize}
          paired={materials.some((m) => m.kind === "musicxml" && m.items.some((i) => i.paired))}
          audio={materials.some((m) => (m.kind === "vocals" || m.kind === "accompaniment") && m.items.some((i) => i.state !== "missing" && i.state !== "found"))}
        />
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
                .map((m) => ({ material: m, items: AUDIO_KINDS.has(m.kind) ? m.items : m.items.filter((i) => i.origin !== "generated") }))
                .filter((r) => INPUT_ROWS.has(r.material.kind) || r.items.length)
                .sort((a, b) => INPUT_ORDER.indexOf(a.material.kind) - INPUT_ORDER.indexOf(b.material.kind))
                .map(({ material, items }) => ({
                  key: material.kind,
                  icon: ICONS[material.kind],
                  label: material.label,
                  has: items.some((i) => i.state !== "missing" && i.state !== "found"),
                  content: (
                    <>
                      {material.empty && !items.length ? <span className="material-empty" title="分离结果几乎是静音，不作为分轨">无（分离结果为静音）</span> : files(material, items)}
                      {AUDIO_KINDS.has(material.kind) && generatorButtons(material)}
                      {ATTACH[material.kind] && (
                        <button className="ui-icon-button" title={`关联${material.label}文件…`} aria-label={`关联${material.label}文件`} disabled={locked || readOnly} onClick={() => void attach(material)}>
                          <Plus />
                        </button>
                      )}
                    </>
                  ),
                }))}
            />
            <MaterialColumn
              title="输出"
              rows={[
                ...materials
                  .filter((m) => !AUDIO_KINDS.has(m.kind))
                  .map((m) => ({ material: m, items: m.items.filter((i) => i.origin === "generated") }))
                  .filter((r) => r.items.length || r.material.generators.length)
                  .map(({ material, items }) => ({
                    key: material.kind,
                    icon: ICONS[material.kind],
                    label: material.label,
                    has: items.length > 0,
                    content: (
                      <>
                        {files(material, items)}
                        {generatorButtons(material)}
                      </>
                    ),
                  })),
                ...(summary.layers ?? [])
                  .filter((l) => OUTPUT_LAYERS.has(l.name) && (l.name !== "lyrics" || l.count > 0))
                  .map((layer) => ({
                    key: `layer:${layer.name}`,
                    icon: LAYER_ICONS[layer.name],
                    label: LAYER_NAMES[layer.name] ?? layer.label,
                    has: !!layer.origin,
                    content: <LayerCell layer={layer} edit={EDITABLE.has(layer.name) ? () => editLayer(layer.name) : undefined} disabled={locked} />,
                  })),
              ]}
            />
          </div>
        )}
      </section>

      <section className="song-section song-overview" aria-label="MIDI 总览">
        <h3>MIDI 总览</h3>
        <PianoRoll song={song} />
      </section>
    </Dialog>
  );
}

/** Rows the input column always shows, so a missing input can be added. Whether a file is an
 * input or generated comes from its provenance, not its kind (song-pipeline.md): a MIDI the
 * player brought is an input, one transcribed from the recording is generated. */
const INPUT_ROWS = new Set(["performance", "musicxml", "source", "paper", "vocals", "accompaniment", "cover"]);
/** Recordings and pictures count as inputs even when separated or cut from the video: they are
 * what the player listens to and looks at, not notation made for practice. */
const AUDIO_KINDS = new Set(["source", "vocals", "accompaniment", "stems", "cover"]);
const INPUT_ORDER = ["source", "vocals", "accompaniment", "stems", "cover", "performance", "musicxml", "abc", "paper"];
/** Layers shown with the outputs. Hands are part of the fingering (one algorithm makes both);
 * key and tempo are in the facts; lyrics only when the MIDI has them. */
const OUTPUT_LAYERS = new Set(["fingering", "chords", "sections", "lyrics"]);
const LAYER_NAMES: Record<string, string> = { fingering: "指法与手别" };
const LAYER_ICONS: Record<string, ReactNode> = { fingering: <Hand />, chords: <Music2 />, sections: <Milestone />, lyrics: <MicVocal /> };
/** The step that made a generated file (provenance.step). */
/** A generated file by its label and type ("乐谱量化 · MID"): its name repeats the song's. */
const displayName = (item: MaterialItem) => {
  const name = fileName(item.relative);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : "";
  return item.origin === "generated" && item.label ? `${item.label}${ext ? ` · ${ext}` : ""}` : name;
};
const STEP_NAMES: Record<string, string> = { separate: "分离", transcribe: "转录", engrave: "制谱", export: "导出", frame: "视频画面", omr: "识谱" };

/** One column of the materials: a row per kind (or layer), its files and its actions. */
function MaterialColumn({ title, rows }: { title: string; rows: { key: string; icon: ReactNode; label: string; has: boolean; content: ReactNode }[] }) {
  return (
    <div className="material-column">
      <h4>{title}</h4>
      <ul className="material-rows">
        {rows.map((row) => (
          <li key={row.key} className="material-row" data-has={row.has || undefined}>
            <span className="material-kind">
              {row.icon}
              {row.label}
            </span>
            <span className="material-cell">{row.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which MIDI the stage plays: every performance of the song, inputs and generated ones alike
 * (the player's own MIDI, the transcription, the score-quantized MIDI, the practice MIDI). */
function PerformanceChoice({ items, disabled, choose }: { items: MaterialItem[]; disabled: boolean; choose: (item: MaterialItem) => void }) {
  if (items.length < 2) return null;
  const current = items.find((i) => i.state === "current");
  const name = (i: MaterialItem) => `${i.label ?? fileName(i.relative)}（${i.origin === "generated" ? STEP_NAMES[i.step ?? ""] ?? "生成" : "输入"}）`;
  return (
    <div className="variant-row">
      <span className="variant-field">
        <span>MIDI</span>
        <select
          aria-label="演奏用的 MIDI"
          disabled={disabled}
          value={current?.path ?? ""}
          onChange={(e) => {
            const item = items.find((i) => i.path === e.target.value);
            if (item && item.state !== "current") choose(item);
          }}
        >
          {items.map((i) => (
            <option key={i.path} value={i.path ?? ""} title={i.relative}>
              {name(i)}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** What the current choice means on the stage (song-pipeline.md, "演奏"). */
function PlayNotes({ current, quantized, paired, audio }: { current?: MaterialItem; quantized: boolean; paired: boolean; audio: boolean }) {
  const notes: string[] = [];
  if (current?.step === "transcribe")
    notes.push("转录 MIDI 保留原曲的时间与力度，没有真实的拍子：小节线、节拍器和段落只作参考；需要准确小节时选“乐谱量化”。");
  if (quantized && audio) notes.push("练习量化会挪动音符时间，人声与伴奏可能和音符对不齐；跟原曲一起弹时用原始时值。");
  if (!quantized && !paired) notes.push("没有配对的乐谱：谱面按原始时值自动排版，节奏可能零碎；可选“乐谱量化”或配对 MusicXML。");
  if (!notes.length) return null;
  return (
    <ul className="play-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
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
        <span>练习量化</span>
        <select aria-label="练习量化" title="在当前 MIDI 上对齐网格（不改文件）" disabled={disabled} value={v.quantize} onChange={(e) => change({ quantize: Number(e.target.value) })}>
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

/** A layer in the output column: where it came from, whether it waits for review, and edit. */
function LayerCell({ layer, edit, disabled }: { layer: Layer; edit?: () => void; disabled: boolean }) {
  return (
    <>
      <span className="material-layer">
        {layer.origin ? `${ORIGIN_NAMES[layer.origin]}${layer.count ? ` · ${layer.count}` : ""}` : <span className="material-empty">—</span>}
        {layer.review === "pending" && <em data-state="found" title="算法生成，尚未经 AI 或你检查">待检查</em>}
      </span>
      {edit && (
        <button className="ui-icon-button" title={`编辑${layer.label}`} aria-label={`编辑${layer.label}`} disabled={disabled} onClick={edit}>
          <PencilLine />
        </button>
      )}
    </>
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

