import type { ScoreJobProgress } from "./scoreJobProgress";
import { api } from "../../api";
import type {
  ScoreDraft,
  ScoreJobRequest,
  ScoreJobStatus,
  PdfDraft,
  ScoreExportResult,
  MediaExportDraft,
} from "../../engine/commands.generated";
export class PendingScoreJob extends Error {
  constructor(
    message: string,
    public request: ScoreJobRequest,
  ) {
    super(message);
    this.name = "PendingScoreJob";
  }
}
export class CancelledScoreJob extends Error {
  constructor() {
    super("文件任务已取消，原曲目与谱页保留");
    this.name = "CancelledScoreJob";
  }
}
let protocol: Promise<number> | undefined;
export const scoreJobProtocol = () => (protocol ??= api.scoreJobProtocol());
const wait = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledScoreJob());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new CancelledScoreJob());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 250);
    signal?.addEventListener("abort", abort, { once: true });
  });
export function scoreJobMessage(status: ScoreJobProgress): string {
  if (status.phase === "ready") {
    if (status.request.kind === "notationToPdf") return "PDF 已排版，等待查看";
    if (status.request.kind === "annotatedScore")
      return "个人标记谱已制作，等待另存";
    return ["midiExport", "packageExport", "mediaSave"].includes(
      status.request.kind,
    )
      ? "导出处理已完成"
      : "初稿已生成，等待核对";
  }
  if (status.phase === "cancelled")
    return status.stage === "cancelledChoosingExportTarget"
      ? "已取消，请关闭原文件选择窗口后继续。已制作成品保留。"
      : "已取消，原曲目与谱页保留";
  if (status.phase === "error") return status.error || "文件任务失败";
  if (status.stage.startsWith("writingMediaExport:"))
    return `正在另存文件：${status.stage.split(":")[1]}%`;
  return (
    (
      {
        preparing: "正在准备",
        readingSource: "正在核对曲目与谱页",
        choosingProgram: "正在检查或选择 MuseScore 程序",
        copyingSource: "正在准备固定的转换副本",
        converting: "MuseScore 正在从 MIDI 转谱",
        recognizing: "Audiveris 正在识别纸谱",
        checkingResult: "正在核对初稿与来源",
        layingOutPdf: "MuseScore 正在排版 PDF",
        retainingPdf: "正在保留排版 PDF",
        preparingAnnotatedScore: "正在制作个人标记谱",
        retainingAnnotatedScore: "正在保留导出成品",
        readingExportSource: "正在读取导出来源",
        encodingPackage: "正在打包曲目与谱面资料",
        preparingMidi: "正在制作 MIDI 副本",
        retainingMediaExport: "正在保留导出成品",
        readingCachedExport: "正在读取已制作的成品",
        choosingExportTarget: "等待选择另存位置",
        copyingMediaExport: "正在复制并核对导出成品",
        committingMediaExport: "正在完成文件保存",
      } as Record<string, string>
    )[status.stage] ?? "正在处理文件"
  );
}
type ReadOptions = {
  signal?: AbortSignal;
  changed: (status: ScoreJobStatus) => void;
  submit?: () => Promise<unknown>;
  awaitingAdmission?: () => boolean;
};
export const readScoreOperation = (
  request: ScoreJobRequest,
  options: ReadOptions,
) =>
  readScoreResult<ScoreDraft>(
    request,
    options,
    (status) => status.draft ?? undefined,
  );
export const readPdfOperation = (
  request: ScoreJobRequest,
  options: ReadOptions,
) =>
  readScoreResult<PdfDraft>(
    request,
    options,
    (status) => status.pdf ?? undefined,
  );
export const readExportOperation = (
  request: ScoreJobRequest,
  options: ReadOptions,
) =>
  readScoreResult<ScoreExportResult>(
    request,
    options,
    (status) => status.preparedExport ?? undefined,
  );
export const readMediaOperation = (
  request: ScoreJobRequest,
  options: ReadOptions,
) =>
  readScoreResult<MediaExportDraft>(
    request,
    options,
    (status) => status.mediaExport ?? undefined,
  );
async function readScoreResult<T>(
  request: ScoreJobRequest,
  options: ReadOptions,
  ready: (status: ScoreJobStatus) => T | undefined,
): Promise<T> {
  let submissionError: unknown,
    submitted = false;
  if (options.submit)
    void options.submit().then(
      () => {
        submitted = true;
      },
      (failure) => {
        submitted = true;
        submissionError = failure;
      },
    );
  const deadline = performance.now() + 360000;
  const stopped = () => {
    if (options.signal?.reason === "cancelled") throw new CancelledScoreJob();
    throw new PendingScoreJob(
      "已停止等待，原文件任务保留，可以继续读取。",
      request,
    );
  };
  while (true) {
    if (options.signal?.aborted) stopped();
    let status: ScoreJobStatus | null;
    try {
      status = await api.readScoreJob(request);
    } catch (failure) {
      throw new PendingScoreJob(
        `原任务保留，状态读取失败：${failure instanceof Error ? failure.message : String(failure)}`,
        request,
      );
    }
    if (status) {
      options.changed(status);
      if (status.phase === "ready") {
        const value = ready(status);
        if (value !== undefined) return value;
        throw new Error("文件任务完成，但结果类型不一致，请查看本机保留结果。");
      }
      if (status.phase === "cancelled") throw new CancelledScoreJob();
      if (status.phase === "error")
        throw new Error(status.error || "文件任务失败");
    } else if (submitted && submissionError) throw submissionError;
    else if (submitted)
      throw new PendingScoreJob(
        "本次调用已返回，原任务记录暂不可读。请先重新读取任务或查看本机保留结果。",
        request,
      );
    else if (!options.submit && !options.awaitingAdmission?.())
      throw new PendingScoreJob(
        "原任务记录已过期。请先查看本机保留的结果，再决定是否重新生成。",
        request,
      );
    if (performance.now() > deadline)
      throw new PendingScoreJob(
        "仍在等待文件结果。原任务保留，可以继续读取。",
        request,
      );
    try {
      await wait(options.signal);
    } catch {
      stopped();
    }
  }
}
