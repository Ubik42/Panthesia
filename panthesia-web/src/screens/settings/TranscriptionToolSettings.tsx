import { useEffect, useState } from "react";
import { api } from "../../api";

type ToolStatus = { available: boolean; path: string | null; source: "selected" | "environment" | null; message?: string };

/** Where the external transcription and separation tool (music-transcription's Run.cmd) is. */
export function TranscriptionToolSettings({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<ToolStatus | null>(null);
  const [error, setError] = useState("");
  const read = () =>
    api
      .command<ToolStatus>({ type: "transcriptionTool" })
      .then(setStatus)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void read();
  }, []);
  const choose = async () => {
    setError("");
    try {
      const path = api.desktop ? await api.pickSongFile("tool") : window.prompt("转录工具 Run.cmd 的完整路径", status?.path ?? "")?.trim();
      if (path) setStatus(await api.command<ToolStatus>({ type: "setTranscriptionTool", path }));
    } catch (e) {
      setError(String(e));
    }
  };
  const clear = async () => {
    setError("");
    try {
      setStatus(await api.command<ToolStatus>({ type: "setTranscriptionTool", path: null }));
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section aria-labelledby="tools-transcription">
      <h3 id="tools-transcription">转录与分离</h3>
      <div className="ui-row">
        <span>
          工具位置
          <br />
          <small>{status?.available ? `${status.path}${status.source === "environment" ? "（来自环境变量）" : ""}` : "未指定"}</small>
        </span>
        <span className="settings-row-actions">
          <button type="button" disabled={disabled} onClick={() => void choose()}>
            选择…
          </button>
          {status?.source === "selected" && (
            <button type="button" disabled={disabled} onClick={() => void clear()}>
              清除
            </button>
          )}
        </span>
      </div>
      <p className="parameter-help">music-transcription 的 Run.cmd。歌曲页用它从原曲转录 MIDI、分离人声与伴奏，任务在后台运行。</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
