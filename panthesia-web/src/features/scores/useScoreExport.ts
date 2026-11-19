import { scoreJobProgress } from "./scoreJobProgress";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { api, type LoadedSong } from "../../api";
import type {
  DraftSelection,
  ScoreExportCacheItem,
  ScoreExportInput,
  ScoreExportPreview,
  ScoreExportResult,
  ScoreJobStatus,
} from "../../engine/commands.generated";
import {
  CancelledScoreJob,
  PendingScoreJob,
  readExportOperation,
  scoreJobMessage,
  scoreJobProtocol,
} from "./scoreJobClient";
import { scoreExportSlot, replaceScoreExportCache, scoreExportInputKey as inputKey } from "./scoreExportStore";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function useScoreExport(song: LoadedSong, allowPrepare = true) {
  const slot = useMemo(
    () => scoreExportSlot(song.engineId, song.contentId, { title: song.title, path: song.sourcePath }),
    [song.engineId, song.contentId],
  );
  const state = useSyncExternalStore(
    slot.subscribe,
    slot.getSnapshot,
    slot.getSnapshot,
  );
  const currentInput = (options: typeof state.options): ScoreExportInput => ({
    contentId: song.contentId,
    scoreRevision: song.scoreRevision,
    annotationRevision: song.annotationRevision,
    fingerActionRevision: song.fingerActionRevision,
    options,
  });
  const legacyKey = (options: typeof state.options) =>
    inputKey(currentInput(options));
  const waiting = useRef<AbortController | null>(null),
    cancelling = useRef(false);
  const currentEngine = async (requireSong = false) => {
    const actual = await api.state(),
      engineId = actual.stateOrder?.engineId;
    if (
      !engineId ||
      (song.engineId && song.engineId !== engineId) ||
      (requireSong && actual.contentId !== song.contentId)
    )
      throw new Error("曲目或练习室连接已改变，请返回来源曲目后继续制作。");
    return engineId;
  };
  const selection = async (item: {
    id: string;
    contentId: string;
  }): Promise<DraftSelection> => ({
    engineId: await currentEngine(),
    contentId: item.contentId,
    id: item.id,
  });
  const refresh = async () => {
    if (!api.desktop || (await scoreJobProtocol()) < 3) return;
    const latest = slot.beginRead();
    const engineId = await currentEngine();
    const listing = await api.listScoreExports(engineId);
    if (!latest()) return;
    replaceScoreExportCache(engineId, listing, slot);
  };
  const changed = (status: ScoreJobStatus) => {
    const previous = slot.getSnapshot().status;
    if (
      previous?.request.id === status.request.id &&
      previous.phase === status.phase &&
      previous.stage === status.stage &&
      previous.error === status.error
    )
      return;
    const small = scoreJobProgress(status);
    slot.update({
      status: small,
      message:
        status.phase === "ready"
          ? "导出成品已制作，正在读取摘要…"
          : scoreJobMessage(status),
    });
  };
  const confirmReleasedResult = async () => {
    const request = slot.getSnapshot().job;
    if (!request || slot.getSnapshot().status?.phase !== "ready") return false;
    await refresh();
    if (
      slot.getSnapshot().job?.id !== request.id ||
      slot.getSnapshot().items.some((item) => item.id === request.id)
    )
      return false;
    slot.update({
      job: undefined,
      status: undefined,
      submitting: false,
      message: "原任务已经完成，其临时成品已释放。可以按当前设置重新制作。",
    });
    return true;
  };
  const installResult = async (result: ScoreExportResult, engineId: string) => {
    if (result.prepared) {
      const artifact = await api.readScoreExport({
        id: result.prepared.id,
        contentId: result.prepared.contentId,
        engineId,
      });
      slot.update({
        artifact,
        legacyPreview: null,
        job: undefined,
        status: undefined,
        submitting: false,
        message: "个人标记谱已制作。保存、取消保存或再次另存均使用这份成品。",
      });
    } else if (result.preview) {
      slot.update({
        artifact: null,
        legacyPreview: result.preview,
        legacyOptions: result.input.options,
        legacyKey: inputKey(result.input),
        job: undefined,
        status: undefined,
        submitting: false,
        message:
          result.warning || "预览已制作。保存时会重新核对当前资料并生成文件。",
      });
    } else throw new Error("导出任务没有返回成品或预览，请重新读取原任务。");
  };
  const run = async (resume = false) => {
    if (!resume && !allowPrepare) {
      slot.update({
        error: "当前曲目尚未加载可导出的 MusicXML，请先关联并打开原谱。",
      });
      return;
    }
    const before = slot.getSnapshot();
    if (before.busy || before.saving || (!resume && before.submitting)) return;
    if (!resume && before.job) {
      slot.update({ error: "原任务尚未核对结束，请先继续读取或取消原任务。" });
      return;
    }
    const controller = new AbortController();
    waiting.current = controller;
    slot.update({ busy: true, error: "", message: "正在制作个人标记谱…" });
    try {
      if (!api.desktop || (await scoreJobProtocol()) < 3) {
        const legacyPreview = await api.command<ScoreExportPreview>({
          type: "exportAnnotatedScore",
          content_id: song.contentId,
          score_revision: song.scoreRevision,
          options: before.options,
        });
        slot.update({
          legacyPreview,
          legacyOptions: before.options,
          legacyKey: legacyKey(before.options),
          message: "预览已更新，可以保存个人标记谱。",
        });
        return;
      }
      slot.update({ supported: true });
      let request = resume ? before.job : undefined;
      if (!request) {
        const engineId = await currentEngine(true);
        request = {
          id: crypto.randomUUID(),
          engineId,
          contentId: song.contentId,
          kind: "annotatedScore",
          createdAtMs: Date.now(),
        };
        slot.update({ job: request, status: undefined });
      }
      const actual = request;
      const result = await readExportOperation(actual, {
        signal: controller.signal,
        changed,
        awaitingAdmission: () =>
          slot.getSnapshot().job?.id === actual.id &&
          slot.getSnapshot().submitting,
        ...(resume
          ? {}
          : {
              submit: async () => {
                slot.update({ submitting: true });
                try {
                  return await api.prepareScoreExport(
                    actual,
                    currentInput(before.options),
                  );
                } finally {
                  if (slot.getSnapshot().job?.id === actual.id)
                    slot.update({ submitting: false });
                }
              },
            }),
      });
      await installResult(result, actual.engineId);
      await refresh().catch((error) =>
        slot.update({
          error: `${result.prepared ? "成品" : "预览"}已保留，缓存列表暂未更新：${message(error)}`,
        }),
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
          message: "制作已取消，原谱和已保留的成品仍可使用。",
          error: "",
        });
      else if (error instanceof PendingScoreJob)
        slot.update({ job: error.request, error: error.message });
      else {
        const released = await confirmReleasedResult().catch(() => false);
        slot.update({
          error: released ? "请重新制作需要的个人标记谱。" : message(error),
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
  };
  useEffect(() => {
    let alive = true;
    const initialize = async () => {
      await refresh().catch((error) => slot.update({ error: message(error) }));
      if (!alive) return;
      const current = slot.getSnapshot();
      if (
        current.artifact ||
        current.legacyPreview ||
        current.job ||
        current.busy ||
        current.saving
      )
        return;
      const retained = current.items.find(
        (item) => item.contentId === song.contentId,
      );
      if (retained) {
        slot.update({ busy: true });
        try {
          const artifact = await api.readScoreExport(await selection(retained));
          slot.update({
            artifact,
            message:
              "已恢复上次制作的个人标记谱，可以直接另存或按当前设置重新制作。",
          });
        } catch (error) {
          slot.update({ error: message(error) });
        } finally {
          slot.update({ busy: false });
        }
      } else if (allowPrepare) void run();
    };
    void initialize();
    return () => {
      alive = false;
      waiting.current?.abort("windowClosed");
    };
  }, [slot]);
  const cancel = async () => {
    const request = slot.getSnapshot().job;
    if (!request || cancelling.current) return;
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
          message: "制作已取消，原谱和已保留的成品仍可使用。",
        });
        await refresh();
      } else if (status.preparedExport) {
        await installResult(status.preparedExport, request.engineId);
        await refresh();
      }
    } catch (error) {
      const released = await confirmReleasedResult().catch(() => false);
      slot.update({
        error: released ? "临时成品已释放，可以重新制作。" : message(error),
      });
    } finally {
      cancelling.current = false;
    }
  };
  const save = async () => {
    const current = slot.getSnapshot();
    if (current.busy || current.saving || current.submitting) return;
    slot.update({ saving: true, error: "", message: "等待选择保存位置…" });
    try {
      if (current.artifact) {
        const path = await api.saveScoreExport(
          await selection(current.artifact),
        );
        slot.update({
          ...(path
            ? { artifact: { ...current.artifact, savedPath: path } }
            : {}),
          message: path
            ? `已保存：${path}`
            : "保存已取消，成品保留，可以直接再次保存。",
        });
      } else if (current.legacyPreview) {
        if (current.legacyKey !== legacyKey(current.options))
          throw new Error("选项或个人标记已经改变，请重新制作预览后保存。");
        const command = {
          type: "exportAnnotatedScore" as const,
          content_id: song.contentId,
          score_revision: song.scoreRevision,
          options: current.options,
          download: true,
          fingerprint: current.legacyPreview.fingerprint,
        };
        if (api.desktop) {
          const path = await api.exportAnnotatedScore(command);
          slot.update({
            message: path ? `已保存：${path}` : "已取消保存，预览保留。",
            ...(path ? { legacySavedKey: current.legacyKey } : {}),
          });
        } else {
          const result = await api.command<
            ScoreExportPreview & { bytes?: number[] }
          >(command);
          if (!result.bytes)
            throw new Error("导出文件尚未生成，请重新制作预览。");
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(result.bytes)], {
              type: "application/vnd.recordare.musicxml+xml",
            }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = result.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          slot.update({ legacySavedKey: current.legacyKey, message: "个人标记谱已生成，请查看下载文件。" });
        }
      }
    } catch (error) {
      slot.update({ error: `保存尚未完成：${message(error)}` });
    } finally {
      slot.update({ saving: false });
      if (current.artifact)
        await refresh().catch((error) =>
          slot.update({ error: `成品列表暂未更新：${message(error)}` }),
        );
    }
  };
  const cacheAction = async (item: ScoreExportCacheItem, remove = false) => {
    if (
      slot.getSnapshot().busy ||
      slot.getSnapshot().saving ||
      slot.getSnapshot().submitting
    )
      return;
    slot.update({ busy: true, error: "" });
    try {
      const request = await selection(item);
      if (remove) {
        await api.removeScoreExport(request);
        if (slot.getSnapshot().artifact?.id === item.id)
          slot.update({ artifact: null });
        await refresh();
        slot.update({
          message: "这份临时导出成品已释放，原谱和已经另存的文件保留。",
        });
      } else {
        const artifact = await api.readScoreExport(request);
        slot.update({
          artifact,
          ...(item.contentId === song.contentId
            ? { options: artifact.options }
            : {}),
          message: "已打开制作完成时的个人标记谱，可以保存这份快照。",
        });
      }
    } catch (error) {
      slot.update({ error: message(error) });
    } finally {
      slot.update({ busy: false });
    }
  };
  const artifactCurrent = state.artifact
    ? inputKey(state.artifact) === legacyKey(state.options)
    : state.legacyKey === legacyKey(state.options);
  return {
    ...state,
    artifactCurrent,
    preview: state.artifact?.preview ?? state.legacyPreview,
    setOptions: (options: typeof state.options) =>
      slot.update({
        options,
        error: "",
        message: slot.getSnapshot().artifact
          ? "导出选项已改变。点击制作预览生成新成品；原成品仍可另存。"
          : "导出选项已改变，请重新制作预览后保存。",
      }),
    run,
    resume: () => run(true),
    cancel,
    save,
    refresh: () =>
      refresh().catch((error) => slot.update({ error: message(error) })),
    cacheAction,
  };
}
