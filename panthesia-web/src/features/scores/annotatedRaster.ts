import { annotatedPagePng } from "./PaperPageExport";
import type { PaperAnnotation } from "./PaperAnnotations";
import { createPdfWorker } from "./pdfWorkerClient";
export async function annotatedRasterPng(
  source: HTMLCanvasElement,
  notes: PaperAnnotation[],
  name: string,
  page: number,
  rotation: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("图片导出已停止，原谱与批注保留。", "AbortError");
  };
  check();
  const session = createPdfWorker(signal);
  try {
    const capability = await session.send({
      type: "start",
      name,
      pages: 1,
      mode: "annotated",
      rotation,
    });
    if (!capability.canAnnotate || typeof createImageBitmap !== "function")
      return await annotatedPagePng(source, notes, name, page, rotation);
    const bitmap = await createImageBitmap(source);
    try {
      check();
      const result = await session.send(
        {
          type: "annotatedPage",
          index: 0,
          bitmap,
          notes,
          imageOnly: true,
          pageNumber: page,
        },
        [bitmap],
      );
      check();
      if (!result.bytes?.length)
        throw new Error("批注图片没有生成有效内容，请重试。");
      return new Blob([result.bytes.slice().buffer], { type: "image/png" });
    } finally {
      bitmap.close();
    }
  } finally {
    session.dispose();
  }
}
