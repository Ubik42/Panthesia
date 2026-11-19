import { X } from "lucide-react";
import "./browseFilterChips.css";
export interface BrowseFilterChip {
  id: string;
  label: string;
  remove: () => void;
}
export function BrowseFilterChips({
  chips,
  reset,
  disabled = false,
}: {
  chips: BrowseFilterChip[];
  reset: () => void;
  disabled?: boolean;
}) {
  if (!chips.length) return null;
  return (
    <div className="browse-filter-chips" aria-label="已启用的筛选">
      <span>当前筛选</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          disabled={disabled}
          title={`移除筛选：${chip.label}`}
          aria-label={`移除筛选：${chip.label}`}
          onClick={chip.remove}
        >
          <span>{chip.label}</span>
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      <button
        className="browse-filter-reset"
        disabled={disabled}
        onClick={reset}
      >
        清除筛选
      </button>
    </div>
  );
}
