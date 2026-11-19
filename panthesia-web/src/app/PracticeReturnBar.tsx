import { ArrowLeft, History, Library, X } from "lucide-react";
import type { BrowseWorkspace } from "./useWorkspaceNavigation";
import "./practiceReturnBar.css";
export function PracticeReturnBar({
  workspace,
  title,
  context,
  disabled,
  unavailable,
  resume,
  dismiss,
}: {
  workspace: BrowseWorkspace;
  title?: string;
  context?: string;
  disabled: boolean;
  unavailable?: string | null;
  resume: () => void;
  dismiss: () => void;
}) {
  const label = workspace === "review" ? "回顾" : "曲库",
    Icon = workspace === "review" ? History : Library;
  return (
    <div className="practice-return-bar">
      <Icon size={16} aria-hidden="true" />
      <div>
        <strong>
          {workspace === "review" ? "继续查看练习记录" : "继续浏览曲库"}
        </strong>
        <span title={[title, context].filter(Boolean).join(" · ")}>
          {[title, context].filter(Boolean).join(" · ") ||
            "保留了上次的筛选、选择与浏览位置"}
        </span>
      </div>
      <button
        disabled={disabled}
        title={unavailable ?? undefined}
        onClick={resume}
      >
        <ArrowLeft size={14} />
        返回{label}
      </button>
      <button
        className="icon-button"
        aria-label="收起快捷返回"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
