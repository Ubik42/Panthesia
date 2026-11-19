import { useId, useRef, type ReactNode } from "react";

export type PracticeInspectorTab = "setup" | "tools" | "results";
const tabs = [
  { id: "setup", label: "练习参数" },
  { id: "tools", label: "进阶设置" },
  { id: "results", label: "本轮记录" },
] as const;

export function PracticeInspectorTabs({
  value,
  change,
  setup,
  tools,
  results,
}: {
  value: PracticeInspectorTab;
  change: (tab: PracticeInspectorTab) => void;
  setup: ReactNode;
  tools: ReactNode;
  results: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const content = { setup, tools, results };
  return (
    <div className="practice-inspector-pages">
      <div
        className="practice-inspector-tabs"
        role="tablist"
        aria-label="练习设置分类"
        ref={root}
        onKeyDown={(event) => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          event.preventDefault();
          const index = tabs.findIndex((tab) => tab.id === value);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
                  tabs.length;
          change(tabs[next].id);
          root.current
            ?.querySelector<HTMLButtonElement>(
              `[data-practice-tab="${tabs[next].id}"]`,
            )
            ?.focus();
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${id}-${tab.id}`}
            role="tab"
            data-practice-tab={tab.id}
            aria-selected={value === tab.id}
            aria-controls={`${id}-${tab.id}-panel`}
            tabIndex={value === tab.id ? 0 : -1}
            data-dialog-initial-focus={value === tab.id || undefined}
            onClick={() => change(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Keep editor drafts mounted when moving between inspector pages. */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${id}-${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab.id}`}
          className="practice-inspector-page"
          hidden={value !== tab.id}
          tabIndex={0}
        >
          {content[tab.id]}
        </div>
      ))}
    </div>
  );
}
