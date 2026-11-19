import { CalendarDays } from "lucide-react";
import "./calendarDateInput.css";

/** Keep incomplete typed dates while a separate native picker supplies complete dates. */
export function CalendarDateInput({
  value,
  change,
  disabled,
  label,
  min = "2000-01-01",
  max = "2200-12-31",
}: {
  value: string;
  change: (value: string) => void;
  disabled: boolean;
  label: string;
  min?: string;
  max?: string;
}) {
  return (
    <span className="calendar-date-input">
      <input
        type="text"
        inputMode="numeric"
        maxLength={10}
        aria-label={label}
        placeholder="YYYY-MM-DD"
        disabled={disabled}
        value={value}
        onChange={(event) => change(event.target.value)}
      />
      <span className="calendar-date-picker">
        <CalendarDays size={16} aria-hidden="true" />
        <input
          type="date"
          aria-label={`用日历选择${label}`}
          min={min}
          max={max}
          disabled={disabled}
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
          onChange={(event) => {
            change(event.target.value);
          }}
        />
      </span>
    </span>
  );
}
