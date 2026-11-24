import { product } from "../product.generated";
import { Copy, FolderOpen, Info, RefreshCw } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/components";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  buildReportText,
  frontendBuildIdentity,
  type DesktopBuildReport,
} from "../engine/buildIdentity";
import "./aboutDialog.css";

export function AboutDialog({ close }: { close: () => void }) {
  const [report, setReport] = useState<DesktopBuildReport | null>(null);
  const [reading, setReading] = useState(api.desktop);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [fallback, setFallback] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true),
    generation = useRef(0);
  const read = async () => {
    const request = ++generation.current;
    setReading(true);
    setError("");
    setFallback("");
    setNotice("");
    try {
      const result = await api.desktopBuildInfo();
      if (!result) throw new Error("桌面程序暂未返回版本信息，请重新读取。");
      if (alive.current && request === generation.current) setReport(result);
    } catch (failure) {
      if (alive.current && request === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (alive.current && request === generation.current) setReading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (api.desktop) void read();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (fallback) {
      field.current?.focus();
      field.current?.select();
    }
  }, [fallback]);
  const identity = report?.identity ?? frontendBuildIdentity;
  const mismatch =
    !!report &&
    ((!!report.identity.buildId &&
      !!frontendBuildIdentity?.buildId &&
      report.identity.buildId !== frontendBuildIdentity.buildId) ||
      (!!report.identity.sourceFingerprint &&
        !!frontendBuildIdentity?.sourceFingerprint &&
        report.identity.sourceFingerprint !==
          frontendBuildIdentity.sourceFingerprint));
  const reportText = [
    buildReportText(report, api.desktop),
    error && `读取错误：${error}`,
  ]
    .filter(Boolean)
    .join("\n");
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    setNotice("");
    const text = reportText;
    try {
      await navigator.clipboard.writeText(text);
      if (alive.current) {
        setNotice("版本信息已复制。");
        setFallback("");
      }
    } catch {
      if (alive.current) {
        setFallback(text);
        setNotice("可以在下方选取并复制版本信息。");
      }
    } finally {
      if (alive.current) setCopying(false);
    }
  };
  const openFolder = async () => {
    if (openingFolder) return;
    setOpeningFolder(true);
    setActionError("");
    try {
      await api.openDataFolder();
    } catch (failure) {
      if (alive.current)
        setActionError(
          failure instanceof Error ? failure.message : String(failure),
        );
    } finally {
      if (alive.current) setOpeningFolder(false);
    }
  };
  return (
    <Dialog title={`关于 ${product.name}`} subtitle="本机钢琴练习室" closeLabel="关闭版本信息" close={close} className="about-dialog">
        <div className="about-version">
          <span>
            <Info size={24} aria-hidden="true" />
          </span>
          <div>
            <strong>
              {api.desktop && !report
                ? `${product.name} · 版本待核对`
                : `${product.name} ${identity?.version ?? "版本未登记"}`}
            </strong>
            <p>
              {report
                ? "中文桌面版"
                : api.desktop
                  ? reading
                    ? "正在读取桌面版本"
                    : "桌面版本暂未读齐"
                  : "浏览器界面"}
              {identity?.revision && ` · ${identity.revision.slice(0, 10)}`}
            </p>
          </div>
        </div>
        {mismatch && (
          <p className="about-warning" role="alert">
            当前界面与桌面程序来自不同构建。请关闭本窗口并从同一份完整运行包重新打开。
          </p>
        )}
        {reading && (
          <p className="about-status" role="status">
            正在读取实际运行程序的信息…
          </p>
        )}
        {error && (
          <div className="about-warning" role="alert">
            <p>{error}</p>
            <Button icon={RefreshCw} disabled={reading} onClick={() => void read()}>
              重新读取
            </Button>
          </div>
        )}
        <dl className="about-facts">
          <div>
            <dt>{api.desktop && !report ? "界面构建时间" : "构建时间"}</dt>
            <dd>
              {identity?.builtAt
                ? new Date(identity.builtAt).toLocaleString("zh-CN")
                : "未登记"}
            </dd>
          </div>
          <div>
            <dt>{api.desktop && !report ? "界面来源" : "程序来源"}</dt>
            <dd>
              {identity?.revision
                ? identity.dirty === true
                  ? "源码提交包含本地修改"
                  : identity.dirty === false
                    ? "已保存的源码提交"
                    : "源码状态未登记"
                : identity?.sourceFingerprint
                  ? "已记录本机源码内容"
                  : "直接构建，未登记源码来源"}
            </dd>
          </div>
          <div>
            <dt>练习资料</dt>
            <dd>
              {report?.dataRoot ??
                (api.desktop
                  ? "读取后显示本机位置"
                  : "由当前音乐服务保存在本机")}
            </dd>
          </div>
        </dl>
        <div className="about-actions">
          <Button variant="primary" icon={Copy} disabled={copying || reading} onClick={() => void copy()}>
            {copying
              ? "正在复制…"
              : error && !report
                ? "复制已有信息与错误"
                : "复制版本信息"}
          </Button>
          {api.desktop && (
            <Button icon={FolderOpen} disabled={openingFolder} onClick={() => void openFolder()}>
              {openingFolder ? "正在打开…" : "打开资料文件夹"}
            </Button>
          )}
        </div>
        {actionError && (
          <p className="about-warning" role="alert">
            资料文件夹暂未打开：{actionError}
          </p>
        )}
        {notice && (
          <p className="about-status" role="status">
            {notice}
          </p>
        )}
        {fallback && (
          <textarea
            ref={field}
            className="about-copy-fallback"
            aria-label="可复制的版本信息"
            readOnly
            rows={9}
            value={fallback}
          />
        )}
        <details className="about-details">
          <summary>构建与位置详情</summary>
          <pre>{reportText}</pre>
          <p>复制内容包含版本、源码来源与本机文件位置。</p>
        </details>
        <p className="about-footer">
          {api.desktop
            ? report
              ? "移动软件时请保留完整运行包及随包音源。已保存的记录与计划保存在上方的资料位置。"
              : "移动软件时请保留完整运行包及随包音源。重新读取版本信息后可查看练习资料的位置。"
            : "练习记录与计划由本机音乐服务保存。关闭浏览器后，下次连接同一服务可继续使用。"}
        </p>
    </Dialog>
  );
}
