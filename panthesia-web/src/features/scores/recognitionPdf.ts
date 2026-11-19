import { api } from "../../api";
import type { PaperAttachment } from "./paperTypes";
import { createPdfWorker } from "./pdfWorkerClient";

async function webpForRecognition(
  bytes: Uint8Array,
  pageNumber: number,
  losslessBudget: number,
): Promise<{ bytes: Uint8Array; kind: "png" | "jpeg" }> {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: "image/webp" }),
  );
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    if (
      !source.naturalWidth ||
      !source.naturalHeight ||
      source.naturalWidth > 16_384 ||
      source.naturalHeight > 16_384 ||
      source.naturalWidth * source.naturalHeight > 40_000_000
    )
      throw new Error(
        `第 ${pageNumber} 页图片尺寸过大。请缩小图片后重新导入。`,
      );
    const canvas = document.createElement("canvas");
    try {
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(`第 ${pageNumber} 页无法转换 WebP 图片。`);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0);
      const encode = (kind: "image/png" | "image/jpeg") =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (result) =>
              result
                ? resolve(result)
                : reject(new Error(`第 ${pageNumber} 页无法转换 WebP 图片。`)),
            kind,
            kind === "image/jpeg" ? 0.98 : undefined,
          ),
        );
      if (losslessBudget > 0) {
        const png = await encode("image/png");
        if (
          png.type === "image/png" &&
          png.size <= Math.min(8_000_000, losslessBudget)
        )
          return {
            bytes: new Uint8Array(await png.arrayBuffer()),
            kind: "png",
          };
      }
      const jpeg = await encode("image/jpeg");
      if (jpeg.type !== "image/jpeg")
        throw new Error(`第 ${pageNumber} 页无法转换为识谱图片。`);
      return { bytes: new Uint8Array(await jpeg.arrayBuffer()), kind: "jpeg" };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function recognitionPdf(
  contentId: string,
  attachment: PaperAttachment,
  report: (message: string) => void,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  const cancelled = () =>
    new DOMException("已停止整理图片，原谱页保留。", "AbortError");
  const check = () => {
    if (signal?.aborted) throw cancelled();
  };
  check();
  if (
    attachment.format !== "images" ||
    (attachment.pages.length === 1 && attachment.pages[0].kind !== "webp")
  )
    return undefined;
  if (!attachment.pages.length || attachment.pages.length > 80)
    throw new Error("图片谱页数无效，最多支持 80 页。");
  const total = attachment.pages.reduce((size, page) => size + page.size, 0);
  const limit = attachment.pages.length === 1 ? 48_000_000 : 32_000_000;
  if (total > limit)
    throw new Error(
      `这份图片谱超过 ${limit / 1_000_000} MB，请分成较小的谱本再识别。`,
    );
  const session = createPdfWorker(signal);
  const send = session.send;
  try {
    let progress = await send({
      type: "start",
      name: attachment.name,
      pages: attachment.pages.length,
    });
    for (const [index, page] of attachment.pages.entries()) {
      check();
      report(`正在整理第 ${index + 1} / ${attachment.pages.length} 页图片…`);
      const source = await api.readScoreAttachment(
        contentId,
        attachment.id,
        index,
        undefined,
        page.id,
      );
      check();
      const { bytes, kind } =
        page.kind === "webp" && !progress.canWebp
          ? await webpForRecognition(
              source,
              index + 1,
              Math.max(0, 28_000_000 - (progress.embeddedBytes ?? 0)),
            )
          : { bytes: source, kind: page.kind };
      check();
      progress = await send({ type: "page", index, kind, bytes }, [
        bytes.buffer as ArrayBuffer,
      ]);
    }
    report("正在生成识谱 PDF…");
    const result = await send({ type: "finish" });
    check();
    if (!result.bytes?.length)
      throw new Error("图片组页没有生成有效 PDF，请重试。");
    return result.bytes;
  } finally {
    session.dispose();
  }
}
