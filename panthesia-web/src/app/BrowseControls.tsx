import { Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import "./browsePanes.css";

export function BrowseControls({
  compact,
  expanded,
  toggle,
  activeCount,
  label,
  query,
  placeholder,
  disabled,
  change,
  searchOptions,
  children,
}: {
  compact: boolean;
  expanded: boolean;
  toggle: () => void;
  activeCount: number;
  label: string;
  query: string;
  placeholder: string;
  disabled: boolean;
  change: (query: string) => void;
  searchOptions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="browse-search-controls">
      <div className="browse-search-line">
        {searchOptions}
        <label className="browse-search-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            aria-label={label}
            value={query}
            placeholder={placeholder}
            disabled={disabled}
            maxLength={4096}
            onChange={(event) => change(event.target.value)}
          />
        </label>
        {query && (
          <button
            className="browse-clear-query"
            disabled={disabled}
            aria-label={`清除${label}`}
            onClick={() => {
              change("");
              input.current?.focus();
            }}
          >
            <X size={15} />
            <span>清除</span>
          </button>
        )}
        {compact && (
          <button
            disabled={disabled}
            aria-expanded={expanded}
            aria-controls={id}
            onClick={toggle}
            className={expanded ? "selected" : undefined}
          >
            <SlidersHorizontal size={16} />
            筛选与排序
            {activeCount > 0 && (
              <span className="browse-filter-count">{activeCount}</span>
            )}
          </button>
        )}
      </div>
      <fieldset
        id={id}
        className="browse-controls-fields"
        aria-label="筛选与排序选项"
        disabled={disabled}
        hidden={compact && !expanded}
      >
        {children}
      </fieldset>
    </div>
  );
}
