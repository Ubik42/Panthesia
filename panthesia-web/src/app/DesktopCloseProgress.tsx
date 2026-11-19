import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { returnFromDesktopClose, decideDesktopClose } from "./useDesktopClose";
import type { DesktopCloseStatus, DesktopCloseIssue } from "../engine/commands.generated";
import "./desktopClose.css";

export function DesktopCloseProgress({ status, issues, error, returning }: {
  status: DesktopCloseStatus | null; issues: DesktopCloseIssue[]; error: string; returning: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!status || !root.current) return;
    const host = root.current, previous = document.activeElement as HTMLElement | null;
    const changed = new Map<HTMLElement, boolean>();
    const protect = () => {
      for (const child of document.body.children) {
        if (!(child instanceof HTMLElement) || child === host || child.contains(host)) continue;
        if (!changed.has(child)) { changed.set(child, child.inert); child.inert = true; }
      }
    };
    protect();
    const observer = new MutationObserver(protect); observer.observe(document.body, { childList: true });
    host.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { observer.disconnect(); for (const [child, inert] of changed) child.inert = inert; if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true }); };
  }, [status?.id]);
  if (!status) return null;
  return createPortal(<div className="desktop-close-backdrop" ref={root}>
    <section className="desktop-close-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-close-title" aria-describedby="desktop-close-description">
      <div className="desktop-close-icon" aria-hidden="true"><ShieldCheck size={28} /></div>
      <div className="desktop-close-heading"><span>PANTHESIA · 练习室</span><h2 id="desktop-close-title">{returning ? "正在返回窗口" : status.phase === "reviewing" ? "退出前确认" : "正在保存并退出"}</h2></div>
      <p id="desktop-close-description" role="status">{(returning || status.phase !== "reviewing") && <LoaderCircle className="desktop-close-spinner" size={17} />}{returning ? "正在返回窗口，已开始的保存会继续完成。" : status.message}</p>
      <ol className="desktop-close-steps" aria-label="退出准备步骤">
        <li className={status.phase === "preparing" ? "current" : "complete"}>保留编辑输入</li>
        <li className={status.phase === "saving" ? "current" : ["finalizing", "reviewing"].includes(status.phase) ? "complete" : ""}>保存练习与文件</li>
        <li className={["finalizing", "reviewing"].includes(status.phase) ? "current" : ""}>确认保存状态</li>
      </ol>
      {issues.length > 0 && <div className="desktop-close-issues"><strong>退出前需要确认</strong><ul>{issues.map((issue, index) => <li key={`${issue.key}-${index}`}><span>{issue.label}</span>{issue.detail}</li>)}</ul></div>}
      {error && <p className="desktop-close-error" role="alert">{error}</p>}
      <footer><small>已写入的文件与恢复资料会保留。</small>{status.phase === "reviewing" && <><button type="button" disabled={returning} onClick={()=>void decideDesktopClose("retry")}>重试保存</button><button type="button" disabled={returning} onClick={()=>void decideDesktopClose("close")}>{issues.some(i=>!i.kind || i.kind==="temporary")?"放弃未保存内容并退出":"保留现有资料并退出"}</button></>}<button type="button" disabled={returning} onClick={() => void returnFromDesktopClose()}>{returning ? "正在返回…" : "返回窗口"}</button></footer>
    </section>
  </div>, document.body);
}
