import { useEffect, useState } from "react";
import { FileMusic, Layers3, SlidersHorizontal } from "lucide-react";
import { api, type LoadedSong } from "../../api";
import type { EngineCommand, RepertoireView } from "../../engine/commands.generated";
import { readRepertoire } from "../library/repertoireClient";
import type { ScoreRouteEvidence } from "../../ScoreRoutePreview";
import "./songEditionBar.css";

export function SongEditionBar({
  song,
  disabled,
  execute,
  openPerformance,
  manage,
}: {
  song: LoadedSong;
  disabled: boolean;
  execute: (command: EngineCommand) => Promise<unknown>;
  openPerformance: (
    path: string,
    contentId: string,
    label: string,
  ) => Promise<unknown>;
  manage: () => void;
}) {
  const [view, setView] = useState<RepertoireView | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setView(null);
    setError("");
    if (song.generated || !song.sourcePath) return;
    void readRepertoire(song.sourcePath, song.contentId)
      .then((value) => {
        if (current) setView(value);
      })
      .catch((error) => {
        if (current)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [
    song.engineId,
    song.contentId,
    song.sourcePath,
    song.scoreRevision,
    retry,
  ]);
  const project = view?.project;
  if (song.generated) return null;
  const performances = project
    ? Object.values(view!.registry.performances).filter(
        (row) => row.workId === project.work.id,
      )
    : [];
  const active = project?.notations.find((row) => row.active);
  const transform = song.practiceVariant?.settings;
  const locked = disabled || pending;
  const change = async (operation: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await operation();
      setRetry((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="song-edition-bar"
      aria-label="演奏与谱面版本"
      aria-busy={pending}
    >
      <label>
        <Layers3 size={16} />
        <span>演奏版本</span>
        <select
          aria-label="当前演奏版本"
          disabled={locked || performances.length < 2}
          value={song.contentId}
          onChange={(event) => {
            const target = performances.find(
              (row) => row.contentId === event.target.value,
            );
            if (target?.locations[0])
              void change(() =>
                openPerformance(
                  target.locations[0],
                  target.contentId,
                  target.label,
                ),
              );
          }}
        >
          {!performances.length && (
            <option value={song.contentId}>{song.title}</option>
          )}
          {performances.map((row) => (
            <option key={row.contentId} value={row.contentId}>
              {row.label || "演奏 MIDI"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <FileMusic size={16} />
        <span>练习谱面</span>
        <select
          aria-label="当前练习谱面"
          value={active?.edition.versionId ?? ""}
          disabled={locked || !project}
          onChange={(event) => {
            const id = event.target.value;
            void change(async () => {
              if (!id)
                return execute({
                  type: "detachScore",
                  content_id: song.contentId,
                });
              const preview = await api.commandForEngine<ScoreRouteEvidence>(
                song.engineId ?? undefined,
                {
                  type: "previewScoreVersionRoute",
                  id,
                  content_id: song.contentId,
                },
              );
              if (preview.route?.complete !== true)
                throw new Error(
                  "这份谱面尚未完成演奏顺序对应，请在谱面管理中核对。",
                );
              return execute({
                type: "activateScore",
                id,
                content_id: song.contentId,
                expected: preview.review,
              });
            });
          }}
        >
        <option value="">{project?"MIDI 即时谱":"正在读取谱面…"}</option>
          {project?.notations.map((row) => (
            <option
              key={row.edition.id}
              value={row.edition.versionId}
              disabled={row.status !== "ready" && row.status !== "retained"}
            >
              {row.edition.name}
              {row.status === "missing" ? "（文件缺失）" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="song-edition-condition">
        <SlidersHorizontal size={15} />
        <span>
          {transform?.transpose
            ? `${transform.transpose > 0 ? "+" : ""}${transform.transpose} 半音`
            : "原调"}
        </span>
        <span>
          {transform?.quantize
            ? `1/${transform.quantize} 练习网格`
            : "原始时序"}
        </span>
      </div>
      <button
        className="song-edition-manage"
        disabled={locked}
        onClick={manage}
      >
        添加 / 管理谱面
      </button>
      {error && (
        <p role="status">
          {error}{" "}
          <button
            disabled={locked}
            onClick={() => setRetry((value) => value + 1)}
          >
            重新读取
          </button>
        </p>
      )}
    </section>
  );
}
