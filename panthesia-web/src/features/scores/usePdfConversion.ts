import { scoreJobProgress } from "./scoreJobProgress";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../api";
import type {
  PdfDraft,
  ScoreJobRequest,
  ScoreJobStatus,
} from "../../engine/commands.generated";
import {
  CancelledScoreJob,
  PendingScoreJob,
  readPdfOperation,
  scoreJobMessage,
  scoreJobProtocol,
} from "./scoreJobClient";
import type { ScoreWorkspaceSlot } from "./scoreWorkspaceStore";

const message = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);
export function usePdfConversion(
  slot: ScoreWorkspaceSlot,
  afterSaved: () => Promise<void>,
) {
  const state = useSyncExternalStore(
    slot.subscribe,
    slot.getSnapshot,
    slot.getSnapshot,
  );
  const [preview, setPreview] = useState<File | null>(null),
    [supported, setSupported] = useState(false);
  const waiting = useRef<AbortController | null>(null),
    alive = useRef(true),
    cancelling = useRef(false);
  useEffect(() => {
    alive.current = true;
    setPreview(null);
    return () => {
      alive.current = false;
      waiting.current?.abort();
    };
  }, [slot]);
  const current = async () => {
    const before = slot.getSnapshot().source,
      actual = await api.state();
    if (
      actual.contentId !== before.contentId ||
      (before.engineId && actual.stateOrder?.engineId !== before.engineId)
    )
      throw new Error("曲目或连接已改变，请返回来源曲目后继续处理 PDF。");
    return actual.stateOrder?.engineId;
  };
  const selection = async (draft: PdfDraft, requireCurrent = false) => {
    const engineId = await current();
    if (
      requireCurrent &&
      draft.contentId !== slot.getSnapshot().source.contentId
    )
      throw new Error("请返回这份 PDF 的来源曲目后再加入谱页。");
    if (!engineId) throw new Error("练习室连接尚未准备完成。");
    return {
      engineId,
      contentId: draft.contentId,
      id: draft.id,
    };
  };
  const refresh = async (all = slot.getSnapshot().pdfAll) => {
    if (!api.desktop || (await scoreJobProtocol()) < 2) return;
    if (alive.current) setSupported(true);
    const latest = slot.beginPdfRead();
    slot.update({ pdfAll: all });
    try {
      const engineId = await current();
      if (!engineId) return;
      const value = await api.listPdfDrafts(
        engineId,
        all ? undefined : slot.getSnapshot().source.contentId,
      );
      if (latest())
        slot.update({
          pdfDrafts: value.drafts,
          pdfIssues: value.issues,
          pdfTotal: value.total,
        });
    } catch (failure) {
      if (latest())
        slot.update({
          pdfIssues: [`PDF 缓存列表暂未读到新结果：${message(failure)}`],
        });
      throw failure;
    }
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, [slot]);
  const changed = (status: ScoreJobStatus) => {
    const previous = slot.getSnapshot().pdfStatus;
    if (
      previous?.request.id === status.request.id &&
      previous.phase === status.phase &&
      previous.stage === status.stage &&
      previous.error === status.error
    )
      return;
    const pdfStatus = scoreJobProgress(status);
    slot.update({
      pdfStatus,
      pdfMessage:
        status.phase === "ready" ? "排版 PDF 已保留" : scoreJobMessage(status),
    });
  };
  const adopt = async (draft: PdfDraft, owned = false) => {
    if (
      !owned &&
      (slot.getSnapshot().pdfBusy ||
        slot.getSnapshot().pdfSubmission ||
        slot.getSnapshot().jobBusy ||
        slot.getSnapshot().submissionPending)
    )
      return;
    const allowAdopt = !draft.paperId || draft.adoptionPending;
    slot.update({
      pdfBusy: true,
      pdfAdopting: true,
      pdfError: "",
      pdfMessage: allowAdopt
        ? "正在加入 PDF 谱面，已完成的排版保留…"
        : "正在核对已保存的 PDF 谱页…",
    });
    try {
      const result = await api.adoptPdfDraft(
        await selection(draft, true),
        allowAdopt,
      );
      slot.update({
        pdfLast: result,
        pdfMessage: result.paperId
          ? "PDF 已加入当前曲目，可在 PDF / 图片谱面中查看。"
          : "PDF 已保留，加入结果尚未确认。",
        pdfError: result.paperId
          ? result.warning || ""
          : result.warning || "请重新确认加入结果。",
      });
      if (result.paperId) {
        slot.update({ tab: "paper" });
        try {
          await afterSaved();
        } catch (failure) {
          slot.update({ pdfError: message(failure) });
        }
      }
      await refresh().catch(() => {});
    } catch (failure) {
      slot.update({ pdfError: message(failure) });
    } finally {
      slot.update({ pdfAdopting: false, ...(owned ? {} : { pdfBusy: false }) });
    }
  };
  const run = async (versionId?: string, resume = false) => {
    const before = slot.getSnapshot();
    if (before.pdfBusy || before.jobBusy || before.submissionPending) return;
    if (
      !resume &&
      before.pdfJob &&
      (!before.pdfStatus ||
        ["preparing", "running"].includes(before.pdfStatus.phase))
    ) {
      slot.update({
        pdfError: "原 PDF 排版任务尚未确认结束，请先继续读取或取消原任务。",
      });
      return;
    }
    slot.update({
      pdfBusy: true,
      pdfError: "",
      pdfMessage: "正在准备 PDF 排版…",
    });
    const controller = new AbortController();
    waiting.current = controller;
    try {
      const engineId = await current();
      if ((await scoreJobProtocol()) < 2) {
        if (!versionId || resume)
          throw new Error("当前版本需要从原谱重新生成 PDF。");
        await api.addMuseScorePdf(
          slot.getSnapshot().source.contentId,
          versionId,
        );
        slot.update({ tab: "paper", pdfMessage: "PDF 已加入当前曲目。" });
        await afterSaved();
        return;
      }
      let request = resume ? before.pdfJob : undefined;
      let draft: PdfDraft;
      if (!request) {
        if (!versionId || !engineId)
          throw new Error("原谱版本或练习室连接尚未准备完成。");
        request = {
          id: crypto.randomUUID(),
          engineId,
          contentId: before.source.contentId,
          kind: "notationToPdf",
          createdAtMs: Date.now(),
        };
        slot.update({
          pdfJob: request,
          pdfStatus: undefined,
          pdfAutoAdopt: true,
        });
        const actual = request;
        draft = await readPdfOperation(actual, {
          signal: controller.signal,
          changed,
          submit: async () => {
            slot.update({ pdfSubmission: true });
            try {
              return await api.preparePdfDraft(
                actual,
                versionId!,
                before.source.title,
              );
            } finally {
              if (slot.getSnapshot().pdfJob?.id === actual.id)
                slot.update({ pdfSubmission: false });
            }
          },
        });
      } else {
        const actual = request;
        draft = await readPdfOperation(actual, {
          signal: controller.signal,
          changed,
          awaitingAdmission: () =>
            slot.getSnapshot().pdfJob?.id === actual.id &&
            slot.getSnapshot().pdfSubmission,
        });
      }
      slot.update({
        pdfLast: draft,
        pdfJob: undefined,
        pdfStatus: undefined,
        pdfSubmission: false,
        pdfMessage: "排版 PDF 已保留。",
      });
      await refresh().catch(() => {});
      if (
        !controller.signal.aborted &&
        !draft.warning &&
        slot.getSnapshot().pdfAutoAdopt
      )
        await adopt(draft, true);
    } catch (failure) {
      if (
        controller.signal.reason === "cancelled" ||
        failure instanceof CancelledScoreJob
      )
        slot.update({
          pdfJob: undefined,
          pdfSubmission: false,
          pdfStatus: undefined,
          pdfError: "",
          pdfMessage: "排版已取消，原谱与已保存的谱页保留。",
        });
      else if (failure instanceof PendingScoreJob)
        slot.update({ pdfJob: failure.request, pdfError: failure.message });
      else {
        if (slot.getSnapshot().pdfStatus?.phase === "error")
          slot.update({ pdfJob: undefined });
        slot.update({ pdfError: message(failure) });
      }
    } finally {
      if (waiting.current === controller) waiting.current = null;
      slot.update({ pdfBusy: false });
    }
  };
  const cancel = async () => {
    const request = slot.getSnapshot().pdfJob;
    if (!request || cancelling.current || slot.getSnapshot().pdfAdopting)
      return;
    cancelling.current = true;
    slot.update({ pdfAutoAdopt: false });
    try {
      const status = await api.cancelScoreJob(request);
      if (slot.getSnapshot().pdfJob?.id !== request.id) return;
      changed(status);
      if (status.phase === "cancelled") {
        waiting.current?.abort("cancelled");
        slot.update({
          pdfJob: undefined,
          pdfSubmission: false,
          pdfMessage: "排版已取消，原谱保留。",
        });
      } else if (status.pdf) {
        slot.update({
          pdfLast: status.pdf,
          pdfMessage: "排版已完成，PDF 保留，尚未自动加入谱页。",
        });
        await refresh().catch(() => {});
      }
    } catch (failure) {
      slot.update({ pdfError: message(failure) });
    } finally {
      cancelling.current = false;
    }
  };
  const action = async (
    draft: PdfDraft,
    kind: "view" | "export" | "remove",
  ) => {
    if (slot.getSnapshot().pdfBusy || slot.getSnapshot().pdfSubmission) return;
    slot.update({ pdfBusy: true, pdfError: "" });
    try {
      const request = await selection(draft);
      if (kind === "view") {
        const bytes = await api.readPdfDraftBytes(request);
        if (alive.current)
          setPreview(
            new File([bytes.slice().buffer], draft.name, {
              type: "application/pdf",
            }),
          );
      } else if (kind === "export") {
        const path = await api.exportPdfDraft(request);
        if (path) slot.update({ pdfMessage: `PDF 副本已保存：${path}` });
      } else {
        await api.removePdfDraft(request);
        if (slot.getSnapshot().pdfLast?.id === draft.id)
          slot.update({ pdfLast: undefined });
        await refresh();
      }
    } catch (failure) {
      slot.update({ pdfError: message(failure) });
    } finally {
      slot.update({ pdfBusy: false });
    }
  };
  return {
    ...state,
    supported,
    preview,
    closePreview: () => setPreview(null),
    refresh,
    run,
    resume: () => run(undefined, true),
    adopt,
    cancel,
    action,
  };
}
