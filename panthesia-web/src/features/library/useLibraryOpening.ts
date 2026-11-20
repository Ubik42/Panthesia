import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { reportDiagnostic } from "../../app/diagnostics";
import type {
  LibraryOpenIntent,
  LibraryOpenWorkspace,
} from "./libraryOpenStore";
import type {
  LibraryOpenSource,
  LibraryOpenReceipt,
  LibraryPrepared,
} from "../../engine/commands.generated";

/** Opening is an ephemeral navigation operation, not a saved user task. */
export function useLibraryOpening(options: {
  engineId?: string;
  workspace: LibraryOpenWorkspace;
  visible: boolean;
  canPresent: boolean;
  present: (
    intent: LibraryOpenIntent,
    result: LibraryPrepared,
    current: () => boolean,
    workspace: LibraryOpenWorkspace,
  ) => Promise<boolean>;
}) {
  const current = useRef(options);
  current.current = options;
  const active = useRef<AbortController | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cancelPending = () => active.current?.abort();
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [options.engineId, options.workspace, options.visible],
  );
  const start = async (
    source: LibraryOpenSource,
    title: string,
    path: string,
  ) => {
    if (active.current) return false;
    const engine = options.engineId,
      owner = options.workspace;
    if (!engine || !options.visible) return false;
    const controller = new AbortController(),
      signal = controller.signal;
    active.current = controller;
    setSubmitting(true);
    const id = `library-${crypto.randomUUID()}`;
    let submitted = false,
      finished = false;
    const valid = () =>
      !signal.aborted &&
      current.current.engineId === engine &&
      current.current.workspace === owner &&
      current.current.visible;
    const wait = () =>
      new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 150);
        signal.addEventListener("abort", abort, { once: true });
      });
    const read = () =>
      api.commandForEngine<LibraryOpenReceipt | null>(engine, {
        type: "readLibraryOpen",
        id,
        metadata_only: false,
      });
    try {
      const state = await api.state();
      signal.throwIfAborted();
      if (state.stateOrder?.engineId !== engine) return false;
      const request = {
        engineId: engine,
        id,
        createdAtMs: Date.now(),
        origin: {
          contentId: state.contentId ?? null,
          scoreRevision: state.scoreRevision ?? 0,
          midiEvents: state.midiEvents,
          status: state.status,
        },
        source,
      };
      const intent: LibraryOpenIntent = {
        request,
        title,
        path,
        workspace: owner,
        disposition: "pending",
        lastPhase: "unknown",
        error: "",
      };
      submitted = true;
      let receipt: LibraryOpenReceipt | null;
      try {
        receipt = await api.commandForEngine<LibraryOpenReceipt>(engine, {
          type: "startLibraryOpen",
          request,
        });
      } catch (error) {
        reportDiagnostic("曲目打开请求", error);
        receipt = await read();
        if (!receipt) throw error;
      }
      while (valid()) {
        if (!receipt) throw Error("曲目文件无法读取");
        if (receipt.phase === "done") {
          if (!receipt.result) {
            receipt = await read();
            continue;
          }
          finished = true;
          // Source binding can finish one render after the native commit.
          if (!current.current.canPresent) {
            await wait();
            continue;
          }
          if (
            await current.current.present(
              intent,
              receipt.result.libraryPrepared,
              () => valid() && current.current.canPresent,
              owner,
            )
          )
            return true;
          await wait();
          continue;
        }
        if (
          ["error", "cancelled", "released", "unconfirmed"].includes(
            receipt.phase,
          )
        )
          throw Error(receipt.error || "曲目文件无法读取");
        await wait();
        receipt = await read();
      }
      return false;
    } catch (error) {
      if (signal.aborted) return false;
      reportDiagnostic("曲目读取", error);
      throw error;
    } finally {
      if (submitted) {
        if (!finished)
          await api
            .commandForEngine(engine, { type: "cancelLibraryOpen", id })
            .catch((error) => reportDiagnostic("取消曲目读取", error));
        await api
          .commandForEngine(engine, { type: "releaseLibraryOpen", id })
          .catch((error) => reportDiagnostic("释放曲目读取", error));
      }
      if (active.current === controller) {
        active.current = null;
        setSubmitting(false);
      }
    }
  };
  return { submitting, start, cancelPending };
}
