import { scoreJobProgress } from "../scores/scoreJobProgress";
/** One background status read: a score job admitted earlier and still pending. */
export interface BackgroundRead {
  id: string;
  engineId: string;
  available: () => boolean;
  read: (valid: () => boolean) => Promise<number | void>;
  issue: (message: string) => void;
}
import { api } from "../../api";
import type {
  ScoreJobRequest,
  ScoreJobStatus,
} from "../../engine/commands.generated";
import { scoreJobMessage } from "../scores/scoreJobClient";
import {
  scoreExportSessions,
  scoreExportInputKey,
} from "../scores/scoreExportStore";
import { mediaExportSessions } from "../exports/mediaExportStore";
import { activitySignal } from "./activitySignal";
import type { WorkSources, ProgressContext } from "./workProgressStore";

interface PendingJob {
  row: string;
  request: ScoreJobRequest;
  owned: () => boolean;
  current: () => boolean;
  cancellable: boolean;
  beforeCancel?: () => void;
  apply: (
    status: ScoreJobStatus,
    cancelling?: boolean,
    valid?: () => boolean,
  ) => void | Promise<void>;
  issue: (message: string) => void;
}
const observed = new Map<string, number>();
export const isBackgroundJobLive = (id?: string) =>
  !!id && Date.now() - (observed.get(id) ?? 0) < 5000;
function sameRequest(a: ScoreJobRequest, b: ScoreJobRequest) {
  return (
    a.id === b.id &&
    a.engineId === b.engineId &&
    a.contentId === b.contentId &&
    a.kind === b.kind &&
    a.createdAtMs === b.createdAtMs
  );
}
export function pendingWorkJobs(sources: WorkSources): PendingJob[] {
  const refs: PendingJob[] = [];
  for (const { key, slot, state } of sources.scores.sessions()) {
    for (const pdf of [false, true]) {
      const request = pdf ? state.pdfJob : state.job;
      if (!request) continue;
      const current = () =>
        (pdf ? slot.getSnapshot().pdfJob?.id : slot.getSnapshot().job?.id) ===
        request.id;
      const owned = () => {
        const row = slot.getSnapshot();
        return pdf
          ? row.pdfBusy || row.pdfSubmission || row.pdfAdopting
          : row.jobBusy || row.submissionPending;
      };
      const status = pdf ? state.pdfStatus : state.jobStatus;
      refs.push({
        row: `${pdf ? "pdf" : "scores"}:${key}`,
        request,
        current,
        owned,
        beforeCancel: pdf
          ? () => {
              if (current()) slot.update({ pdfAutoAdopt: false });
            }
          : undefined,
        cancellable:
          (!pdf || !state.pdfAdopting) &&
          (!status ||
            (["preparing", "running"].includes(status.phase) &&
              status.cancellable !== false)),
        issue: (message) => {
          if (current() && !owned())
            slot.update(pdf ? { pdfError: message } : { error: message });
        },
        apply: (status, cancelling) => {
          if (!current() || (owned() && !cancelling)) return;
          const small = scoreJobProgress(status),
            message = scoreJobMessage(status);
          if (owned()) {
            slot.update(
              pdf
                ? { pdfStatus: small, pdfMessage: message }
                : { jobStatus: small, message },
            );
            return;
          }
          if (status.phase === "ready") {
            slot.update(pdf ? { pdfStatus: small } : { jobStatus: small });
            if (pdf) {
              if (!status.pdf || status.pdf.contentId !== request.contentId)
                throw new Error("PDF 任务结果无法完整读取，请返回原任务核对。");
              slot.update({
                pdfLast: status.pdf,
                pdfJob: undefined,
                pdfStatus: small,
                pdfAutoAdopt: false,
                pdfError: "",
                pdfMessage: "PDF 已保留，打开后可预览、加入谱页或另存。",
              });
            } else {
              const draft = status.draft;
              if (
                !draft ||
                !Array.isArray(draft.bytes) ||
                !draft.bytes.length ||
                draft.bytes.length > 4_000_000 ||
                !draft.bytes.every(
                  (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
                )
              )
                throw new Error("初稿数据无法完整读取，请从本机初稿重新打开。");
              const existing = slot.getSnapshot().pendingDraft;
              if (existing && existing.previewToken !== draft.previewToken)
                throw new Error(
                  "原任务已完成。当前正在核对另一份初稿，请先处理当前初稿，再从本机初稿列表打开生成结果。",
                );
              slot.update({
                pendingDraft: {
                  ...draft,
                  bytes: Uint8Array.from(draft.bytes),
                  generated: request.kind === "midiToNotation",
                  recognizedFrom:
                    request.kind === "paperToNotation"
                      ? "已保留的纸谱识别初稿"
                      : undefined,
                },
                job: undefined,
                jobStatus: small,
                error: "",
                message: "初稿已生成并保留，等待核对演奏顺序。",
              });
            }
          } else if (status.phase === "cancelled") {
            slot.update(
              pdf
                ? {
                    pdfJob: undefined,
                    pdfStatus: small,
                    pdfAutoAdopt: false,
                    pdfError: "",
                    pdfMessage: message,
                  }
                : { job: undefined, jobStatus: small, error: "", message },
            );
          } else if (status.phase === "error") {
            slot.update(
              pdf
                ? {
                    pdfJob: undefined,
                    pdfStatus: small,
                    pdfError: status.error || message,
                  }
                : {
                    job: undefined,
                    jobStatus: small,
                    error: status.error || message,
                  },
            );
          } else
            slot.update(
              pdf
                ? { pdfStatus: small, pdfMessage: message, pdfError: "" }
                : { jobStatus: small, message, error: "" },
            );
        },
      });
    }
  }
  for (const { key, slot, state } of scoreExportSessions()) {
    const request = state.job;
    if (!request) continue;
    const current = () => slot.getSnapshot().job?.id === request.id;
    const owned = () => {
      const row = slot.getSnapshot();
      return row.busy || row.saving || row.submitting;
    };
    refs.push({
      row: `score-export:${key}`,
      request,
      current,
      owned,
      cancellable:
        !state.status ||
        (["preparing", "running"].includes(state.status.phase) &&
          state.status.cancellable !== false),
      issue: (message) => {
        if (current() && !owned()) slot.update({ error: message });
      },
      apply: async (status, cancelling, valid = () => true) => {
        if (!current() || (owned() && !cancelling)) return;
        const small = scoreJobProgress(status),
          message = scoreJobMessage(status);
        if (owned()) {
          slot.update({ status: small, message });
          return;
        }
        if (status.phase === "ready") {
          slot.update({
            status: small,
            message: "成品已制作，正在读取原结果…",
          });
          const result = status.preparedExport;
          if (!result || (!result.prepared && !result.preview))
            throw new Error("个人标记谱结果尚未完整读取，请返回原任务核对。");
          if (
            result.input.contentId !== request.contentId ||
            (result.prepared && result.prepared.contentId !== request.contentId)
          )
            throw new Error(
              "个人标记谱的来源与原任务不一致，请返回原任务核对。",
            );
          const artifact = result.prepared
            ? await api.readScoreExport({
                id: result.prepared.id,
                contentId: request.contentId,
                engineId: request.engineId,
              })
            : null;
          if (!valid() || !current() || owned()) return;
          if (
            artifact &&
            (artifact.id !== result.prepared?.id ||
              artifact.contentId !== request.contentId)
          )
            throw new Error("个人标记谱成品身份已改变，原任务继续保留。");
          slot.update({
            status: small,
            job: undefined,
            artifact,
            legacyPreview: artifact ? null : result.preview,
            legacyOptions: artifact ? null : result.input.options,
            legacyKey: artifact ? undefined : scoreExportInputKey(result.input),
            error: "",
            message: artifact
              ? "个人标记谱已按原设置制作，可以另存。"
              : result.warning || "个人标记谱预览已保留。",
          });
        } else if (status.phase === "error" || status.phase === "cancelled")
          slot.update({
            status: small,
            job: undefined,
            error: status.phase === "error" ? status.error || message : "",
            message,
          });
        else slot.update({ status: small, error: "", message });
      },
    });
  }
  for (const { key, slot, state, kind } of mediaExportSessions()) {
    const request = state.job;
    if (!request) continue;
    const current = () => slot.getSnapshot().job?.id === request.id;
    const owned = () =>
      slot.getSnapshot().busy || slot.getSnapshot().submitting;
    refs.push({
      row: `media:${key}`,
      request,
      current,
      owned,
      cancellable:
        !state.status ||
        (["preparing", "running"].includes(state.status.phase) &&
          state.status.cancellable !== false),
      issue: (message) => {
        if (current() && !owned()) slot.update({ error: message });
      },
      apply: (status, cancelling) => {
        if (!current() || (owned() && !cancelling)) return;
        const small = scoreJobProgress(status),
          message = scoreJobMessage(status);
        if (owned()) {
          slot.update({ status: small, message });
          return;
        }
        if (status.phase === "ready") {
          slot.update({ status: small });
          if (
            !status.mediaExport ||
            status.mediaExport.contentId !== request.contentId ||
            status.mediaExport.kind !== kind
          )
            throw new Error("导出成品尚未完整读取，请返回原任务核对。");
          slot.update({
            artifact: status.mediaExport,
            job: undefined,
            status: small,
            error: "",
            message: status.mediaExport.savedPath
              ? `文件已保存：${status.mediaExport.savedPath}`
              : "导出成品已保留，等待另存。",
          });
        } else if (status.phase === "error" || status.phase === "cancelled")
          slot.update({
            status: small,
            job: undefined,
            error: status.phase === "error" ? status.error || message : "",
            message,
          });
        else slot.update({ status: small, error: "", message });
      },
    });
  }
  return refs;
}
export async function cancelBackgroundJob(ref: PendingJob) {
  if (!ref.current() || !ref.cancellable) return;
  ref.beforeCancel?.();
  const status = await api.cancelScoreJob(ref.request);
  if (!sameRequest(ref.request, status.request))
    throw new Error("原任务身份已改变，停止请求尚未确认。");
  await ref.apply(status, true);
  activitySignal.changed();
}
/** Hidden workspaces observe original jobs without adopting results or resubmitting requests. */
export function startBackgroundJobs(
  sources: WorkSources,
  context: () => ProgressContext,
) {
  let stopped = false,
    reading = false,
    cursor = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = new Map<string, { next: number; failures: number }>();
  const reads = (): BackgroundRead[] => {
    const engineId = context().engineId;
    if (!engineId) return [];
    return [
      ...(api.desktop ? pendingWorkJobs(sources) : [])
        .filter((ref) => ref.request.engineId === engineId)
        .map((ref): BackgroundRead => ({
          id: ref.request.id,
          engineId,
          available: () => ref.current() && !ref.owned(),
          issue: ref.issue,
          read: async (valid) => {
            const status = await api.readScoreJob(ref.request);
            if (stopped || context().closing || !ref.current() || ref.owned())
              return;
            if (!status && !valid()) return;
            if (!status)
              throw new Error(
                "暂未读到原任务。原提交编号保留，可打开原入口继续核对。",
              );
            if (!sameRequest(ref.request, status.request))
              throw new Error("原任务身份回复不一致，请打开来源窗口核对。");
            // A completed byte draft can still be kept by its original slot after reconnecting.
            // Other results continue to require the same live connection for cache access.
            const retainedBytes =
              status.phase === "ready" &&
              !!status.draft &&
              ["midiToNotation", "paperToNotation"].includes(ref.request.kind);
            if (!valid() && !retainedBytes) return;
            await ref.apply(status, false, valid);
          },
        })),
    ];
  };
  let currentRead: Promise<void> = Promise.resolve();
  const cycle = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || reading) return;
    const scope = context();
    if (!scope.connected || scope.closing || !scope.engineId) return;
    const all = reads().filter((ref) => ref.available());
    if (!all.length) return;
    const now = Date.now(),
      due = all.filter((ref) => (schedule.get(ref.id)?.next ?? 0) <= now);
    const selected = Array.from(
      { length: Math.min(3, due.length) },
      (_, index) => due[(cursor + index) % due.length],
    );
    if (due.length) cursor = (cursor + selected.length) % due.length;
    reading = true;
    await Promise.allSettled(
      selected.map(async (ref) => {
        const valid = () =>
          !stopped &&
          context().connected &&
          !context().closing &&
          context().engineId === ref.engineId;
        try {
          const delay = await ref.read(valid);
          if (valid()) {
            observed.set(ref.id, Date.now());
            while (observed.size > 128)
              observed.delete(observed.keys().next().value!);
          }
          if (valid() && ref.available())
            schedule.set(ref.id, {
              next: Date.now() + (delay ?? 1000),
              failures: 0,
            });
          else schedule.delete(ref.id);
        } catch (error) {
          if (!valid() || !ref.available()) return;
          const failures = Math.min(
            5,
            (schedule.get(ref.id)?.failures ?? 0) + 1,
          );
          schedule.set(ref.id, {
            next: Date.now() + Math.min(30_000, 1000 * 2 ** failures),
            failures,
          });
          ref.issue(
            `后台进度暂未更新：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
    reading = false;
    activitySignal.changed();
    const remaining = reads().filter((ref) => ref.available());
    const ids = new Set(remaining.map((ref) => ref.id));
    for (const key of schedule.keys()) if (!ids.has(key)) schedule.delete(key);
    if (!stopped && remaining.length) {
      const delay = Math.max(
        150,
        Math.min(
          ...remaining.map(
            (ref) => (schedule.get(ref.id)?.next ?? 0) - Date.now(),
          ),
        ),
      );
      timer = setTimeout(() => void poll(), delay);
    }
  };
  const poll = () => (reading ? currentRead : (currentRead = cycle()));
  const release = activitySignal.subscribe(() => {
    if (!reading && !timer)
      timer = setTimeout(() => {
        timer = undefined;
        void poll();
      }, 150);
  });
  // Persistent preparation stores do not emit the transient inventory signal.
  const releases = [
    sources.exercise,
  ].map((source) =>
    source.subscribe(() => {
      if (!reading && !timer)
        timer = setTimeout(() => {
          timer = undefined;
          void poll();
        }, 150);
    }),
  );
  void poll();
  return {
    refresh: () => {
      schedule.clear();
      clearTimeout(timer);
      timer = undefined;
      return poll();
    },
    wake: () => {
      if (!reading) {
        clearTimeout(timer);
        timer = undefined;
        void poll();
      }
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      release();
      releases.forEach((release) => release());
    },
  };
}
