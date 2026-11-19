import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, type LoadedSong } from "../../api";
import { LibraryMetadataEditor } from "../../LibraryMetadataEditor";
import { TaskActivity } from "../../engine/TaskActivity";
import type { Metadata, MetadataDraft, MetadataService } from "./metadataTypes";
import { metadataDefaultsReply } from "./metadataClient";

type Source = Pick<
  LoadedSong,
  "contentId" | "title" | "sourcePath" | "scoreRevision" | "annotationRevision" | "engineId"
>;

export function MetadataDialog({
  song,
  drafts,
  close,
  saved,
  draftPath,
}: {
  song: Source;
  drafts: Map<string, MetadataDraft>;
  close: () => void;
  saved: () => Promise<void>;
  draftPath?: string;
}) {
  const opened = useRef<Source>({
    engineId: song.engineId,
    contentId: song.contentId,
    title: song.title,
    sourcePath: song.sourcePath,
    scoreRevision: song.scoreRevision,
    annotationRevision: song.annotationRevision,
  });
  const latest = useRef(song);
  latest.current = song;
  const [value, setValue] = useState<Metadata | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false),
    [revision, setRevision] = useState(0);
  const service = useMemo<MetadataService>(() => {
    const source = opened.current;
    const check = () => {
      if (
        latest.current.engineId !== source.engineId ||
        latest.current.contentId !== source.contentId ||
        latest.current.scoreRevision !== source.scoreRevision ||
        latest.current.annotationRevision !== source.annotationRevision
      )
        throw new Error(
          "曲目或标注已变化。当前输入仍保留，请关闭后重新打开曲目信息。",
        );
    };
    return {
      read: async () => {
        check();
        const value = await api.readPractice<Metadata>(source, { type: "metadata" });
        check();
        return value;
      },
      save: async (draft, expected) => {
        check();
        return api.editPractice(source, {
          type: "editMetadata",
          value: draft,
          expected,
        });
      },
      readDefaults: async () => {
        check();
        const result = metadataDefaultsReply(await api.readPractice<unknown>(source,
          { type: "readMetadataDefaults" }), source.contentId);
        check();
        return result;
      },
      resetDefaults: async (fields, expected, proof) => {
        check();
        return api.editPractice(source, { type: "resetMetadataDefaults", fields, expected, proof });
      },
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void service
      .read()
      .then((metadata) => {
        if (!cancelled) setValue(metadata);
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service, revision]);
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!working) close();
      }}
    >
      <section
        className="settings-dialog song-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="metadata-title">曲目信息</h2>
            <p>{opened.current.title}</p>
          </div>
          <button
            autoFocus
            data-dialog-close
            disabled={working}
            aria-label="关闭并保留曲目信息输入"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <p className="parameter-help">
          关闭窗口会保留输入。保存前会再次核对资料，发现其他修改时可逐项合并。
        </p>
        <TaskActivity
          contentId={opened.current.contentId}
          label={["读取曲目信息", "保存曲目信息"]}
        />
        {loading && <p role="status">正在读取曲目信息…</p>}
        {error && (
          <div className="workspace-read-error" role="alert">
            <span>{error}</span>
            <button
              disabled={loading}
              onClick={() => setRevision((previous) => previous + 1)}
            >
              重新读取
            </button>
          </div>
        )}
        {value && (
          <LibraryMetadataEditor
            edit={{
              path: draftPath ?? (opened.current.sourcePath || "内置技术练习"),
              contentId: opened.current.contentId,
              value,
            }}
            showHeading={false}
            service={service}
            draftMemory={drafts}
            onBusy={setWorking}
            saved={saved}
            cancel={close}
          />
        )}
      </section>
    </div>
  );
}
