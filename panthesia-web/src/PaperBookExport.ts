import { annotatedPagePng } from "./PaperPageExport";
import type { PaperAnnotation } from "./PaperAnnotations";
import { createPdfWorker } from "./features/scores/pdfWorkerClient";

/** render() returns an independent page snapshot owned by this export. */
export async function annotatedBookPdf({
  name,
  pages,
  rotation,
  render,
  annotations,
  progress,
  cancelled,
  signal,
}: {
  name: string;
  pages: number;
  rotation: number;
  render: (page: number) => Promise<HTMLCanvasElement>;
  annotations: (page: number) => PaperAnnotation[];
  progress: (page: number, total: number) => void;
  cancelled: () => boolean;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 200)
    throw new Error("整本导出支持 1 至 200 页，请拆分较长的谱本后导出。");
  const check = () => {
    if (cancelled() || signal?.aborted)
      throw new DOMException("整本导出已停止，原谱与批注保留。", "AbortError");
  };
  check();
  const session = createPdfWorker(signal);
  try {
    const capability = await session.send({
      type: "start",
      name,
      pages,
      mode: "annotated",
      rotation,
    });
    for (let page = 1; page <= pages; page++) {
      check();
      progress(page, pages);
      const source = await render(page);
      try {
        check();
        const notes = annotations(page);
        if (capability.canAnnotate && typeof createImageBitmap === "function") {
          const bitmap = await createImageBitmap(source);
          try {
            check();
            await session.send(
              { type: "annotatedPage", index: page - 1, bitmap, notes },
              [bitmap],
            );
          } finally {
            bitmap.close();
          }
        } else {
          const blob = await annotatedPagePng(
            source,
            notes,
            name,
            page,
            rotation,
          );
          check();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await session.send(
            { type: "page", index: page - 1, kind: "png", bytes },
            [bytes.buffer],
          );
        }
      } finally {
        source.width = 0;
        source.height = 0;
      }
    }
    check();
    const result = await session.send({ type: "finish" });
    check();
    if (!result.bytes?.length)
      throw new Error("整本批注 PDF 没有生成有效内容，请重试。");
    return result.bytes;
  } finally {
    session.dispose();
  }
}
