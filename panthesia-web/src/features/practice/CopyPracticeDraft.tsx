import "./catalog.css";
import { useRef, useState } from "react";

/** Copy the captured payload; a later edit never receives the older copy's success label. */
export function CopyPracticeDraft({
  value,
  label = "复制当前输入",
  plainText = false,
  createText,
  disabled = false,
}: {
  value: unknown;
  label?: string;
  plainText?: boolean;
  /** Build large text only on click; value is its immutable identity for the result label. */
  createText?: () => string;
  disabled?: boolean;
}) {
  const payload = createText
    ? null
    : plainText && typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  const source = createText ? value : payload;
  const working = useRef(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState<{
    source: unknown;
    error?: string;
  } | null>(null);
  return (
    <div className="practice-draft-copy">
      <button
        disabled={copying || disabled}
        onClick={() => {
          if (working.current || disabled) return;
          working.current = true;
          setCopying(true);
          setResult(null);
          try {
            const text = createText ? createText() : payload;
            if (typeof text !== "string") throw new Error("复制内容无效");
            void navigator.clipboard
              .writeText(text)
              .then(() => setResult({ source }))
              .catch(() =>
                setResult({ source, error: "复制失败，输入仍在，请重试。" }),
              )
              .finally(() => {
                working.current = false;
                setCopying(false);
              });
          } catch {
            setResult({ source, error: "复制失败，输入仍在，请重试。" });
            working.current = false;
            setCopying(false);
          }
        }}
      >
        {copying ? "正在复制…" : label}
      </button>
      {result && result.source === source && (
        <span role={result.error ? "alert" : "status"}>
          {result.error ?? "已复制，可粘贴到文本文件保存。"}
        </span>
      )}
    </div>
  );
}
