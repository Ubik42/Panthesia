import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./practiceStage.css";

export function PracticeStage({
  combined,
  axis,
  ratio,
  changeRatio,
  children,
}: {
  combined: boolean;
  axis: "auto" | "rows" | "columns";
  ratio: number;
  changeRatio: (value: number) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [automatic, setAutomatic] = useState<"rows" | "columns">("columns");
  const [draft, setDraft] = useState(ratio);
  const drag = useRef<{ pointer: number; value: number } | null>(null);
  useEffect(() => {
    if (!drag.current) setDraft(ratio);
  }, [ratio]);
  useEffect(() => {
    const node = root.current!;
    const observer = new ResizeObserver(() =>
      setAutomatic(
        node.clientWidth > node.clientHeight * 1.7 ? "columns" : "rows",
      ),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const direction = axis === "auto" ? automatic : axis;
  const clamp = (value: number) =>
    Math.max(25, Math.min(75, Math.round(value)));
  const commit = (value: number) => {
    setDraft(value);
    changeRatio(value);
  };
  return (
    <div
      ref={root}
      className="piano-stage practice-stage"
      data-combined={combined}
      data-axis={direction}
      style={{ "--score-share": `${draft}%` } as CSSProperties}
    >
      {children}
      {combined && (
        <div
          className="practice-stage-divider"
          role="separator"
          tabIndex={0}
          aria-label="谱面与瀑布分隔条"
          aria-orientation={direction === "columns" ? "vertical" : "horizontal"}
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={draft}
          aria-valuetext={`谱面占 ${draft}%`}
          title="拖动调整比例；方向键微调，Home / End 调到边界"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            drag.current = { pointer: event.pointerId, value: draft };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointer !== event.pointerId) return;
            const rect = root.current!.getBoundingClientRect();
            const value = clamp(
              100 *
                (direction === "columns"
                  ? (event.clientX - rect.left) / rect.width
                  : (event.clientY - rect.top) / rect.height),
            );
            drag.current.value = value;
            setDraft(value);
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointer !== event.pointerId) return;
            const value = drag.current.value;
            drag.current = null;
            commit(value);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDraft(ratio);
          }}
          onLostPointerCapture={() => {
            if (drag.current) {
              drag.current = null;
              setDraft(ratio);
            }
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 2;
            const values: Record<string, number> = {
              ArrowLeft: draft - step,
              ArrowUp: draft - step,
              ArrowRight: draft + step,
              ArrowDown: draft + step,
              Home: 25,
              End: 75,
            };
            if (event.key === "Escape" && drag.current) {
              event.preventDefault();
              event.stopPropagation();
              drag.current = null;
              setDraft(ratio);
              return;
            }
            if (values[event.key] === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            commit(clamp(values[event.key]));
          }}
        >
          <span />
        </div>
      )}
    </div>
  );
}
