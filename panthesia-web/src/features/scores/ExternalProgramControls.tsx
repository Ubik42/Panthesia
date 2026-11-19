import { CheckCircle2, CircleAlert, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import type { ExternalProgramController } from "./useExternalProgram";
import "./externalProgram.css";

export function ExternalProgramControls({ program, disabled = false }: { program: ExternalProgramController; disabled?: boolean }) {
  const name = program.kind === "musescore" ? "MuseScore Studio" : "Audiveris";
  const description = program.kind === "musescore" ? "编辑原谱 · PDF 排版" : "将纸谱识别为可编辑乐谱";
  const busy = program.checking || program.changing;
  const supported = program.status?.supported !== false;
  const source = { selected: "手动选择", environment: "环境设置", installed: "自动查找" };
  return <section className="external-program" aria-label={`${name} 程序设置`} aria-busy={busy}>
    <div className="external-program-heading">
      <div><strong>{name}</strong><span>{description}</span></div>
      <span className={`external-program-badge ${program.status?.available ? "available" : "unavailable"}`}>
        {busy ? <LoaderCircle size={14} className="external-program-spinner" /> : program.status?.available ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
        {program.changing ? "正在设置" : program.checking ? "正在检查" : program.status?.available ? "可用" : program.error ? "检查未完成" : program.status ? supported ? "需要设置" : "系统入口" : "等待检查"}
      </span>
    </div>
    <p className="external-program-status" role="status">{program.status?.message || (program.error ? "程序检查未完成，可重新检查或选择本机程序。" : "正在检查本机程序…")}</p>
    {program.status?.path && <details className="external-program-location"><summary>{program.status.source ? source[program.status.source] : "程序位置"} · 查看完整路径</summary><code>{program.status.path}</code></details>}
    {program.error && <p className="external-program-error" role="alert">{program.error}</p>}
    {program.message && <p className="external-program-notice" role="status">{program.message}</p>}
    <div className="external-program-actions">
      {supported && <button type="button" disabled={disabled || busy} onClick={() => void program.select()}><FolderOpen size={15} />选择程序</button>}
      <button type="button" disabled={disabled || busy} onClick={() => void program.refresh()}><RefreshCw size={15} />重新检查</button>
      {program.status?.source === "selected" && <button type="button" disabled={disabled || busy} onClick={() => void program.reset()}>恢复自动查找</button>}
    </div>
  </section>;
}
