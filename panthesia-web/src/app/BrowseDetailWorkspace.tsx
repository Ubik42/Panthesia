import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

export interface BrowseDetailSection<Id extends string> {
  id: Id;
  label: string;
  content: ReactNode;
  count?: number;
}

/** Keep primary actions visible while each detail section retains its editors. */
export function BrowseDetailWorkspace<Id extends string>({
  header,
  sections,
  value,
  change,
  label,
}: {
  header: ReactNode;
  sections: readonly BrowseDetailSection<Id>[];
  value: Id;
  change: (id: Id) => void;
  label: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const active = sections.some((section) => section.id === value)
    ? value
    : sections[0]?.id;
  useLayoutEffect(() => {
    const region = tabs.current;
    if (!region) return;
    const reveal = () => {
      if (!region.getClientRects().length) return;
      const button = region.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      );
      if (!button) return;
      if (button.offsetLeft < region.scrollLeft)
        region.scrollLeft = button.offsetLeft;
      else if (
        button.offsetLeft + button.offsetWidth >
        region.scrollLeft + region.clientWidth
      )
        region.scrollLeft =
          button.offsetLeft + button.offsetWidth - region.clientWidth;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(region);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    const node = heading.current;
    if (!node) return;
    const update = () => {
      const region = root.current;
      if (!region || !node.getClientRects().length) return;
      region.style.setProperty(
        "--browse-detail-heading-height",
        `${node.offsetHeight}px`,
      );
      if (region.clientWidth <= 370)
        region.setAttribute("data-detail-narrow", "");
      else region.removeAttribute("data-detail-narrow");
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  const activate = (next: Id) => {
    change(next);
    tabs.current
      ?.querySelector<HTMLButtonElement>(`[data-detail-section="${next}"]`)
      ?.focus({ preventScroll: true });
  };
  return (
    <div className="browse-detail-workspace" ref={root}>
      <div className="browse-detail-masthead" ref={heading}>
        {header}
        <div
          role="tablist"
          className="browse-detail-tabs"
          aria-label={label}
          ref={tabs}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.nativeEvent.isComposing ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const index = sections.findIndex(
              (section) => section.id === active,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? sections.length - 1
                  : (index +
                      (event.key === "ArrowLeft" ? -1 : 1) +
                      sections.length) %
                    sections.length;
            if (sections[next]) activate(sections[next].id);
          }}
        >
          {sections.map((section) => (
            <button
              key={section.id}
              id={`${id}-${section.id}-tab`}
              role="tab"
              data-detail-section={section.id}
              aria-selected={active === section.id}
              aria-controls={`${id}-${section.id}-panel`}
              tabIndex={active === section.id ? 0 : -1}
              onClick={() => activate(section.id)}
            >
              {section.label}
              {section.count != null && (
                <span className="browse-detail-tab-count">{section.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      {sections.map((section) => (
        <section
          key={section.id}
          role="tabpanel"
          className="browse-detail-section"
          id={`${id}-${section.id}-panel`}
          aria-labelledby={`${id}-${section.id}-tab`}
          hidden={active !== section.id}
          tabIndex={0}
        >
          {section.content}
        </section>
      ))}
    </div>
  );
}
