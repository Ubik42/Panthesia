import type { BatchData } from "../../batchImportStore";
type Input =
  | { kind: "encode"; practice: Blob; batches: BatchData[] }
  | { kind: "decode"; file: Blob }
  | { kind: "compare"; files: { name: string; left: Blob; right: Blob }[] };
function run<T>(
  input: Input,
  progress: (text: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("完整备份文件处理已取消，原文件保留。", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../../workspaceBackupWorker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      reject(error);
      return;
    }
    let finished = false;
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      stop();
      reject(error);
    };
    const abort = () =>
      fail(
        new DOMException(
          "完整备份文件处理已取消，原文件和已保存资料保留。",
          "AbortError",
        ),
      );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      if (finished) return;
      if (event.data.kind === "progress") progress(String(event.data.text));
      else if (event.data.kind === "ready") {
        finished = true;
        stop();
        resolve(event.data.value as T);
      } else
        fail(
          new Error(event.data.message || "完整备份文件处理失败，原文件保留。"),
        );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(
        new Error(
          event.message || "完整备份处理已中断，请减少本次文件数量后重试。",
        ),
      );
    };
    worker.onmessageerror = () =>
      fail(new Error("完整备份处理结果无法读取，原文件保留。"));
    try {
      worker.postMessage(input);
    } catch (error) {
      fail(error);
    }
    if (signal?.aborted) abort();
  });
}
export const encodeWorkspaceInBackground = (
  practice: Blob,
  batches: BatchData[],
  progress: (text: string) => void,
  signal?: AbortSignal,
) => run<Blob>({ kind: "encode", practice, batches }, progress, signal);
export const decodeWorkspaceInBackground = (
  file: Blob,
  progress: (text: string) => void,
  signal?: AbortSignal,
) =>
  run<{ practice: File; batches: BatchData[] }>(
    { kind: "decode", file },
    progress,
    signal,
  );

export const compareBackupFiles = (
  files: { name: string; left: Blob; right: Blob }[],
  progress: (text: string) => void,
  signal?: AbortSignal,
) => run<void>({ kind: "compare", files }, progress, signal);
