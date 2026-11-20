import { History, Library, Music2 } from "lucide-react";
import { useId } from "react";
import type { Workspace } from "./useWorkspaceNavigation";
import "./workspaces.css";

const workspaces = [
  { id: "library", label: "曲库", accessible: "曲库管理", icon: Library },
  { id: "practice", label: "演奏", accessible: "练习工作区", icon: Music2 },
] as const;

export function WorkspaceNavigation({
  active,
  disabled,
  unavailable,
  pending,
  change,
}: {
  active: Workspace;
  disabled: boolean;
  unavailable?: string | null;
  pending?: Workspace | null;
  change: (workspace: Workspace) => void;
}) {
  const reasonId = useId();
  return (
    <nav
      className="workspace-navigation"
      aria-label="工作区"
      aria-busy={!!pending}
      aria-describedby={disabled && unavailable ? reasonId : undefined}
      onKeyDown={(event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (index < 0 || !buttons.length) return;
        event.preventDefault();
        const target =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowLeft" ? -1 : 1) +
                  buttons.length) %
                buttons.length;
        buttons[target].focus();
      }}
    >
      {workspaces.map(({ id, label, accessible, icon: Icon }) => (
        <button
          key={id}
          aria-label={accessible}
          aria-current={active === id ? "page" : undefined}
          data-pending={pending === id ? "" : undefined}
          title={
            disabled && active !== id
              ? (unavailable ?? undefined)
              : pending === id
                ? "正在切换工作区"
                : undefined
          }
          disabled={disabled && active !== id}
          onClick={() => change(id)}
        >
          <Icon size={17} />
          <span>{label}</span>
        </button>
      ))}
      {disabled && unavailable && (
        <span id={reasonId} className="workspace-navigation-reason">
          {unavailable}
        </span>
      )}
    </nav>
  );
}
