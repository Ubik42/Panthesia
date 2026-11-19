import { scoreJobProgress } from "../scores/scoreJobProgress";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { api } from "../../api";
import type {
  MediaExportDraft,
  MediaExportKind,
  ScoreJobRequest,
  ScoreJobStatus,
} from "../../engine/commands.generated";
import {
  CancelledScoreJob,
  PendingScoreJob,
  readMediaOperation,
  scoreJobMessage,
  scoreJobProtocol,
} from "../scores/scoreJobClient";
import { mediaExportSlot, type MediaExportSource } from "./mediaExportStore";
const description = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function useMediaExport(
  source: MediaExportSource,
  kind: MediaExportKind,
) {
  const slot = useMemo(
    () => mediaExportSlot(source, kind),
    [source.engineId, source.contentId, kind],
  );
  const state = useSyncExternalStore(
    slot.subscribe,
    slot.getSnapshot,
    slot.getSnapshot,
  );
  const waiting = useRef<AbortController | null>(null),
    alive = useRef(true),
    cancelling = useRef(false),
    autoSaveRequested = useRef(false);
  const engine = async (current = false) => {
    const value = await api.state(),
      engineId = value.stateOrder?.engineId;
    if (
      !engineId ||
      (source.engineId && source.engineId !== engineId) ||
      (current && value.contentId !== source.contentId)
    )
      throw new Error(
        "曲目或练习室连接已改变，请返回来源曲目后继续制作。已保留的成品可以从缓存列表另存。",
      );
    return engineId;
  };
  const refresh = async () => {
    if (!api.desktop || (await scoreJobProtocol()) < 4) return;
    const latest = slot.beginRead();
    const listing = await api.listMediaExports(await engine());
    if (latest()) {
      const current = slot.getSnapshot();
      const selected =
        current.artifact &&
        listing.drafts.find((row) => row.id === current.artifact!.id);
      slot.update({
        supported: true,
        listing,
        ...(!current.job && current.artifact
          ? { artifact: selected || null }
          : {}),
      });
    }
  };
  const changed = (status: ScoreJobStatus) => {
    const previous = slot.getSnapshot().status;
    if (
      previous?.request.id === status.request.id &&
      previous.phase === status.phase &&
      previous.stage === status.stage &&
      previous.cancellable === status.cancellable &&
      previous.error === status.error
    )
      return;
    const small = scoreJobProgress(status);
    slot.update({ status: small, message: scoreJobMessage(status) });
  };
  const legacy = async () => {
    if (
      slot.getSnapshot().busy ||
      slot.getSnapshot().submitting ||
      slot.getSnapshot().job
    )
      return;
    const controller = new AbortController();
    waiting.current = controller;
    slot.update({
      busy: true,
      action: "save",
      error: "",
      message: "正在准备并另存当前曲目…",
    });
    try {
      await engine(true);
      if (controller.signal.aborted || !alive.current) return;
      if (api.desktop) {
        const path = await (kind !== "package"
          ? kind === "practiceMidi" ? Promise.reject(new Error("练习版导出需要当前版本桌面端，请重新启动新版软件")) : api.export()
          : api.exportPackage());
        slot.update({
          message: path ? `已保存：${path}` : "保存已取消，原曲目资料保留。",
        });
      } else {
        const blob = await (kind !== "package"
          ? kind === "practiceMidi" ? api.command<{bytes:number[]}>({type:"exportPracticeVariant"}).then(value=>new Blob([new Uint8Array(value.bytes)],{type:"audio/midi"})) : api.downloadMidi(source.contentId, controller.signal)
          : api.downloadPackage(source.contentId, controller.signal));
        if (!controller.signal.aborted && alive.current) {
          download(
            blob,
            `${
              Array.from(source.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_"))
                .slice(0, 100)
                .join("") || "曲目"
            }.${kind !== "package" ? "mid" : "neopiece"}`,
          );
          slot.update({ message: "文件已生成，请查看下载文件。" });
        }
      }
    } catch (error) {
      slot.update({
        error: controller.signal.aborted ? "" : description(error),
        ...(controller.signal.aborted
          ? { message: "已停止等待导出，原曲目资料保留。" }
          : {}),
      });
    } finally {
      if (waiting.current === controller) waiting.current = null;
      slot.update({ busy: false });
    }
  };
  const run = async (
    action: "prepare" | "save",
    artifact?: MediaExportDraft,
    resume = false,
    autoSave = false,
  ) => {
    const before = slot.getSnapshot();
    if (before.busy || (!resume && (before.submitting || before.job))) return;
    if (!api.desktop) {
      await legacy();
      return;
    }
    slot.update({
      busy: true,
      action,
      error: "",
      message: action === "prepare" ? "正在制作导出成品…" : "正在准备另存成品…",
    });
    autoSaveRequested.current = autoSave;
    const controller = new AbortController();
    waiting.current = controller;
    let submission: Promise<unknown> | undefined;
    let ready: MediaExportDraft | undefined;
    try {
      const protocol = await scoreJobProtocol();
      if (controller.signal.aborted || !alive.current) return;
      if (protocol < 4) {
        slot.update({ busy: false });
        await legacy();
        return;
      }
      slot.update({ supported: true });
      let request = resume ? before.job : undefined;
      if (!request) {
        if (action === "save" && !artifact)
          throw new Error("请先选择已制作的导出成品。");
        const engineId = await engine(action === "prepare");
        if (controller.signal.aborted || !alive.current) return;
        request = {
          id: crypto.randomUUID(),
          engineId,
          contentId:
            action === "prepare" ? source.contentId : artifact!.contentId,
          kind:
            action === "save"
              ? "mediaSave"
              : kind !== "package"
                ? "midiExport"
                : "packageExport",
          createdAtMs: Date.now(),
        };
        slot.update({ job: request, status: undefined });
      }
      const actual = request;
      if (
        resume &&
        !before.submitting &&
        (await api.readScoreJob(actual)) === null
      ) {
        slot.update({
          job: undefined,
          status: undefined,
          submitting: false,
          message:
            "原任务记录已过期。请查看本机保留的成品；需要当前版本时可以重新制作。",
        });
        await refresh();
        return;
      }
      ready = await readMediaOperation(actual, {
        signal: controller.signal,
        changed,
        awaitingAdmission: () =>
          slot.getSnapshot().job?.id === actual.id &&
          slot.getSnapshot().submitting,
        ...(resume
          ? {}
          : {
              submit: () => {
                slot.update({ submitting: true });
                submission = (
                  action === "prepare"
                    ? api.prepareMediaExport(actual, {
                        contentId: source.contentId,
                        kind,
                      })
                    : api.saveMediaExport(actual, {
                        engineId: actual.engineId,
                        contentId: artifact!.contentId,
                        id: artifact!.id,
                      })
                ).finally(() => {
                  if (slot.getSnapshot().job?.id === actual.id)
                    slot.update({ submitting: false });
                });
                return submission;
              },
            }),
      });
      await submission?.catch(() => {});
      slot.update({
        artifact: ready,
        job: undefined,
        status: undefined,
        submitting: false,
        message:
          ready.savedPath && action === "save"
            ? `已另存：${ready.savedPath}`
            : ready.requestId !== actual.id
              ? "内容与已保留成品一致，已复用原文件，可以继续另存。"
              : "导出成品已保留，可以另存。退出软件后仍可从本机缓存继续处理。",
        error: ready.warning || "",
      });
      await refresh().catch((error) =>
        slot.update({ error: `成品保留，列表尚未更新：${description(error)}` }),
      );
    } catch (error) {
      if (
        error instanceof CancelledScoreJob ||
        controller.signal.reason === "cancelled"
      )
        slot.update({
          job: undefined,
          status: undefined,
          submitting: false,
          error: "",
          message:
            action === "save"
              ? "保存已取消，导出成品仍保留。"
              : "制作已取消，原曲目与已保留的成品可继续使用。",
        });
      else if (error instanceof PendingScoreJob)
        slot.update({ job: error.request, error: error.message });
      else {
        slot.update({
          error: description(error),
          ...(slot.getSnapshot().status?.phase === "error"
            ? { job: undefined }
            : {}),
        });
        const request = slot.getSnapshot().job;
        if (
          request &&
          !slot.getSnapshot().submitting &&
          !slot.getSnapshot().status
        ) {
          const admitted = await api
            .readScoreJob(request)
            .catch(() => undefined);
          if (admitted === null && slot.getSnapshot().job?.id === request.id)
            slot.update({ job: undefined });
        }
      }
    } finally {
      if (waiting.current === controller) waiting.current = null;
      slot.update({ busy: false });
    }
    if (
      autoSave &&
      autoSaveRequested.current &&
      ready &&
      !controller.signal.aborted &&
      alive.current
    ) {
      autoSaveRequested.current = false;
      await run("save", ready);
    }
  };
  useEffect(() => {
    alive.current = true;
    const initialize = async () => {
      await refresh().catch((error) =>
        slot.update({ error: description(error) }),
      );
      if (!alive.current) return;
      const current = slot.getSnapshot();
      if (current.artifact || current.job || current.busy || current.submitting)
        return;
      const retained = current.listing.drafts.find(
        (row) =>
          row.contentId === source.contentId &&
          row.kind === kind &&
          !row.warning,
      );
      if (retained)
        slot.update({
          artifact: retained,
          message:
            "已恢复上次制作的导出成品。可以另存这份快照，或按当前曲目资料重新制作。",
        });
      else if (api.desktop && (await scoreJobProtocol()) >= 4)
        void run("prepare", undefined, false, true);
    };
    void initialize();
    return () => {
      alive.current = false;
      autoSaveRequested.current = false;
      waiting.current?.abort("windowClosed");
    };
  }, [slot]);
  const cancel = async () => {
    autoSaveRequested.current = false;
    const request = slot.getSnapshot().job;
    if (!request) {
      waiting.current?.abort("cancelled");
      return;
    }
    if (cancelling.current) return;
    cancelling.current = true;
    try {
      const status = await api.cancelScoreJob(request);
      if (slot.getSnapshot().job?.id !== request.id) return;
      changed(status);
      if (status.phase === "cancelled") {
        waiting.current?.abort("cancelled");
        slot.update({
          job: undefined,
          status: undefined,
          submitting: false,
          message: "已取消，原曲目和已制作成品保留。",
        });
        await refresh();
      } else if (status.mediaExport) {
        slot.update({
          artifact: status.mediaExport,
          job: undefined,
          status: undefined,
          submitting: false,
          message: status.mediaExport.savedPath
            ? `已保存：${status.mediaExport.savedPath}`
            : "制作已完成，成品保留。",
        });
        await refresh();
      }
    } catch (error) {
      slot.update({ error: description(error) });
    } finally {
      cancelling.current = false;
    }
  };
  const remove = async (artifact: MediaExportDraft) => {
    if (
      slot.getSnapshot().busy ||
      slot.getSnapshot().submitting ||
      slot.getSnapshot().job
    )
      return;
    slot.update({ busy: true, error: "" });
    try {
      await api.removeMediaExport({
        engineId: await engine(),
        contentId: artifact.contentId,
        id: artifact.id,
      });
      if (slot.getSnapshot().artifact?.id === artifact.id)
        slot.update({ artifact: null });
      await refresh();
      slot.update({
        message: "这份导出缓存已移除，原曲目和已经另存的文件保留。",
      });
    } catch (error) {
      slot.update({ error: description(error) });
    } finally {
      slot.update({ busy: false });
    }
  };
  const confirm = async (artifact: MediaExportDraft) => {
    if (
      slot.getSnapshot().busy ||
      slot.getSnapshot().submitting ||
      slot.getSnapshot().job
    )
      return;
    slot.update({ busy: true, error: "" });
    try {
      const result = await api.confirmMediaExport({
        engineId: await engine(),
        contentId: artifact.contentId,
        id: artifact.id,
      });
      slot.update({
        artifact: result,
        message:
          result.savePendingPath || result.previousPendingPaths?.length
            ? "部分原保存结果仍需核对，成品保留，可以另存新副本。"
            : result.savedPath
              ? `已确认另存：${result.savedPath}`
              : "成品尚未另存，可以继续保存。",
        error: result.warning || "",
      });
      await refresh();
    } catch (error) {
      slot.update({ error: description(error) });
    } finally {
      slot.update({ busy: false });
    }
  };
  return {
    ...state,
    canStopWaiting: !api.desktop,
    prepare: () => run("prepare", undefined, false, true),
    save: (artifact = slot.getSnapshot().artifact) =>
      artifact ? run("save", artifact) : Promise.resolve(),
    resume: () => run(slot.getSnapshot().action, undefined, true),
    cancel,
    remove,
    confirm,
    legacy,
    select: (artifact: MediaExportDraft) =>
      slot.update({
        artifact,
        error: "",
        message: "已选中制作时的成品快照，可以另存。",
      }),
    refresh: () =>
      refresh().catch((error) => slot.update({ error: description(error) })),
  };
}
