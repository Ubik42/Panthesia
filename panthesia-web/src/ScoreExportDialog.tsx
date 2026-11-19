import { useEffect, useState } from "react";
import { X, Download, FileText, Loader2, RefreshCw } from "lucide-react";
import type { LoadedSong } from "./api";
import type { ScoreExportOptions } from "./engine/commands.generated";
import { useScoreExport } from "./features/scores/useScoreExport";
import { ScoreExportConflicts } from "./features/scores/ScoreExportConflicts";
import "./features/scores/scoreExport.css";

export function ScoreExportDialog({
  song,
  close,
  allowPrepare = true,
}: {
  song: LoadedSong;
  close: () => void;
  allowPrepare?: boolean;
}) {
  const workspace = useScoreExport(song, allowPrepare);
  const { options, setOptions, preview, error, message } = workspace;
  const [remove, setRemove] = useState<string | null>(null);
  const busy = workspace.busy || workspace.saving || workspace.submitting;
  const canPrepare =
    allowPrepare && (options.fingers || options.hands || options.substitutions);
  const displayedOptions =
    workspace.artifact?.options ?? workspace.legacyOptions ?? options;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workspace.saving) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [workspace.saving, close]);
  return (
    <div className="modal-backdrop">
      <section
        className="settings-dialog score-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-export-title"
      >
        <header className="dialog-heading">
          <h2 id="score-export-title">导出个人标记谱</h2>
          <button
            aria-label="关闭导出谱"
            onClick={close}
            disabled={workspace.saving}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          为《{song.title}》制作 MusicXML
          副本。保留原谱的小节、反复、歌词与演奏记号，写入已保存的个人标记。
        </p>
        <div className="score-export-options">
          <label>
            <input
              type="checkbox"
              checked={options.fingers}
              disabled={busy}
              onChange={(e) =>
                setOptions({ ...options, fingers: e.target.checked })
              }
            />
            个人指法
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.hands}
              disabled={busy}
              onChange={(e) =>
                setOptions({ ...options, hands: e.target.checked })
              }
            />
            逐音分手标记
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.substitutions}
              disabled={busy}
              onChange={(e) =>
                setOptions({ ...options, substitutions: e.target.checked })
              }
            />
            持音换指标记
          </label>
          <label>
            反复段落的不同标记
            <select
              aria-label="反复段落导出方式"
              value={options.repeatPolicy}
              disabled={busy}
              onChange={(e) =>
                setOptions({
                  ...options,
                  repeatPolicy: e.target
                    .value as ScoreExportOptions["repeatPolicy"],
                })
              }
            >
              <option value="consistent">保留原谱，跳过有分歧的标记</option>
              <option value="first">采用首次演奏的标记</option>
            </select>
          </label>
        </div>
        <p className="muted">
          分手以“左手 /
          右手”文字标注；原谱声部和谱表布局保持原样。尚未接受的推荐、纸谱批注不会写入此文件。持音换指同时写出对应起音指、接替指和起音后经过的四分音符拍数，按保存时的推荐速度校验动作；具体排版由制谱软件决定。
        </p>
        {!canPrepare && (
          <p className="score-export-note">
            {allowPrepare
              ? "请选择至少一种个人标记后制作。"
              : "当前曲目尚未加载可导出的 MusicXML，请先关联并打开原谱。"}
            已保留的成品仍可另存。
          </p>
        )}
        {workspace.job && (
          <div className="score-export-task" aria-live="polite">
            <Loader2
              size={17}
              className={workspace.busy ? "score-export-spinner" : undefined}
              aria-hidden="true"
            />
            <span>
              {workspace.busy
                ? "正在制作，关闭此窗口后可以继续读取"
                : "原制作任务保留"}
            </span>
            {!workspace.busy && (
              <button
                disabled={workspace.saving}
                onClick={() => void workspace.resume()}
              >
                继续读取原任务
              </button>
            )}
            {workspace.status?.cancellable !== false && (
              <button
                disabled={workspace.saving}
                onClick={() => void workspace.cancel()}
              >
                取消制作
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <div className="score-export-artifact">
              <FileText size={22} aria-hidden="true" />
              <div>
                <strong>{preview.name}</strong>
                <span>
                  {workspace.artifact
                    ? `${(workspace.artifact.size / 1_048_576).toFixed(2)} MB · ${new Date(workspace.artifact.createdAtMs).toLocaleString("zh-CN")} 制作`
                    : "当前导出预览"}
                </span>
                {workspace.artifact?.savedPath && (
                  <span>上次另存：{workspace.artifact.savedPath}</span>
                )}
              </div>
              <b>
                {workspace.artifact &&
                workspace.artifact.contentId !== song.contentId
                  ? "其他曲目的成品"
                  : workspace.artifactCurrent
                    ? "与当前设置一致"
                    : "上次制作的快照"}
              </b>
            </div>
            {!workspace.artifactCurrent && (
              <p className="score-export-note">
                {workspace.artifact &&
                workspace.artifact.contentId !== song.contentId
                  ? "这份成品来自其他曲目。下方摘要和另存文件均对应它原有的内容。"
                  : "当前选项、曲目版本或个人标记已变化。下方摘要对应上次制作的内容。"}
                {workspace.artifact
                  ? "可以另存这份快照，或按当前设置重新制作。"
                  : "请按当前设置重新制作预览后保存。"}
              </p>
            )}
            <dl className="score-export-summary">
              <div>
                <dt>指法谱音</dt>
                <dd>{preview.fingerNotes}</dd>
              </div>
              <div>
                <dt>分手谱音</dt>
                <dd>{preview.handNotes}</dd>
              </div>
              <div>
                <dt>持音换指</dt>
                <dd>
                  {preview.substitutionActions} 个动作 /{" "}
                  {preview.substitutionNotes} 个谱音
                </dd>
              </div>
              <div>
                <dt>反复分歧</dt>
                <dd>{preview.conflicts.length}</dd>
              </div>
              <div>
                <dt>未能可靠对应的个人标记</dt>
                <dd>{preview.unmappedNotes}</dd>
              </div>
            </dl>
            {preview.invalidActions > 0 && (
              <p role="status">
                {preview.invalidActions}{" "}
                个已保存动作需要重新审阅，本次跳过其所在音符的换指标记；起音指法和分手仍按所选方式处理。
              </p>
            )}
            {preview.writtenNotes === 0 && (
              <p>
                当前没有可写入的个人标记。保存时仍会生成原谱的 MusicXML 副本。
              </p>
            )}
            {preview.unmappedNotes > 0 && (
              <p>未能可靠对应的标记保留在练习记录中，本次导出跳过这些音符。</p>
            )}
            {preview.conflicts.length > 0 && (
              <ScoreExportConflicts
                key={preview.fingerprint}
                conflicts={preview.conflicts}
                ppq={preview.ppq}
                options={displayedOptions}
              />
            )}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {workspace.supported && (
          <details className="score-export-cache">
            <summary>
              本次打开的软件中保留的成品 · {workspace.items.length} 份
            </summary>
            <p>
              关闭此窗口会保留成品；退出软件时释放。请及时另存需要长期保留的文件。
            </p>
            <button
              disabled={busy}
              onClick={() => void workspace.refresh().catch(() => {})}
            >
              <RefreshCw size={14} />
              重新读取成品列表
            </button>
            {!workspace.items.length && (
              <p>尚无临时成品，制作完成后会出现在这里。</p>
            )}
            <ul>
              {workspace.items.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.contentId === song.contentId
                        ? "当前曲目"
                        : "其他曲目的快照"}{" "}
                      · {(item.size / 1_048_576).toFixed(2)} MB ·{" "}
                      {item.savedPath ? "已另存" : "尚未另存"}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => void workspace.cacheAction(item)}
                  >
                    打开摘要
                  </button>
                  {remove === item.id ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRemove(null);
                          void workspace.cacheAction(item, true);
                        }}
                      >
                        确认释放
                      </button>
                      <button onClick={() => setRemove(null)}>保留</button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => setRemove(item.id)}>
                      释放
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        <footer>
          <button
            disabled={busy || !canPrepare || !!workspace.job}
            onClick={() => void workspace.run()}
          >
            {preview ? "按当前设置重新制作" : "制作预览"}
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !preview ||
              (!workspace.artifact && !workspace.artifactCurrent)
            }
            onClick={() => void workspace.save()}
          >
            <Download size={16} />
            {workspace.saving
              ? "正在保存…"
              : workspace.artifact
                ? "保存这份 MusicXML"
                : "保存 MusicXML"}
          </button>
        </footer>
      </section>
    </div>
  );
}
