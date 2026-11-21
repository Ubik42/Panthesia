import { scoreJobProgress } from "./scoreJobProgress";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api";
import type { PaperAttachment } from "./paperTypes";
import type { ScoreRouteEvidence } from "./ScoreRoutePreview";
import type {
  ScoreDraft,
  DraftSummary,
  ScoreJobStatus,
} from "../../engine/commands.generated";
import {
  scoreJobProtocol,
  readScoreOperation,
  PendingScoreJob,
  CancelledScoreJob,
  scoreJobMessage,
} from "./scoreJobClient";
import type {
  ScoreWorkspaceSlot,
  RetainedScoreDraft,
} from "./scoreWorkspaceStore";
import { retainScorePreview } from "./scoreWorkspaceStore";

export function useScoreConversion(slot: ScoreWorkspaceSlot) {
  const state = useSyncExternalStore(
    slot.subscribe,
    slot.getSnapshot,
    slot.getSnapshot,
  );
  const waiting = useRef<AbortController | null>(null),
    cancelling = useRef(false);
  const alive = useRef(true);
  const [nativeJobs, setNativeJobs] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      waiting.current?.abort();
    };
  }, [slot]);
  const current = async () => {
    const expected = slot.getSnapshot().source,
      actual = await api.state();
    if (
      actual.contentId !== expected.contentId ||
      (expected.engineId && actual.stateOrder?.engineId !== expected.engineId)
    )
      throw new Error("当前曲目或连接已改变，请返回原曲目后继续读取谱面初稿。");
    return actual;
  };
  const refreshDrafts = async () => {
    const latest = slot.beginDraftRead();
    if (!api.desktop || !(await scoreJobProtocol())) return;
    if (alive.current) setNativeJobs(true);
    try {
      const value = await api.listNotationDrafts(
        slot.getSnapshot().source.contentId,
      );
      if (latest())
        slot.update({ drafts: value.drafts, draftIssues: value.issues });
    } catch (failure) {
      if (!latest()) return;
      slot.update({
        draftIssues: [
          `初稿列表暂未读到新结果，可以重新读取：${failure instanceof Error ? failure.message : String(failure)}`,
        ],
      });
      throw failure;
    }
  };
  const retainImported = async (
    draft: RetainedScoreDraft,
  ): Promise<RetainedScoreDraft> => {
    if (!draft.imported || draft.cached || !api.desktop) return draft;
    const source = await current();
    if (!source.stateOrder?.engineId)
      throw new Error("连接尚未准备完成，上传文件继续保留在当前窗口。");
    const saved = await api.retainNotationFile({
      engineId: source.stateOrder.engineId,
      contentId: slot.getSnapshot().source.contentId,
      name: draft.name,
      bytes: Array.from(draft.bytes),
    });
    if (
      saved.contentId !== slot.getSnapshot().source.contentId ||
      saved.name !== draft.name ||
      saved.size !== draft.bytes.length ||
      !/^[a-f\d]{64}$/i.test(saved.id)
    )
      throw new Error("上传文件副本的回复与当前初稿不一致，请重试暂存。");
    return { ...draft, previewToken: saved.id, cached: true, warning: null };
  };
  const retryRetainImported = async () => {
    const state = slot.getSnapshot(),
      draft =
        state.pendingDraft ??
        (state.filePreview ? retainScorePreview(state.filePreview) : null);
    if (!draft?.imported || state.jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      const retained = await retainImported(draft),
        latest = slot.getSnapshot();
      if (latest.pendingDraft?.bytes === draft.bytes)
        slot.update({ pendingDraft: retained });
      if (latest.filePreview?.bytes === draft.bytes)
        slot.update({ filePreview: { ...latest.filePreview, ...retained } });
      slot.update({ message: "上传文件副本已保留，可关闭窗口后继续核对。" });
      await refreshDrafts();
    } catch (error) {
      slot.update({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  useEffect(() => {
    void refreshDrafts().catch(() => {});
  }, [slot]);
  const checkDraft = async (
    draft: RetainedScoreDraft,
    signal?: AbortSignal,
  ) => {
    slot.update({
      pendingDraft: draft,
      message: "初稿已保留，正在读取演奏顺序…",
    });
    const before = await current();
    if (signal?.aborted) return;
    const evidence = await api.commandForEngine<ScoreRouteEvidence>(
      before.stateOrder?.engineId,
      {
        type: "previewScoreBytesRoute",
        bytes: Array.from(draft.bytes),
        name: draft.name,
        content_id: slot.getSnapshot().source.contentId,
      },
    );
    const after = await current();
    if (signal?.aborted) return;
    if (
      after.scoreRevision !== before.scoreRevision ||
      after.annotationRevision !== before.annotationRevision
    )
      throw new Error("练习条件已改变。初稿保留，请重新核对演奏顺序。");
    slot.update({
      filePreview: { ...draft, evidence },
      pendingDraft: null,
      tab: "notation",
      message: "初稿已就绪，请核对后决定保存或使用。",
      error: "",
    });
  };
  const changed = (status: ScoreJobStatus) => {
    const previous = slot.getSnapshot().jobStatus;
    if (
      previous?.request.id === status.request.id &&
      previous.phase === status.phase &&
      previous.stage === status.stage &&
      previous.error === status.error &&
      previous.cancellable === status.cancellable
    )
      return;
    const jobStatus = scoreJobProgress(status);
    slot.update({ jobStatus, message: scoreJobMessage(status) });
  };
  const run = async (
    kind: "midiToNotation" | "paperToNotation",
    attachment?: PaperAttachment,
    prepare?: (signal: AbortSignal) => Promise<Uint8Array | undefined>,
    resume = false,
  ) => {
    if (slot.getSnapshot().jobBusy) return;
    const previous = slot.getSnapshot();
    if (
      !resume &&
      previous.job &&
      (!previous.jobStatus ||
        ["preparing", "running"].includes(previous.jobStatus.phase))
    ) {
      const error = "原谱面任务尚未确认结束，请先继续读取或取消原任务。";
      slot.update({ error });
      throw new Error(error);
    }
    slot.update({ jobBusy: true, error: "" });
    if (!resume) slot.update({ job: undefined, jobStatus: undefined });
    const controller = new AbortController();
    waiting.current = controller;
    try {
      const before = await current();
      let draft: ScoreDraft;
      if (await scoreJobProtocol()) {
        let request = resume ? slot.getSnapshot().job : undefined;
        let preparedPdf: Uint8Array | undefined;
        if (!request) {
          if (prepare) {
            slot.update({ message: "正在整理纸谱图片…" });
            preparedPdf = await prepare(controller.signal);
          }
          if (controller.signal.aborted) return;
          if (!before.stateOrder?.engineId)
            throw new Error("练习室连接尚未准备完成。");
          request = {
            id: crypto.randomUUID(),
            engineId: before.stateOrder.engineId,
            contentId: slot.getSnapshot().source.contentId,
            kind,
            createdAtMs: Date.now(),
          };
          slot.update({
            job: request,
            jobStatus: undefined,
            message: "正在建立谱面任务…",
          });
          const actual = request;
          draft = await readScoreOperation(actual, {
            signal: controller.signal,
            changed,
            submit: async () => {
              slot.update({ submissionPending: true });
              try {
                const submission =
                  kind === "midiToNotation"
                    ? api.startMidiScoreJob(actual)
                    : api.startPaperScoreJob(
                        actual,
                        attachment!.id,
                        attachment!.pages.map((page) => ({
                          id: page.id,
                          kind: page.kind,
                        })),
                        preparedPdf,
                        {
                          signal: controller.signal,
                          shouldCancel: () =>
                            slot.getSnapshot().job?.id !== actual.id,
                          progress: (sent, total) => {
                            if (slot.getSnapshot().job?.id === actual.id)
                              slot.update({
                                message: `正在传输识谱 PDF：${Math.round((sent / total) * 100)}%`,
                              });
                          },
                        },
                      );
                preparedPdf = undefined;
                return await submission;
              } finally {
                if (slot.getSnapshot().job?.id === actual.id)
                  slot.update({ submissionPending: false });
              }
            },
          });
        } else {
          const actual = request;
          draft = await readScoreOperation(actual, {
            signal: controller.signal,
            changed,
            awaitingAdmission: () =>
              slot.getSnapshot().job?.id === actual.id &&
              slot.getSnapshot().submissionPending,
          });
        }
      } else {
        if (resume) throw new Error("当前版本需要重新生成初稿。");
        if (kind === "midiToNotation")
          draft = await api.generateDuetScore(
            slot.getSnapshot().source.contentId,
          );
        else {
          const pdf = await prepare?.(controller.signal);
          if (controller.signal.aborted) return;
          draft = await api.recognizePaperWithAudiveris(
            slot.getSnapshot().source.contentId,
            attachment!.id,
            attachment!.pages.map((page) => ({ id: page.id, kind: page.kind })),
            pdf,
          );
        }
      }
      await checkDraft(
        {
          ...draft,
          bytes: Uint8Array.from(draft.bytes),
          generated: kind === "midiToNotation",
          recognizedFrom:
            kind === "paperToNotation"
              ? attachment?.name || "纸谱识别初稿"
              : undefined,
        },
        controller.signal,
      );
      slot.update({
        job: undefined,
        jobStatus: undefined,
        submissionPending: false,
      });
      await refreshDrafts().catch(() => {});
    } catch (failure) {
      if (controller.signal.reason === "cancelled") {
        slot.update({
          job: undefined,
          jobStatus: undefined,
          submissionPending: false,
          error: "",
          message: "已取消，原曲目与谱页保留。",
        });
      } else if (failure instanceof PendingScoreJob)
        slot.update({ job: failure.request, error: failure.message });
      else if (failure instanceof CancelledScoreJob)
        slot.update({
          job: undefined,
          jobStatus: undefined,
          submissionPending: false,
          error: "",
          message: failure.message,
        });
      else {
        if (slot.getSnapshot().jobStatus?.phase === "error")
          slot.update({ job: undefined });
        slot.update({
          error: failure instanceof Error ? failure.message : String(failure),
        });
      }
      throw failure;
    } finally {
      if (waiting.current === controller) waiting.current = null;
      if (controller.signal.reason === "cancelled")
        slot.update({
          message: "已取消，原曲目与谱页保留。",
          submissionPending: false,
        });
      slot.update({ jobBusy: false });
    }
  };
  const previewRetained = async () => {
    const draft = slot.getSnapshot().pendingDraft;
    if (!draft || slot.getSnapshot().jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      await checkDraft(draft);
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  const load = async (row: DraftSummary) => {
    if (slot.getSnapshot().jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      const source = await current();
      const draft = await api.readNotationDraft({
        engineId: source.stateOrder!.engineId,
        contentId: row.contentId,
        id: row.id,
      });
      await checkDraft({
        ...draft,
        bytes: Uint8Array.from(draft.bytes),
        generated: row.kind === "midiToNotation",
        imported: row.kind === "importedNotation",
        recognizedFrom:
          row.kind === "paperToNotation" ? "已保留的纸谱识别初稿" : undefined,
      });
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  const remove = async (row: DraftSummary) => {
    if (slot.getSnapshot().jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      const source = await current();
      await api.removeNotationDraft({
        engineId: source.stateOrder!.engineId,
        contentId: row.contentId,
        id: row.id,
      });
      if (slot.getSnapshot().filePreview?.previewToken === row.id)
        slot.update({ filePreview: null });
      if (slot.getSnapshot().pendingDraft?.previewToken === row.id)
        slot.update({ pendingDraft: null });
      await refreshDrafts();
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  const exportCopy = async (row: DraftSummary) => {
    if (slot.getSnapshot().jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      const source = await current();
      const path = await api.exportNotationDraft({
        engineId: source.stateOrder!.engineId,
        contentId: row.contentId,
        id: row.id,
      });
      if (path)
        slot.update({
          message: `初稿副本已保存：${path}`,
          editMessage: `初稿副本已保存：${path}。可以在制谱软件中打开并校正。`,
        });
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  const cancel = async () => {
    const request = slot.getSnapshot().job;
    if (!request) {
      if (waiting.current) {
        waiting.current.abort("cancelled");
        slot.update({ message: "正在停止图片准备…" });
      }
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
          submissionPending: false,
          message: "已取消，原曲目与谱页保留。",
        });
      } else if (status.phase === "ready" && status.draft) {
        slot.update({
          pendingDraft: {
            ...status.draft,
            bytes: Uint8Array.from(status.draft.bytes),
            generated: request.kind === "midiToNotation",
            recognizedFrom:
              request.kind === "paperToNotation" ? "纸谱识别初稿" : undefined,
          },
          message: "原任务已完成，初稿已保留。请核对后保存。",
        });
      }
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      cancelling.current = false;
    }
  };
  const exportRetained = async () => {
    const draft = slot.getSnapshot().pendingDraft;
    if (!draft?.previewToken || slot.getSnapshot().jobBusy) return;
    slot.update({ jobBusy: true, error: "" });
    try {
      const source = await current();
      const path = await api.exportNotationDraftBytes(
        {
          engineId: source.stateOrder!.engineId,
          contentId: slot.getSnapshot().source.contentId,
          id: draft.previewToken,
        },
        draft.name,
        draft.bytes,
      );
      if (path)
        slot.update({
          editMessage: `初稿副本已保存：${path}。可以在制谱软件中打开并校正。`,
        });
    } catch (failure) {
      slot.update({
        error: failure instanceof Error ? failure.message : String(failure),
      });
    } finally {
      slot.update({ jobBusy: false });
    }
  };
  return {
    ...state,
    canCancelPreparation: !!waiting.current && !state.job,
    canExportRetained: nativeJobs && !!state.pendingDraft?.previewToken,
    exportRetained,
    refreshDrafts,
    retainImported,
    retryRetainImported,
    browseDrafts: (
      change: Partial<
        Pick<
          import("./scoreWorkspaceStore").ScoreWorkspace,
          "draftQuery" | "draftPage" | "draftExpanded"
        >
      >,
    ) => slot.update(change),
    recheckPreview: async () => {
      const state = slot.getSnapshot();
      if (!state.filePreview || state.jobBusy) return;
      const draft = retainScorePreview(state.filePreview);
      slot.update({ pendingDraft: draft, filePreview: null });
      await previewRetained();
    },
    run,
    load,
    remove,
    exportCopy,
    cancel,
    previewRetained,
    discardPending: () =>
      slot.update({
        pendingDraft: null,
        message: "已放弃本次待核对内容。已有谱面与本机缓存保留。",
      }),
    resume: () => {
      const job = slot.getSnapshot().job;
      return job &&
        (job.kind === "midiToNotation" || job.kind === "paperToNotation")
        ? run(job.kind, undefined, undefined, true)
        : Promise.resolve();
    },
  };
}
