import { useRef, useState } from "react";
import { Download, FileMusic, Package, RefreshCw, X } from "lucide-react";
import type { MediaExportKind } from "../../engine/commands.generated";
import type { MediaExportSource } from "./mediaExportStore";
import { useMediaExport } from "./useMediaExport";
import "./mediaExport.css";

export function MediaExportDialog({
  source,
  kind,
  close,
}: {
  source: MediaExportSource;
  kind: MediaExportKind;
  close: () => void;
}) {
  const workspace = useMediaExport(source, kind);
  const [all, setAll] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const busy = workspace.busy || workspace.submitting;
  const saving = busy && workspace.action === "save";
  const artifact = workspace.artifact;
  const result = useRef<HTMLElement>(null);
  const rows = all
    ? workspace.listing.drafts
    : workspace.listing.drafts.filter(
        (row) => row.contentId === source.contentId && row.kind === kind,
      );
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (!saving) close();
      }}
    >
      <section
        className="settings-dialog media-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-export-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-heading">
          <div>
            <h2 id="media-export-title">
              {kind === "practiceMidi"
                ? "导出练习版 MIDI"
                : kind === "midi"
                  ? "导出原始 MIDI"
                  : "导出曲目包"}
            </h2>
            <p>{source.title}</p>
          </div>
          <button
            data-dialog-close
            aria-label="关闭文件导出"
            disabled={saving}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <div className="media-export-intro">
          {kind !== "package" ? (
            <FileMusic size={26} aria-hidden="true" />
          ) : (
            <Package size={26} aria-hidden="true" />
          )}
          <p>
            {kind === "practiceMidi"
              ? "导出当前转调、量化后的音符与演奏事件。原始 MIDI 保留；该文件可在其他 MIDI 软件中使用。"
              : kind !== "package"
                ? "保留原始 MIDI 的音符与演奏事件，生成可另存的副本。练习指法、谱页和个人设置可通过曲目包一起保存。"
                : "将 MIDI、全部谱面、个人标记、教学规则和曲目设置一起打包。个人成绩、设备设置与练习进度继续保留在本机。"}
          </p>
        </div>
        {workspace.message && (
          <p className="media-export-progress" role="status">
            {workspace.message}
          </p>
        )}
        {workspace.error && (
          <p className="dialog-error" role="alert">
            {workspace.error}
          </p>
        )}
        {workspace.job && (
          <div className="media-export-task-actions">
            {!workspace.busy && (
              <button
                disabled={workspace.submitting}
                onClick={() => void workspace.resume()}
              >
                <RefreshCw size={14} />
                继续读取原任务
              </button>
            )}
            {workspace.status?.cancellable !== false && (
              <button onClick={() => void workspace.cancel()}>
                取消{workspace.action === "save" ? "保存" : "制作"}
              </button>
            )}
            {workspace.status?.cancellable === false && (
              <span>正在完成文件保存，请等待结果。</span>
            )}
          </div>
        )}
        {!workspace.job &&
          busy &&
          !workspace.supported &&
          workspace.canStopWaiting && (
            <button
              disabled={!!workspace.submitting}
              onClick={() => void workspace.cancel()}
            >
              停止等待
            </button>
          )}
        {artifact && (
          <article className="media-export-result" ref={result}>
            <div className="media-export-result-heading">
              <strong>{artifact.name}</strong>
              <span>
                {artifact.kind !== "package" ? "MIDI" : "曲目包"} ·{" "}
                {(artifact.size / 1_048_576).toFixed(2)} MB
              </span>
            </div>
            <p>
              {new Date(artifact.createdAtMs).toLocaleString("zh-CN")}{" "}
              制作的快照
              {artifact.contentId !== source.contentId ? " · 来自其他曲目" : ""}
              。曲目资料修改后，可以制作新的副本。
            </p>
            {artifact.kind === "package" && (
              <dl className="media-export-summary">
                <div>
                  <dt>演奏谱面</dt>
                  <dd>
                    {artifact.summary.scores} 份 ·{" "}
                    {artifact.summary.performances || 1} 个演奏版本
                  </dd>
                </div>
                <div>
                  <dt>PDF / 图片谱</dt>
                  <dd>
                    {artifact.summary.paperBooks} 份 ·{" "}
                    {artifact.summary.paperPages} 个文件
                  </dd>
                </div>
                <div>
                  <dt>个人指法 / 分手</dt>
                  <dd>
                    {artifact.summary.fingerings} / {artifact.summary.hands}{" "}
                    个标记
                  </dd>
                </div>
                <div>
                  <dt>持音换指</dt>
                  <dd>{artifact.summary.fingerActions} 个动作</dd>
                </div>
                <div>
                  <dt>命名练习段</dt>
                  <dd>{artifact.summary.passages} 个</dd>
                </div>
                <div>
                  <dt>速度阶梯</dt>
                  <dd>{artifact.summary.ladders} 个</dd>
                </div>
              </dl>
            )}
            {artifact.savedPath && <p>上次另存：{artifact.savedPath}</p>}
            {(artifact.savePendingPath ||
              !!artifact.previousPendingPaths?.length) && (
              <div className="media-export-warning">
                <p>以下保存位置的结果仍待确认：</p>
                <ul>
                  {[
                    ...(artifact.previousPendingPaths ?? []),
                    ...(artifact.savePendingPath
                      ? [artifact.savePendingPath]
                      : []),
                  ].map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
                <button
                  disabled={busy || !!workspace.job}
                  onClick={() => void workspace.confirm(artifact)}
                >
                  核对原保存位置
                </button>
              </div>
            )}
            {artifact.warning && (
              <p className="media-export-warning">{artifact.warning}</p>
            )}
            <button
              className="primary"
              disabled={busy || !!workspace.job}
              onClick={() => void workspace.save(artifact)}
            >
              <Download size={15} />
              另存这份成品
            </button>
          </article>
        )}
        {workspace.supported && (
          <details
            className="media-export-cache"
            open={
              !!workspace.error &&
              (workspace.listing.drafts.length >= 16 ||
                workspace.error.includes("容量限制"))
            }
          >
            <summary>
              本机保留的导出成品 ·{" "}
              {(workspace.listing.totalSize / 1_048_576).toFixed(1)} MB / 1 GiB
            </summary>
            <p>保留最多 16 份成品。移除缓存会保留原曲目和已另存文件。</p>
            <div className="media-export-cache-toolbar">
              <button
                disabled={busy}
                aria-pressed={all}
                onClick={() => setAll(!all)}
              >
                {all ? "只看当前曲目与格式" : "查看全部曲目与格式"}
              </button>
              <button disabled={busy} onClick={() => void workspace.refresh()}>
                <RefreshCw size={14} />
                重新读取
              </button>
            </div>
            {workspace.listing.issues.map((issue, index) => (
              <p key={index} className="media-export-warning">
                {issue}
              </p>
            ))}
            {!rows.length && <p>当前没有保留的导出成品。</p>}
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      {new Date(row.createdAtMs).toLocaleString("zh-CN")} ·{" "}
                      {(row.size / 1_048_576).toFixed(2)} MB ·{" "}
                      {row.savePendingPath || row.previousPendingPaths?.length
                        ? "保存结果待确认"
                        : row.savedPath
                          ? "已另存"
                          : "尚未另存"}
                    </small>
                    {row.warning && <p>{row.warning}</p>}
                  </div>
                  <button
                    disabled={busy || !!workspace.job}
                    aria-pressed={artifact?.id === row.id}
                    onClick={() => {
                      workspace.select(row);
                      requestAnimationFrame(() =>
                        result.current?.scrollIntoView({ block: "nearest" }),
                      );
                    }}
                  >
                    查看成品
                  </button>
                  {remove === row.id ? (
                    <>
                      <button
                        disabled={busy || !!workspace.job}
                        onClick={() => {
                          setRemove(null);
                          void workspace.remove(row);
                        }}
                      >
                        确认移除缓存
                      </button>
                      <button onClick={() => setRemove(null)}>保留</button>
                    </>
                  ) : (
                    <button
                      disabled={busy || !!workspace.job}
                      onClick={() => setRemove(row.id)}
                    >
                      移除缓存
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <footer>
          <button
            disabled={busy || !!workspace.job}
            className={!artifact ? "primary" : undefined}
            onClick={() => void workspace.prepare()}
          >
            {artifact
              ? "按当前曲目重新制作并另存"
              : workspace.supported
                ? "制作并另存"
                : "另存当前曲目"}
          </button>
          {workspace.supported && (
            <button
              disabled={busy || !!workspace.job}
              onClick={() => void workspace.legacy()}
            >
              直接另存当前曲目
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
