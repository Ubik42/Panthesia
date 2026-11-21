import { PDFDocument } from "pdf-lib";
import { annotatedPageCanvas } from "./PaperPageExport";
import type { PaperAnnotation } from "./PaperAnnotations";

export type RecognitionPdfRequest =
  | {
      id: number;
      type: "start";
      name: string;
      pages: number;
      mode?: "recognition" | "annotated";
      rotation?: number;
    }
  | { id: number; type: "page"; index: number; kind: string; bytes: Uint8Array }
  | {
      id: number;
      type: "annotatedPage";
      index: number;
      bitmap: ImageBitmap;
      notes: PaperAnnotation[];
      imageOnly?: boolean;
      pageNumber?: number;
    }
  | { id: number; type: "finish" };
export type RecognitionPdfReply = {
  id: number;
  error?: string;
  bytes?: Uint8Array;
  canWebp?: boolean;
  embeddedBytes?: number;
  canAnnotate?: boolean;
};

let document: PDFDocument | undefined;
let expected = 0,
  received = 0,
  embeddedBytes = 0;
const LIMIT = 32_000_000;
let annotated = false,
  rotation = 0,
  title = "";
const channel = self as unknown as {
  onmessage: ((event: MessageEvent<RecognitionPdfRequest>) => void) | null;
  postMessage: (
    reply: RecognitionPdfReply,
    options?: { transfer: Transferable[] },
  ) => void;
};
function checkPng(bytes: Uint8Array, page: number) {
  const invalid = () =>
    new Error(`第 ${page} 页 PNG 内容不完整，请重新导入该页。`);
  if (bytes.length < 33) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452
  )
    throw invalid();
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (
    !width ||
    !height ||
    width > 60_000 ||
    height > 60_000 ||
    width * height > 64_000_000
  )
    throw new Error(`第 ${page} 页 PNG 尺寸过大，请缩小图片后重新导入。`);
  // pdf-lib inflates all PNG frames before rejecting animated files.
  // Inspect chunk lengths and animation count before it allocates the pixels.
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = view.getUint32(offset),
      type = view.getUint32(offset + 4);
    const end = offset + size + 12;
    if (end > bytes.length) throw invalid();
    if (type === 0x6163544c) {
      if (size !== 8) throw invalid();
      if (view.getUint32(offset + 8) > 1)
        throw new Error(
          `第 ${page} 页是动画 PNG，请先导出一张静态图片再识别。`,
        );
    }
    if (type === 0x49454e44) {
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended) throw invalid();
}
async function webp(bytes: Uint8Array, number: number) {
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  )
    throw new Error(
      "当前浏览器无法在后台转换 WebP。请先将该页转成 PNG 或 JPEG 后再识别。",
    );
  const bitmap = await createImageBitmap(
    new Blob([bytes.slice().buffer], { type: "image/webp" }),
  );
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 16_384 ||
      bitmap.height > 16_384 ||
      bitmap.width * bitmap.height > 40_000_000
    )
      throw new Error(`第 ${number} 页图片尺寸过大，请缩小图片后重新导入。`);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error(`第 ${number} 页无法转换 WebP 图片。`);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, bitmap.width, bitmap.height);
      context.drawImage(bitmap, 0, 0);
      const budget = Math.min(
        8_000_000,
        Math.max(0, 28_000_000 - embeddedBytes),
      );
      if (budget) {
        const png = await canvas.convertToBlob({ type: "image/png" });
        if (png.type === "image/png" && png.size <= budget)
          return {
            bytes: new Uint8Array(await png.arrayBuffer()),
            kind: "png",
          };
      }
      const jpeg = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.98,
      });
      if (jpeg.type !== "image/jpeg")
        throw new Error(`第 ${number} 页无法转换为识谱图片。`);
      return { bytes: new Uint8Array(await jpeg.arrayBuffer()), kind: "jpeg" };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
async function handle(
  request: RecognitionPdfRequest,
): Promise<RecognitionPdfReply> {
  if (request.type === "annotatedPage") {
    if (
      !document ||
      !annotated ||
      request.index !== received ||
      typeof OffscreenCanvas === "undefined"
    ) {
      request.bitmap.close();
      throw new Error("批注 PDF 后台状态已改变，请重新导出。");
    }
    try {
      const pageNumber = request.pageNumber ?? received + 1;
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1)
        throw new Error("导出页码无效，请重新读取谱面。");
      const output = annotatedPageCanvas(
        request.bitmap,
        request.notes,
        title,
        pageNumber,
        rotation,
        () => new OffscreenCanvas(1, 1),
      ) as OffscreenCanvas;
      let blob: Blob;
      try {
        blob = await output.convertToBlob({ type: "image/png" });
      } finally {
        output.width = 0;
        output.height = 0;
      }
      if (blob.size > 48_000_000)
        throw new Error("本页批注图像超过 48 MB，请减少批注或拆分谱本。");
      if (request.imageOnly)
        return {
          id: request.id,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      return handle({
        id: request.id,
        type: "page",
        index: request.index,
        kind: "png",
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    } finally {
      request.bitmap.close();
    }
  }
  if (request.type === "start") {
    annotated = request.mode === "annotated";
    if (
      document ||
      !Number.isInteger(request.pages) ||
      request.pages < 1 ||
      request.pages > (annotated ? 200 : 80) ||
      request.name.length > 1024
    )
      throw new Error("图片谱页数或名称无效，请重新打开谱面管理。");
    expected = request.pages;
    received = 0;
    embeddedBytes = 0;
    rotation = request.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation))
      throw new Error("谱面旋转方向无效，请重新打开谱面。");
    title = request.name;
    document = await PDFDocument.create();
    document.setTitle(annotated ? `${request.name} · 个人批注` : request.name);
  } else if (request.type === "page") {
    if (
      !document ||
      request.index !== received ||
      received >= expected ||
      !["png", "jpeg", "webp"].includes(request.kind) ||
      !request.bytes.length ||
      request.bytes.length > 48_000_000
    )
      throw new Error("图片谱页序或内容无效，请重新读取谱页。");
    const number = received + 1;
    const converted =
      request.kind === "webp" ? await webp(request.bytes, number) : request;
    embeddedBytes += converted.bytes.length;
    if (!annotated && embeddedBytes > LIMIT)
      throw new Error("整理后的图片超过 32 MB，请分成较小的谱本再识别。");
    if (converted.kind === "png") checkPng(converted.bytes, number);
    const image =
      converted.kind === "png"
        ? await document.embedPng(converted.bytes)
        : await document.embedJpg(converted.bytes);
    if (annotated) {
      const width = 595,
        height = (image.height * width) / image.width,
        sheetHeight = 842;
      const slices = Math.ceil(height / sheetHeight);
      if (document.getPageCount() + slices > 500)
        throw new Error(
          "批注较长，导出将超过 500 张打印页。请拆分谱本后导出。",
        );
      for (let slice = 0; slice < slices; slice++)
        document.addPage([width, sheetHeight]).drawImage(image, {
          x: 0,
          y: sheetHeight - height + slice * sheetHeight,
          width,
          height,
        });
    } else {
      const width = (image.width * 72) / 300,
        height = (image.height * 72) / 300;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 14_400 ||
        height > 14_400
      )
        throw new Error(`第 ${number} 页的图片尺寸无法用于识谱 PDF。`);
      document
        .addPage([width, height])
        .drawImage(image, { x: 0, y: 0, width, height });
    }
    // pdf-lib releases decoded pixel channels after embed(). Keeping all images
    // pending until save() would retain hundreds of full-resolution pages.
    await image.embed();
    const retainedBytes = document.context
      .enumerateIndirectObjects()
      .reduce((size, [, object]) => size + object.sizeInBytes(), 0);
    if (retainedBytes > (annotated ? 64_000_000 : LIMIT))
      throw new Error(
        annotated
          ? "整本批注 PDF 超过 64 MB，请拆分谱本后导出。"
          : "识谱 PDF 超过 32 MB，请拆分谱本后再识别。",
      );
    received++;
  } else {
    if (!document || received !== expected)
      throw new Error("图片谱尚未全部组成 PDF，请重新读取谱页。");
    const bytes = await document.save();
    if (bytes.length > (annotated ? 64_000_000 : LIMIT))
      throw new Error(
        annotated
          ? "整本批注 PDF 超过 64 MB，请拆分谱本后导出。"
          : "图片组页生成的 PDF 超过 32 MB，请分成较小的谱本再识别。",
      );
    document = undefined;
    return { id: request.id, bytes };
  }
  return {
    id: request.id,
    canWebp:
      typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap !== "undefined",
    embeddedBytes,
    canAnnotate: typeof OffscreenCanvas !== "undefined",
  };
}
// The client submits one page at a time; serialization also protects against late messages.
let queue = Promise.resolve();
channel.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const reply = await handle(data);
      channel.postMessage(
        reply,
        reply.bytes
          ? { transfer: [reply.bytes.buffer as ArrayBuffer] }
          : undefined,
      );
    } catch (failure) {
      document = undefined;
      channel.postMessage({
        id: data.id,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  });
};
