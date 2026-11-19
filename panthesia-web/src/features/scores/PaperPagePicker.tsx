import { useEffect, useRef, useState } from "react";
import "./paperReaderControls.css";

/** Keep incomplete input local; only an explicit commit turns the page. */
export function PaperPagePicker({
  page,
  count,
  disabled,
  navigate,
}: {
  page: number;
  count: number;
  disabled: boolean;
  navigate: (page: number) => boolean;
}) {
  const [text, setText] = useState(String(page)),
    [error, setError] = useState("");
  const editing = useRef(false),
    current = useRef(page);
  current.current = page;
  useEffect(() => {
    if (!editing.current) {
      setText(String(page));
      setError("");
    }
  }, [page]);
  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    const target = text.trim() ? Number(text) : NaN;
    if (!Number.isSafeInteger(target) || target < 1 || target > count) {
      setError(`请输入 1–${count} 之间的页码。`);
      return;
    }
    if (target === current.current) {
      setText(String(current.current));
      setError("");
      return;
    }
    if (navigate(target)) setError("");
    else setError("请先完成当前编辑，再跳转谱页。");
  };
  return (
    <label className="paper-page-picker">
      第{" "}
      <input
        aria-label="谱页页码"
        aria-invalid={!!error}
        title={error || "输入页码后按 Enter 或移开焦点跳转"}
        type="number"
        min={1}
        max={count || 1}
        value={text}
        disabled={!count || disabled}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => {
          editing.current = true;
          setText(event.target.value);
          setError("");
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            editing.current = false;
            setText(String(current.current));
            setError("");
            event.currentTarget.blur();
          }
        }}
      />{" "}
      / {count || "…"} 页
      {error && (
        <span role="status" className="paper-page-input-error">
          {error}
        </span>
      )}
    </label>
  );
}
