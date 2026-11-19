import type { ReactNode } from "react";
import { ToolbarMore } from "./ToolbarMore";
export function ApplicationMenu({
  groups,
  disabled,
}: {
  groups: { label: string; content: ReactNode }[];
  disabled: boolean;
}) {
  return (
    <nav className="application-menubar" aria-label="应用菜单">
      {groups.map((group) => (
        <ToolbarMore key={group.label} label={group.label} disabled={disabled}>
          {group.content}
        </ToolbarMore>
      ))}
    </nav>
  );
}
