import {
  encodeWorkspaceBackup,
  decodeWorkspaceBackup,
} from "./workspaceBackup";
import type { BatchData } from "./batchImportStore";
type Input =
  | { kind: "encode"; practice: Blob; batches: BatchData[] }
  | { kind: "decode"; file: Blob }
  | { kind: "compare"; files: { name: string; left: Blob; right: Blob }[] };
const context = self as unknown as {
  onmessage: ((event: MessageEvent<Input>) => void) | null;
  postMessage: (message: unknown) => void;
};
context.onmessage = (event) => {
  let reported = 0;
  const progress = (text: string) => {
    const now = performance.now();
    if (now - reported >= 60) {
      reported = now;
      context.postMessage({ kind: "progress", text });
    }
  };
  const input = event.data;
  const compare = async (
    files: { name: string; left: Blob; right: Blob }[],
  ) => {
    for (const file of files) {
      if (file.left.size !== file.right.size)
        throw new Error(`已有文件大小不同：${file.name}`);
      for (let at = 0; at < file.left.size; at += 1_048_576) {
        progress(
          `正在核对已恢复的文件：${file.name} · ${Math.round((at / file.left.size) * 100)}%`,
        );
        const [left, right] = await Promise.all([
          file.left.slice(at, at + 1_048_576).arrayBuffer(),
          file.right.slice(at, at + 1_048_576).arrayBuffer(),
        ]);
        const bytes = new Uint8Array(left),
          other = new Uint8Array(right);
        if (
          bytes.length !== other.length ||
          bytes.some((byte, index) => byte !== other[index])
        )
          throw new Error(
            `本机文件内容与备份不同：${file.name}。现有批次保留。`,
          );
      }
    }
  };
  const operation =
    input.kind === "encode"
      ? encodeWorkspaceBackup(input.practice, input.batches, progress)
      : input.kind === "decode"
        ? decodeWorkspaceBackup(input.file, progress)
        : compare(input.files);
  void operation.then(
    (value) => context.postMessage({ kind: "ready", value }),
    (error) =>
      context.postMessage({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
