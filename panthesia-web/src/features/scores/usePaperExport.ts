import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api } from "../../api";
import type { PaperAttachment, PaperView } from "./paperTypes";
import { annotatedBookPdf } from "./PaperBookExport";
import { annotatedRasterPng } from "./annotatedRaster";
import { createPaperExportFeedback } from "./PaperExportFeedback";
import { useCloseParticipant } from "../../app/closePreparation";

const exportName = (name: string, suffix: string) => {
  const stem = name
    .replace(/\.(pdf|png|jpe?g|webp|musicxml|mxl|xml)$/i, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();
  return `${Array.from(stem).slice(0, 100).join("") || "乐谱"}-${suffix}`;
};

interface Source {
  contentId: string;
  attachment: PaperAttachment;
  doc: PDFDocumentProxy | null;
  count: number;
  view: PaperView;
  previewKind?: string;
  annotationEditing: boolean;
  selectingRegion: boolean;
  loading: boolean;
  error: string;
  needsPassword: boolean;
  disabled: boolean;
  onStart: () => void;
}
/** Generation reads one immutable source identity; saving owns an already completed snapshot. */
export function usePaperExport({
  contentId,
  attachment,
  doc,
  count,
  view,
  previewKind,
  annotationEditing,
  selectingRegion,
  loading,
  error,
  needsPassword,
  disabled,
  onStart,
}: Source) {
  const [exportBusy, setExportBusy] = useState(false),
    [exportCommitting, setExportCommitting] = useState(false);
  const [feedback] = useState(createPaperExportFeedback);
  const setExportNotice = feedback.update;
  const [preparedBook, setPreparedBook] = useState<{
    name: string;
    bytes: Uint8Array;
    pages: number;
  } | null>(null);
  const [preparedPage, setPreparedPage] = useState<{
    name: string;
    blob: Blob;
    page: number;
  } | null>(null);
  const exportReadsSource = useRef(false);
  const savedArtifacts = useRef(new WeakSet<object>());
  const exportAbort = useRef<AbortController | null>(null);
  const exportLock = useRef(false),
    exportCancelled = useRef(false),
    readerAlive = useRef(true);
  useCloseParticipant("谱页批注导出", () => {
    if (exportLock.current) return "批注图片或 PDF 仍在制作或保存，请等待当前处理结束。";
    if (preparedPage && !savedArtifacts.current.has(preparedPage)) return "已制作的批注图片尚未另存，关闭后这份临时图片会释放。";
    if (preparedBook && !savedArtifacts.current.has(preparedBook)) return "已制作的批注 PDF 尚未另存，关闭后这份临时 PDF 会释放。";
    return null;
  }, () => {
    if (exportReadsSource.current && !exportCommitting) { exportCancelled.current = true; exportAbort.current?.abort("closing"); }
  });
  useEffect(() => {
    readerAlive.current = true;
    return () => {
      readerAlive.current = false;
      exportCancelled.current = true;
      exportAbort.current?.abort();
    };
  }, []);
  const exportIdentity = useMemo(
    () =>
      JSON.stringify([
        contentId,
        attachment.id,
        attachment.name,
        attachment.format,
        attachment.pages.map((page) => [page.id, page.kind]),
        attachment.annotations ?? [],
        previewKind ?? null,
      ]),
    [
      contentId,
      attachment.id,
      attachment.name,
      attachment.format,
      attachment.pages,
      attachment.annotations,
      previewKind,
    ],
  );
  const currentExportIdentity = useRef(exportIdentity);
  currentExportIdentity.current = exportIdentity;
  useEffect(() => {
    if (exportReadsSource.current) exportAbort.current?.abort("sourceChanged");
  }, [exportIdentity]);
  const renderForExport = async (
    pageNumber: number,
    rotation: number,
    signal?: AbortSignal,
  ) => {
    const check = () => {
      if (
        signal?.aborted ||
        !readerAlive.current ||
        currentExportIdentity.current !== exportIdentity
      )
        throw new DOMException(
          "谱页或批注已改变，导出已停止，请重新读取后继续。",
          "AbortError",
        );
    };
    check();
    const asset =
      attachment.format === "pdf"
        ? attachment.pages[0]
        : attachment.pages[pageNumber - 1];
    if (!asset?.available)
      throw new Error(`第 ${pageNumber} 页副本不可用，请先修复谱页`);
    const source = document.createElement("canvas");
    const context = source.getContext("2d");
    if (!context) throw new Error("无法创建导出画布");
    try {
      if (attachment.format === "pdf") {
        if (!doc) throw new Error("PDF 尚未加载完成");
        const pdfPage = await doc.getPage(pageNumber);
        check();
        const base = pdfPage.getViewport({
          scale: 1,
          rotation: (pdfPage.rotate + rotation) % 360,
        });
        const scale = Math.min(
          1800 / base.width,
          Math.sqrt(12_000_000 / (base.width * base.height)),
        );
        const viewport = pdfPage.getViewport({
          scale,
          rotation: (pdfPage.rotate + rotation) % 360,
        });
        source.width = Math.max(1, Math.ceil(viewport.width));
        source.height = Math.max(1, Math.ceil(viewport.height));
        const task = pdfPage.render({
          canvas: source,
          canvasContext: context,
          viewport,
        });
        const abort = () => task.cancel();
        signal?.addEventListener("abort", abort, { once: true });
        try {
          await task.promise;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      } else {
        const bytes = await api.readScoreAttachment(
          contentId,
          attachment.id,
          pageNumber - 1,
          previewKind,
          asset.id,
        );
        check();
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer], { type: `image/${asset.kind}` }),
        );
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          check();
          if (image.naturalWidth * image.naturalHeight > 64_000_000)
            throw new Error(`第 ${pageNumber} 页图片过大，请缩小后导出`);
          const swap = rotation % 180 !== 0;
          const width = swap ? image.naturalHeight : image.naturalWidth;
          const height = swap ? image.naturalWidth : image.naturalHeight;
          const scale = Math.min(
            1800 / width,
            1,
            Math.sqrt(12_000_000 / (width * height)),
          );
          source.width = Math.max(1, Math.ceil(width * scale));
          source.height = Math.max(1, Math.ceil(height * scale));
          context.fillStyle = "#fff";
          context.fillRect(0, 0, source.width, source.height);
          context.translate(source.width / 2, source.height / 2);
          context.rotate((rotation * Math.PI) / 180);
          context.scale(scale, scale);
          context.drawImage(
            image,
            -image.naturalWidth / 2,
            -image.naturalHeight / 2,
          );
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      check();
      return source;
    } catch (failure) {
      source.width = 0;
      source.height = 0;
      throw failure;
    }
  };
  const exportPage = async () => {
    if (
      exportLock.current ||
      annotationEditing ||
      selectingRegion ||
      loading ||
      error ||
      needsPassword ||
      !count
    )
      return;
    exportLock.current = true;
    exportReadsSource.current = true;
    exportCancelled.current = false;
    const controller = new AbortController();
    exportAbort.current = controller;
    setExportBusy(true);
    setExportCommitting(false);
    setExportNotice("");
    onStart();
    // Capture page/version/remarks before any asynchronous render or save dialog.
    const pageNumber = view.page,
      rotation = view.rotation,
      name = attachment.name;
    const asset =
      attachment.format === "pdf"
        ? attachment.pages[0]
        : attachment.pages[pageNumber - 1];
    const notes = (attachment.annotations ?? []).filter(
      (n) =>
        n.assetId === asset?.id &&
        n.page === (attachment.format === "pdf" ? pageNumber : 1),
    );
    try {
      const source = await renderForExport(
        pageNumber,
        rotation,
        controller.signal,
      );
      let blob: Blob;
      try {
        blob = await annotatedRasterPng(
          source,
          notes,
          name,
          pageNumber,
          rotation,
          controller.signal,
        );
      } finally {
        source.width = 0;
        source.height = 0;
      }
      if (controller.signal.aborted || !readerAlive.current) return;
      const fileName = exportName(name, `第${pageNumber}页-批注.png`);
      const artifact = { name: fileName, blob, page: pageNumber };
      setPreparedPage(artifact);
      exportReadsSource.current = false;
      await savePageArtifact(artifact, controller.signal);
    } catch (e) {
      if (readerAlive.current)
        setExportNotice(
          controller.signal.aborted
            ? controller.signal.reason === "sourceChanged"
              ? "谱页或批注已改变，本页导出已停止。可以按新内容重新导出。"
              : "本页导出已停止，制作好的图片仍可再次保存。"
            : `导出失败：${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      exportLock.current = false;
      exportReadsSource.current = false;
      if (exportAbort.current === controller) exportAbort.current = null;
      if (readerAlive.current) {
        setExportBusy(false);
        setExportCommitting(false);
      }
    }
  };
  const savePageArtifact = async (
    artifact: NonNullable<typeof preparedPage>,
    signal: AbortSignal,
  ) => {
    if (signal.aborted || !readerAlive.current)
      throw new DOMException("本页导出已停止", "AbortError");
    if (api.desktop) {
      const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
      if (signal.aborted || !readerAlive.current)
        throw new DOMException("本页导出已停止", "AbortError");
      const path = await api.exportPaperPage(artifact.name, bytes, {
        signal,
        progress: (phase, percent) => {
          if (!readerAlive.current) return;
          setExportCommitting(phase === "committing");
          setExportNotice(
            phase === "choosing"
              ? "批注图片已制作，等待选择保存位置…"
              : phase === "writing"
                ? `正在保存批注图片：${percent}%`
                : "正在完成文件保存…",
          );
        },
      });
      if (path) savedArtifacts.current.add(artifact);
      if (readerAlive.current)
        setExportNotice(
          path
            ? `已保存：${path}`
            : "保存已取消，批注图片保留，可以直接再次保存。",
        );
    } else {
      const url = URL.createObjectURL(artifact.blob),
        link = document.createElement("a");
      link.href = url;
      link.download = artifact.name;
      link.click();
      savedArtifacts.current.add(artifact);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (readerAlive.current)
        setExportNotice("已导出本页批注图片，包含编号及完整批注说明。");
    }
  };
  const savePreparedPage = async () => {
    if (exportLock.current || !preparedPage) return;
    const artifact = preparedPage,
      controller = new AbortController();
    exportLock.current = true;
    exportReadsSource.current = false;
    exportCancelled.current = false;
    exportAbort.current = controller;
    setExportBusy(true);
    setExportCommitting(false);
    try {
      await savePageArtifact(artifact, controller.signal);
    } catch (failure) {
      if (readerAlive.current)
        setExportNotice(
          controller.signal.aborted
            ? "保存已停止，批注图片仍保留。"
            : `图片已制作，保存暂未完成：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      exportLock.current = false;
      if (exportAbort.current === controller) exportAbort.current = null;
      if (readerAlive.current) {
        setExportBusy(false);
        setExportCommitting(false);
      }
    }
  };
  const saveBookArtifact = async (
    artifact: NonNullable<typeof preparedBook>,
    signal: AbortSignal,
  ) => {
    if (signal.aborted || !readerAlive.current)
      throw new DOMException("整本导出已停止", "AbortError");
    if (api.desktop) {
      const path = await api.exportPaperBook(artifact.name, artifact.bytes, {
        signal,
        progress: (phase, percent) => {
          if (!readerAlive.current) return;
          setExportCommitting(phase === "committing");
          setExportNotice(
            phase === "choosing"
              ? "PDF 已制作，等待选择保存位置…"
              : phase === "writing"
                ? `正在保存整本批注 PDF：${percent}%`
                : "正在完成文件保存…",
          );
        },
      });
      if (path) savedArtifacts.current.add(artifact);
      if (readerAlive.current)
        setExportNotice(
          path
            ? `已保存：${path}`
            : "PDF 已制作，保存已取消。可以直接再次保存上次 PDF。",
        );
    } else {
      const url = URL.createObjectURL(
        new Blob([artifact.bytes.slice().buffer], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = artifact.name;
      link.click();
      savedArtifacts.current.add(artifact);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (readerAlive.current)
        setExportNotice(`已导出整本批注 PDF，共 ${artifact.pages} 页原谱。`);
    }
  };
  const exportBook = async () => {
    if (
      exportLock.current ||
      disabled ||
      annotationEditing ||
      selectingRegion ||
      loading ||
      error ||
      needsPassword ||
      !count
    )
      return;
    exportLock.current = true;
    exportCancelled.current = false;
    exportReadsSource.current = true;
    const controller = new AbortController();
    exportAbort.current = controller;
    setExportBusy(true);
    setExportCommitting(false);
    setExportNotice("");
    onStart();
    const name = attachment.name,
      rotation = view.rotation;
    try {
      const bytes = await annotatedBookPdf({
        name,
        pages: count,
        rotation,
        signal: controller.signal,
        render: (pageNumber) =>
          renderForExport(pageNumber, rotation, controller.signal),
        cancelled: () => exportCancelled.current || !readerAlive.current,
        annotations: (pageNumber) => {
          const asset =
            attachment.format === "pdf"
              ? attachment.pages[0]
              : attachment.pages[pageNumber - 1];
          return (attachment.annotations ?? []).filter(
            (note) =>
              note.assetId === asset?.id &&
              note.page === (attachment.format === "pdf" ? pageNumber : 1),
          );
        },
        progress: (pageNumber, total) => {
          if (readerAlive.current)
            setExportNotice(`正在制作第 ${pageNumber} / ${total} 页批注 PDF…`);
        },
      });
      if (controller.signal.aborted || !readerAlive.current) return;
      const artifact = {
        name: exportName(name, "整本批注.pdf"),
        bytes,
        pages: count,
      };
      setPreparedBook(artifact);
      exportReadsSource.current = false;
      await saveBookArtifact(artifact, controller.signal);
    } catch (failure) {
      if (readerAlive.current)
        setExportNotice(
          exportCancelled.current
            ? "已取消整本导出，原谱与批注保留。"
            : controller.signal.reason === "sourceChanged"
              ? "谱页或批注已改变，本次制作已停止。请按新内容重新制作。"
              : `整本导出失败：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      exportLock.current = false;
      if (exportAbort.current === controller) exportAbort.current = null;
      exportReadsSource.current = false;
      if (readerAlive.current) {
        setExportBusy(false);
        setExportCommitting(false);
      }
    }
  };
  const savePreparedBook = async () => {
    if (exportLock.current || !preparedBook) return;
    const artifact = preparedBook,
      controller = new AbortController();
    exportLock.current = true;
    exportCancelled.current = false;
    exportAbort.current = controller;
    exportReadsSource.current = false;
    setExportBusy(true);
    setExportCommitting(false);
    try {
      await saveBookArtifact(artifact, controller.signal);
    } catch (failure) {
      if (readerAlive.current)
        setExportNotice(
          controller.signal.aborted
            ? "保存已停止，制作好的 PDF 仍保留。"
            : `PDF 已制作，保存暂未完成：${failure instanceof Error ? failure.message : String(failure)}`,
        );
    } finally {
      exportLock.current = false;
      if (exportAbort.current === controller) exportAbort.current = null;
      if (readerAlive.current) {
        setExportBusy(false);
        setExportCommitting(false);
      }
    }
  };
  return {
    exportBusy,
    exportCommitting,
    feedback,
    preparedBook,
    preparedPage,
    exportPage,
    exportBook,
    savePreparedPage,
    savePreparedBook,
    isBusy: () => exportLock.current,
    cancel: () => {
      if (!exportLock.current || exportCommitting) return;
      exportCancelled.current = true;
      exportAbort.current?.abort("cancelled");
      setExportNotice("正在停止本次导出…");
    },
    releasePage: () => {
      if (!exportLock.current) setPreparedPage(null);
    },
    releaseBook: () => {
      if (!exportLock.current) setPreparedBook(null);
    },
  };
}
