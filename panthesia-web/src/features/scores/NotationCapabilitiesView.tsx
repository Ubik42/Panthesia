import { useState } from "react";
import { inspectNotation } from "../library/repertoireClient";
import type { NotationCapabilities } from "../../engine/commands.generated";
export function NotationCapabilitiesView({
  path,
  contentId,
  versionId,
  blocked,
}: {
  path: string;
  contentId: string;
  versionId: string;
  blocked: boolean;
}) {
  const [report, setReport] = useState<NotationCapabilities | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="notation-capabilities">
      <button
        disabled={busy || blocked}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setReport(await inspectNotation(path, contentId, versionId));
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在检查谱面…" : "查看显示、播放与导出能力"}
      </button>
      {report && (
        <>
          <p>
            {report.format} · {report.parts} 个声部 · {report.writtenNotes}{" "}
            个书面音符{report.exporter ? ` · ${report.exporter}` : ""}
          </p>
          <dl>
            {(
              [
                ["显示", report.display],
                ["分析", report.analysis],
                ["播放", report.playback],
                ["编辑", report.editing],
                ["导出", report.export],
                ["音符身份", report.identity],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!!report.preservedOnly.length && (
            <details>
              <summary>来源保留与练习分析的边界</summary>
              <ul>
                {report.preservedOnly.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          )}
          {!!report.formatChanges.length && (
            <p>{report.formatChanges.join("；")}</p>
          )}
          {report.issues.length ? (
            <details open>
              <summary>需核对 {report.issues.length} 项</summary>
              <ul>
                {report.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p>
              当前解析与演奏转换未报告问题。谱面排版和音乐解释仍可对照原谱检查。
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
    </div>
  );
}
