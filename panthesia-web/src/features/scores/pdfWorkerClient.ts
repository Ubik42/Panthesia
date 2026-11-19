import type {
  RecognitionPdfRequest,
  RecognitionPdfReply,
} from "./recognitionPdf.worker";
type Request = RecognitionPdfRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, "id">
    : never
  : never;
/** A single-page-at-a-time channel bounds pixel ownership and cancels CPU work with the worker. */
export function createPdfWorker(signal?: AbortSignal) {
  const interrupted = () =>
    new DOMException("PDF 制作已停止，原资料保留。", "AbortError");
  const worker = new Worker(
    new URL("./recognitionPdf.worker.ts", import.meta.url),
    { type: "module" },
  );
  let next = 0,
    fatal: Error | undefined;
  let pending:
    | {
        id: number;
        resolve: (value: RecognitionPdfReply) => void;
        reject: (failure: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const fail = (failure: Error) => {
    fatal = failure;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(failure);
      pending = undefined;
    }
    worker.terminate();
  };
  worker.onmessage = ({ data }: MessageEvent<RecognitionPdfReply>) => {
    if (!pending || data.id !== pending.id) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    if (data.error) current.reject(new Error(data.error));
    else current.resolve(data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    fail(new Error("PDF 制作后台任务中断，原资料保留，请重试。"));
  };
  worker.onmessageerror = () =>
    fail(new Error("PDF 制作结果无法读取，原资料保留，请重试。"));
  const abort = () => fail(interrupted());
  signal?.addEventListener("abort", abort, { once: true });
  const send = (request: Request, transfer: Transferable[] = []) =>
    new Promise<RecognitionPdfReply>((resolve, reject) => {
      if (signal?.aborted) {
        reject(interrupted());
        return;
      }
      if (fatal) {
        reject(fatal);
        return;
      }
      if (pending) {
        reject(new Error("上一页仍在处理，请等待完成。"));
        return;
      }
      const id = ++next;
      pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(
          () =>
            fail(
              new Error(
                "PDF 制作等待时间过长，已停止本次处理，请拆分谱本后重试。",
              ),
            ),
          60000,
        ),
      };
      try {
        worker.postMessage({ ...request, id }, transfer);
      } catch (failure) {
        fail(failure instanceof Error ? failure : new Error(String(failure)));
      }
    });
  return {
    send,
    dispose: () => {
      signal?.removeEventListener("abort", abort);
      fail(interrupted());
    },
  };
}
