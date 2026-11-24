import { useState } from "react";
import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/components";
import "./inkMergeReview.css";
import type { PaperAnnotation } from "./PaperAnnotations";
import { applyInkMerge, type InkReview } from "./paperInkMerge";
const colors: Record<string, string> = {
  red: "#ba5050",
  yellow: "#c69a20",
  blue: "#3679b9",
  green: "#35845d",
};
function InkPreview({ note }: { note: PaperAnnotation | null }) {
  if (!note) return <p>已擦除此笔</p>;
  const w = note.width!,
    h = note.height!,
    scale = Math.min(160 / w, 80 / h);
  return (
    <>
      <svg
        width="180"
        height="100"
        viewBox="0 0 180 100"
        aria-label="笔迹形状预览"
      >
        <path
          d={note
            .ink!.points.map(
              (p, i) =>
                `${i ? "L" : "M"}${10 + p[0] * w * scale} ${10 + p[1] * h * scale}`,
            )
            .join(" ")}
          fill="none"
          stroke={colors[note.color]}
          strokeWidth={Math.max(1, Math.min(6, note.ink!.thickness * scale))}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {note.text && <p>{note.text}</p>}
    </>
  );
}
export function InkMergeReview({
  review,
  apply,
  close,
}: {
  review: InkReview;
  apply: (strokes: PaperAnnotation[]) => void;
  close: () => void;
}) {
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<Record<string, "saved" | "local">>({});
  const pages = Math.ceil(review.conflicts.length / 10);
  return (
    <Dialog
      title="核对笔迹更改"
      subtitle={`已保存 ${review.current.length} 笔 · 本机草稿合并后 ${applyInkMerge(review, choices).length} 笔`}
      closeLabel="关闭笔迹核对"
      close={close}
      keepOnBackdrop
      wide
      className="ink-merge-dialog"
      footer={
        <>
          <Button onClick={close}>返回手写草稿</Button>
          <Button variant="primary" onClick={() => apply(applyInkMerge(review, choices))}>
            合并到草稿
          </Button>
        </>
      }
    >
      <p>
        未冲突的新增、修改和擦除会合并。
        {review.conflicts.length
          ? `${review.conflicts.length} 笔有不同改动，请逐笔选择；默认保留已保存版本。`
          : "当前没有同笔冲突，可将更改合并回草稿。"}
        合并后先查看谱页，再保存。
      </p>
      {pages > 1 && (
        <div className="ink-merge-pages">
          <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            上一页笔迹冲突
          </Button>
          <span>
            {page + 1} / {pages} 页
          </span>
          <Button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            下一页笔迹冲突
          </Button>
        </div>
      )}
      <div className="ink-merge-conflicts">
        {review.conflicts.slice(page * 10, (page + 1) * 10).map((c, i) => (
          <fieldset key={c.id}>
            <legend>笔迹冲突 {page * 10 + i + 1}</legend>
            <div className="ink-merge-options">
              {(["saved", "local"] as const).map((kind) => (
                <label key={kind}>
                  <input
                    type="radio"
                    name={`ink-conflict-${c.id}`}
                    aria-label={`${kind === "saved" ? "保留已保存" : "采用本机草稿"}笔迹 ${page * 10 + i + 1}`}
                    checked={(choices[c.id] ?? "saved") === kind}
                    onChange={() => setChoices({ ...choices, [c.id]: kind })}
                  />
                  {kind === "saved" ? "已保存版本" : "本机草稿"}
                  <InkPreview note={kind === "saved" ? c.saved : c.local} />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
